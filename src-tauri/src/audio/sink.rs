//! Native Media Sink Boundary & Output Router
//!
//! # Architectural Boundary:
//! ```text
//! MASTER AUDIO (Rust Realtime AudioEngine Processing Loop)
//!        ↓
//! NATIVE OUTPUT ROUTER
//!   ├── Native SHOUTcast Stream (First-Class MP3 Streaming)
//!   ├── Native File Recorder (First-Class WAV / Lossless Master Capture)
//!   └── Plugin-Backed Native Media Sinks (Extensible Realtime Boundary)
//! ```
//!
//! # Realtime Safety & Isolation:
//! In Broadcst Studio, realtime audio processing runs in Domain A (Native Realtime).
//! Zero raw PCM audio frames are ever exposed to the JavaScript or React runtime.
//! Plugin control logic (Domain B) configures destinations, receives status, and syncs
//! metadata over async IPC, while audio encoding and network transmission execute
//! entirely within this native media boundary.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;

/// Audio sample formats supported by Native Media Sinks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaSampleFormat {
    /// Canonical 32-bit floating point, interleaved stereo, normalized -1.0 to 1.0.
    F32Le,
    /// 16-bit signed integer PCM, little-endian, interleaved stereo.
    I16Le,
}

/// Strict lifecycle state of a Native Media Sink.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MediaSinkState {
    /// Sink is uninitialized or closed.
    Closed,
    /// Sink is opened and configured with audio parameters, but not actively processing.
    Opened,
    /// Sink is actively consuming PCM frames and streaming to transport destination.
    Streaming,
    /// Sink is flushing pending encoded frames before shutdown.
    Flushing,
    /// Sink has paused or stopped transmission.
    Stopped,
    /// Sink has encountered a network or encoding error.
    Error(String),
}

/// Media Sink Configuration provided when opening the sink.
#[derive(Debug, Clone)]
pub struct MediaSinkConfig {
    /// Unique identifier for the sink (e.g. "native-shoutcast", "plugin-rtmp-telegram").
    pub id: String,
    /// Human-readable destination name.
    pub name: String,
    /// Sample rate in Hz (Broadcst canonical: 48000).
    pub sample_rate: u32,
    /// Channel count (Broadcst canonical: 2 stereo).
    pub channels: u16,
    /// PCM sample format.
    pub sample_format: MediaSampleFormat,
    /// Frame block size (Broadcst canonical: 480 frames = 10ms at 48kHz).
    pub frame_size: usize,
    /// Target network destination or streaming endpoint URL (if applicable).
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
#[derive(Debug, Clone, Default)]
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
///
/// Any downstream destination for Broadcst Master Audio (RTMP, HLS, WebRTC,
/// SHOUTcast, ICEcast) must implement this contract to receive Master PCM blocks.
pub trait MediaSink: Send + Sync {
    /// Opens the sink with the specified configuration.
    fn open(&mut self, config: MediaSinkConfig) -> Result<(), MediaSinkError>;

    /// Starts streaming audio. Transitions state from Opened to Streaming.
    fn start(&mut self) -> Result<(), MediaSinkError>;

    /// Consumes an interleaved stereo audio block from Master Bus.
    /// In Broadcst Studio, this is canonical 48kHz stereo f32 (480 frames = 960 samples).
    fn write_block(&mut self, pcm_interleaved: &[f32]) -> Result<usize, MediaSinkError>;

    /// Flushes any pending encoded audio buffers to transport.
    fn flush(&mut self) -> Result<(), MediaSinkError>;

    /// Stops audio streaming. Transitions state to Stopped.
    fn stop(&mut self) -> Result<(), MediaSinkError>;

    /// Closes the sink and releases all native sockets/buffers.
    fn close(&mut self) -> Result<(), MediaSinkError>;

    /// Returns the current operational state of the sink.
    fn state(&self) -> MediaSinkState;

    /// Returns telemetry metrics.
    fn metrics(&self) -> MediaSinkMetrics;

    /// Returns sink identifier.
    fn id(&self) -> &str;
}

/// Reference architectural implementation of a Native Media Sink.
/// Demonstrates the strict state machine and frame accounting without sending fake data.
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

/// Native Output Router managing multiple registered Media Sinks.
pub struct NativeOutputRouter {
    sinks: Arc<Mutex<Vec<Box<dyn MediaSink>>>>,
}

impl NativeOutputRouter {
    pub fn new() -> Self {
        Self {
            sinks: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// Registers a new native media sink.
    pub fn register_sink(&self, sink: Box<dyn MediaSink>) {
        self.sinks.lock().push(sink);
    }

    /// Removes a sink by id.
    pub fn unregister_sink(&self, id: &str) -> bool {
        let mut sinks = self.sinks.lock();
        let initial_len = sinks.len();
        sinks.retain(|s| s.id() != id);
        sinks.len() < initial_len
    }

    /// Dispatches master PCM block to all streaming sinks.
    pub fn dispatch_block(&self, pcm_interleaved: &[f32]) {
        let mut sinks = self.sinks.lock();
        for sink in sinks.iter_mut() {
            if sink.state() == MediaSinkState::Streaming {
                let _ = sink.write_block(pcm_interleaved);
            }
        }
    }

    /// Count of currently registered sinks.
    pub fn sink_count(&self) -> usize {
        self.sinks.lock().len()
    }
}

impl Default for NativeOutputRouter {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_media_sink_lifecycle_transitions() {
        let mut sink = ReferenceMediaSink::new();
        assert_eq!(sink.state(), MediaSinkState::Closed);

        // Cannot write to closed sink
        let block = vec![0.0f32; 960]; // 480 stereo frames
        assert!(sink.write_block(&block).is_err());

        // Open sink with canonical configuration
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

        // Start sink
        assert!(sink.start().is_ok());
        assert_eq!(sink.state(), MediaSinkState::Streaming);

        // Write block
        let written = sink.write_block(&block).expect("write should succeed");
        assert_eq!(written, 480);
        assert_eq!(sink.metrics().frames_written, 480);

        // Stop & close
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
            sample_rate: 44100, // Non-canonical sample rate
            channels: 1,        // Mono
            sample_format: MediaSampleFormat::F32Le,
            frame_size: 480,
            endpoint: None,
        };
        let res = sink.open(invalid_config);
        assert!(matches!(res, Err(MediaSinkError::InvalidAudioFormat { .. })));
    }

    #[test]
    fn test_native_output_router_dispatch() {
        let router = NativeOutputRouter::new();
        let mut sink1 = ReferenceMediaSink::new();
        let config1 = MediaSinkConfig::default();
        sink1.open(config1).unwrap();
        sink1.start().unwrap();

        router.register_sink(Box::new(sink1));
        assert_eq!(router.sink_count(), 1);

        let block = vec![0.0f32; 960];
        router.dispatch_block(&block);

        assert!(router.unregister_sink("default-sink"));
        assert_eq!(router.sink_count(), 0);
    }
}
