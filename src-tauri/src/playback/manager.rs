use crate::audio::mixer::{load_atomic_f32, store_atomic_f32};
use crate::playback::deck::{Deck, DeckSnapshot};
use crate::playback::decoder::{decode_audio_file, TrackMetadataInfo};
use crate::playback::playlist::PlaylistManager;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackSnapshot {
    pub deck_a: DeckSnapshot,
    pub deck_b: DeckSnapshot,
    pub active_deck: String,
    pub crossfader: f32,
    pub auto_advance: bool,
    pub current_track: Option<TrackMetadataInfo>,
}

pub struct PlaybackManager {
    pub deck_a: Arc<Deck>,
    pub deck_b: Arc<Deck>,
    pub playlist: Arc<PlaylistManager>,
    active_deck_id: Arc<RwLock<String>>,
    crossfader: AtomicU32, // -1.0 to 1.0
    auto_advance: AtomicBool,
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
        }
    }

    pub fn load_file_to_deck(&self, deck_id: &str, file_path: &str) -> Result<TrackMetadataInfo, String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        let decoded = decode_audio_file(file_path)?;
        let info = decoded.info.clone();
        deck.load_track(decoded);
        self.set_active_deck(deck_id);
        Ok(info)
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

    pub fn seek_deck(&self, deck_id: &str, position_ms: u64) -> Result<(), String> {
        let deck = self.get_deck(deck_id).ok_or_else(|| format!("Unknown deck '{}'", deck_id))?;
        deck.seek_ms(position_ms);
        Ok(())
    }

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

    pub fn set_auto_advance(&self, enabled: bool) {
        self.auto_advance.store(enabled, Ordering::Relaxed);
    }

    pub fn is_auto_advance(&self) -> bool {
        self.auto_advance.load(Ordering::Relaxed)
    }

    /// Triggered when a deck finishes playback.
    /// Automatically advances to the next playlist item on the opposite deck (or same deck).
    pub fn handle_deck_finished(self: &Arc<Self>, finished_deck_id: &str) -> Option<TrackMetadataInfo> {
        if !self.is_auto_advance() {
            return None;
        }

        let next_item = self.playlist.next_item()?;
        let target_deck_id = if finished_deck_id == "deck_a" { "deck_b" } else { "deck_a" };

        let decoded = match decode_audio_file(&next_item.file_path) {
            Ok(d) => d,
            Err(e) => {
                tracing::warn!("Auto-advance decode failed for {:?}: {}", next_item.file_path, e);
                return None;
            }
        };

        let info = decoded.info.clone();
        if let Some(target_deck) = self.get_deck(target_deck_id) {
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
        } else {
            None
        }
    }

    pub fn current_playing_track(&self) -> Option<TrackMetadataInfo> {
        let active_id = self.active_deck_id();
        if active_id == "deck_a" {
            self.deck_a.current_track_info()
        } else {
            self.deck_b.current_track_info()
        }
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
            current_track,
        }
    }
}
