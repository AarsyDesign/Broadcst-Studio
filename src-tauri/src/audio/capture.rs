use crate::audio::buffer::AudioProducer;
use crate::models::AudioDevice;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, Stream, StreamConfig};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub const CANONICAL_SAMPLE_RATE: u32 = 48000;
pub const CANONICAL_CHANNELS: u16 = 2;

/// Real-time safe linear resampler with zero heap allocations.
/// Converts input interleaved stereo samples at `src_rate` to canonical 48000 Hz interleaved stereo.
pub struct RealtimeResampler {
    ratio: f64,
    phase: f64,
    last_frame: [f32; 2],
}

impl RealtimeResampler {
    pub fn new(src_rate: u32, target_rate: u32) -> Self {
        let ratio = src_rate as f64 / target_rate as f64;
        Self {
            ratio,
            phase: 0.0,
            last_frame: [0.0, 0.0],
        }
    }

    /// Resample a block of interleaved stereo frames into canonical 48kHz stereo.
    /// Emits resampled stereo frames directly to the real-time AudioProducer using stack buffers.
    #[inline]
    pub fn process_stereo_block(&mut self, input_stereo: &[f32], producer: &mut AudioProducer) {
        if input_stereo.is_empty() {
            return;
        }

        let total_input_frames = input_stereo.len() / 2;
        if total_input_frames == 0 {
            return;
        }

        const OUT_CHUNK_FRAMES: usize = 256;
        let mut out_buf = [0.0f32; OUT_CHUNK_FRAMES * 2];
        let mut out_count = 0;

        // If phase is negative from previous chunk, interpolate between last_frame and input_stereo[0]
        if self.phase < 0.0 {
            let alpha = (self.phase + 1.0) as f32;
            let l0 = self.last_frame[0];
            let r0 = self.last_frame[1];
            let l1 = input_stereo[0];
            let r1 = input_stereo[1];

            out_buf[out_count * 2] = l0 + alpha * (l1 - l0);
            out_buf[out_count * 2 + 1] = r0 + alpha * (r1 - r0);
            out_count += 1;
            self.phase += self.ratio;
        }

        while self.phase < (total_input_frames.saturating_sub(1)) as f64 {
            let idx = self.phase.floor() as usize;
            let alpha = (self.phase - idx as f64) as f32;

            let in_idx0 = idx * 2;
            let in_idx1 = (idx + 1) * 2;

            let l0 = input_stereo[in_idx0];
            let r0 = input_stereo[in_idx0 + 1];
            let l1 = input_stereo[in_idx1];
            let r1 = input_stereo[in_idx1 + 1];

            out_buf[out_count * 2] = l0 + alpha * (l1 - l0);
            out_buf[out_count * 2 + 1] = r0 + alpha * (r1 - r0);
            out_count += 1;

            if out_count >= OUT_CHUNK_FRAMES {
                producer.push_slice(&out_buf[..out_count * 2]);
                out_count = 0;
            }

            self.phase += self.ratio;
        }

        if out_count > 0 {
            producer.push_slice(&out_buf[..out_count * 2]);
        }

        // Store last frame and carry over fractional phase
        let last_idx = (total_input_frames - 1) * 2;
        self.last_frame[0] = input_stereo[last_idx];
        self.last_frame[1] = input_stereo[last_idx + 1];
        self.phase -= total_input_frames as f64;
    }
}

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

        let mut resampler = if sample_rate != CANONICAL_SAMPLE_RATE {
            Some(RealtimeResampler::new(sample_rate, CANONICAL_SAMPLE_RATE))
        } else {
            None
        };

        // We build the CPAL stream based on sample format
        let stream = match sample_format {
            SampleFormat::F32 => {
                let ch_count = channels as usize;
                device
                    .build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            process_input_samples_f32(
                                data,
                                ch_count,
                                resampler.as_mut(),
                                &mut producer,
                            );
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
                            process_input_samples_i16(
                                data,
                                ch_count,
                                resampler.as_mut(),
                                &mut producer,
                            );
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
                            process_input_samples_u16(
                                data,
                                ch_count,
                                resampler.as_mut(),
                                &mut producer,
                            );
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

/// Convert input f32 samples to stereo interleaved f32 with optional real-time resampling.
/// Stack-allocated chunk processing for hard real-time safety.
#[inline]
fn process_input_samples_f32(
    data: &[f32],
    channels: usize,
    mut resampler: Option<&mut RealtimeResampler>,
    producer: &mut AudioProducer,
) {
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

        let slice = &stereo_buf[..chunk_frames * 2];
        if let Some(res) = resampler.as_deref_mut() {
            res.process_stereo_block(slice, producer);
        } else {
            producer.push_slice(slice);
        }

        frame_idx += chunk_frames;
    }
}

/// Convert input i16 samples to normalized f32 stereo interleaved [-1.0, 1.0].
#[inline]
fn process_input_samples_i16(
    data: &[i16],
    channels: usize,
    mut resampler: Option<&mut RealtimeResampler>,
    producer: &mut AudioProducer,
) {
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

        let slice = &stereo_buf[..chunk_frames * 2];
        if let Some(res) = resampler.as_deref_mut() {
            res.process_stereo_block(slice, producer);
        } else {
            producer.push_slice(slice);
        }

        frame_idx += chunk_frames;
    }
}

/// Convert input u16 samples to normalized f32 stereo interleaved [-1.0, 1.0].
#[inline]
fn process_input_samples_u16(
    data: &[u16],
    channels: usize,
    mut resampler: Option<&mut RealtimeResampler>,
    producer: &mut AudioProducer,
) {
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

        let slice = &stereo_buf[..chunk_frames * 2];
        if let Some(res) = resampler.as_deref_mut() {
            res.process_stereo_block(slice, producer);
        } else {
            producer.push_slice(slice);
        }

        frame_idx += chunk_frames;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_devices_honest() {
        let devices = AudioCaptureManager::enumerate_input_devices();
        println!(
            "Detected {} physical audio input devices on host:",
            devices.len()
        );
        for dev in &devices {
            println!(
                "  [ID: {}] {} (default: {}, {}ch @ {}Hz)",
                dev.id, dev.name, dev.is_default, dev.channels, dev.sample_rate
            );
            assert!(!dev.name.is_empty());
            assert_ne!(dev.name, "Default System Audio Capture");
        }
    }

    #[test]
    fn test_process_input_samples_f32_normalization() {
        let (mut prod, mut cons, _, _) = crate::audio::buffer::create_audio_ring_buffer(64);
        let mono_input = [0.5f32, -0.5f32];
        process_input_samples_f32(&mono_input, 1, None, &mut prod);

        let mut output = [0.0f32; 4];
        let read = cons.pop_slice(&mut output);
        assert_eq!(read, 4);
        assert_eq!(output, [0.5, 0.5, -0.5, -0.5]);
    }

    #[test]
    fn test_process_input_samples_i16_normalization() {
        let (mut prod, mut cons, _, _) = crate::audio::buffer::create_audio_ring_buffer(64);
        let stereo_i16 = [16384i16, -16384i16];
        process_input_samples_i16(&stereo_i16, 2, None, &mut prod);

        let mut output = [0.0f32; 2];
        let read = cons.pop_slice(&mut output);
        assert_eq!(read, 2);
        assert!((output[0] - 0.5).abs() < 1e-3);
        assert!((output[1] - (-0.5)).abs() < 1e-3);
    }

    #[test]
    fn test_resampler_44100_to_48000() {
        let (mut prod, mut cons, _, _) = crate::audio::buffer::create_audio_ring_buffer(96000);
        let mut resampler = RealtimeResampler::new(44100, 48000);

        // Feed exactly 4410 frames (100ms at 44.1kHz) of a constant stereo signal
        let input: Vec<f32> = (0..4410).flat_map(|_| vec![0.75f32, -0.75f32]).collect();

        resampler.process_stereo_block(&input, &mut prod);

        let mut output = vec![0.0f32; 96000];
        let read_samples = cons.pop_slice(&mut output);
        let read_frames = read_samples / 2;

        // 4410 frames at 44.1kHz converted to 48kHz must yield ~4800 frames (+-2)
        assert!(
            (read_frames as i32 - 4800).abs() <= 2,
            "Resampling 4410 frames to 48kHz should yield ~4800 frames, got {}",
            read_frames
        );

        // Verify values are preserved
        assert!((output[0] - 0.75).abs() < 0.05);
        assert!((output[1] - (-0.75)).abs() < 0.05);
    }

    #[test]
    fn test_resampler_96000_to_48000() {
        let (mut prod, mut cons, _, _) = crate::audio::buffer::create_audio_ring_buffer(96000);
        let mut resampler = RealtimeResampler::new(96000, 48000);

        // Feed 9600 frames (100ms at 96kHz)
        let input: Vec<f32> = (0..9600).flat_map(|_| vec![0.5f32, 0.5f32]).collect();

        resampler.process_stereo_block(&input, &mut prod);

        let mut output = vec![0.0f32; 96000];
        let read_samples = cons.pop_slice(&mut output);
        let read_frames = read_samples / 2;

        // Downsampling by 2 should yield 4800 frames (+-1)
        assert!(
            (read_frames as i32 - 4800).abs() <= 1,
            "Downsampling 9600 frames by 2x should yield ~4800 frames, got {}",
            read_frames
        );
    }
}
