use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BroadcastState {
    Offline,
    Connecting,
    Authenticating,
    Connected,
    Reconnecting,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShoutcastConfig {
    pub server: String,
    pub port: u16,
    pub mount_point: Option<String>,
    pub stream_id: u32,
    pub password: Option<String>,
    pub bitrate: u32,
    pub codec: String,
    pub station_name: String,
    pub genre: Option<String>,
    pub is_public: bool,
}

impl Default for ShoutcastConfig {
    fn default() -> Self {
        Self {
            server: "radio.example.org".to_string(),
            port: 8000,
            mount_point: None,
            stream_id: 1,
            password: None,
            bitrate: 128,
            codec: "MP3".to_string(),
            station_name: "Broadcast Radio V1".to_string(),
            genre: Some("Talk / Speech".to_string()),
            is_public: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BroadcastStatus {
    pub state: BroadcastState,
    pub uptime_seconds: u64,
    pub reconnect_count: u32,
    pub error_message: Option<String>,
    pub last_connected_at: Option<String>,
    pub config: ShoutcastConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadata {
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: Option<u64>,
    pub station_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub channels: u16,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioMetrics {
    pub input_peak_db: f32,
    pub input_rms_db: f32,
    pub master_peak_db: f32,
    pub master_rms_db: f32,
    pub buffer_underruns: u64,
    pub latency_ms: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamMetrics {
    pub target_bitrate_kbps: u32,
    pub actual_upload_kbps: f32,
    pub buffer_health_ratio: f32,
    pub dropped_frames: u64,
    pub bytes_sent: u64,
    pub network_latency_ms: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemMetrics {
    pub cpu_usage_percent: f32,
    pub memory_usage_mb: f32,
    pub audio_thread_time_ms: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelemetrySnapshot {
    pub timestamp_ms: u64,
    pub stream: StreamMetrics,
    pub audio: AudioMetrics,
    pub system: SystemMetrics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptSegment {
    pub id: String,
    pub start_ms: u64,
    pub end_ms: u64,
    pub text: String,
    pub confidence: Option<f32>,
    pub language: Option<String>,
    pub speaker: Option<String>,
    pub finalized: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptConfig {
    pub provider: String,
    pub model_name: String,
    pub language: String,
    pub is_local: bool,
    pub auto_scroll: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptStatus {
    pub state: String,
    pub active_segment_id: Option<String>,
    pub segments_count: usize,
    pub config: TranscriptConfig,
    pub last_error_message: Option<String>,
}
