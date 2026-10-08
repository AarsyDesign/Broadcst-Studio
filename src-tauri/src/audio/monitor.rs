use crate::audio::buffer::{create_audio_ring_buffer, AudioConsumer, AudioProducer};
use crate::models::AudioDevice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub const CANONICAL_SAMPLE_RATE: u32 = 48000;
pub const CANONICAL_CHANNELS: u16 = 2;

pub struct AudioMonitorStream {
    #[allow(dead_code)]
    stream: Stream,
    device_name: String,
    is_running: Arc<AtomicBool>,
    error_count: Arc<AtomicU64>,
}

// SAFETY: CPAL Stream controls audio output lifecycle and can be safely sent across threads.
unsafe impl Send for AudioMonitorStream {}
unsafe impl Sync for AudioMonitorStream {}

impl AudioMonitorStream {
    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    pub fn error_count(&self) -> u64 {
        self.error_count.load(Ordering::Relaxed)
    }
}

pub struct AudioMonitorManager {
    active_stream: Arc<Mutex<Option<AudioMonitorStream>>>,
    producer_slot: Arc<Mutex<Option<AudioProducer>>>,
}

impl AudioMonitorManager {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            active_stream: Arc::new(Mutex::new(None)),
            producer_slot: Arc::new(Mutex::new(None)),
        })
    }

    /// Enumerate all physical audio output devices on host.
    pub fn enumerate_output_devices() -> Vec<AudioDevice> {
        let host = cpal::default_host();
        let mut devices = Vec::new();
        let default_device_name = host.default_output_device().and_then(|d| d.name().ok());

        if let Ok(output_devices) = host.output_devices() {
            for (index, device) in output_devices.enumerate() {
                if let Ok(name) = device.name() {
                    let is_default = default_device_name
                        .as_ref()
                        .map(|def| def == &name)
                        .unwrap_or(false);

                    let (channels, sample_rate) = device
                        .default_output_config()
                        .map(|c| (c.channels(), c.sample_rate().0))
                        .unwrap_or((2, 48000));

                    devices.push(AudioDevice {
                        id: format!("out-{}", index),
                        name,
                        is_default,
                        channels,
                        sample_rate,
                    });
                }
            }
        }

        devices
    }

    /// Open physical output stream and attach ring buffer for feeding master program
    pub fn start_monitor(&self, device_id_or_name: Option<&str>) -> Result<String, String> {
        let host = cpal::default_host();
        let device = match device_id_or_name {
            Some(target) => {
                let mut found = None;
                if let Ok(output_devices) = host.output_devices() {
                    for (index, dev) in output_devices.enumerate() {
                        let dev_id = format!("out-{}", index);
                        let dev_name = dev.name().unwrap_or_default();
                        if dev_id == target || dev_name == target {
                            found = Some(dev);
                            break;
                        }
                    }
                }
                found.ok_or_else(|| format!("Specified audio output device '{}' not found", target))?
            }
            None => host
                .default_output_device()
                .ok_or_else(|| "No default audio output device available on host".to_string())?,
        };

        let device_name = device
            .name()
            .unwrap_or_else(|_| "Unknown Output Device".to_string());

        let default_config = device.default_output_config().map_err(|e| {
            format!(
                "Failed to get default output config for '{}': {}",
                device_name, e
            )
        })?;

        let sample_format = default_config.sample_format();
        let channels = default_config.channels() as usize;
        let config: StreamConfig = default_config.into();

        // 1 second buffer at 48kHz stereo (96000 samples)
        let (producer, mut consumer, _, _) = create_audio_ring_buffer(CANONICAL_SAMPLE_RATE as usize * 2);

        let error_count = Arc::new(AtomicU64::new(0));
        let error_count_cb = error_count.clone();

        let err_fn = move |_err: cpal::StreamError| {
            error_count_cb.fetch_add(1, Ordering::Relaxed);
        };

        let stream = match sample_format {
            SampleFormat::F32 => {
                device
                    .build_output_stream(
                        &config,
                        move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                            render_output_samples_f32(data, channels, &mut consumer);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build f32 output stream: {}", e))?
            }
            SampleFormat::I16 => {
                device
                    .build_output_stream(
                        &config,
                        move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                            render_output_samples_i16(data, channels, &mut consumer);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build i16 output stream: {}", e))?
            }
            SampleFormat::U16 => {
                device
                    .build_output_stream(
                        &config,
                        move |data: &mut [u16], _: &cpal::OutputCallbackInfo| {
                            render_output_samples_u16(data, channels, &mut consumer);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build u16 output stream: {}", e))?
            }
            other => {
                return Err(format!("Unsupported output sample format: {:?}", other));
            }
        };

        stream
            .play()
            .map_err(|e| format!("Failed to start output stream: {}", e))?;

        let is_running = Arc::new(AtomicBool::new(true));

        *self.active_stream.lock() = Some(AudioMonitorStream {
            stream,
            device_name: device_name.clone(),
            is_running,
            error_count,
        });
        *self.producer_slot.lock() = Some(producer);

        Ok(device_name)
    }

    pub fn stop_monitor(&self) {
        *self.active_stream.lock() = None;
        *self.producer_slot.lock() = None;
    }

    pub fn is_monitoring(&self) -> bool {
        self.active_stream.lock().is_some()
    }

    pub fn current_device_name(&self) -> Option<String> {
        self.active_stream.lock().as_ref().map(|s| s.device_name().to_string())
    }

    /// Push master PCM block into hardware monitor ring buffer (called from audio engine thread)
    #[inline]
    pub fn push_master_samples(&self, samples: &[f32]) {
        let mut guard = self.producer_slot.lock();
        if let Some(producer) = guard.as_mut() {
            producer.push_slice(samples);
        }
    }
}

/// Render samples from SPSC ring buffer to hardware f32 output. Wait-free.
#[inline]
fn render_output_samples_f32(data: &mut [f32], channels: usize, consumer: &mut AudioConsumer) {
    if channels == 0 {
        return;
    }

    const CHUNK_FRAMES: usize = 256;
    let mut stereo_buf = [0.0f32; CHUNK_FRAMES * 2];
    let frame_count = data.len() / channels;

    let mut frame_idx = 0;
    while frame_idx < frame_count {
        let chunk_frames = (frame_count - frame_idx).min(CHUNK_FRAMES);
        let needed_samples = chunk_frames * 2;
        let read = consumer.pop_slice(&mut stereo_buf[..needed_samples]);

        for i in 0..chunk_frames {
            let out_idx = (frame_idx + i) * channels;
            let (l, r) = if i * 2 + 1 < read {
                (stereo_buf[i * 2], stereo_buf[i * 2 + 1])
            } else {
                (0.0, 0.0) // Underrun: silence fill
            };

            if channels == 1 {
                data[out_idx] = (l + r) * 0.5;
            } else {
                data[out_idx] = l;
                data[out_idx + 1] = r;
                for ch in 2..channels {
                    data[out_idx + ch] = 0.0;
                }
            }
        }

        frame_idx += chunk_frames;
    }
}

/// Render samples from SPSC ring buffer to hardware i16 output. Wait-free.
#[inline]
fn render_output_samples_i16(data: &mut [i16], channels: usize, consumer: &mut AudioConsumer) {
    if channels == 0 {
        return;
    }

    const CHUNK_FRAMES: usize = 256;
    let mut stereo_buf = [0.0f32; CHUNK_FRAMES * 2];
    let frame_count = data.len() / channels;

    let mut frame_idx = 0;
    while frame_idx < frame_count {
        let chunk_frames = (frame_count - frame_idx).min(CHUNK_FRAMES);
        let needed_samples = chunk_frames * 2;
        let read = consumer.pop_slice(&mut stereo_buf[..needed_samples]);

        for i in 0..chunk_frames {
            let out_idx = (frame_idx + i) * channels;
            let (l, r) = if i * 2 + 1 < read {
                (stereo_buf[i * 2], stereo_buf[i * 2 + 1])
            } else {
                (0.0, 0.0)
            };

            let l_i16 = (l.clamp(-1.0, 1.0) * 32767.0) as i16;
            let r_i16 = (r.clamp(-1.0, 1.0) * 32767.0) as i16;

            if channels == 1 {
                data[out_idx] = ((l_i16 as i32 + r_i16 as i32) / 2) as i16;
            } else {
                data[out_idx] = l_i16;
                data[out_idx + 1] = r_i16;
                for ch in 2..channels {
                    data[out_idx + ch] = 0;
                }
            }
        }

        frame_idx += chunk_frames;
    }
}

/// Render samples from SPSC ring buffer to hardware u16 output. Wait-free.
#[inline]
fn render_output_samples_u16(data: &mut [u16], channels: usize, consumer: &mut AudioConsumer) {
    if channels == 0 {
        return;
    }

    const CHUNK_FRAMES: usize = 256;
    let mut stereo_buf = [0.0f32; CHUNK_FRAMES * 2];
    let frame_count = data.len() / channels;

    let mut frame_idx = 0;
    while frame_idx < frame_count {
        let chunk_frames = (frame_count - frame_idx).min(CHUNK_FRAMES);
        let needed_samples = chunk_frames * 2;
        let read = consumer.pop_slice(&mut stereo_buf[..needed_samples]);

        for i in 0..chunk_frames {
            let out_idx = (frame_idx + i) * channels;
            let (l, r) = if i * 2 + 1 < read {
                (stereo_buf[i * 2], stereo_buf[i * 2 + 1])
            } else {
                (0.0, 0.0)
            };

            let l_u16 = ((l.clamp(-1.0, 1.0) * 32767.0) + 32768.0) as u16;
            let r_u16 = ((r.clamp(-1.0, 1.0) * 32767.0) + 32768.0) as u16;

            if channels == 1 {
                data[out_idx] = ((l_u16 as u32 + r_u16 as u32) / 2) as u16;
            } else {
                data[out_idx] = l_u16;
                data[out_idx + 1] = r_u16;
                for ch in 2..channels {
                    data[out_idx + ch] = 32768;
                }
            }
        }

        frame_idx += chunk_frames;
    }
}
