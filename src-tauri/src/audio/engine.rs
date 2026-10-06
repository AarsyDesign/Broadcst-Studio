use crate::audio::buffer::{create_audio_ring_buffer, AudioConsumer};
use crate::audio::capture::{AudioCaptureManager, AudioCaptureStream};
use crate::audio::mixer::{ChannelStrip, ChannelStripSnapshot, MasterBus};
use crate::models::AudioMetrics;
use crossbeam_channel::{bounded, Receiver, Sender, TrySendError};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

pub const CANONICAL_SAMPLE_RATE: u32 = 48000;
pub const CANONICAL_CHANNELS: u16 = 2;
pub const PROCESSING_BLOCK_FRAMES: usize = 480; // 10ms at 48kHz
pub const PROCESSING_BLOCK_SAMPLES: usize = PROCESSING_BLOCK_FRAMES * (CANONICAL_CHANNELS as usize); // 960 samples
pub const TAP_QUEUE_CAPACITY: usize = 64; // ~640ms buffer

/// Master PCM Tap receiver for downstream consumers (encoder, recorder).
pub struct MasterTapSubscription {
    pub receiver: Receiver<Vec<f32>>,
    pub dropped_frames: Arc<AtomicU64>,
}

pub struct AudioEngine {
    sample_rate: u32,
    mic_channel: Arc<ChannelStrip>,
    music_channel: Arc<ChannelStrip>,
    aux_channel: Arc<ChannelStrip>,
    sfx_channel: Arc<ChannelStrip>,
    master_bus: Arc<MasterBus>,

    // SPSC ring buffer metrics
    overrun_count: Arc<AtomicU64>,
    underrun_count: Arc<AtomicU64>,

    // Tap distribution
    encoder_tap_tx: Arc<Mutex<Option<Sender<Vec<f32>>>>>,
    recorder_tap_tx: Arc<Mutex<Option<Sender<Vec<f32>>>>>,
    dropped_encoder_frames: Arc<AtomicU64>,
    dropped_recorder_frames: Arc<AtomicU64>,

    // Hardware capture stream
    capture_stream: Arc<Mutex<Option<AudioCaptureStream>>>,
    consumer_slot: Arc<Mutex<Option<AudioConsumer>>>,

    // Engine thread control
    is_running: Arc<AtomicBool>,
    worker_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl AudioEngine {
    pub fn new(sample_rate: u32) -> Arc<Self> {
        let mic = ChannelStrip::new("mic", "Microphone", true);
        let music = ChannelStrip::new("music", "Music / Deck", false);
        let aux = ChannelStrip::new("aux", "Aux / Soundboard", false);
        let sfx = ChannelStrip::new("sfx", "Studio FX", false);
        let master = Arc::new(MasterBus::new());

        let engine = Arc::new(Self {
            sample_rate,
            mic_channel: mic,
            music_channel: music,
            aux_channel: aux,
            sfx_channel: sfx,
            master_bus: master,
            overrun_count: Arc::new(AtomicU64::new(0)),
            underrun_count: Arc::new(AtomicU64::new(0)),
            encoder_tap_tx: Arc::new(Mutex::new(None)),
            recorder_tap_tx: Arc::new(Mutex::new(None)),
            dropped_encoder_frames: Arc::new(AtomicU64::new(0)),
            dropped_recorder_frames: Arc::new(AtomicU64::new(0)),
            capture_stream: Arc::new(Mutex::new(None)),
            consumer_slot: Arc::new(Mutex::new(None)),
            is_running: Arc::new(AtomicBool::new(false)),
            worker_handle: Arc::new(Mutex::new(None)),
        });

        engine.start_processing_thread();
        engine
    }

    /// Subscribe encoder worker to Master PCM Tap
    pub fn subscribe_encoder_tap(&self) -> MasterTapSubscription {
        let (tx, rx) = bounded(TAP_QUEUE_CAPACITY);
        *self.encoder_tap_tx.lock() = Some(tx);
        MasterTapSubscription {
            receiver: rx,
            dropped_frames: self.dropped_encoder_frames.clone(),
        }
    }

    /// Unsubscribe encoder worker
    pub fn unsubscribe_encoder_tap(&self) {
        *self.encoder_tap_tx.lock() = None;
    }

    /// Subscribe recorder worker to Master PCM Tap
    pub fn subscribe_recorder_tap(&self) -> MasterTapSubscription {
        let (tx, rx) = bounded(TAP_QUEUE_CAPACITY);
        *self.recorder_tap_tx.lock() = Some(tx);
        MasterTapSubscription {
            receiver: rx,
            dropped_frames: self.dropped_recorder_frames.clone(),
        }
    }

    /// Unsubscribe recorder worker
    pub fn unsubscribe_recorder_tap(&self) {
        *self.recorder_tap_tx.lock() = None;
    }

    /// Start hardware CPAL capture on the selected device
    pub fn start_capture(&self, device_id_or_name: Option<&str>) -> Result<String, String> {
        // Create 1 second buffer at 48kHz stereo (96000 samples)
        let (producer, consumer, overruns, underruns) =
            create_audio_ring_buffer(self.sample_rate as usize * (CANONICAL_CHANNELS as usize));

        let stream = AudioCaptureManager::open_input_stream(device_id_or_name, producer)?;
        let dev_name = stream.device_name().to_string();

        *self.capture_stream.lock() = Some(stream);
        *self.consumer_slot.lock() = Some(consumer);

        // Store active overrun/underrun references
        self.overrun_count
            .store(overruns.load(Ordering::Relaxed), Ordering::Relaxed);
        self.underrun_count
            .store(underruns.load(Ordering::Relaxed), Ordering::Relaxed);

        Ok(dev_name)
    }

    /// Stop hardware CPAL capture
    pub fn stop_capture(&self) {
        *self.capture_stream.lock() = None;
        *self.consumer_slot.lock() = None;
    }

    pub fn is_capturing(&self) -> bool {
        self.capture_stream.lock().is_some()
    }

    pub fn set_channel_fader(&self, channel_id: &str, level: f32) {
        match channel_id {
            "mic" => self.mic_channel.set_fader(level),
            "music" => self.music_channel.set_fader(level),
            "aux" => self.aux_channel.set_fader(level),
            "sfx" => self.sfx_channel.set_fader(level),
            _ => {}
        }
    }

    pub fn set_channel_gain(&self, channel_id: &str, gain_db: f32) {
        match channel_id {
            "mic" => self.mic_channel.set_gain_db(gain_db),
            "music" => self.music_channel.set_gain_db(gain_db),
            "aux" => self.aux_channel.set_gain_db(gain_db),
            "sfx" => self.sfx_channel.set_gain_db(gain_db),
            _ => {}
        }
    }

    pub fn set_channel_mute(&self, channel_id: &str, mute: bool) {
        match channel_id {
            "mic" => self.mic_channel.set_mute(mute),
            "music" => self.music_channel.set_mute(mute),
            "aux" => self.aux_channel.set_mute(mute),
            "sfx" => self.sfx_channel.set_mute(mute),
            _ => {}
        }
    }

    pub fn get_channel_strips(&self) -> Vec<ChannelStripSnapshot> {
        vec![
            self.mic_channel.snapshot(),
            self.music_channel.snapshot(),
            self.aux_channel.snapshot(),
            self.sfx_channel.snapshot(),
        ]
    }

    pub fn get_metrics(&self) -> AudioMetrics {
        let capture_lock = self.capture_stream.lock();
        let capture_errors = capture_lock.as_ref().map(|s| s.error_count()).unwrap_or(0);

        AudioMetrics {
            input_peak_db: self.mic_channel.get_peak_db(),
            input_rms_db: self.mic_channel.get_rms_db(),
            master_peak_db: self.master_bus.get_peak_db(),
            master_rms_db: self.master_bus.get_rms_db(),
            buffer_underruns: self.underrun_count.load(Ordering::Relaxed) + capture_errors,
            latency_ms: (PROCESSING_BLOCK_FRAMES as f32 / self.sample_rate as f32) * 1000.0,
        }
    }

    fn start_processing_thread(self: &Arc<Self>) {
        let is_running = self.is_running.clone();
        is_running.store(true, Ordering::SeqCst);

        let mic = self.mic_channel.clone();
        let master = self.master_bus.clone();
        let consumer_slot = self.consumer_slot.clone();
        let encoder_tap_tx = self.encoder_tap_tx.clone();
        let recorder_tap_tx = self.recorder_tap_tx.clone();
        let dropped_enc = self.dropped_encoder_frames.clone();
        let dropped_rec = self.dropped_recorder_frames.clone();

        let handle = thread::spawn(move || {
            let mut block = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];

            while is_running.load(Ordering::Relaxed) {
                let start_time = std::time::Instant::now();

                // 1. Pull input from capture consumer if active, else fill silence
                let has_audio = {
                    let mut cons_guard = consumer_slot.lock();
                    if let Some(consumer) = cons_guard.as_mut() {
                        consumer.pop_slice(&mut block);
                        true
                    } else {
                        block.fill(0.0);
                        false
                    }
                };

                // 2. Process microphone channel strip
                let mic_gain = mic.compute_linear_gain();
                if has_audio {
                    mic.update_meters(&block);
                } else {
                    mic.update_meters(&[]);
                }

                for s in block.iter_mut() {
                    *s *= mic_gain;
                }

                // 3. Process master bus (gain + soft limiter)
                master.process_master(&mut block);

                // 4. Distribute to master output tap subscribers
                // Non-blocking overflow policy: drop frame if queue is full, increment drop counter
                {
                    let enc_guard = encoder_tap_tx.lock();
                    if let Some(tx) = enc_guard.as_ref() {
                        match tx.try_send(block.clone()) {
                            Ok(()) => {}
                            Err(TrySendError::Full(_)) => {
                                dropped_enc.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(TrySendError::Disconnected(_)) => {}
                        }
                    }
                }

                {
                    let rec_guard = recorder_tap_tx.lock();
                    if let Some(tx) = rec_guard.as_ref() {
                        match tx.try_send(block.clone()) {
                            Ok(()) => {}
                            Err(TrySendError::Full(_)) => {
                                dropped_rec.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(TrySendError::Disconnected(_)) => {}
                        }
                    }
                }

                // 5. Pace processing to ~10ms if not hardware driven
                let elapsed = start_time.elapsed();
                let target_interval = Duration::from_micros(10_000); // 10ms
                if elapsed < target_interval {
                    thread::sleep(target_interval - elapsed);
                }
            }
        });

        *self.worker_handle.lock() = Some(handle);
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.worker_handle.lock().take() {
            let _ = handle.join();
        }
    }
}
