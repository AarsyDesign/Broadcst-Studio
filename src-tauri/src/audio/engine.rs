use crate::audio::buffer::{create_audio_ring_buffer, AudioConsumer};
use crate::audio::capture::{AudioCaptureManager, AudioCaptureStream};
use crate::audio::mixer::{sum_channel_buffers, ChannelStrip, ChannelStripSnapshot, MasterBus};
use crate::audio::monitor::AudioMonitorManager;
use crate::models::AudioMetrics;
use crate::playback::{DeckRenderStatus, PlaybackManager};
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
    deck_a_channel: Arc<ChannelStrip>,
    deck_b_channel: Arc<ChannelStrip>,
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

    // Output monitor manager
    pub monitor_manager: Arc<AudioMonitorManager>,

    // Playback manager for Deck A / Deck B
    pub playback_manager: Arc<PlaybackManager>,

    // Engine thread control
    is_running: Arc<AtomicBool>,
    worker_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

impl AudioEngine {
    pub fn new(sample_rate: u32, playback_manager: Arc<PlaybackManager>) -> Arc<Self> {
        let mic = ChannelStrip::new("mic", "Microphone", true);
        let deck_a = ChannelStrip::new("deck_a", "Deck A", false);
        let deck_b = ChannelStrip::new("deck_b", "Deck B", false);
        let music = ChannelStrip::new("music", "Music Master", false);
        let aux = ChannelStrip::new("aux", "Aux / Soundboard", false);
        let sfx = ChannelStrip::new("sfx", "Studio FX", false);
        let master = Arc::new(MasterBus::new());
        let monitor = AudioMonitorManager::new();

        let engine = Arc::new(Self {
            sample_rate,
            mic_channel: mic,
            deck_a_channel: deck_a,
            deck_b_channel: deck_b,
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
            monitor_manager: monitor,
            playback_manager,
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
        let (producer, consumer, overruns, underruns) =
            create_audio_ring_buffer(self.sample_rate as usize * (CANONICAL_CHANNELS as usize));

        let stream = AudioCaptureManager::open_input_stream(device_id_or_name, producer)?;
        let dev_name = stream.device_name().to_string();

        *self.capture_stream.lock() = Some(stream);
        *self.consumer_slot.lock() = Some(consumer);

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

    pub fn start_monitor(&self, device_id_or_name: Option<&str>) -> Result<String, String> {
        self.monitor_manager.start_monitor(device_id_or_name)
    }

    pub fn stop_monitor(&self) {
        self.monitor_manager.stop_monitor();
    }

    pub fn is_monitoring(&self) -> bool {
        self.monitor_manager.is_monitoring()
    }

    pub fn current_monitor_device(&self) -> Option<String> {
        self.monitor_manager.current_device_name()
    }

    pub fn set_channel_fader(&self, channel_id: &str, level: f32) {
        match channel_id {
            "mic" => self.mic_channel.set_fader(level),
            "deck_a" | "deckA" => self.deck_a_channel.set_fader(level),
            "deck_b" | "deckB" => self.deck_b_channel.set_fader(level),
            "music" => {
                self.music_channel.set_fader(level);
                self.deck_a_channel.set_fader(level);
                self.deck_b_channel.set_fader(level);
            }
            "aux" => self.aux_channel.set_fader(level),
            "sfx" => self.sfx_channel.set_fader(level),
            _ => {}
        }
    }

    pub fn set_channel_gain(&self, channel_id: &str, gain_db: f32) {
        match channel_id {
            "mic" => self.mic_channel.set_gain_db(gain_db),
            "deck_a" | "deckA" => self.deck_a_channel.set_gain_db(gain_db),
            "deck_b" | "deckB" => self.deck_b_channel.set_gain_db(gain_db),
            "music" => self.music_channel.set_gain_db(gain_db),
            "aux" => self.aux_channel.set_gain_db(gain_db),
            "sfx" => self.sfx_channel.set_gain_db(gain_db),
            _ => {}
        }
    }

    pub fn set_channel_mute(&self, channel_id: &str, mute: bool) {
        match channel_id {
            "mic" => self.mic_channel.set_mute(mute),
            "deck_a" | "deckA" => self.deck_a_channel.set_mute(mute),
            "deck_b" | "deckB" => self.deck_b_channel.set_mute(mute),
            "music" => {
                self.music_channel.set_mute(mute);
                self.deck_a_channel.set_mute(mute);
                self.deck_b_channel.set_mute(mute);
            }
            "aux" => self.aux_channel.set_mute(mute),
            "sfx" => self.sfx_channel.set_mute(mute),
            _ => {}
        }
    }

    pub fn get_channel_strips(&self) -> Vec<ChannelStripSnapshot> {
        vec![
            self.mic_channel.snapshot(),
            self.deck_a_channel.snapshot(),
            self.deck_b_channel.snapshot(),
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
        let deck_a_strip = self.deck_a_channel.clone();
        let deck_b_strip = self.deck_b_channel.clone();
        let music_strip = self.music_channel.clone();
        let aux = self.aux_channel.clone();
        let sfx = self.sfx_channel.clone();
        let master = self.master_bus.clone();
        let consumer_slot = self.consumer_slot.clone();
        let encoder_tap_tx = self.encoder_tap_tx.clone();
        let recorder_tap_tx = self.recorder_tap_tx.clone();
        let dropped_enc = self.dropped_encoder_frames.clone();
        let dropped_rec = self.dropped_recorder_frames.clone();
        let monitor = self.monitor_manager.clone();
        let playback = self.playback_manager.clone();

        let handle = thread::spawn(move || {
            let mut mic_block = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
            let mut deck_a_block = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
            let mut deck_b_block = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
            let mut aux_block = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
            let mut sfx_block = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
            let mut master_sum = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
            let mut block_counter: u64 = 0;

            while is_running.load(Ordering::Relaxed) {
                let start_time = std::time::Instant::now();

                // 1. Pull input from capture consumer if active, else silence
                let has_audio = {
                    let mut cons_guard = consumer_slot.lock();
                    if let Some(consumer) = cons_guard.as_mut() {
                        consumer.pop_slice(&mut mic_block);
                        true
                    } else {
                        mic_block.fill(0.0);
                        false
                    }
                };

                // 2. Process microphone channel strip
                let mic_gain = mic.compute_linear_gain();
                if has_audio {
                    mic.update_meters(&mic_block);
                } else {
                    mic.update_meters(&[]);
                }
                for s in mic_block.iter_mut() {
                    *s *= mic_gain;
                }

                // 3. Render Deck A
                let status_a = playback.deck_a.render_block(&mut deck_a_block);
                if let DeckRenderStatus::Finished { .. } = status_a {
                    let pb = playback.clone();
                    thread::spawn(move || {
                        pb.handle_deck_finished("deck_a");
                    });
                }

                // 4. Render Deck B
                let status_b = playback.deck_b.render_block(&mut deck_b_block);
                if let DeckRenderStatus::Finished { .. } = status_b {
                    let pb = playback.clone();
                    thread::spawn(move || {
                        pb.handle_deck_finished("deck_b");
                    });
                }

                // 5. Apply crossfade gains
                let (gain_a, gain_b) = playback.compute_crossfade_gains();
                for s in deck_a_block.iter_mut() {
                    *s *= gain_a;
                }
                for s in deck_b_block.iter_mut() {
                    *s *= gain_b;
                }

                // 6. Channel strips for Deck A & Deck B
                let da_gain = deck_a_strip.compute_linear_gain();
                deck_a_strip.update_meters(&deck_a_block);
                for s in deck_a_block.iter_mut() {
                    *s *= da_gain;
                }

                let db_gain = deck_b_strip.compute_linear_gain();
                deck_b_strip.update_meters(&deck_b_block);
                for s in deck_b_block.iter_mut() {
                    *s *= db_gain;
                }

                // Update legacy music strip meters reflecting active playback
                let active_is_a = playback.active_deck_id() == "deck_a";
                if active_is_a {
                    music_strip.update_meters(&deck_a_block);
                } else {
                    music_strip.update_meters(&deck_b_block);
                }

                // Placeholders for aux and sfx
                aux_block.fill(0.0);
                sfx_block.fill(0.0);
                aux.update_meters(&[]);
                sfx.update_meters(&[]);

                // 7. Sum all active channels into Master
                sum_channel_buffers(
                    &[&mic_block, &deck_a_block, &deck_b_block, &aux_block],
                    &mut master_sum,
                );

                // 8. Process Master bus (gain + soft limiter)
                master.process_master(&mut master_sum);

                // Preload check every ~50 blocks (500ms)
                if block_counter % 50 == 0 {
                    playback.check_and_preload();
                }
                block_counter = block_counter.wrapping_add(1);

                // 9. Feed hardware output monitor stream (Program Master or CUE)
                if playback.monitor_source() == "cue" {
                    let mut cue_sum = vec![0.0f32; PROCESSING_BLOCK_SAMPLES];
                    let cue_a = playback.deck_a.is_cue();
                    let cue_b = playback.deck_b.is_cue();
                    if !playback.is_cue_muted() {
                        let cue_gain = 10.0f32.powf(playback.cue_gain_db() / 20.0);
                        for i in 0..PROCESSING_BLOCK_SAMPLES {
                            let mut sample = 0.0f32;
                            if cue_a { sample += deck_a_block[i]; }
                            if cue_b { sample += deck_b_block[i]; }
                            cue_sum[i] = (sample * cue_gain).clamp(-1.0, 1.0);
                        }
                    }
                    monitor.push_master_samples(&cue_sum);
                } else {
                    monitor.push_master_samples(&master_sum);
                }

                // 10. Distribute to master output tap subscribers (encoder & recorder)
                {
                    let enc_guard = encoder_tap_tx.lock();
                    if let Some(tx) = enc_guard.as_ref() {
                        match tx.try_send(master_sum.clone()) {
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
                        match tx.try_send(master_sum.clone()) {
                            Ok(()) => {}
                            Err(TrySendError::Full(_)) => {
                                dropped_rec.fetch_add(1, Ordering::Relaxed);
                            }
                            Err(TrySendError::Disconnected(_)) => {}
                        }
                    }
                }

                // 11. Precise timing pace
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
