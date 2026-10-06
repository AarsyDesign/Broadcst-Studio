use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: u64,
}

pub struct PlaylistManager {
    items: Arc<RwLock<Vec<PlaylistItem>>>,
    current_index: AtomicUsize,
    storage_path: PathBuf,
}

impl PlaylistManager {
    pub fn new() -> Arc<Self> {
        let storage_path = Self::resolve_storage_path();
        let manager = Arc::new(Self {
            items: Arc::new(RwLock::new(Vec::new())),
            current_index: AtomicUsize::new(0),
            storage_path,
        });

        manager.load_from_disk();
        manager
    }

    fn resolve_storage_path() -> PathBuf {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let mut p = PathBuf::from(app_data);
            p.push("BroadcstStudio");
            let _ = fs::create_dir_all(&p);
            p.push("playlist.json");
            return p;
        }

        PathBuf::from("playlist_state.json")
    }

    pub fn load_from_disk(&self) {
        if !self.storage_path.exists() {
            return;
        }

        if let Ok(file) = File::open(&self.storage_path) {
            let reader = BufReader::new(file);
            if let Ok(loaded) = serde_json::from_reader::<_, Vec<PlaylistItem>>(reader) {
                let mut guard = self.items.write();
                *guard = loaded;
                tracing::info!("Loaded {} playlist items from {:?}", guard.len(), self.storage_path);
            }
        }
    }

    pub fn save_to_disk(&self) {
        if let Some(parent) = self.storage_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(file) = File::create(&self.storage_path) {
            let writer = BufWriter::new(file);
            let guard = self.items.read();
            let _ = serde_json::to_writer_pretty(writer, &*guard);
        }
    }

    pub fn get_items(&self) -> Vec<PlaylistItem> {
        self.items.read().clone()
    }

    pub fn add_item(&self, item: PlaylistItem) {
        {
            let mut guard = self.items.write();
            guard.push(item);
        }
        self.save_to_disk();
    }

    pub fn remove_item(&self, index: usize) -> Option<PlaylistItem> {
        let removed = {
            let mut guard = self.items.write();
            if index < guard.len() {
                Some(guard.remove(index))
            } else {
                None
            }
        };

        if removed.is_some() {
            self.save_to_disk();
        }
        removed
    }

    pub fn clear(&self) {
        {
            let mut guard = self.items.write();
            guard.clear();
        }
        self.current_index.store(0, Ordering::Relaxed);
        self.save_to_disk();
    }

    pub fn reorder(&self, from: usize, to: usize) -> bool {
        let mut guard = self.items.write();
        let len = guard.len();
        if from < len && to < len && from != to {
            let item = guard.remove(from);
            guard.insert(to, item);
            drop(guard);
            self.save_to_disk();
            true
        } else {
            false
        }
    }

    pub fn get_item_at(&self, index: usize) -> Option<PlaylistItem> {
        let guard = self.items.read();
        guard.get(index).cloned()
    }

    pub fn current_index(&self) -> usize {
        self.current_index.load(Ordering::Relaxed)
    }

    pub fn set_current_index(&self, idx: usize) {
        self.current_index.store(idx, Ordering::Relaxed);
    }

    pub fn next_item(&self) -> Option<PlaylistItem> {
        let guard = self.items.read();
        if guard.is_empty() {
            return None;
        }

        let cur = self.current_index.load(Ordering::Relaxed);
        let next_idx = if cur + 1 < guard.len() {
            cur + 1
        } else {
            0 // Loop back or stop
        };

        self.current_index.store(next_idx, Ordering::Relaxed);
        guard.get(next_idx).cloned()
    }
}
