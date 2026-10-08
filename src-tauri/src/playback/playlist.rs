use crate::playback::decoder::TrackMetadataInfo;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{BufReader, BufWriter};
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistItem {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: u64,
    #[serde(default)]
    pub format: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub added_at: Option<String>,
}

pub struct PlaylistManager {
    library: Arc<RwLock<Vec<PlaylistItem>>>,
    queue: Arc<RwLock<Vec<PlaylistItem>>>,
    current_index: AtomicUsize,
    queue_storage_path: PathBuf,
    library_storage_path: PathBuf,
}

impl PlaylistManager {
    pub fn new() -> Arc<Self> {
        let (queue_storage_path, library_storage_path) = Self::resolve_storage_paths();
        let manager = Arc::new(Self {
            library: Arc::new(RwLock::new(Vec::new())),
            queue: Arc::new(RwLock::new(Vec::new())),
            current_index: AtomicUsize::new(0),
            queue_storage_path,
            library_storage_path,
        });

        manager.load_from_disk();
        manager
    }

    fn resolve_storage_paths() -> (PathBuf, PathBuf) {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let mut p = PathBuf::from(app_data);
            p.push("BroadcstStudio");
            let _ = fs::create_dir_all(&p);
            let queue_p = p.join("playlist.json");
            let lib_p = p.join("library.json");
            return (queue_p, lib_p);
        }

        (
            PathBuf::from("playlist_state.json"),
            PathBuf::from("library_state.json"),
        )
    }

    pub fn load_from_disk(&self) {
        // 1. Load Queue
        if self.queue_storage_path.exists() {
            if let Ok(file) = File::open(&self.queue_storage_path) {
                let reader = BufReader::new(file);
                if let Ok(loaded) = serde_json::from_reader::<_, Vec<PlaylistItem>>(reader) {
                    let mut guard = self.queue.write();
                    *guard = loaded;
                    tracing::info!("Loaded {} queue items from {:?}", guard.len(), self.queue_storage_path);
                }
            }
        }

        // 2. Load Library
        if self.library_storage_path.exists() {
            if let Ok(file) = File::open(&self.library_storage_path) {
                let reader = BufReader::new(file);
                if let Ok(loaded) = serde_json::from_reader::<_, Vec<PlaylistItem>>(reader) {
                    let mut guard = self.library.write();
                    *guard = loaded;
                    tracing::info!("Loaded {} library items from {:?}", guard.len(), self.library_storage_path);
                }
            }
        }
    }

    pub fn save_queue_to_disk(&self) {
        if let Some(parent) = self.queue_storage_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(file) = File::create(&self.queue_storage_path) {
            let writer = BufWriter::new(file);
            let guard = self.queue.read();
            let _ = serde_json::to_writer_pretty(writer, &*guard);
        }
    }

    pub fn save_library_to_disk(&self) {
        if let Some(parent) = self.library_storage_path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        if let Ok(file) = File::create(&self.library_storage_path) {
            let writer = BufWriter::new(file);
            let guard = self.library.read();
            let _ = serde_json::to_writer_pretty(writer, &*guard);
        }
    }

    // ==========================================
    // LIBRARY OPERATIONS
    // ==========================================

    pub fn get_library(&self) -> Vec<PlaylistItem> {
        self.library.read().clone()
    }

    pub fn scan_folder(&self, folder_path: &str) -> Vec<PlaylistItem> {
        let mut discovered = Vec::new();
        let path = std::path::Path::new(folder_path);
        if !path.exists() || !path.is_dir() {
            return discovered;
        }

        Self::walk_and_collect_audio_files(path, &mut discovered);

        // Add discovered items to library if not already present by file_path
        {
            let mut lib = self.library.write();
            for item in &discovered {
                if !lib.iter().any(|existing| existing.file_path == item.file_path) {
                    lib.push(item.clone());
                }
            }
        }
        self.save_library_to_disk();
        discovered
    }

    fn walk_and_collect_audio_files(dir: &std::path::Path, out: &mut Vec<PlaylistItem>) {
        if let Ok(entries) = fs::read_dir(dir) {
            for entry in entries.flatten() {
                let p = entry.path();
                if p.is_dir() {
                    Self::walk_and_collect_audio_files(&p, out);
                } else if p.is_file() {
                    if let Some(ext) = p.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()) {
                        if matches!(ext.as_str(), "mp3" | "wav" | "flac" | "ogg") {
                            let file_str = p.to_string_lossy().to_string();
                            let info = match crate::playback::decoder::decode_audio_file(&file_str) {
                                Ok(d) => d.info,
                                Err(_) => {
                                    let filename = p
                                        .file_stem()
                                        .and_then(|s| s.to_str())
                                        .unwrap_or("Track")
                                        .to_string();
                                    TrackMetadataInfo {
                                        id: format!("trk-{}", chrono::Utc::now().timestamp_micros()),
                                        file_path: file_str.clone(),
                                        title: filename,
                                        artist: "Local Audio".to_string(),
                                        album: None,
                                        duration_ms: 0,
                                    }
                                }
                            };

                            out.push(PlaylistItem {
                                id: info.id,
                                file_path: info.file_path,
                                title: info.title,
                                artist: info.artist,
                                album: info.album,
                                duration_ms: info.duration_ms,
                                format: Some(ext),
                                pinned: false,
                                added_at: Some(chrono::Utc::now().to_rfc3339()),
                            });
                        }
                    }
                }
            }
        }
    }

    pub fn search_library(&self, query: &str) -> Vec<PlaylistItem> {
        let q = query.to_lowercase();
        let lib = self.library.read();
        if q.is_empty() {
            return lib.clone();
        }
        lib.iter()
            .filter(|item| {
                item.title.to_lowercase().contains(&q)
                    || item.artist.to_lowercase().contains(&q)
                    || item.album.as_ref().map(|a| a.to_lowercase().contains(&q)).unwrap_or(false)
            })
            .cloned()
            .collect()
    }

    pub fn remove_missing_files(&self) -> usize {
        let mut count = 0;
        {
            let mut lib = self.library.write();
            let orig_len = lib.len();
            lib.retain(|item| std::path::Path::new(&item.file_path).exists());
            count += orig_len - lib.len();
        }
        {
            let mut queue = self.queue.write();
            let orig_len = queue.len();
            queue.retain(|item| std::path::Path::new(&item.file_path).exists());
            count += orig_len - queue.len();
        }
        self.save_library_to_disk();
        self.save_queue_to_disk();
        count
    }

    pub fn toggle_pinned(&self, id: &str) -> bool {
        let mut pinned = false;
        {
            let mut lib = self.library.write();
            if let Some(item) = lib.iter_mut().find(|i| i.id == id) {
                item.pinned = !item.pinned;
                pinned = item.pinned;
            }
        }
        self.save_library_to_disk();
        pinned
    }

    // ==========================================
    // QUEUE OPERATIONS (BACKWARD-COMPATIBLE)
    // ==========================================

    pub fn get_items(&self) -> Vec<PlaylistItem> {
        self.queue.read().clone()
    }

    pub fn add_item(&self, item: PlaylistItem) {
        {
            let mut guard = self.queue.write();
            guard.push(item);
        }
        self.save_queue_to_disk();
    }

    pub fn insert_next(&self, item: PlaylistItem) {
        let cur = self.current_index.load(Ordering::Relaxed);
        {
            let mut guard = self.queue.write();
            let insert_pos = if cur < guard.len() { cur + 1 } else { guard.len() };
            guard.insert(insert_pos, item);
        }
        self.save_queue_to_disk();
    }

    pub fn remove_item(&self, index: usize) -> Option<PlaylistItem> {
        let removed = {
            let mut guard = self.queue.write();
            if index < guard.len() {
                Some(guard.remove(index))
            } else {
                None
            }
        };

        if removed.is_some() {
            self.save_queue_to_disk();
        }
        removed
    }

    pub fn clear(&self) {
        {
            let mut guard = self.queue.write();
            guard.clear();
        }
        self.current_index.store(0, Ordering::Relaxed);
        self.save_queue_to_disk();
    }

    pub fn reorder(&self, from: usize, to: usize) -> bool {
        let mut guard = self.queue.write();
        let len = guard.len();
        if from < len && to < len && from != to {
            let item = guard.remove(from);
            guard.insert(to, item);
            drop(guard);
            self.save_queue_to_disk();
            true
        } else {
            false
        }
    }

    pub fn get_item_at(&self, index: usize) -> Option<PlaylistItem> {
        let guard = self.queue.read();
        guard.get(index).cloned()
    }

    pub fn current_index(&self) -> usize {
        self.current_index.load(Ordering::Relaxed)
    }

    pub fn set_current_index(&self, idx: usize) {
        self.current_index.store(idx, Ordering::Relaxed);
    }

    pub fn peek_next_item(&self) -> Option<PlaylistItem> {
        let guard = self.queue.read();
        if guard.is_empty() {
            return None;
        }

        let cur = self.current_index.load(Ordering::Relaxed);
        let next_idx = if cur + 1 < guard.len() { cur + 1 } else { 0 };
        guard.get(next_idx).cloned()
    }

    pub fn next_item(&self) -> Option<PlaylistItem> {
        let guard = self.queue.read();
        if guard.is_empty() {
            return None;
        }

        let cur = self.current_index.load(Ordering::Relaxed);
        let next_idx = if cur + 1 < guard.len() { cur + 1 } else { 0 };

        self.current_index.store(next_idx, Ordering::Relaxed);
        guard.get(next_idx).cloned()
    }
}
