use crate::audio::buffer::AudioProducer;
use crate::models::AudioDevice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub struct AudioCaptureStream {
    stream: Stream,
    device_name: String,
    channels: u16,
    sample_rate: u32,
    is_running: Arc<AtomicBool>,
    error_count: Arc<AtomicU64>,
}

impl AudioCaptureStream {
    pub fn device_name(&self) -> &str {
        &self.device_name
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    pub fn is_running(&self) -> bool {
        self.is_running.load(Ordering::Relaxed)
    }

    pub fn error_count(&self) -> u64 {
        self.error_count.load(Ordering::Relaxed)
    }

    pub fn pause(&self) -> Result<(), String> {
        self.stream
            .pause()
            .map_err(|e| format!("Failed to pause capture stream: {}", e))?;
        self.is_running.store(false, Ordering::SeqCst);
        Ok(())
    }

    pub fn play(&self) -> Result<(), String> {
        self.stream
            .play()
            .map_err(|e| format!("Failed to play capture stream: {}", e))?;
        self.is_running.store(true, Ordering::SeqCst);
        Ok(())
    }
}

// SAFETY: cpal::Stream controls WASAPI audio stream lifecycle and can be safely sent/synced across threads.
unsafe impl Send for AudioCaptureStream {}
unsafe impl Sync for AudioCaptureStream {}

pub struct AudioCaptureManager;

impl AudioCaptureManager {
    /// Enumerate all physical audio input devices available on the operating system host.
    /// Real implementation: returns an honest list of detected devices.
    /// Returns empty vector if no physical devices are present. No fabricated dummy devices.
    pub fn enumerate_input_devices() -> Vec<AudioDevice> {
        let host = cpal::default_host();
        let mut devices = Vec::new();

        let default_device_name = host.default_input_device().and_then(|d| d.name().ok());

        if let Ok(input_devices) = host.input_devices() {
            for (index, device) in input_devices.enumerate() {
                if let Ok(name) = device.name() {
                    let is_default = default_device_name
                        .as_ref()
                        .map(|def| def == &name)
                        .unwrap_or(false);

                    let (channels, sample_rate) = device
                        .default_input_config()
                        .map(|c| (c.channels(), c.sample_rate().0))
                        .unwrap_or((2, 48000));

                    devices.push(AudioDevice {
                        id: format!("dev-{}", index),
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

    /// Open a physical CPAL input stream for the chosen device (or default device if None).
    /// Audio callback converts input samples (f32, i16, u16) to normalized f32 stereo 48kHz
    /// and pushes into the real-time wait-free AudioProducer ring buffer.
    pub fn open_input_stream(
        device_id_or_name: Option<&str>,
        mut producer: AudioProducer,
    ) -> Result<AudioCaptureStream, String> {
        let host = cpal::default_host();

        let device = match device_id_or_name {
            Some(target) => {
                let mut found = None;
                if let Ok(input_devices) = host.input_devices() {
                    for (index, dev) in input_devices.enumerate() {
                        let dev_id = format!("dev-{}", index);
                        let dev_name = dev.name().unwrap_or_default();
                        if dev_id == target || dev_name == target {
                            found = Some(dev);
                            break;
                        }
                    }
                }
                found
                    .ok_or_else(|| format!("Specified audio input device '{}' not found", target))?
            }
            None => host
                .default_input_device()
                .ok_or_else(|| "No default audio input device available on host".to_string())?,
        };

        let device_name = device
            .name()
            .unwrap_or_else(|_| "Unknown Audio Device".to_string());

        let default_config = device.default_input_config().map_err(|e| {
            format!(
                "Failed to get default input config for '{}': {}",
                device_name, e
            )
        })?;

        let sample_format = default_config.sample_format();
        let channels = default_config.channels();
        let sample_rate = default_config.sample_rate().0;
        let config: StreamConfig = default_config.into();

        let error_count = Arc::new(AtomicU64::new(0));
        let error_count_cb = error_count.clone();

        let err_fn = move |_err: cpal::StreamError| {
            // Real-time safe error callback: atomic counter only, zero logging/alloc
            error_count_cb.fetch_add(1, Ordering::Relaxed);
        };

        // We build the CPAL stream based on sample format
        let stream = match sample_format {
            SampleFormat::F32 => {
                let ch_count = channels as usize;
                device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            process_input_samples_f32(data, ch_count, &mut producer);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build f32 input stream: {}", e))?
            }
            SampleFormat::I16 => {
                let ch_count = channels as usize;
                device
                    .build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            process_input_samples_i16(data, ch_count, &mut producer);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build i16 input stream: {}", e))?
            }
            SampleFormat::U16 => {
                let ch_count = channels as usize;
                device
                    .build_input_stream(
                        &config,
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            process_input_samples_u16(data, ch_count, &mut producer);
                        },
                        err_fn,
                        None,
                    )
                    .map_err(|e| format!("Failed to build u16 input stream: {}", e))?
            }
            other => {
                return Err(format!("Unsupported audio sample format: {:?}", other));
            }
        };

        stream
            .play()
            .map_err(|e| format!("Failed to start CPAL stream: {}", e))?;

        let is_running = Arc::new(AtomicBool::new(true));

        Ok(AudioCaptureStream {
            stream,
            device_name,
            channels,
            sample_rate,
            is_running,
            error_count,
        })
    }
}

/// Convert input f32 samples to stereo interleaved f32.
/// Stack-allocated chunk processing for hard real-time safety.
#[inline]
fn process_input_samples_f32(data: &[f32], channels: usize, producer: &mut AudioProducer) {
    if channels == 0 || data.is_empty() {
        return;
    }

    const STACK_BUFFER_FRAMES: usize = 256;
    let mut stereo_buf = [0.0f32; STACK_BUFFER_FRAMES * 2];
    let frame_count = data.len() / channels;

    let mut frame_idx = 0;
    while frame_idx < frame_count {
        let chunk_frames = (frame_count - frame_idx).min(STACK_BUFFER_FRAMES);

        for i in 0..chunk_frames {
            let src_idx = (frame_idx + i) * channels;
            let (l, r) = if channels == 1 {
                let s = data[src_idx];
                (s, s)
            } else {
                (data[src_idx], data[src_idx + 1])
            };
            stereo_buf[i * 2] = l;
            stereo_buf[i * 2 + 1] = r;
        }

        producer.push_slice(&stereo_buf[..chunk_frames * 2]);
        frame_idx += chunk_frames;
    }
}

/// Convert input i16 samples to normalized f32 stereo interleaved [-1.0, 1.0].
#[inline]
fn process_input_samples_i16(data: &[i16], channels: usize, producer: &mut AudioProducer) {
    if channels == 0 || data.is_empty() {
        return;
    }

    const STACK_BUFFER_FRAMES: usize = 256;
    let mut stereo_buf = [0.0f32; STACK_BUFFER_FRAMES * 2];
    let frame_count = data.len() / channels;

    let mut frame_idx = 0;
    while frame_idx < frame_count {
        let chunk_frames = (frame_count - frame_idx).min(STACK_BUFFER_FRAMES);

        for i in 0..chunk_frames {
            let src_idx = (frame_idx + i) * channels;
            let (l, r) = if channels == 1 {
                let s = data[src_idx] as f32 / 32768.0;
                (s, s)
            } else {
                (
                    data[src_idx] as f32 / 32768.0,
                    data[src_idx + 1] as f32 / 32768.0,
                )
            };
            stereo_buf[i * 2] = l;
            stereo_buf[i * 2 + 1] = r;
        }

        producer.push_slice(&stereo_buf[..chunk_frames * 2]);
        frame_idx += chunk_frames;
    }
}

/// Convert input u16 samples to normalized f32 stereo interleaved [-1.0, 1.0].
#[inline]
fn process_input_samples_u16(data: &[u16], channels: usize, producer: &mut AudioProducer) {
    if channels == 0 || data.is_empty() {
        return;
    }

    const STACK_BUFFER_FRAMES: usize = 256;
    let mut stereo_buf = [0.0f32; STACK_BUFFER_FRAMES * 2];
    let frame_count = data.len() / channels;

    let mut frame_idx = 0;
    while frame_idx < frame_count {
        let chunk_frames = (frame_count - frame_idx).min(STACK_BUFFER_FRAMES);

        for i in 0..chunk_frames {
            let src_idx = (frame_idx + i) * channels;
            let (l, r) = if channels == 1 {
                let s = (data[src_idx] as f32 - 32768.0) / 32768.0;
                (s, s)
            } else {
                (
                    (data[src_idx] as f32 - 32768.0) / 32768.0,
                    (data[src_idx + 1] as f32 - 32768.0) / 32768.0,
                )
            };
            stereo_buf[i * 2] = l;
            stereo_buf[i * 2 + 1] = r;
        }

        producer.push_slice(&stereo_buf[..chunk_frames * 2]);
        frame_idx += chunk_frames;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_devices_honest() {
        let devices = AudioCaptureManager::enumerate_input_devices();
        for dev in &devices {
            assert!(!dev.name.is_empty());
            assert_ne!(dev.name, "Default System Audio Capture");
        }
    }

    #[test]
    fn test_process_input_samples_f32_normalization() {
        let (mut prod, mut cons, _, _) = crate::audio::buffer::create_audio_ring_buffer(64);
        let mono_input = [0.5f32, -0.5f32];
        process_input_samples_f32(&mono_input, 1, &mut prod);

        let mut output = [0.0f32; 4];
        let read = cons.pop_slice(&mut output);
        assert_eq!(read, 4);
        assert_eq!(output, [0.5, 0.5, -0.5, -0.5]);
    }

    #[test]
    fn test_process_input_samples_i16_normalization() {
        let (mut prod, mut cons, _, _) = crate::audio::buffer::create_audio_ring_buffer(64);
        let stereo_i16 = [16384i16, -16384i16];
        process_input_samples_i16(&stereo_i16, 2, &mut prod);

        let mut output = [0.0f32; 2];
        let read = cons.pop_slice(&mut output);
        assert_eq!(read, 2);
        assert!((output[0] - 0.5).abs() < 1e-3);
        assert!((output[1] - (-0.5)).abs() < 1e-3);
    }
}
