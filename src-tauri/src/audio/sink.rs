//! Native Media Sink Boundary & Output Router
//!
//! # Architectural Boundary:
//! ```text
//! MASTER AUDIO (AudioEngine Realtime Processing Loop - Domain A)
//!        ↓
//! MASTER TAP DISTRIBUTION (Non-blocking Bounded Ring Buffers)
//!   ├── Native SHOUTcast (MP3 Encoder Worker & TCP Network Stream)
//!   ├── Master Recorder (Lossless WAV Writer Worker)
//!   └── NativeOutputRouter (Dedicated Native Fan-Out Dispatcher)
//!             ├── MediaSink Worker 1 (e.g. ReferenceMediaSink)
//!             ├── MediaSink Worker 2 (e.g. RtmpMediaSink - Future RTMP)
//!             └── MediaSink Worker N (Extensible Plugin-Backed Sinks)
//! ```
//!
//! # Realtime Safety & Isolation Guarantees:
//! 1. The realtime audio callback NEVER executes blocking mutex operations on sinks,
//!    network I/O, filesystem operations, or dynamic allocation.
//! 2. Master PCM blocks (canonical 48kHz stereo interleaved f32) are distributed via
//!    lock-free/bounded `try_send` queues using `Arc<Vec<f32>>` to avoid redundant heap copies.
//! 3. Each active `MediaSink` runs inside its own isolated output worker thread. A failure or
//!    slowdown in one sink (e.g. network stall) causes bounded frame-dropping strictly for that
//!    sink, without impacting SHOUTcast, the recorder, or the master audio engine.

use crossbeam_channel::{bounded, Receiver, RecvTimeoutError, Sender, TrySendError};
use parking_lot::{Mutex, RwLock};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const SINK_QUEUE_CAPACITY: usize = 64; // ~640ms buffer at 10ms blocks

/// Audio sample formats supported by Native Media Sinks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MediaSampleFormat {
    /// Canonical 32-bit floating point, interleaved stereo (-1.0 to 1.0).
    F32Le,
    /// 16-bit signed integer PCM, little-endian, interleaved stereo.
    I16Le,
}

/// Strict lifecycle state of a Native Media Sink.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MediaSinkState {
    /// Sink is uninitialized or closed.
    Closed,
    /// Sink is opened and configured with audio parameters, ready to start.
    Opened,
    /// Sink is actively consuming PCM frames and streaming to transport destination.
    Streaming,
    /// Sink is flushing pending encoded frames before shutdown.
    Flushing,
    /// Sink has paused or stopped transmission.
    Stopped,
    /// Sink has encountered a network, encoder, or operational error.
    Error(String),
}

/// Media Sink Configuration provided when opening the sink.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaSinkConfig {
    pub id: String,
    pub name: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub sample_format: MediaSampleFormat,
    pub frame_size: usize,
    pub endpoint: Option<String>,
}

impl Default for MediaSinkConfig {
    fn default() -> Self {
        Self {
            id: "default-sink".to_string(),
            name: "Default Native Media Sink".to_string(),
            sample_rate: 48000,
            channels: 2,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: None,
        }
    }
}

/// Telemetry metrics for a Native Media Sink.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct MediaSinkMetrics {
    pub frames_written: u64,
    pub bytes_sent: u64,
    pub dropped_frames: u64,
    pub errors_count: u64,
    pub state_label: String,
}

/// Error type for Native Media Sink operations.
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum MediaSinkError {
    #[error("Media sink is already open")]
    AlreadyOpen,
    #[error("Media sink is closed or not initialized")]
    NotInitialized,
    #[error("Invalid audio format: expected {expected_channels}ch {expected_rate}Hz")]
    InvalidAudioFormat {
        expected_channels: u16,
        expected_rate: u32,
    },
    #[error("Transport connection error: {0}")]
    Transport(String),
    #[error("Buffer overrun: dropped {0} frames")]
    BufferOverrun(usize),
}

/// Core contract representing a Native Media Sink.
pub trait MediaSink: Send + Sync {
    /// Opens the sink with the specified configuration.
    fn open(&mut self, config: MediaSinkConfig) -> Result<(), MediaSinkError>;

    /// Starts streaming audio. Transitions state from Opened to Streaming.
    fn start(&mut self) -> Result<(), MediaSinkError>;

    /// Consumes an interleaved stereo audio block from Master Bus.
    /// Canonical Broadcst Studio block: 48kHz stereo f32 (480 frames = 960 samples).
    fn write_block(&mut self, pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError>;

    /// Flushes any pending encoded audio buffers to transport.
    fn flush(&mut self) -> Result<(), MediaSinkError>;

    /// Stops audio streaming. Transitions state to Stopped.
    fn stop(&mut self) -> Result<(), MediaSinkError>;

    /// Closes the sink and releases all native resources.
    fn close(&mut self) -> Result<(), MediaSinkError>;

    /// Returns the current operational state of the sink.
    fn state(&self) -> MediaSinkState;

    /// Returns telemetry metrics.
    fn metrics(&self) -> MediaSinkMetrics;

    /// Returns sink identifier.
    fn id(&self) -> &str;
}

/// Reference architectural implementation of a Native Media Sink.
/// Consumes real master PCM frames in developer diagnostic mode without transmitting externally.
pub struct ReferenceMediaSink {
    config: Option<MediaSinkConfig>,
    state: MediaSinkState,
    frames_written: Arc<AtomicU64>,
    dropped_frames: Arc<AtomicU64>,
    is_streaming: Arc<AtomicBool>,
}

impl ReferenceMediaSink {
    pub fn new() -> Self {
        Self {
            config: None,
            state: MediaSinkState::Closed,
            frames_written: Arc::new(AtomicU64::new(0)),
            dropped_frames: Arc::new(AtomicU64::new(0)),
            is_streaming: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl Default for ReferenceMediaSink {
    fn default() -> Self {
        Self::new()
    }
}

impl MediaSink for ReferenceMediaSink {
    fn open(&mut self, config: MediaSinkConfig) -> Result<(), MediaSinkError> {
        if self.state == MediaSinkState::Streaming {
            return Err(MediaSinkError::AlreadyOpen);
        }
        if config.sample_rate != 48000 || config.channels != 2 {
            return Err(MediaSinkError::InvalidAudioFormat {
                expected_channels: 2,
                expected_rate: 48000,
            });
        }
        self.config = Some(config);
        self.state = MediaSinkState::Opened;
        Ok(())
    }

    fn start(&mut self) -> Result<(), MediaSinkError> {
        if self.state == MediaSinkState::Closed {
            return Err(MediaSinkError::NotInitialized);
        }
        self.state = MediaSinkState::Streaming;
        self.is_streaming.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn write_block(&mut self, pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError> {
        if self.state != MediaSinkState::Streaming {
            return Err(MediaSinkError::NotInitialized);
        }
        let frames = pcm_interleaved.len() / 2;
        self.frames_written.fetch_add(frames as u64, Ordering::Relaxed);
        Ok(frames)
    }

    fn flush(&mut self) -> Result<(), MediaSinkError> {
        if self.state == MediaSinkState::Streaming {
            self.state = MediaSinkState::Flushing;
        }
        Ok(())
    }

    fn stop(&mut self) -> Result<(), MediaSinkError> {
        self.is_streaming.store(false, Ordering::SeqCst);
        self.state = MediaSinkState::Stopped;
        Ok(())
    }

    fn close(&mut self) -> Result<(), MediaSinkError> {
        self.is_streaming.store(false, Ordering::SeqCst);
        self.state = MediaSinkState::Closed;
        self.config = None;
        Ok(())
    }

    fn state(&self) -> MediaSinkState {
        self.state.clone()
    }

    fn metrics(&self) -> MediaSinkMetrics {
        MediaSinkMetrics {
            frames_written: self.frames_written.load(Ordering::Relaxed),
            bytes_sent: 0,
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
            errors_count: 0,
            state_label: format!("{:?}", self.state),
        }
    }

    fn id(&self) -> &str {
        self.config.as_ref().map(|c| c.id.as_str()).unwrap_or("reference-sink")
    }
}

/// Forward-looking RTMP Media Sink abstraction.
///
/// Implements `MediaSink` for RTMP/RTMPS stream targets (e.g. Telegram Live, YouTube, Twitch).
/// Encapsulates endpoint negotiation and stream lifecycle without hardcoding platform-specific
/// details into the core audio engine.
pub struct RtmpMediaSink {
    config: Option<MediaSinkConfig>,
    state: MediaSinkState,
    frames_written: Arc<AtomicU64>,
    bytes_sent: Arc<AtomicU64>,
    dropped_frames: Arc<AtomicU64>,
    is_streaming: Arc<AtomicBool>,
}

impl RtmpMediaSink {
    pub fn new(id: impl Into<String>, name: impl Into<String>, endpoint: Option<String>) -> Self {
        let config = MediaSinkConfig {
            id: id.into(),
            name: name.into(),
            sample_rate: 48000,
            channels: 2,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint,
        };

        Self {
            config: Some(config),
            state: MediaSinkState::Opened,
            frames_written: Arc::new(AtomicU64::new(0)),
            bytes_sent: Arc::new(AtomicU64::new(0)),
            dropped_frames: Arc::new(AtomicU64::new(0)),
            is_streaming: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl MediaSink for RtmpMediaSink {
    fn open(&mut self, config: MediaSinkConfig) -> Result<(), MediaSinkError> {
        if config.sample_rate != 48000 || config.channels != 2 {
            return Err(MediaSinkError::InvalidAudioFormat {
                expected_channels: 2,
                expected_rate: 48000,
            });
        }
        self.config = Some(config);
        self.state = MediaSinkState::Opened;
        Ok(())
    }

    fn start(&mut self) -> Result<(), MediaSinkError> {
        if self.state == MediaSinkState::Closed {
            return Err(MediaSinkError::NotInitialized);
        }
        self.state = MediaSinkState::Streaming;
        self.is_streaming.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn write_block(&mut self, pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError> {
        if self.state != MediaSinkState::Streaming {
            return Err(MediaSinkError::NotInitialized);
        }
        let frames = pcm_interleaved.len() / 2;
        self.frames_written.fetch_add(frames as u64, Ordering::Relaxed);
        Ok(frames)
    }

    fn flush(&mut self) -> Result<(), MediaSinkError> {
        if self.state == MediaSinkState::Streaming {
            self.state = MediaSinkState::Flushing;
        }
        Ok(())
    }

    fn stop(&mut self) -> Result<(), MediaSinkError> {
        self.is_streaming.store(false, Ordering::SeqCst);
        self.state = MediaSinkState::Stopped;
        Ok(())
    }

    fn close(&mut self) -> Result<(), MediaSinkError> {
        self.is_streaming.store(false, Ordering::SeqCst);
        self.state = MediaSinkState::Closed;
        Ok(())
    }

    fn state(&self) -> MediaSinkState {
        self.state.clone()
    }

    fn metrics(&self) -> MediaSinkMetrics {
        MediaSinkMetrics {
            frames_written: self.frames_written.load(Ordering::Relaxed),
            bytes_sent: self.bytes_sent.load(Ordering::Relaxed),
            dropped_frames: self.dropped_frames.load(Ordering::Relaxed),
            errors_count: 0,
            state_label: format!("{:?}", self.state),
        }
    }

    fn id(&self) -> &str {
        self.config.as_ref().map(|c| c.id.as_str()).unwrap_or("rtmp-sink")
    }
}

/// DTO for bridging native media sink state to Tauri IPC and frontend OutputRouter.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaSinkStatusDto {
    pub id: String,
    pub name: String,
    pub state: String,
    pub is_streaming: bool,
    pub frames_written: u64,
    pub bytes_sent: u64,
    pub dropped_frames: u64,
    pub errors_count: u64,
    pub endpoint: Option<String>,
    pub error_message: Option<String>,
}

/// Isolated worker managing an individual MediaSink instance on its own OS thread.
struct SinkWorkerHandle {
    id: String,
    name: String,
    endpoint: Option<String>,
    pcm_tx: Sender<Arc<Vec<f32>>>,
    dropped_frames: Arc<AtomicU64>,
    is_running: Arc<AtomicBool>,
    state: Arc<RwLock<MediaSinkState>>,
    metrics: Arc<RwLock<MediaSinkMetrics>>,
    worker_handle: Option<JoinHandle<()>>,
}

/// Native Output Router managing the distribution of Master Audio to registered Media Sinks.
pub struct NativeOutputRouter {
    sinks: Arc<RwLock<HashMap<String, SinkWorkerHandle>>>,
    dispatch_worker: Arc<Mutex<Option<JoinHandle<()>>>>,
    is_dispatching: Arc<AtomicBool>,
}

impl NativeOutputRouter {
    pub fn new() -> Self {
        Self {
            sinks: Arc::new(RwLock::new(HashMap::new())),
            dispatch_worker: Arc::new(Mutex::new(None)),
            is_dispatching: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Starts the background dispatch worker thread consuming master tap blocks.
    pub fn start_dispatch_worker(&self, tap_rx: Receiver<Arc<Vec<f32>>>) {
        let is_running = self.is_dispatching.clone();
        is_running.store(true, Ordering::SeqCst);

        let sinks_ref = self.sinks.clone();

        let handle = thread::spawn(move || {
            while is_running.load(Ordering::Relaxed) {
                match tap_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(block) => {
                        // Fan-out to registered sinks outside the audio thread
                        let sinks_guard = sinks_ref.read();
                        for sink_handle in sinks_guard.values() {
                            if sink_handle.is_running.load(Ordering::Relaxed) {
                                match sink_handle.pcm_tx.try_send(block.clone()) {
                                    Ok(()) => {}
                                    Err(TrySendError::Full(_)) => {
                                        // Bounded Backpressure: Drop frame for this slow sink only
                                        sink_handle.dropped_frames.fetch_add(480, Ordering::Relaxed);
                                        let mut m = sink_handle.metrics.write();
                                        m.dropped_frames = sink_handle.dropped_frames.load(Ordering::Relaxed);
                                    }
                                    Err(TrySendError::Disconnected(_)) => {}
                                }
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
        });

        *self.dispatch_worker.lock() = Some(handle);
    }

    /// Stops the router dispatch worker.
    pub fn stop_dispatch_worker(&self) {
        self.is_dispatching.store(false, Ordering::SeqCst);
        if let Some(h) = self.dispatch_worker.lock().take() {
            let _ = h.join();
        }
    }

    /// Registers a new native MediaSink into its own isolated worker thread.
    pub fn register_sink(
        &self,
        mut sink: Box<dyn MediaSink>,
        config: MediaSinkConfig,
    ) -> Result<(), MediaSinkError> {
        let id = config.id.clone();
        let name = config.name.clone();
        let endpoint = config.endpoint.clone();

        sink.open(config)?;
        sink.start()?;

        let (pcm_tx, pcm_rx) = bounded::<Arc<Vec<f32>>>(SINK_QUEUE_CAPACITY);
        let dropped_frames = Arc::new(AtomicU64::new(0));
        let is_running = Arc::new(AtomicBool::new(true));
        let state = Arc::new(RwLock::new(sink.state()));
        let metrics = Arc::new(RwLock::new(sink.metrics()));

        let is_running_clone = is_running.clone();
        let state_clone = state.clone();
        let metrics_clone = metrics.clone();

        let worker = thread::spawn(move || {
            while is_running_clone.load(Ordering::Relaxed) {
                match pcm_rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(pcm_block) => {
                        match sink.write_block(&pcm_block) {
                            Ok(_) => {
                                *metrics_clone.write() = sink.metrics();
                                *state_clone.write() = sink.state();
                            }
                            Err(err) => {
                                // Error Isolation: Only this sink enters Error state
                                let err_str = err.to_string();
                                *state_clone.write() = MediaSinkState::Error(err_str);
                                is_running_clone.store(false, Ordering::Relaxed);
                                break;
                            }
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }

            let is_error = matches!(&*state_clone.read(), MediaSinkState::Error(_));
            let _ = sink.stop();
            let _ = sink.close();
            if !is_error {
                *state_clone.write() = sink.state();
            }
            *metrics_clone.write() = sink.metrics();
        });

        let handle = SinkWorkerHandle {
            id: id.clone(),
            name,
            endpoint,
            pcm_tx,
            dropped_frames,
            is_running,
            state,
            metrics,
            worker_handle: Some(worker),
        };

        self.sinks.write().insert(id, handle);
        Ok(())
    }

    /// Unregisters and gracefully shuts down an active media sink.
    pub fn unregister_sink(&self, id: &str) -> bool {
        let mut sinks_guard = self.sinks.write();
        if let Some(mut handle) = sinks_guard.remove(id) {
            handle.is_running.store(false, Ordering::SeqCst);
            if let Some(w) = handle.worker_handle.take() {
                let _ = w.join();
            }
            true
        } else {
            false
        }
    }

    /// Dispatches a master audio PCM block to all registered sinks.
    /// Used by tests or direct dispatch.
    pub fn dispatch_master_block(&self, block: Arc<Vec<f32>>) {
        let sinks_guard = self.sinks.read();
        for sink_handle in sinks_guard.values() {
            if sink_handle.is_running.load(Ordering::Relaxed) {
                match sink_handle.pcm_tx.try_send(block.clone()) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        sink_handle.dropped_frames.fetch_add(480, Ordering::Relaxed);
                        let mut m = sink_handle.metrics.write();
                        m.dropped_frames = sink_handle.dropped_frames.load(Ordering::Relaxed);
                    }
                    Err(TrySendError::Disconnected(_)) => {}
                }
            }
        }
    }

    /// Returns the count of registered sinks.
    pub fn sink_count(&self) -> usize {
        self.sinks.read().len()
    }

    /// Fetches live status DTOs for all registered sinks.
    pub fn get_sink_statuses(&self) -> Vec<MediaSinkStatusDto> {
        let sinks_guard = self.sinks.read();
        sinks_guard
            .values()
            .map(|h| {
                let st = h.state.read().clone();
                let m = h.metrics.read().clone();

                let (state_str, is_streaming, err_msg) = match &st {
                    MediaSinkState::Streaming => ("STREAMING".to_string(), true, None),
                    MediaSinkState::Opened => ("OPENED".to_string(), false, None),
                    MediaSinkState::Closed => ("CLOSED".to_string(), false, None),
                    MediaSinkState::Flushing => ("FLUSHING".to_string(), false, None),
                    MediaSinkState::Stopped => ("STOPPED".to_string(), false, None),
                    MediaSinkState::Error(err) => ("ERROR".to_string(), false, Some(err.clone())),
                };

                MediaSinkStatusDto {
                    id: h.id.clone(),
                    name: h.name.clone(),
                    state: state_str,
                    is_streaming,
                    frames_written: m.frames_written,
                    bytes_sent: m.bytes_sent,
                    dropped_frames: m.dropped_frames,
                    errors_count: m.errors_count,
                    endpoint: h.endpoint.clone(),
                    error_message: err_msg,
                }
            })
            .collect()
    }
}

impl Default for NativeOutputRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl Drop for NativeOutputRouter {
    fn drop(&mut self) {
        self.stop_dispatch_worker();
        let mut sinks_guard = self.sinks.write();
        for (_, mut handle) in sinks_guard.drain() {
            handle.is_running.store(false, Ordering::SeqCst);
            if let Some(w) = handle.worker_handle.take() {
                let _ = w.join();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailingSink {
        id: String,
        state: MediaSinkState,
    }

    impl FailingSink {
        fn new(id: &str) -> Self {
            Self {
                id: id.to_string(),
                state: MediaSinkState::Closed,
            }
        }
    }

    impl MediaSink for FailingSink {
        fn open(&mut self, _config: MediaSinkConfig) -> Result<(), MediaSinkError> {
            self.state = MediaSinkState::Opened;
            Ok(())
        }

        fn start(&mut self) -> Result<(), MediaSinkError> {
            self.state = MediaSinkState::Streaming;
            Ok(())
        }

        fn write_block(&mut self, _pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError> {
            // Emulate immediate hardware or network failure
            Err(MediaSinkError::Transport("Simulated socket write error".to_string()))
        }

        fn flush(&mut self) -> Result<(), MediaSinkError> {
            Ok(())
        }

        fn stop(&mut self) -> Result<(), MediaSinkError> {
            self.state = MediaSinkState::Stopped;
            Ok(())
        }

        fn close(&mut self) -> Result<(), MediaSinkError> {
            self.state = MediaSinkState::Closed;
            Ok(())
        }

        fn state(&self) -> MediaSinkState {
            self.state.clone()
        }

        fn metrics(&self) -> MediaSinkMetrics {
            MediaSinkMetrics::default()
        }

        fn id(&self) -> &str {
            &self.id
        }
    }

    #[test]
    fn test_media_sink_lifecycle_transitions() {
        let mut sink = ReferenceMediaSink::new();
        assert_eq!(sink.state(), MediaSinkState::Closed);

        let block = vec![0.0f32; 960];
        assert!(sink.write_block(&block).is_err());

        let config = MediaSinkConfig {
            id: "test-ref".to_string(),
            name: "Test Reference Sink".to_string(),
            sample_rate: 48000,
            channels: 2,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: Some("rtmps://test.endpoint/live".to_string()),
        };
        assert!(sink.open(config).is_ok());
        assert_eq!(sink.state(), MediaSinkState::Opened);

        assert!(sink.start().is_ok());
        assert_eq!(sink.state(), MediaSinkState::Streaming);

        let written = sink.write_block(&block).expect("write should succeed");
        assert_eq!(written, 480);
        assert_eq!(sink.metrics().frames_written, 480);

        assert!(sink.stop().is_ok());
        assert_eq!(sink.state(), MediaSinkState::Stopped);

        assert!(sink.close().is_ok());
        assert_eq!(sink.state(), MediaSinkState::Closed);
    }

    #[test]
    fn test_media_sink_rejects_invalid_format() {
        let mut sink = ReferenceMediaSink::new();
        let invalid_config = MediaSinkConfig {
            id: "bad-format".to_string(),
            name: "Bad Format Sink".to_string(),
            sample_rate: 44100,
            channels: 1,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: None,
        };
        let res = sink.open(invalid_config);
        assert!(matches!(res, Err(MediaSinkError::InvalidAudioFormat { .. })));
    }

    #[test]
    fn test_native_output_router_fanout_and_isolation() {
        let router = NativeOutputRouter::new();

        // 1. Register good reference sink
        let sink_good = Box::new(ReferenceMediaSink::new());
        let config_good = MediaSinkConfig {
            id: "good-sink".to_string(),
            name: "Good Sink".to_string(),
            sample_rate: 48000,
            channels: 2,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: None,
        };
        router.register_sink(sink_good, config_good).unwrap();

        // 2. Register failing sink
        let sink_failing = Box::new(FailingSink::new("failing-sink"));
        let config_failing = MediaSinkConfig {
            id: "failing-sink".to_string(),
            name: "Failing Sink".to_string(),
            sample_rate: 48000,
            channels: 2,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: None,
        };
        router.register_sink(sink_failing, config_failing).unwrap();

        assert_eq!(router.sink_count(), 2);

        // 3. Dispatch master blocks
        let block = Arc::new(vec![0.1f32; 960]);
        for _ in 0..5 {
            router.dispatch_master_block(block.clone());
        }

        // Give workers time to process
        thread::sleep(Duration::from_millis(80));

        let statuses = router.get_sink_statuses();
        let good_status = statuses.iter().find(|s| s.id == "good-sink").unwrap();
        let failing_status = statuses.iter().find(|s| s.id == "failing-sink").unwrap();

        // Verify Error Isolation: Good sink keeps streaming despite failing sink!
        assert_eq!(good_status.state, "STREAMING");
        assert!(good_status.frames_written >= 480);

        assert_eq!(failing_status.state, "ERROR");
        assert!(failing_status.error_message.is_some());

        assert!(router.unregister_sink("good-sink"));
        assert!(router.unregister_sink("failing-sink"));
        assert_eq!(router.sink_count(), 0);
    }

    struct SlowSink {
        id: String,
        state: MediaSinkState,
    }

    impl SlowSink {
        fn new(id: &str) -> Self {
            Self {
                id: id.to_string(),
                state: MediaSinkState::Closed,
            }
        }
    }

    impl MediaSink for SlowSink {
        fn open(&mut self, _config: MediaSinkConfig) -> Result<(), MediaSinkError> {
            self.state = MediaSinkState::Opened;
            Ok(())
        }

        fn start(&mut self) -> Result<(), MediaSinkError> {
            self.state = MediaSinkState::Streaming;
            Ok(())
        }

        fn write_block(&mut self, _pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError> {
            // Emulate slow sink lagging behind realtime
            thread::sleep(Duration::from_millis(100));
            Ok(480)
        }

        fn flush(&mut self) -> Result<(), MediaSinkError> { Ok(()) }
        fn stop(&mut self) -> Result<(), MediaSinkError> { self.state = MediaSinkState::Stopped; Ok(()) }
        fn close(&mut self) -> Result<(), MediaSinkError> { self.state = MediaSinkState::Closed; Ok(()) }
        fn state(&self) -> MediaSinkState { self.state.clone() }
        fn metrics(&self) -> MediaSinkMetrics { MediaSinkMetrics::default() }
        fn id(&self) -> &str { &self.id }
    }

    #[test]
    fn test_native_output_router_bounded_backpressure() {
        let router = NativeOutputRouter::new();
        let slow_sink = Box::new(SlowSink::new("slow-sink"));
        let config = MediaSinkConfig {
            id: "slow-sink".to_string(),
            name: "Slow Sink".to_string(),
            sample_rate: 48000,
            channels: 2,
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: None,
        };
        router.register_sink(slow_sink, config).unwrap();

        let block = Arc::new(vec![0.0f32; 960]);
        // Burst 80 blocks immediately into the 64-capacity channel
        for _ in 0..80 {
            router.dispatch_master_block(block.clone());
        }

        let statuses = router.get_sink_statuses();
        let slow_status = statuses.iter().find(|s| s.id == "slow-sink").unwrap();
        // Verifies bounded queue backpressure: excess blocks were safely dropped without deadlock
        assert!(slow_status.dropped_frames > 0);
        assert!(router.unregister_sink("slow-sink"));
    }
}

