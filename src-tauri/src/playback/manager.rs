use crate::audio::mixer::{load_atomic_f32, store_atomic_f32};
use crate::playback::deck::{Deck, DeckSnapshot, DeckState};
use crate::playback::decoder::{decode_audio_file, TrackMetadataInfo};
use crate::playback::playlist::PlaylistManager;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransitionMode {
    HardCut,
    LinearCrossfade,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingSnapshot {
    pub deck_id: String,
    pub track: Option<TrackMetadataInfo>,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub playback_state: String,
    pub started_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub deck_a: DeckSnapshot,
    pub deck_b: DeckSnapshot,
    pub active_deck: String,
    pub crossfader: f32,
    pub auto_advance: bool,
    pub monitor_source: String,
    pub cue_gain_db: f32,
    pub cue_muted: bool,
    pub current_track: Option<TrackMetadataInfo>,
    pub now_playing: Option<NowPlayingSnapshot>,
}

pub struct PlaybackManager {
    pub deck_a: Arc<Deck>,
    pub deck_b: Arc<Deck>,
    pub playlist: Arc<PlaylistManager>,
    active_deck_id: Arc<RwLock<String>>,
    crossfader: AtomicU32, // -1.0 to 1.0
    auto_advance: AtomicBool,
    monitor_source: AtomicU8, // 0 = "master", 1 = "cue"
    cue_gain_db: AtomicU32,
    cue_muted: AtomicBool,
    now_playing_started_at: Arc<RwLock<Option<String>>>,
    is_preloading: AtomicBool,
}

impl PlaybackManager {
    pub fn new() -> Arc<Self> {
        let deck_a = Deck::new("deck_a", "Deck A");
        let deck_b = Deck::new("deck_b", "Deck B");
        let playlist = PlaylistManager::new();

        Arc::new(Self {
            deck_a,
            deck_b,
            playlist,
            active_deck_id: Arc::new(RwLock::new("deck_a".to_string())),
            crossfader: AtomicU32::new(0.0f32.to_bits()), // Centered
            auto_advance: AtomicBool::new(true),
            monitor_source: AtomicU8::new(0), // Master default
            cue_gain_db: AtomicU32::new(0.0f32.to_bits()),
            cue_muted: AtomicBool::new(false),
            now_playing_started_at: Arc::new(RwLock::new(None)),
            is_preloading: AtomicBool::new(false),
        })
    }

    pub fn get_deck(&self, deck_id: &str) -> Option<Arc<Deck>> {
        match deck_id {
            "deck_a" | "deckA" | "A" => Some(self.deck_a.clone()),
            "deck_b" | "deckB" | "B" => Some(self.deck_b.clone()),
            _ => None,
        }
    }

    pub fn active_deck_id(&self) -> String {
        self.active_deck_id.read().clone()
    }

    pub fn set_active_deck(&self, deck_id: &str) {
        if deck_id == "deck_a" || deck_id == "deck_b" {
            *self.active_deck_id.write() = deck_id.to_string();
            *self.now_playing_started_at.write() = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    // ==========================================
    // DECK PLAYBACK CONTROLS
    // ==========================================

    pub fn load_file_to_deck(&self, deck_id: &str, file_path: &str) -> Result<TrackMetadataInfo, String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        let decoded = decode_audio_file(file_path)?;
        let info = decoded.info.clone();
        deck.load_track(decoded);
        self.set_active_deck(deck_id);
        Ok(info)
    }

    pub fn unload_deck(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.unload_track();
        Ok(())
    }

    pub fn play_deck(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.play();
        self.set_active_deck(deck_id);
        Ok(())
    }

    pub fn pause_deck(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.pause();
        Ok(())
    }

    pub fn stop_deck(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.stop();
        Ok(())
    }

    pub fn restart_deck(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.restart();
        self.set_active_deck(deck_id);
        Ok(())
    }

    pub fn seek_deck(&self, deck_id: &str, position_ms: u64) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.seek_ms(position_ms);
        Ok(())
    }

    // Cue controls
    pub fn set_deck_cue_position(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.set_cue_position();
        Ok(())
    }

    pub fn return_to_cue(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.return_to_cue();
        Ok(())
    }

    pub fn start_from_cue(&self, deck_id: &str) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.start_from_cue();
        self.set_active_deck(deck_id);
        Ok(())
    }

    pub fn set_deck_cue(&self, deck_id: &str, cue: bool) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.set_cue(cue);
        Ok(())
    }

    pub fn set_deck_gain(&self, deck_id: &str, gain_db: f32) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.set_gain_db(gain_db);
        Ok(())
    }

    pub fn set_deck_mute(&self, deck_id: &str, mute: bool) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.set_mute(mute);
        Ok(())
    }

    // ==========================================
    // CUE & MONITOR ROUTING
    // ==========================================

    pub fn set_monitor_source(&self, source: &str) {
        if source.eq_ignore_ascii_case("cue") {
            self.monitor_source.store(1, Ordering::Relaxed);
        } else {
            self.monitor_source.store(0, Ordering::Relaxed);
        }
    }

    pub fn monitor_source(&self) -> String {
        if self.monitor_source.load(Ordering::Relaxed) == 1 {
            "cue".to_string()
        } else {
            "master".to_string()
        }
    }

    pub fn set_cue_gain_db(&self, db: f32) {
        let clamped = db.clamp(-60.0, 12.0);
        store_atomic_f32(&self.cue_gain_db, clamped);
    }

    pub fn cue_gain_db(&self) -> f32 {
        load_atomic_f32(&self.cue_gain_db)
    }

    pub fn set_cue_muted(&self, muted: bool) {
        self.cue_muted.store(muted, Ordering::Relaxed);
    }

    pub fn is_cue_muted(&self) -> bool {
        self.cue_muted.load(Ordering::Relaxed)
    }

    // ==========================================
    // CROSSFADER & TRANSITIONS
    // ==========================================

    pub fn set_crossfader(&self, val: f32) {
        let clamped = val.clamp(-1.0, 1.0);
        store_atomic_f32(&self.crossfader, clamped);
    }

    pub fn crossfader(&self) -> f32 {
        load_atomic_f32(&self.crossfader)
    }

    /// Linear crossfade gains for [deck_a, deck_b]
    pub fn compute_crossfade_gains(&self) -> (f32, f32) {
        let x = self.crossfader();
        if x <= 0.0 {
            // Left half: Deck A is 1.0, Deck B ramps from 0.0 to 1.0
            (1.0, 1.0 + x)
        } else {
            // Right half: Deck A ramps from 1.0 to 0.0, Deck B is 1.0
            (1.0 - x, 1.0)
        }
    }

    pub fn trigger_transition(
        self: &Arc<Self>,
        target_deck_id: &str,
        mode: TransitionMode,
        duration_ms: u64,
    ) -> Result<(), String> {
        let target_deck = self
            .get_deck(target_deck_id)
            .ok_or_else(|| format!("Target deck '{}' not found", target_deck_id))?;

        let source_deck_id = if target_deck_id == "deck_a" {
            "deck_b"
        } else {
            "deck_a"
        };
        let source_deck = self.get_deck(source_deck_id).unwrap();

        target_deck.play();
        self.set_active_deck(target_deck_id);

        match mode {
            TransitionMode::HardCut => {
                let target_x = if target_deck_id == "deck_a" { -1.0 } else { 1.0 };
                self.set_crossfader(target_x);
                source_deck.stop();
            }
            TransitionMode::LinearCrossfade => {
                let manager = self.clone();
                let source_deck_clone = source_deck.clone();
                let target_is_a = target_deck_id == "deck_a";
                let dur = duration_ms.max(200);

                thread::spawn(move || {
                    let steps = 40;
                    let step_delay = Duration::from_millis(dur / steps);
                    let start_x = manager.crossfader();
                    let target_x = if target_is_a { -1.0 } else { 1.0 };

                    for i in 1..=steps {
                        let t = i as f32 / steps as f32;
                        let next_x = start_x + (target_x - start_x) * t;
                        manager.set_crossfader(next_x);
                        thread::sleep(step_delay);
                    }

                    source_deck_clone.pause();
                });
            }
            TransitionMode::Manual => {
                // Handled directly by operator moving slider
            }
        }

        Ok(())
    }

    // ==========================================
    // AUTO-ADVANCE & PRELOAD PIPELINE
    // ==========================================

    pub fn set_auto_advance(&self, enabled: bool) {
        self.auto_advance.store(enabled, Ordering::Relaxed);
    }

    pub fn is_auto_advance(&self) -> bool {
        self.auto_advance.load(Ordering::Relaxed)
    }

    /// Check if the active deck is approaching the end and preload next track onto idle deck
    pub fn check_and_preload(self: &Arc<Self>) {
        if !self.is_auto_advance() {
            return;
        }

        if self.is_preloading.load(Ordering::Relaxed) {
            return;
        }

        let active_id = self.active_deck_id();
        let (active_deck, idle_deck_id, idle_deck) = if active_id == "deck_a" {
            (&self.deck_a, "deck_b", &self.deck_b)
        } else {
            (&self.deck_b, "deck_a", &self.deck_a)
        };

        if active_deck.is_playing() {
            let snap = active_deck.snapshot();
            if snap.duration_ms > 0 && snap.remaining_ms < 8000 && snap.remaining_ms > 500 {
                // If idle deck is empty or stopped, preload next item
                if idle_deck.state() == DeckState::Empty || idle_deck.state() == DeckState::Stopped {
                    if let Some(next_item) = self.playlist.peek_next_item() {
                        self.is_preloading.store(true, Ordering::SeqCst);
                        let manager = self.clone();
                        let target_deck = idle_deck.clone();
                        let target_id = idle_deck_id.to_string();

                        thread::spawn(move || {
                            if let Ok(decoded) = decode_audio_file(&next_item.file_path) {
                                target_deck.load_track(decoded);
                                tracing::info!(
                                    "Preloaded next track '{} - {}' onto {}",
                                    next_item.artist,
                                    next_item.title,
                                    target_id
                                );
                            }
                            manager.is_preloading.store(false, Ordering::SeqCst);
                        });
                    }
                }
            }
        }
    }

    /// Triggered when a deck finishes playback.
    /// Advances smoothly to the preloaded idle deck or decodes next queue item.
    pub fn handle_deck_finished(self: &Arc<Self>, finished_deck_id: &str) -> Option<TrackMetadataInfo> {
        if !self.is_auto_advance() {
            return None;
        }

        let target_deck_id = if finished_deck_id == "deck_a" {
            "deck_b"
        } else {
            "deck_a"
        };
        let target_deck = self.get_deck(target_deck_id)?;

        // If target deck already has track preloaded
        if target_deck.state() == DeckState::Loaded {
            target_deck.play();
            self.set_active_deck(target_deck_id);
            // Advance playlist pointer
            let _ = self.playlist.next_item();
            let info = target_deck.current_track_info()?;
            tracing::info!(
                "Seamless auto-advance (preloaded) to '{} - {}' on {}",
                info.artist,
                info.title,
                target_deck_id
            );
            return Some(info);
        }

        // Otherwise decode on the fly
        let next_item = self.playlist.next_item()?;
        let decoded = match decode_audio_file(&next_item.file_path) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("Auto-advance decode failed for {:?}: {}", next_item.file_path, e);
                return None;
            }
        };

        let info = decoded.info.clone();
        target_deck.load_track(decoded);
        target_deck.play();
        self.set_active_deck(target_deck_id);
        tracing::info!(
            "Auto-advanced to next track '{} - {}' on {}",
            info.artist,
            info.title,
            target_deck_id
        );
        Some(info)
    }

    pub fn current_playing_track(&self) -> Option<TrackMetadataInfo> {
        let active_id = self.active_deck_id();
        if active_id == "deck_a" {
            self.deck_a.current_track_info()
        } else {
            self.deck_b.current_track_info()
        }
    }

    pub fn now_playing_snapshot(&self) -> Option<NowPlayingSnapshot> {
        let active_id = self.active_deck_id();
        let (deck, _) = if active_id == "deck_a" {
            (&self.deck_a, "deck_a")
        } else {
            (&self.deck_b, "deck_b")
        };

        let track = deck.current_track_info();
        let pos_ms = deck.position_ms();
        let dur_ms = track.as_ref().map(|t| t.duration_ms).unwrap_or(0);
        let state_str = deck.state().as_str().to_string();
        let started_at = self.now_playing_started_at.read().clone();

        Some(NowPlayingSnapshot {
            deck_id: active_id,
            track,
            position_ms: pos_ms,
            duration_ms: dur_ms,
            playback_state: state_str,
            started_at,
        })
    }

    pub fn snapshot(&self) -> PlaybackSnapshot {
        let snap_a = self.deck_a.snapshot();
        let snap_b = self.deck_b.snapshot();
        let active_id = self.active_deck_id();

        let current_track = if active_id == "deck_a" {
            snap_a.track.clone()
        } else {
            snap_b.track.clone()
        };

        PlaybackSnapshot {
            deck_a: snap_a,
            deck_b: snap_b,
            active_deck: active_id,
            crossfader: self.crossfader(),
            auto_advance: self.is_auto_advance(),
            monitor_source: self.monitor_source(),
            cue_gain_db: self.cue_gain_db(),
            cue_muted: self.is_cue_muted(),
            current_track,
            now_playing: self.now_playing_snapshot(),
        }
    }
}
