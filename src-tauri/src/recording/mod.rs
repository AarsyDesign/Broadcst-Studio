use hound::{WavSpec, WavWriter};
use parking_lot::Mutex;
use std::fs::File;
use std::io::BufWriter;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

pub struct MasterRecorder {
    is_recording: Arc<AtomicBool>,
    duration_samples: Arc<AtomicU64>,
    writer: Arc<Mutex<Option<WavWriter<BufWriter<File>>>>>,
    current_filepath: Arc<Mutex<Option<String>>>,
    sample_rate: u32,
}

impl MasterRecorder {
    pub fn new(sample_rate: u32) -> Arc<Self> {
        Arc::new(Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            duration_samples: Arc::new(AtomicU64::new(0)),
            writer: Arc::new(Mutex::new(None)),
            current_filepath: Arc::new(Mutex::new(None)),
            sample_rate,
        })
    }

    pub fn start(&self, output_path: &str) -> Result<(), String> {
        let spec = WavSpec {
            channels: 2,
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };

        let wav_writer = WavWriter::create(output_path, spec)
            .map_err(|e| format!("Failed to create recording WAV file: {}", e))?;

        *self.writer.lock() = Some(wav_writer);
        *self.current_filepath.lock() = Some(output_path.to_string());
        self.duration_samples.store(0, Ordering::SeqCst);
        self.is_recording.store(true, Ordering::SeqCst);

        Ok(())
    }

    pub fn write_samples(&self, samples: &[f32]) {
        if !self.is_recording.load(Ordering::Relaxed) {
            return;
        }

        let mut lock = self.writer.lock();
        if let Some(w) = lock.as_mut() {
            for &s in samples {
                let clamped = s.clamp(-1.0, 1.0);
                let val_i16 = (clamped * 32767.0) as i16;
                let _ = w.write_sample(val_i16);
            }
            self.duration_samples.fetch_add((samples.len() / 2) as u64, Ordering::Relaxed);
        }
    }

    pub fn stop(&self) -> Result<Option<String>, String> {
        self.is_recording.store(false, Ordering::SeqCst);

        let mut lock = self.writer.lock();
        if let Some(w) = lock.take() {
            w.finalize()
                .map_err(|e| format!("Failed to finalize WAV recording: {}", e))?;
        }

        let path = self.current_filepath.lock().clone();
        Ok(path)
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::Relaxed)
    }

    pub fn get_duration_seconds(&self) -> f32 {
        let samples = self.duration_samples.load(Ordering::Relaxed);
        samples as f32 / self.sample_rate as f32
    }
}
