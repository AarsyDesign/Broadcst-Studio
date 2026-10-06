use crate::audio::{AudioCaptureManager, CANONICAL_CHANNELS, CANONICAL_SAMPLE_RATE};
use crate::encoder::EncoderWorker;
use crate::models::*;
use crate::state::AppState;
use crossbeam_channel::bounded;
use tauri::{command, State};

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
        Ok(status) => Ok(status),
        Err(e) => {
            // Clean up worker and tap subscription on failure
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
            cpu_usage_percent: 0.0, // Honest unmeasured status (no fake values)
            memory_usage_mb: 0.0,
            audio_thread_time_ms: 0.0,
        },
    })
}

#[command]
pub async fn recording_start(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let tap_sub = state.audio_engine.subscribe_recorder_tap();
    let file_path = state.recorder.start(None, tap_sub)?;

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
