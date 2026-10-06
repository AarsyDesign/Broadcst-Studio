use crate::audio::mixer::{load_atomic_f32, store_atomic_f32};
use crate::playback::decoder::{DecodedTrack, TrackMetadataInfo, CANONICAL_SAMPLE_RATE};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, AtomicU32, Ordering};
use std::sync::Arc;

pub const STATE_EMPTY: u8 = 0;
pub const STATE_LOADED: u8 = 1;
pub const STATE_PLAYING: u8 = 2;
pub const STATE_PAUSED: u8 = 3;
pub const STATE_STOPPED: u8 = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DeckState {
    Empty,
    Loaded,
    Playing,
    Paused,
    Stopped,
}

impl From<u8> for DeckState {
    fn from(val: u8) -> Self {
        match val {
            STATE_LOADED => DeckState::Loaded,
            STATE_PLAYING => DeckState::Playing,
            STATE_PAUSED => DeckState::Paused,
            STATE_STOPPED => DeckState::Stopped,
            _ => DeckState::Empty,
        }
    }
}

impl DeckState {
    pub fn as_str(&self) -> &'static str {
        match self {
            DeckState::Empty => "empty",
            DeckState::Loaded => "loaded",
            DeckState::Playing => "playing",
            DeckState::Paused => "paused",
            DeckState::Stopped => "stopped",
        }
    }
}

pub enum DeckRenderStatus {
    Silence,
    Active { frames_rendered: usize },
    Finished { frames_rendered: usize },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckSnapshot {
    pub id: String,
    pub name: String,
    pub state: String,
    pub track: Option<TrackMetadataInfo>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub remaining_ms: u64,
    pub volume: f32,
    pub cue: bool,
    pub looping: bool,
}

pub struct Deck {
    pub id: String,
    pub name: String,
    state: AtomicU8,
    current_frame: AtomicU64,
    volume: AtomicU32,
    cue: AtomicBool,
    looping: AtomicBool,
    track: Arc<RwLock<Option<Arc<DecodedTrack>>>>,
}

impl Deck {
    pub fn new(id: &str, name: &str) -> Arc<Self> {
        Arc::new(Self {
            id: id.to_string(),
            name: name.to_string(),
            state: AtomicU8::new(STATE_EMPTY),
            current_frame: AtomicU64::new(0),
            volume: AtomicU32::new(1.0f32.to_bits()),
            cue: AtomicBool::new(false),
            looping: AtomicBool::new(false),
            track: Arc::new(RwLock::new(None)),
        })
    }

    pub fn state(&self) -> DeckState {
        self.state.load(Ordering::Relaxed).into()
    }

    pub fn is_playing(&self) -> bool {
        self.state.load(Ordering::Relaxed) == STATE_PLAYING
    }

    pub fn load_track(&self, track: DecodedTrack) {
        let mut guard = self.track.write();
        *guard = Some(Arc::new(track));
        self.current_frame.store(0, Ordering::SeqCst);
        self.state.store(STATE_LOADED, Ordering::SeqCst);
    }

    pub fn unload_track(&self) {
        let mut guard = self.track.write();
        *guard = None;
        self.current_frame.store(0, Ordering::SeqCst);
        self.state.store(STATE_EMPTY, Ordering::SeqCst);
    }

    pub fn play(&self) {
        let cur = self.state.load(Ordering::SeqCst);
        if cur == STATE_LOADED || cur == STATE_PAUSED || cur == STATE_STOPPED {
            self.state.store(STATE_PLAYING, Ordering::SeqCst);
        }
    }

    pub fn pause(&self) {
        if self.state.load(Ordering::SeqCst) == STATE_PLAYING {
            self.state.store(STATE_PAUSED, Ordering::SeqCst);
        }
    }

    pub fn stop(&self) {
        let cur = self.state.load(Ordering::SeqCst);
        if cur != STATE_EMPTY {
            self.current_frame.store(0, Ordering::SeqCst);
            self.state.store(STATE_STOPPED, Ordering::SeqCst);
        }
    }

    pub fn seek_ms(&self, position_ms: u64) {
        let guard = self.track.read();
        if let Some(track) = guard.as_ref() {
            let total_frames = track.total_frames();
            let target_frame = ((position_ms as f64 / 1000.0) * CANONICAL_SAMPLE_RATE as f64) as u64;
            let clamped = target_frame.min(total_frames);
            self.current_frame.store(clamped, Ordering::SeqCst);
        }
    }

    pub fn set_volume(&self, vol: f32) {
        let clamped = vol.clamp(0.0, 2.0);
        store_atomic_f32(&self.volume, clamped);
    }

    pub fn volume(&self) -> f32 {
        load_atomic_f32(&self.volume)
    }

    pub fn set_cue(&self, cue: bool) {
        self.cue.store(cue, Ordering::Relaxed);
    }

    pub fn is_cue(&self) -> bool {
        self.cue.load(Ordering::Relaxed)
    }

    pub fn set_looping(&self, looping: bool) {
        self.looping.store(looping, Ordering::Relaxed);
    }

    pub fn is_looping(&self) -> bool {
        self.looping.load(Ordering::Relaxed)
    }

    pub fn position_ms(&self) -> u64 {
        let frames = self.current_frame.load(Ordering::Relaxed);
        ((frames as f64 / CANONICAL_SAMPLE_RATE as f64) * 1000.0) as u64
    }

    pub fn current_track_info(&self) -> Option<TrackMetadataInfo> {
        let guard = self.track.read();
        guard.as_ref().map(|t| t.info.clone())
    }

    /// Render up to `out.len()` samples (interleaved stereo) into buffer.
    /// Real-time safe, wait-free (read-only Arc reference, zero allocations).
    pub fn render_block(&self, out: &mut [f32]) -> DeckRenderStatus {
        if self.state.load(Ordering::Relaxed) != STATE_PLAYING {
            out.fill(0.0);
            return DeckRenderStatus::Silence;
        }

        let guard = self.track.read();
        let track_ref = match guard.as_ref() {
            Some(t) => t.clone(),
            None => {
                out.fill(0.0);
                return DeckRenderStatus::Silence;
            }
        };
        // Drop lock immediately after cloning the Arc pointer
        drop(guard);

        let total_samples = track_ref.samples.len();
        let total_frames = (total_samples / 2) as u64;
        let cur_frame = self.current_frame.load(Ordering::Relaxed);

        if cur_frame >= total_frames {
            if self.looping.load(Ordering::Relaxed) {
                self.current_frame.store(0, Ordering::Relaxed);
            } else {
                self.state.store(STATE_STOPPED, Ordering::Relaxed);
                out.fill(0.0);
                return DeckRenderStatus::Finished { frames_rendered: 0 };
            }
        }

        let block_frames = out.len() / 2;
        let cur_frame = self.current_frame.load(Ordering::Relaxed);
        let available_frames = total_frames.saturating_sub(cur_frame) as usize;
        let frames_to_render = block_frames.min(available_frames);

        let start_sample = (cur_frame * 2) as usize;
        let end_sample = start_sample + frames_to_render * 2;
        let vol = self.volume();

        if frames_to_render > 0 {
            let src = &track_ref.samples[start_sample..end_sample];
            for (i, &s) in src.iter().enumerate() {
                out[i] = s * vol;
            }
        }

        // Fill remaining buffer with silence if track finished mid-block
        if frames_to_render < block_frames {
            out[frames_to_render * 2..].fill(0.0);
        }

        let next_frame = cur_frame + frames_to_render as u64;
        self.current_frame.store(next_frame, Ordering::Relaxed);

        if next_frame >= total_frames {
            if self.looping.load(Ordering::Relaxed) {
                self.current_frame.store(0, Ordering::Relaxed);
                DeckRenderStatus::Active {
                    frames_rendered: frames_to_render,
                }
            } else {
                self.state.store(STATE_STOPPED, Ordering::Relaxed);
                DeckRenderStatus::Finished {
                    frames_rendered: frames_to_render,
                }
            }
        } else {
            DeckRenderStatus::Active {
                frames_rendered: frames_to_render,
            }
        }
    }

    pub fn snapshot(&self) -> DeckSnapshot {
        let guard = self.track.read();
        let track_info = guard.as_ref().map(|t| t.info.clone());
        let duration_ms = track_info.as_ref().map(|i| i.duration_ms).unwrap_or(0);
        let position_ms = self.position_ms();
        let remaining_ms = duration_ms.saturating_sub(position_ms);

        DeckSnapshot {
            id: self.id.clone(),
            name: self.name.clone(),
            state: self.state().as_str().to_string(),
            track: track_info,
            position_ms,
            duration_ms,
            remaining_ms,
            volume: self.volume(),
            cue: self.is_cue(),
            looping: self.is_looping(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_track(frames: usize) -> DecodedTrack {
        let samples: Vec<f32> = (0..frames * 2)
            .map(|i| if i % 2 == 0 { 0.5 } else { -0.5 })
            .collect();
        let duration_ms = ((frames as f64 / CANONICAL_SAMPLE_RATE as f64) * 1000.0) as u64;

        DecodedTrack {
            info: TrackMetadataInfo {
                id: "test-trk-1".to_string(),
                file_path: "/music/test.mp3".to_string(),
                title: "Test Track".to_string(),
                artist: "Broadcst Artist".to_string(),
                album: Some("Studio Album".to_string()),
                duration_ms,
            },
            samples: Arc::new(samples),
        }
    }

    #[test]
    fn test_deck_lifecycle_and_playback() {
        let deck = Deck::new("deck_a", "Deck A");
        assert_eq!(deck.state(), DeckState::Empty);

        // Load 4800 frames (100ms)
        let track = create_test_track(4800);
        deck.load_track(track);
        assert_eq!(deck.state(), DeckState::Loaded);

        // Not playing -> render yields silence
        let mut block = [0.0f32; 960];
        let status = deck.render_block(&mut block);
        assert!(matches!(status, DeckRenderStatus::Silence));
        assert_eq!(block[0], 0.0);

        // Play -> render yields audio
        deck.play();
        assert_eq!(deck.state(), DeckState::Playing);
        assert!(deck.is_playing());

        let status2 = deck.render_block(&mut block);
        assert!(matches!(status2, DeckRenderStatus::Active { .. }));
        assert_eq!(block[0], 0.5);
        assert_eq!(block[1], -0.5);

        // Verify seek
        deck.seek_ms(50);
        assert_eq!(deck.position_ms(), 50);

        // Verify pause
        deck.pause();
        assert_eq!(deck.state(), DeckState::Paused);

        // Verify resume and stop
        deck.play();
        assert_eq!(deck.state(), DeckState::Playing);
        deck.stop();
        assert_eq!(deck.state(), DeckState::Stopped);
        assert_eq!(deck.position_ms(), 0);
    }
}
