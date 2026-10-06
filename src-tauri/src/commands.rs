use crate::audio::AudioCaptureManager;
use crate::models::*;
use crate::state::AppState;
use tauri::{command, State};

#[command]
pub async fn broadcast_start(
    state: State<'_, AppState>,
    _config: Option<ShoutcastConfig>,
) -> Result<BroadcastStatus, String> {
    state.shoutcast_client.start().await
}

#[command]
pub async fn broadcast_stop(state: State<'_, AppState>) -> Result<BroadcastStatus, String> {
    Ok(state.shoutcast_client.stop().await)
}

#[command]
pub async fn broadcast_reconnect(state: State<'_, AppState>) -> Result<BroadcastStatus, String> {
    state.shoutcast_client.reconnect().await
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
pub async fn audio_get_metrics(state: State<'_, AppState>) -> Result<AudioMetrics, String> {
    Ok(state.audio_engine.get_metrics())
}

#[command]
pub async fn stream_get_metrics(state: State<'_, AppState>) -> Result<StreamMetrics, String> {
    Ok(state.shoutcast_client.get_metrics())
}

#[command]
pub async fn telemetry_get_snapshot(state: State<'_, AppState>) -> Result<TelemetrySnapshot, String> {
    let stream_m = state.shoutcast_client.get_metrics();
    let audio_m = state.audio_engine.get_metrics();

    Ok(TelemetrySnapshot {
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        stream: stream_m,
        audio: audio_m,
        system: SystemMetrics {
            cpu_usage_percent: 2.1,
            memory_usage_mb: 48.0,
            audio_thread_time_ms: 0.6,
        },
    })
}

#[command]
pub async fn transcript_start(config: Option<TranscriptConfig>) -> Result<TranscriptStatus, String> {
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

#[command]
pub async fn recording_start(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let timestamp = chrono::Utc::now().timestamp();
    let filename = format!("recording_{}.wav", timestamp);
    state.recorder.start(&filename)?;

    Ok(serde_json::json!({
        "id": format!("rec-{}", timestamp),
        "filePath": filename,
        "startedAt": chrono::Utc::now().to_rfc3339()
    }))
}

#[command]
pub async fn recording_stop(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let duration = state.recorder.get_duration_seconds();
    let filepath = state.recorder.stop()?;

    Ok(serde_json::json!({
        "id": format!("rec-{}", chrono::Utc::now().timestamp()),
        "durationSeconds": duration,
        "filePath": filepath.unwrap_or_else(|| "recording.wav".to_string())
    }))
}

#[command]
pub async fn metadata_set(
    state: State<'_, AppState>,
    metadata: TrackMetadata,
) -> Result<(), String> {
    state.shoutcast_client.set_metadata(metadata);
    Ok(())
}
