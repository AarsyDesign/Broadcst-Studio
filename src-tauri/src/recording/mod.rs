use crate::audio::MasterTapSubscription;
use hound::{SampleFormat, WavSpec, WavWriter};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::BufWriter;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingResult {
    pub id: String,
    pub file_path: String,
    pub duration_seconds: f32,
    pub samples_written: u64,
    pub dropped_frames: u64,
    pub write_errors: u64,
}

pub struct MasterRecorder {
    is_recording: Arc<AtomicBool>,
    samples_written: Arc<AtomicU64>,
    write_errors: Arc<AtomicU64>,
    dropped_frames_counter: Arc<Mutex<Option<Arc<AtomicU64>>>>,
    current_filepath: Arc<Mutex<Option<PathBuf>>>,
    current_session_id: Arc<Mutex<Option<String>>>,
    worker_handle: Arc<Mutex<Option<JoinHandle<Result<(), String>>>>>,
    sample_rate: u32,
    channels: u16,
}

impl MasterRecorder {
    pub fn new(sample_rate: u32, channels: u16) -> Arc<Self> {
        Arc::new(Self {
            is_recording: Arc::new(AtomicBool::new(false)),
            samples_written: Arc::new(AtomicU64::new(0)),
            write_errors: Arc::new(AtomicU64::new(0)),
            dropped_frames_counter: Arc::new(Mutex::new(None)),
            current_filepath: Arc::new(Mutex::new(None)),
            current_session_id: Arc::new(Mutex::new(None)),
            worker_handle: Arc::new(Mutex::new(None)),
            sample_rate,
            channels,
        })
    }

    /// Start recording master PCM frames to a dedicated WAV file.
    /// Runs on a dedicated background worker thread off the audio engine thread.
    pub fn start(
        &self,
        output_dir: Option<&str>,
        subscription: MasterTapSubscription,
    ) -> Result<String, String> {
        if self.is_recording.load(Ordering::SeqCst) {
            return Err("Recording session is already active".to_string());
        }

        // Establish explicit recordings directory
        let dir_path = output_dir
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("recordings"));

        if !dir_path.exists() {
            fs::create_dir_all(&dir_path).map_err(|e| {
                format!(
                    "Failed to create recordings directory {:?}: {}",
                    dir_path, e
                )
            })?;
        }

        let timestamp = chrono::Utc::now();
        let session_id = format!("rec-{}", timestamp.timestamp());
        let filename = format!("recording_{}.wav", timestamp.format("%Y%m%d_%H%M%S"));
        let full_path = dir_path.join(&filename);

        // WAV specification derived from actual engine parameters
        let spec = WavSpec {
            channels: self.channels,
            sample_rate: self.sample_rate,
            bits_per_sample: 16,
            sample_format: SampleFormat::Int,
        };

        let wav_writer = WavWriter::create(&full_path, spec)
            .map_err(|e| format!("Failed to create WAV file at {:?}: {}", full_path, e))?;

        self.samples_written.store(0, Ordering::SeqCst);
        self.write_errors.store(0, Ordering::SeqCst);
        *self.current_filepath.lock() = Some(full_path.clone());
        *self.current_session_id.lock() = Some(session_id.clone());
        *self.dropped_frames_counter.lock() = Some(subscription.dropped_frames.clone());

        self.is_recording.store(true, Ordering::SeqCst);

        let is_running = self.is_recording.clone();
        let samples_counter = self.samples_written.clone();
        let errors_counter = self.write_errors.clone();
        let rx = subscription.receiver;

        let handle = thread::spawn(move || -> Result<(), String> {
            let mut writer: WavWriter<BufWriter<File>> = wav_writer;

            while is_running.load(Ordering::Relaxed) {
                match rx.recv_timeout(Duration::from_millis(50)) {
                    Ok(pcm_block) => {
                        for &s in &pcm_block {
                            let clamped = s.clamp(-1.0, 1.0);
                            let sample_i16 = (clamped * 32767.0) as i16;
                            if let Err(_) = writer.write_sample(sample_i16) {
                                errors_counter.fetch_add(1, Ordering::Relaxed);
                            }
                        }
                        samples_counter.fetch_add(pcm_block.len() as u64, Ordering::Relaxed);
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Timeout) => {
                        // Keep listening while recording is active
                    }
                    Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                        break;
                    }
                }
            }

            // Drain any pending frames upon stopping
            while let Ok(pcm_block) = rx.try_recv() {
                for &s in &pcm_block {
                    let clamped = s.clamp(-1.0, 1.0);
                    let sample_i16 = (clamped * 32767.0) as i16;
                    if let Err(_) = writer.write_sample(sample_i16) {
                        errors_counter.fetch_add(1, Ordering::Relaxed);
                    }
                }
                samples_counter.fetch_add(pcm_block.len() as u64, Ordering::Relaxed);
            }

            writer
                .finalize()
                .map_err(|e| format!("Failed to finalize WAV header: {}", e))?;

            Ok(())
        });

        *self.worker_handle.lock() = Some(handle);

        Ok(full_path.to_string_lossy().to_string())
    }

    /// Stop the recording session, flush and finalize the WAV file, and return the honest recording metrics.
    pub fn stop(&self) -> Result<RecordingResult, String> {
        if !self.is_recording.load(Ordering::SeqCst) {
            return Err("No active recording session to stop".to_string());
        }

        self.is_recording.store(false, Ordering::SeqCst);

        // Join recorder worker thread and catch finalize errors
        if let Some(handle) = self.worker_handle.lock().take() {
            match handle.join() {
                Ok(res) => {
                    res?;
                }
                Err(_) => {
                    return Err("Recorder worker thread panicked".to_string());
                }
            }
        }

        let total_samples = self.samples_written.load(Ordering::Relaxed);
        let duration_seconds = if self.channels > 0 && self.sample_rate > 0 {
            (total_samples / self.channels as u64) as f32 / self.sample_rate as f32
        } else {
            0.0
        };

        let file_path = self
            .current_filepath
            .lock()
            .take()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "recordings/recording.wav".to_string());

        let session_id = self
            .current_session_id
            .lock()
            .take()
            .unwrap_or_else(|| format!("rec-{}", chrono::Utc::now().timestamp()));

        let dropped_frames = self
            .dropped_frames_counter
            .lock()
            .as_ref()
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0);

        let write_errors = self.write_errors.load(Ordering::Relaxed);

        Ok(RecordingResult {
            id: session_id,
            file_path,
            duration_seconds,
            samples_written: total_samples,
            dropped_frames,
            write_errors,
        })
    }

    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::Relaxed)
    }

    pub fn get_duration_seconds(&self) -> f32 {
        let total_samples = self.samples_written.load(Ordering::Relaxed);
        if self.channels > 0 && self.sample_rate > 0 {
            (total_samples / self.channels as u64) as f32 / self.sample_rate as f32
        } else {
            0.0
        }
    }

    pub fn get_status(&self) -> RecordingResult {
        let total_samples = self.samples_written.load(Ordering::Relaxed);
        let duration_seconds = if self.channels > 0 && self.sample_rate > 0 {
            (total_samples / self.channels as u64) as f32 / self.sample_rate as f32
        } else {
            0.0
        };

        let file_path = self
            .current_filepath
            .lock()
            .as_ref()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        let session_id = self.current_session_id.lock().clone().unwrap_or_default();

        let dropped_frames = self
            .dropped_frames_counter
            .lock()
            .as_ref()
            .map(|c| c.load(Ordering::Relaxed))
            .unwrap_or(0);

        let write_errors = self.write_errors.load(Ordering::Relaxed);

        RecordingResult {
            id: session_id,
            file_path,
            duration_seconds,
            samples_written: total_samples,
            dropped_frames,
            write_errors,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crossbeam_channel::bounded;

    #[test]
    fn test_recorder_worker_lifecycle() {
        let recorder = MasterRecorder::new(48000, 2);
        let (tx, rx) = bounded(16);
        let dropped = Arc::new(AtomicU64::new(0));

        let temp_dir = std::env::temp_dir().join("broadcst_test_recordings");
        let sub = MasterTapSubscription {
            receiver: rx,
            dropped_frames: dropped,
        };

        let file_path = recorder
            .start(Some(temp_dir.to_str().unwrap()), sub)
            .expect("Recorder should start");

        // Feed 480 stereo frames = 960 samples (10ms)
        let block = vec![0.25f32; 960];
        tx.send(block).unwrap();

        // Allow worker to write
        thread::sleep(Duration::from_millis(50));

        let result = recorder.stop().expect("Recorder should stop");
        assert_eq!(result.samples_written, 960);
        assert!((result.duration_seconds - 0.01).abs() < 0.005);
        assert_eq!(result.write_errors, 0);

        // Verify WAV file on disk
        let reader = hound::WavReader::open(&file_path).expect("WAV file must be readable");
        assert_eq!(reader.spec().channels, 2);
        assert_eq!(reader.spec().sample_rate, 48000);
        assert_eq!(reader.len(), 960);

        let _ = fs::remove_file(file_path);
        let _ = fs::remove_dir(temp_dir);
    }
}
