use crate::audio::{
    AudioCaptureManager, AudioMonitorManager, ChannelStripSnapshot, CANONICAL_CHANNELS,
    CANONICAL_SAMPLE_RATE,
};
use crate::encoder::EncoderWorker;
use crate::models::*;
use crate::playback::{
    decode_audio_file, DeckSnapshot, PlaylistItem, TrackMetadataInfo,
};
use crate::state::AppState;
use crossbeam_channel::bounded;
use serde::{Deserialize, Serialize};
use tauri::{command, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FullPlaybackSnapshot {
    pub deck_a: DeckSnapshot,
    pub deck_b: DeckSnapshot,
    pub active_deck: String,
    pub crossfader: f32,
    pub auto_advance: bool,
    pub monitor_source: String,
    pub cue_gain_db: f32,
    pub cue_muted: bool,
    pub current_track: Option<TrackMetadataInfo>,
    pub now_playing: Option<crate::playback::NowPlayingSnapshot>,
    pub is_monitoring: bool,
    pub monitor_device: Option<String>,
    pub broadcast_state: String,
    pub is_recording: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlActionRequest {
    pub action: String,
    pub params: Option<serde_json::Value>,
}

#[command]
pub async fn broadcast_start(
    state: State<'_, AppState>,
    config: Option<ShoutcastConfig>,
) -> Result<BroadcastStatus, String> {
    let cfg = if let Some(new_cfg) = config {
        state.shoutcast_client.set_config(new_cfg.clone());
        new_cfg
    } else {
        state.shoutcast_client.get_status().config
    };

    // If capture stream is not yet active, attempt to start capture on default hardware input
    if !state.audio_engine.is_capturing() {
        let _ = state.audio_engine.start_capture(None);
    }

    // Subscribe encoder to Master PCM Tap
    let tap_sub = state.audio_engine.subscribe_encoder_tap();

    // Create bounded network queue (256 packets ~ 5 seconds)
    let (net_tx, net_rx) = bounded(256);

    // Start MP3 Encoder worker off audio thread
    let enc_worker = EncoderWorker::start(
        tap_sub.receiver,
        net_tx,
        CANONICAL_CHANNELS,
        CANONICAL_SAMPLE_RATE,
        cfg.bitrate,
    );
    *state.active_encoder.lock() = Some(enc_worker);

    // Connect and stream over persistent TCP
    match state.shoutcast_client.start(net_rx).await {
        Ok(status) => {
            // Push current playing track metadata if available
            if let Some(track) = state.playback_manager.current_playing_track() {
                state.shoutcast_client.set_metadata(TrackMetadata {
                    title: track.title,
                    artist: track.artist,
                    album: track.album,
                    duration_ms: Some(track.duration_ms),
                    station_name: Some(cfg.station_name),
                });
            }
            Ok(status)
        }
        Err(e) => {
            if let Some(w) = state.active_encoder.lock().take() {
                w.stop();
            }
            state.audio_engine.unsubscribe_encoder_tap();
            Err(e)
        }
    }
}

#[command]
pub async fn broadcast_stop(state: State<'_, AppState>) -> Result<BroadcastStatus, String> {
    let status = state.shoutcast_client.stop().await;

    if let Some(w) = state.active_encoder.lock().take() {
        w.stop();
    }
    state.audio_engine.unsubscribe_encoder_tap();

    Ok(status)
}

#[command]
pub async fn broadcast_reconnect(state: State<'_, AppState>) -> Result<BroadcastStatus, String> {
    let (net_tx, net_rx) = bounded(256);
    let tap_sub = state.audio_engine.subscribe_encoder_tap();
    let cfg = state.shoutcast_client.get_status().config;

    let enc_worker = EncoderWorker::start(
        tap_sub.receiver,
        net_tx,
        CANONICAL_CHANNELS,
        CANONICAL_SAMPLE_RATE,
        cfg.bitrate,
    );
    *state.active_encoder.lock() = Some(enc_worker);

    state.shoutcast_client.reconnect(net_rx).await
}

#[command]
pub async fn broadcast_get_status(state: State<'_, AppState>) -> Result<BroadcastStatus, String> {
    Ok(state.shoutcast_client.get_status())
}

#[command]
pub async fn audio_get_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(AudioCaptureManager::enumerate_input_devices())
}

#[command]
pub async fn audio_get_output_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(AudioMonitorManager::enumerate_output_devices())
}

#[command]
pub async fn audio_start(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<String, String> {
    state.audio_engine.start_capture(device_id.as_deref())
}

#[command]
pub async fn audio_stop(state: State<'_, AppState>) -> Result<(), String> {
    state.audio_engine.stop_capture();
    Ok(())
}

#[command]
pub async fn audio_set_device(
    state: State<'_, AppState>,
    device_id: String,
) -> Result<String, String> {
    state.audio_engine.stop_capture();
    state.audio_engine.start_capture(Some(&device_id))
}

#[command]
pub async fn audio_start_monitor(
    state: State<'_, AppState>,
    device_id: Option<String>,
) -> Result<String, String> {
    state.audio_engine.start_monitor(device_id.as_deref())
}

#[command]
pub async fn audio_stop_monitor(state: State<'_, AppState>) -> Result<(), String> {
    state.audio_engine.stop_monitor();
    Ok(())
}

#[command]
pub async fn audio_set_gain(
    state: State<'_, AppState>,
    channel_id: String,
    gain_db: f32,
) -> Result<(), String> {
    state.audio_engine.set_channel_gain(&channel_id, gain_db);
    Ok(())
}

#[command]
pub async fn audio_set_fader(
    state: State<'_, AppState>,
    channel_id: String,
    level: f32,
) -> Result<(), String> {
    state.audio_engine.set_channel_fader(&channel_id, level);
    Ok(())
}

#[command]
pub async fn audio_mute(
    state: State<'_, AppState>,
    channel_id: String,
    muted: bool,
) -> Result<(), String> {
    state.audio_engine.set_channel_mute(&channel_id, muted);
    Ok(())
}

#[command]
pub async fn audio_get_channels(
    state: State<'_, AppState>,
) -> Result<Vec<ChannelStripSnapshot>, String> {
    Ok(state.audio_engine.get_channel_strips())
}

#[command]
pub async fn audio_get_metrics(state: State<'_, AppState>) -> Result<AudioMetrics, String> {
    Ok(state.audio_engine.get_metrics())
}

#[command]
pub async fn stream_get_metrics(state: State<'_, AppState>) -> Result<StreamMetrics, String> {
    Ok(state.shoutcast_client.get_metrics())
}

#[command]
pub async fn telemetry_get_snapshot(
    state: State<'_, AppState>,
) -> Result<TelemetrySnapshot, String> {
    let stream_m = state.shoutcast_client.get_metrics();
    let audio_m = state.audio_engine.get_metrics();

    Ok(TelemetrySnapshot {
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        stream: stream_m,
        audio: audio_m,
        system: SystemMetrics {
            cpu_usage_percent: 0.0,
            memory_usage_mb: 0.0,
            audio_thread_time_ms: 0.0,
        },
    })
}

// ==========================================
// DECK CONTROLS
// ==========================================

#[command]
pub async fn deck_load(
    state: State<'_, AppState>,
    deck_id: String,
    file_path: String,
) -> Result<TrackMetadataInfo, String> {
    let info = state.playback_manager.load_file_to_deck(&deck_id, &file_path)?;

    // Push metadata if active
    state.shoutcast_client.set_metadata(TrackMetadata {
        title: info.title.clone(),
        artist: info.artist.clone(),
        album: info.album.clone(),
        duration_ms: Some(info.duration_ms),
        station_name: None,
    });

    Ok(info)
}

#[command]
pub async fn deck_play(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.play_deck(&deck_id)?;

    if let Some(track) = state.playback_manager.current_playing_track() {
        state.shoutcast_client.set_metadata(TrackMetadata {
            title: track.title,
            artist: track.artist,
            album: track.album,
            duration_ms: Some(track.duration_ms),
            station_name: None,
        });
    }

    Ok(())
}

#[command]
pub async fn deck_pause(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.pause_deck(&deck_id)
}

#[command]
pub async fn deck_stop(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.stop_deck(&deck_id)
}

#[command]
pub async fn deck_seek(
    state: State<'_, AppState>,
    deck_id: String,
    position_ms: u64,
) -> Result<(), String> {
    state.playback_manager.seek_deck(&deck_id, position_ms)
}

#[command]
pub async fn deck_set_crossfader(state: State<'_, AppState>, value: f32) -> Result<(), String> {
    state.playback_manager.set_crossfader(value);
    Ok(())
}

#[command]
pub async fn deck_set_auto_advance(state: State<'_, AppState>, enabled: bool) -> Result<(), String> {
    state.playback_manager.set_auto_advance(enabled);
    Ok(())
}

#[command]
pub async fn playback_get_snapshot(
    state: State<'_, AppState>,
) -> Result<FullPlaybackSnapshot, String> {
    let snap = state.playback_manager.snapshot();
    let bc_status = state.shoutcast_client.get_status();
    let is_rec = state.recorder.is_recording();

    Ok(FullPlaybackSnapshot {
        deck_a: snap.deck_a,
        deck_b: snap.deck_b,
        active_deck: snap.active_deck,
        crossfader: snap.crossfader,
        auto_advance: snap.auto_advance,
        monitor_source: snap.monitor_source,
        cue_gain_db: snap.cue_gain_db,
        cue_muted: snap.cue_muted,
        current_track: snap.current_track,
        now_playing: snap.now_playing,
        is_monitoring: state.audio_engine.is_monitoring(),
        monitor_device: state.audio_engine.current_monitor_device(),
        broadcast_state: format!("{:?}", bc_status.state),
        is_recording: is_rec,
    })
}

// ==========================================
// BROADCAST CUE & TRANSITION DECK CONTROLS
// ==========================================

#[command]
pub async fn deck_restart(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.restart_deck(&deck_id)
}

#[command]
pub async fn deck_unload(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.unload_deck(&deck_id)
}

#[command]
pub async fn deck_set_cue_position(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.set_deck_cue_position(&deck_id)
}

#[command]
pub async fn deck_return_to_cue(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.return_to_cue(&deck_id)
}

#[command]
pub async fn deck_start_from_cue(state: State<'_, AppState>, deck_id: String) -> Result<(), String> {
    state.playback_manager.start_from_cue(&deck_id)
}

#[command]
pub async fn deck_set_cue(state: State<'_, AppState>, deck_id: String, cue: bool) -> Result<(), String> {
    state.playback_manager.set_deck_cue(&deck_id, cue)
}

#[command]
pub async fn deck_set_gain(state: State<'_, AppState>, deck_id: String, gain_db: f32) -> Result<(), String> {
    state.playback_manager.set_deck_gain(&deck_id, gain_db)
}

#[command]
pub async fn deck_set_mute(state: State<'_, AppState>, deck_id: String, muted: bool) -> Result<(), String> {
    state.playback_manager.set_deck_mute(&deck_id, muted)
}

#[command]
pub async fn deck_trigger_transition(
    state: State<'_, AppState>,
    target_deck_id: String,
    mode: Option<String>,
    duration_ms: Option<u64>,
) -> Result<(), String> {
    let trans_mode = match mode.as_deref() {
        Some("hard_cut") | Some("cut") => crate::playback::TransitionMode::HardCut,
        Some("manual") => crate::playback::TransitionMode::Manual,
        _ => crate::playback::TransitionMode::LinearCrossfade,
    };
    state
        .playback_manager
        .trigger_transition(&target_deck_id, trans_mode, duration_ms.unwrap_or(2000))
}

#[command]
pub async fn deck_set_monitor_source(state: State<'_, AppState>, source: String) -> Result<(), String> {
    state.playback_manager.set_monitor_source(&source);
    Ok(())
}

#[command]
pub async fn deck_set_cue_gain(state: State<'_, AppState>, gain_db: f32) -> Result<(), String> {
    state.playback_manager.set_cue_gain_db(gain_db);
    Ok(())
}

#[command]
pub async fn deck_set_cue_muted(state: State<'_, AppState>, muted: bool) -> Result<(), String> {
    state.playback_manager.set_cue_muted(muted);
    Ok(())
}

// ==========================================
// PLAYLIST & LIBRARY CONTROLS
// ==========================================

#[command]
pub async fn playlist_get(state: State<'_, AppState>) -> Result<Vec<PlaylistItem>, String> {
    Ok(state.playback_manager.playlist.get_items())
}

#[command]
pub async fn playlist_get_library(state: State<'_, AppState>) -> Result<Vec<PlaylistItem>, String> {
    Ok(state.playback_manager.playlist.get_library())
}

#[command]
pub async fn playlist_scan_folder(
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<Vec<PlaylistItem>, String> {
    Ok(state.playback_manager.playlist.scan_folder(&folder_path))
}

#[command]
pub async fn playlist_search(
    state: State<'_, AppState>,
    query: String,
) -> Result<Vec<PlaylistItem>, String> {
    Ok(state.playback_manager.playlist.search_library(&query))
}

#[command]
pub async fn playlist_remove_missing(state: State<'_, AppState>) -> Result<usize, String> {
    Ok(state.playback_manager.playlist.remove_missing_files())
}

#[command]
pub async fn playlist_toggle_pinned(state: State<'_, AppState>, id: String) -> Result<bool, String> {
    Ok(state.playback_manager.playlist.toggle_pinned(&id))
}

#[command]
pub async fn playlist_add_file(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<PlaylistItem, String> {
    let decoded = decode_audio_file(&file_path)?;
    let item = PlaylistItem {
        id: decoded.info.id,
        file_path: decoded.info.file_path,
        title: decoded.info.title,
        artist: decoded.info.artist,
        album: decoded.info.album,
        duration_ms: decoded.info.duration_ms,
        format: None,
        pinned: false,
        added_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state.playback_manager.playlist.add_item(item.clone());
    Ok(item)
}

#[command]
pub async fn playlist_insert_next(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<PlaylistItem, String> {
    let decoded = decode_audio_file(&file_path)?;
    let item = PlaylistItem {
        id: decoded.info.id,
        file_path: decoded.info.file_path,
        title: decoded.info.title,
        artist: decoded.info.artist,
        album: decoded.info.album,
        duration_ms: decoded.info.duration_ms,
        format: None,
        pinned: false,
        added_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state.playback_manager.playlist.insert_next(item.clone());
    Ok(item)
}

#[command]
pub async fn playlist_remove(
    state: State<'_, AppState>,
    index: usize,
) -> Result<Option<PlaylistItem>, String> {
    Ok(state.playback_manager.playlist.remove_item(index))
}

#[command]
pub async fn playlist_clear(state: State<'_, AppState>) -> Result<(), String> {
    state.playback_manager.playlist.clear();
    Ok(())
}

#[command]
pub async fn playlist_reorder(
    state: State<'_, AppState>,
    from: usize,
    to: usize,
) -> Result<bool, String> {
    Ok(state.playback_manager.playlist.reorder(from, to))
}

#[command]
pub async fn playlist_play_index(
    state: State<'_, AppState>,
    index: usize,
    deck_id: Option<String>,
) -> Result<TrackMetadataInfo, String> {
    let item = state
        .playback_manager
        .playlist
        .get_item_at(index)
        .ok_or_else(|| format!("Invalid playlist index {}", index))?;

    let target_deck = deck_id.unwrap_or_else(|| state.playback_manager.active_deck_id());
    state.playback_manager.playlist.set_current_index(index);

    let info = state
        .playback_manager
        .load_file_to_deck(&target_deck, &item.file_path)?;
    state.playback_manager.play_deck(&target_deck)?;

    state.shoutcast_client.set_metadata(TrackMetadata {
        title: info.title.clone(),
        artist: info.artist.clone(),
        album: info.album.clone(),
        duration_ms: Some(info.duration_ms),
        station_name: None,
    });

    Ok(info)
}

// ==========================================
// RECORDING CONTROLS
// ==========================================

#[command]
pub async fn recording_start(
    state: State<'_, AppState>,
    prefix: Option<String>,
) -> Result<serde_json::Value, String> {
    let tap_sub = state.audio_engine.subscribe_recorder_tap();
    let file_path = state.recorder.start_with_prefix(None, prefix.as_deref(), tap_sub)?;

    Ok(serde_json::json!({
        "id": format!("rec-{}", chrono::Utc::now().timestamp()),
        "filePath": file_path,
        "startedAt": chrono::Utc::now().to_rfc3339()
    }))
}

#[command]
pub async fn recording_stop(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let result = state.recorder.stop()?;
    state.audio_engine.unsubscribe_recorder_tap();

    Ok(serde_json::json!({
        "id": result.id,
        "durationSeconds": result.duration_seconds,
        "filePath": result.file_path,
        "samplesWritten": result.samples_written,
        "droppedFrames": result.dropped_frames,
        "writeErrors": result.write_errors
    }))
}

#[command]
pub async fn recording_get_history(
    state: State<'_, AppState>,
) -> Result<Vec<crate::recording::RecordingHistoryItem>, String> {
    Ok(state.recorder.get_history())
}

#[command]
pub async fn recording_open_folder(
    _state: State<'_, AppState>,
    path: Option<String>,
) -> Result<(), String> {
    let target = path.unwrap_or_else(|| {
        crate::recording::MasterRecorder::default_recordings_dir()
            .to_string_lossy()
            .to_string()
    });
    crate::recording::MasterRecorder::open_folder(&target)
}

// ==========================================
// PRE-FLIGHT BROADCAST VALIDATION
// ==========================================

#[command]
pub async fn broadcast_preflight_validate(
    state: State<'_, AppState>,
    config: Option<ShoutcastConfig>,
) -> Result<Vec<crate::models::BroadcastPreflightError>, String> {
    let cfg = config.unwrap_or_else(|| state.shoutcast_client.get_status().config);
    let engine_running = true;
    let is_streaming = state.shoutcast_client.get_status().state == crate::models::BroadcastState::Connected;
    match crate::shoutcast::validate_broadcast_preflight(&cfg, engine_running, is_streaming) {
        Ok(()) => Ok(vec![]),
        Err(errs) => Ok(errs),
    }
}

#[command]
pub async fn recording_get_status(
    state: State<'_, AppState>,
) -> Result<crate::recording::RecordingResult, String> {
    Ok(state.recorder.get_status())
}

#[command]
pub async fn metadata_set(
    state: State<'_, AppState>,
    metadata: TrackMetadata,
) -> Result<(), String> {
    state.shoutcast_client.set_metadata(metadata);
    Ok(())
}

// ==========================================
// CONTROL ACTION BRIDGE (AUTOMATION & HOTKEYS)
// ==========================================

#[command]
pub async fn control_action(
    state: State<'_, AppState>,
    action: String,
    params: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    match action.as_str() {
        "deck_play" => {
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or("deck_a");
            state.playback_manager.play_deck(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "deck_pause" => {
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or("deck_a");
            state.playback_manager.pause_deck(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "deck_stop" => {
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or("deck_a");
            state.playback_manager.stop_deck(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "next_track" => {
            let active = state.playback_manager.active_deck_id();
            let next_info = state.playback_manager.handle_deck_finished(&active);
            Ok(serde_json::json!({ "success": true, "track": next_info }))
        }
        "set_fader" => {
            if let Some(p) = params {
                let channel_id = p.get("channelId").and_then(|v| v.as_str()).unwrap_or("master");
                let level = p.get("level").and_then(|v| v.as_f64()).unwrap_or(0.85) as f32;
                state.audio_engine.set_channel_fader(channel_id, level);
            }
            Ok(serde_json::json!({ "success": true }))
        }
        "set_gain" => {
            if let Some(p) = params {
                let channel_id = p.get("channelId").and_then(|v| v.as_str()).unwrap_or("mic");
                let gain_db = p.get("gainDb").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                state.audio_engine.set_channel_gain(channel_id, gain_db);
            }
            Ok(serde_json::json!({ "success": true }))
        }
        "mute_channel" => {
            if let Some(p) = params {
                let channel_id = p.get("channelId").and_then(|v| v.as_str()).unwrap_or("mic");
                let muted = p.get("muted").and_then(|v| v.as_bool()).unwrap_or(true);
                state.audio_engine.set_channel_mute(channel_id, muted);
            }
            Ok(serde_json::json!({ "success": true }))
        }
        "toggle_mic_mute" => {
            let strips = state.audio_engine.get_channel_strips();
            if let Some(mic) = strips.iter().find(|s| s.id == "mic") {
                let new_mute = !mic.mute;
                state.audio_engine.set_channel_mute("mic", new_mute);
                Ok(serde_json::json!({ "success": true, "muted": new_mute }))
            } else {
                Ok(serde_json::json!({ "success": false }))
            }
        }
        "toggle_play_pause" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            if let Some(deck) = state.playback_manager.get_deck(deck_id) {
                if deck.is_playing() {
                    deck.pause();
                    Ok(serde_json::json!({ "success": true, "deckId": deck_id, "playing": false }))
                } else {
                    deck.play();
                    state.playback_manager.set_active_deck(deck_id);
                    Ok(serde_json::json!({ "success": true, "deckId": deck_id, "playing": true }))
                }
            } else {
                Err(format!("Deck '{}' not found", deck_id))
            }
        }
        "switch_active_deck" => {
            let current = state.playback_manager.active_deck_id();
            let next = if current == "deck_a" { "deck_b" } else { "deck_a" };
            state.playback_manager.set_active_deck(next);
            Ok(serde_json::json!({ "success": true, "activeDeck": next }))
        }
        "select_deck" => {
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or("deck_a");
            state.playback_manager.set_active_deck(deck_id);
            Ok(serde_json::json!({ "success": true, "activeDeck": deck_id }))
        }
        "toggle_recording" => {
            if state.recorder.is_recording() {
                let result = state.recorder.stop()?;
                state.audio_engine.unsubscribe_recorder_tap();
                Ok(serde_json::json!({ "success": true, "recording": false, "result": result }))
            } else {
                let tap_sub = state.audio_engine.subscribe_recorder_tap();
                let file_path = state.recorder.start(None, tap_sub)?;
                Ok(serde_json::json!({ "success": true, "recording": true, "filePath": file_path }))
            }
        }
        "start_from_cue" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            state.playback_manager.start_from_cue(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "return_to_cue" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            state.playback_manager.return_to_cue(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "set_cue_position" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            state.playback_manager.set_deck_cue_position(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "restart_deck" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            state.playback_manager.restart_deck(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "unload_deck" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            state.playback_manager.unload_deck(deck_id)?;
            Ok(serde_json::json!({ "success": true, "deckId": deck_id }))
        }
        "toggle_deck_cue" => {
            let active = state.playback_manager.active_deck_id();
            let deck_id = params
                .as_ref()
                .and_then(|p| p.get("deckId"))
                .and_then(|v| v.as_str())
                .unwrap_or(&active);
            if let Some(deck) = state.playback_manager.get_deck(deck_id) {
                let cur = deck.is_cue();
                deck.set_cue(!cur);
                Ok(serde_json::json!({ "success": true, "deckId": deck_id, "cue": !cur }))
            } else {
                Err(format!("Deck '{}' not found", deck_id))
            }
        }
        "set_monitor_source" => {
            let source = params
                .as_ref()
                .and_then(|p| p.get("source"))
                .and_then(|v| v.as_str())
                .unwrap_or("master");
            state.playback_manager.set_monitor_source(source);
            Ok(serde_json::json!({ "success": true, "source": source }))
        }
        "trigger_transition" => {
            let target_deck_id = params
                .as_ref()
                .and_then(|p| p.get("targetDeckId"))
                .and_then(|v| v.as_str())
                .unwrap_or("deck_b");
            let mode_str = params
                .as_ref()
                .and_then(|p| p.get("mode"))
                .and_then(|v| v.as_str());
            let mode = match mode_str {
                Some("hard_cut") | Some("cut") => crate::playback::TransitionMode::HardCut,
                Some("manual") => crate::playback::TransitionMode::Manual,
                _ => crate::playback::TransitionMode::LinearCrossfade,
            };
            let duration_ms = params
                .as_ref()
                .and_then(|p| p.get("durationMs"))
                .and_then(|v| v.as_u64())
                .unwrap_or(2000);
            state.playback_manager.trigger_transition(target_deck_id, mode, duration_ms)?;
            Ok(serde_json::json!({ "success": true, "targetDeckId": target_deck_id }))
        }
        "open_recording_folder" => {
            let target = match params.as_ref().and_then(|p| p.get("path")).and_then(|v| v.as_str()) {
                Some(p) => p.to_string(),
                None => crate::recording::MasterRecorder::default_recordings_dir().to_string_lossy().to_string(),
            };
            crate::recording::MasterRecorder::open_folder(&target)?;
            Ok(serde_json::json!({ "success": true, "path": target }))
        }
        other => Err(format!("Unknown control action: '{}'", other)),
    }
}

// ==========================================
// TRANSCRIPTION PLACEHOLDERS (PHASE C BLOCKED)
// ==========================================

#[command]
pub async fn transcript_start(
    config: Option<TranscriptConfig>,
) -> Result<TranscriptStatus, String> {
    let cfg = config.unwrap_or(TranscriptConfig {
        provider: "local_whisper".to_string(),
        model_name: "whisper-small-q5".to_string(),
        language: "id".to_string(),
        is_local: true,
        auto_scroll: true,
    });
    Ok(TranscriptStatus {
        state: "LISTENING".to_string(),
        active_segment_id: None,
        segments_count: 0,
        config: cfg,
        last_error_message: None,
    })
}

#[command]
pub async fn transcript_stop() -> Result<TranscriptStatus, String> {
    Ok(TranscriptStatus {
        state: "IDLE".to_string(),
        active_segment_id: None,
        segments_count: 0,
        config: TranscriptConfig {
            provider: "local_whisper".to_string(),
            model_name: "whisper-small-q5".to_string(),
            language: "id".to_string(),
            is_local: true,
            auto_scroll: true,
        },
        last_error_message: None,
    })
}

#[command]
pub async fn transcript_get_segments() -> Result<Vec<TranscriptSegment>, String> {
    Ok(vec![])
}
