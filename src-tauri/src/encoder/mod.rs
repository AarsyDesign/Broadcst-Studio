use std::io::Write;

pub trait AudioEncoder: Send + Sync {
    fn encode(&mut self, pcm_samples: &[f32], output: &mut Vec<u8>) -> Result<usize, String>;
    fn flush(&mut self, output: &mut Vec<u8>) -> Result<usize, String>;
}

/// Linear 16-bit PCM streaming encoder
pub struct Pcm16Encoder {
    channels: u16,
    sample_rate: u32,
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
    fn encode(&mut self, pcm_samples: &[f32], output: &mut Vec<u8>) -> Result<usize, String> {
        let initial_len = output.len();
        for &s in pcm_samples {
            // Clamp and quantize to signed 16-bit integer
            let clamped = s.clamp(-1.0, 1.0);
            let sample_i16 = (clamped * 32767.0) as i16;
            let bytes = sample_i16.to_le_bytes();
            output.extend_from_slice(&bytes);
        }
        Ok(output.len() - initial_len)
    }

    fn flush(&mut self, _output: &mut Vec<u8>) -> Result<usize, String> {
        Ok(0)
    }
}
