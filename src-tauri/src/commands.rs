use crate::models::*;
use tauri::command;

#[command]
pub async fn broadcast_start(config: Option<ShoutcastConfig>) -> Result<BroadcastStatus, String> {
    let cfg = config.unwrap_or_default();
    Ok(BroadcastStatus {
        state: BroadcastState::Connected,
        uptime_seconds: 0,
        reconnect_count: 0,
        error_message: None,
        last_connected_at: Some(chrono::Utc::now().to_rfc3339()),
        config: cfg,
    })
}

#[command]
pub async fn broadcast_stop() -> Result<BroadcastStatus, String> {
    Ok(BroadcastStatus {
        state: BroadcastState::Offline,
        uptime_seconds: 0,
        reconnect_count: 0,
        error_message: None,
        last_connected_at: None,
        config: ShoutcastConfig::default(),
    })
}

#[command]
pub async fn broadcast_reconnect() -> Result<BroadcastStatus, String> {
    Ok(BroadcastStatus {
        state: BroadcastState::Reconnecting,
        uptime_seconds: 0,
        reconnect_count: 1,
        error_message: None,
        last_connected_at: None,
        config: ShoutcastConfig::default(),
    })
}

#[command]
pub async fn broadcast_get_status() -> Result<BroadcastStatus, String> {
    Ok(BroadcastStatus {
        state: BroadcastState::Offline,
        uptime_seconds: 0,
        reconnect_count: 0,
        error_message: None,
        last_connected_at: None,
        config: ShoutcastConfig::default(),
    })
}

#[command]
pub async fn audio_get_devices() -> Result<Vec<AudioDevice>, String> {
    Ok(vec![
        AudioDevice {
            id: "dev-mic-1".to_string(),
            name: "Microphone (USB Audio Device)".to_string(),
            is_default: true,
            channels: 2,
            sample_rate: 48000,
        },
        AudioDevice {
            id: "dev-aux-1".to_string(),
            name: "Line In (Realtek High Definition)".to_string(),
            is_default: false,
            channels: 2,
            sample_rate: 48000,
        },
    ])
}

#[command]
pub async fn audio_set_gain(channel_id: String, gain_db: f32) -> Result<(), String> {
    tracing::info!("audio.set_gain: {} -> {} dB", channel_id, gain_db);
    Ok(())
}

#[command]
pub async fn audio_set_fader(channel_id: String, level: f32) -> Result<(), String> {
    tracing::info!("audio.set_fader: {} -> {}", channel_id, level);
    Ok(())
}

#[command]
pub async fn audio_mute(channel_id: String, muted: bool) -> Result<(), String> {
    tracing::info!("audio.mute: {} -> {}", channel_id, muted);
    Ok(())
}

#[command]
pub async fn audio_get_metrics() -> Result<AudioMetrics, String> {
    Ok(AudioMetrics {
        input_peak_db: -90.0,
        input_rms_db: -90.0,
        master_peak_db: -90.0,
        master_rms_db: -90.0,
        buffer_underruns: 0,
        latency_ms: 10.0,
    })
}

#[command]
pub async fn stream_get_metrics() -> Result<StreamMetrics, String> {
    Ok(StreamMetrics {
        target_bitrate_kbps: 128,
        actual_upload_kbps: 0.0,
        buffer_health_ratio: 0.0,
        dropped_frames: 0,
        bytes_sent: 0,
        network_latency_ms: 0,
    })
}

#[command]
pub async fn telemetry_get_snapshot() -> Result<TelemetrySnapshot, String> {
    Ok(TelemetrySnapshot {
        timestamp_ms: chrono::Utc::now().timestamp_millis() as u64,
        stream: StreamMetrics {
            target_bitrate_kbps: 128,
            actual_upload_kbps: 0.0,
            buffer_health_ratio: 0.0,
            dropped_frames: 0,
            bytes_sent: 0,
            network_latency_ms: 0,
        },
        audio: AudioMetrics {
            input_peak_db: -90.0,
            input_rms_db: -90.0,
            master_peak_db: -90.0,
            master_rms_db: -90.0,
            buffer_underruns: 0,
            latency_ms: 10.0,
        },
        system: SystemMetrics {
            cpu_usage_percent: 2.5,
            memory_usage_mb: 45.0,
            audio_thread_time_ms: 0.8,
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
pub async fn recording_start() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "id": format!("rec-{}", chrono::Utc::now().timestamp()),
        "startedAt": chrono::Utc::now().to_rfc3339()
    }))
}

#[command]
pub async fn recording_stop() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "id": format!("rec-{}", chrono::Utc::now().timestamp()),
        "durationSeconds": 0,
        "filePath": "recordings/output.mp3"
    }))
}

#[command]
pub async fn metadata_set(metadata: TrackMetadata) -> Result<(), String> {
    tracing::info!("metadata.set: {} by {}", metadata.title, metadata.artist);
    Ok(())
}
