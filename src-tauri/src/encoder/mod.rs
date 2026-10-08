//! Broadcast Audio Encoder Subsystem
//!
//! # Encoder Licensing & Open-Source Compatibility Audit
//! - Library: `rusty_mp3` (v1.0.0)
//! - License: Apache-2.0
//! - Rationale: All MPEG-1/2 Audio Layer III patents expired globally by 2017.
//!   `rusty_mp3` is a pure-Rust implementation of Layer III encoding without any C/FFI
//!   bindings, dynamic linking requirements, or proprietary SDKs. The Apache-2.0 license
//!   ensures full compatibility with the open-source Broadcst Studio ecosystem.

use crossbeam_channel::{Receiver, Sender, TrySendError};
use parking_lot::Mutex;
use rusty_mp3::{Mp3Encoder, Mp3EncoderConfig};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};

pub const DEFAULT_NETWORK_QUEUE_CAPACITY: usize = 256;

pub trait AudioEncoder: Send {
    fn encode(&mut self, pcm_interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String>;
    fn flush(&mut self) -> Result<Vec<Vec<u8>>, String>;
}

/// Linear 16-bit PCM encoder (retained strictly for tests / internal conversion; NOT for SHOUTcast).
pub struct Pcm16Encoder {
    pub channels: u16,
    pub sample_rate: u32,
}

impl Pcm16Encoder {
    pub fn new(channels: u16, sample_rate: u32) -> Self {
        Self {
            channels,
            sample_rate,
        }
    }
}

impl AudioEncoder for Pcm16Encoder {
    fn encode(&mut self, pcm_interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
        let mut output = Vec::with_capacity(pcm_interleaved.len() * 2);
        for &s in pcm_interleaved {
            let clamped = s.clamp(-1.0, 1.0);
            let sample_i16 = (clamped * 32767.0) as i16;
            output.extend_from_slice(&sample_i16.to_le_bytes());
        }
        Ok(vec![output])
    }

    fn flush(&mut self) -> Result<Vec<Vec<u8>>, String> {
        Ok(vec![])
    }
}

/// Genuine MP3 Streaming Encoder powered by pure-Rust `rusty_mp3`.
pub struct NativeMp3Encoder {
    encoder: Mp3Encoder,
    sample_rate: u32,
    channels: u16,
    bitrate_kbps: u32,
}

impl NativeMp3Encoder {
    pub fn new(channels: u16, sample_rate: u32, bitrate_kbps: u32) -> Self {
        let config = Mp3EncoderConfig {
            bitrate_kbps,
            vbr_quality: None, // CBR streaming for broadcast standard
        };
        let encoder = Mp3Encoder::new(config);

        Self {
            encoder,
            sample_rate,
            channels,
            bitrate_kbps,
        }
    }

    pub fn bitrate_kbps(&self) -> u32 {
        self.bitrate_kbps
    }
}

impl AudioEncoder for NativeMp3Encoder {
    fn encode(&mut self, pcm_interleaved: &[f32]) -> Result<Vec<Vec<u8>>, String> {
        self.encoder
            .push_pcm_f32(pcm_interleaved, self.channels, self.sample_rate)
            .map_err(|e| format!("MP3 encoder push failed: {:?}", e))?;

        let mut packets = Vec::new();
        while let Ok(packet) = self.encoder.next_packet() {
            packets.push(packet);
        }

        Ok(packets)
    }

    fn flush(&mut self) -> Result<Vec<Vec<u8>>, String> {
        self.encoder.finish();
        let mut packets = Vec::new();
        while let Ok(packet) = self.encoder.next_packet() {
            packets.push(packet);
        }
        Ok(packets)
    }
}

/// Dedicated Encoder Worker that consumes PCM frames from the Master Tap
/// and emits encoded MP3 chunks to the bounded network queue.
/// Runs completely off the real-time audio thread.
pub struct EncoderWorker {
    is_running: Arc<AtomicBool>,
    worker_handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    encoded_bytes_total: Arc<AtomicU64>,
    dropped_packets: Arc<AtomicU64>,
}

impl EncoderWorker {
    pub fn start(
        tap_rx: Receiver<Vec<f32>>,
        network_tx: Sender<Vec<u8>>,
        channels: u16,
        sample_rate: u32,
        bitrate_kbps: u32,
    ) -> Self {
        let is_running = Arc::new(AtomicBool::new(true));
        let encoded_bytes_total = Arc::new(AtomicU64::new(0));
        let dropped_packets = Arc::new(AtomicU64::new(0));

        let is_running_cloned = is_running.clone();
        let bytes_cloned = encoded_bytes_total.clone();
        let dropped_cloned = dropped_packets.clone();

        let handle = thread::spawn(move || {
            let mut encoder = NativeMp3Encoder::new(channels, sample_rate, bitrate_kbps);

            while is_running_cloned.load(Ordering::Relaxed) {
                match tap_rx.recv_timeout(std::time::Duration::from_millis(50)) {
                    Ok(pcm_block) => {
                        match encoder.encode(&pcm_block) {
                            Ok(packets) => {
                                for packet in packets {
                                    bytes_cloned.fetch_add(packet.len() as u64, Ordering::Relaxed);
                                    match network_tx.try_send(packet) {
                                        Ok(()) => {}
                                        Err(TrySendError::Full(_)) => {
                                            dropped_cloned.fetch_add(1, Ordering::Relaxed);
                                        }
                                        Err(TrySendError::Disconnected(_)) => {
                                            return;
                                        }
                                    }
                                }
                            }
                            Err(_) => {
                                // Non-fatal encode error: continue processing
                            }
                        }
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        // Keep worker alive waiting for new frames
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }

            // Flush remaining packets upon termination
            if let Ok(packets) = encoder.flush() {
                for packet in packets {
                    bytes_cloned.fetch_add(packet.len() as u64, Ordering::Relaxed);
                    let _ = network_tx.try_send(packet);
                }
            }
        });

        Self {
            is_running,
            worker_handle: Arc::new(Mutex::new(Some(handle))),
            encoded_bytes_total,
            dropped_packets,
        }
    }

    pub fn stop(&self) {
        self.is_running.store(false, Ordering::SeqCst);
        if let Some(handle) = self.worker_handle.lock().take() {
            let _ = handle.join();
        }
    }

    pub fn encoded_bytes_total(&self) -> u64 {
        self.encoded_bytes_total.load(Ordering::Relaxed)
    }

    pub fn dropped_packets(&self) -> u64 {
        self.dropped_packets.load(Ordering::Relaxed)
    }
}

impl Drop for EncoderWorker {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pcm16_encoder() {
        let mut enc = Pcm16Encoder::new(2, 48000);
        let input = [0.0, 0.5, -0.5, 1.0];
        let res = enc.encode(&input).unwrap();
        assert_eq!(res.len(), 1);
        assert_eq!(res[0].len(), input.len() * 2);
    }

    #[test]
    fn test_mp3_encoder_valid_output() {
        let mut enc = NativeMp3Encoder::new(2, 48000, 128);
        // Feed 1152 stereo frames = 2304 samples to generate an MP3 frame
        let input = vec![0.1f32; 2304];
        let packets = enc.encode(&input).unwrap();
        // Packets may be emitted or buffered by the MP3 bit reservoir
        let flushed = enc.flush().unwrap();
        let total_packets = packets.len() + flushed.len();
        assert!(total_packets > 0, "Encoder should produce valid MP3 frames");

        // Verify MP3 sync word (0xFF 0xFB for MPEG-1 Layer III 128kbps) on first packet
        let first_packet = if !packets.is_empty() {
            &packets[0]
        } else {
            &flushed[0]
        };
        assert!(first_packet.len() >= 4);
        assert_eq!(first_packet[0], 0xFF);
        assert!(
            (first_packet[1] & 0xE0) == 0xE0,
            "Sync word 11 bits must be set"
        );
    }

    #[test]
    fn test_mp3_chunk_consistency() {
        let mut enc = NativeMp3Encoder::new(2, 48000, 192);
        // Feed 10 chunks of 480 stereo frames (960 samples each = 10ms at 48kHz)
        let chunk = vec![0.05f32; 960];
        let mut total_packets = 0;
        for _ in 0..10 {
            let packets = enc.encode(&chunk).unwrap();
            total_packets += packets.len();
        }
        let flushed = enc.flush().unwrap();
        total_packets += flushed.len();
        assert!(
            total_packets >= 3,
            "100ms of 48kHz audio should yield multiple MP3 packets (got {})",
            total_packets
        );
    }

    #[test]
    fn test_mp3_encoder_roundtrip_decoding() {
        use rusty_mp3::Mp3Decoder;

        let mut enc = NativeMp3Encoder::new(2, 48000, 128);
        // Feed 4800 stereo frames (100ms at 48kHz = 9600 samples)
        let pcm_input = vec![0.25f32; 9600];
        let mut mp3_bytes = Vec::new();

        let packets = enc.encode(&pcm_input).unwrap();
        for p in packets {
            mp3_bytes.extend_from_slice(&p);
        }
        let flushed = enc.flush().unwrap();
        for p in flushed {
            mp3_bytes.extend_from_slice(&p);
        }

        assert!(!mp3_bytes.is_empty(), "MP3 bitstream should contain bytes");

        // Validate bitstream using Mp3Decoder
        let mut decoder = Mp3Decoder::new();
        decoder.push(&mp3_bytes);
        decoder.flush();

        let mut decoded_frames = 0;
        let mut total_decoded_samples = 0;
        while let Ok(audio) = decoder.next_frame() {
            assert_eq!(
                audio.sample_rate, 48000,
                "Decoded sample rate must match 48000"
            );
            assert_eq!(audio.channels, 2, "Decoded channels must be stereo");
            assert!(!audio.samples.is_empty());
            decoded_frames += 1;
            total_decoded_samples += audio.samples.len();
        }

        assert!(
            decoded_frames > 0,
            "Decoder must successfully decode at least one MP3 frame from encoded stream"
        );
        assert!(total_decoded_samples > 0);
    }
}
