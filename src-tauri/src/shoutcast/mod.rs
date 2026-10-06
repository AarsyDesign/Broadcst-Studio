//! SHOUTcast Source Protocol Implementation
//!
//! # Protocol Specification & Authoritative DNAS Target
//! Broadcst Studio implements the authoritative **SHOUTcast Source Protocol (v1 / ICY wire protocol)**,
//! supported universally by SHOUTcast DNAS 1.x and DNAS 2.x (in legacy source mode), as well as
//! standard broadcasting platforms (Centova Cast, RadioToolbox, sc_serv):
//!
//! 1. **Transport Layer**: Persistent TCP connection established to the DNAS source port.
//! 2. **Authentication**: Client sends the plain-text password terminated with CRLF:
//!    - Single stream: `<PASSWORD>\r\n`
//!    - Multi-stream DNAS 2 targeting: `<PASSWORD>:#<STREAM_ID>\r\n`
//!    *(Note: Icecast HTTP `SOURCE` method and `Authorization: Basic` are NOT SHOUTcast protocols and are not used).*
//! 3. **Server Acceptance**: Server validates credentials and responds with `OK2\r\n` (and optional `icy-caps`).
//!    Only upon receiving `OK2` does the client transition from `AUTHENTICATING` to `CONNECTED`.
//! 4. **Stream Headers**: Immediately following `OK2`, client transmits ICY broadcast configuration:
//!    ```text
//!    icy-name:<station_name>\r\n
//!    icy-genre:<genre>\r\n
//!    icy-url:<url>\r\n
//!    icy-pub:<0 or 1>\r\n
//!    icy-br:<bitrate>\r\n
//!    \r\n
//!    ```
//! 5. **Audio Payload**: Immediately following the double CRLF, client streams continuous raw MP3 audio frames.
//! 6. **Dynamic Metadata Updates**: Stream title/artist updates are dispatched off the audio thread via the
//!    standard DNAS admin interface:
//!    `GET /admin.cgi?mode=updinfo&pass=<PASSWORD>&song=<SONG>&sid=<STREAM_ID> HTTP/1.0\r\n\r\n`
//! 7. **Reliability & State Machine**: State transitions strictly follow:
//!    `OFFLINE` -> `CONNECTING` -> `AUTHENTICATING` -> `CONNECTED` -> `RECONNECTING` -> `ERROR`
//!    Features exponential backoff reconnects that are immediately terminated upon manual user `STOP`.

use crate::models::{
    BroadcastState, BroadcastStatus, ShoutcastConfig, StreamMetrics, TrackMetadata,
};
use crossbeam_channel::Receiver;
use parking_lot::RwLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::Notify;

/// Format the initial SHOUTcast authentication line.
/// In standard DNAS 1: `<PASSWORD>\r\n`
/// In multi-stream DNAS 2: `<PASSWORD>:#<SID>\r\n`
pub fn format_auth_line(cfg: &ShoutcastConfig) -> String {
    let pass = cfg.password.as_deref().unwrap_or_default();
    if cfg.stream_id > 1 {
        format!("{}:#{}\r\n", pass, cfg.stream_id)
    } else {
        format!("{}\r\n", pass)
    }
}

/// Format the ICY stream headers sent after server responds with `OK2`.
pub fn format_icy_stream_headers(cfg: &ShoutcastConfig) -> String {
    format!(
        "icy-name:{}\r\n\
        icy-genre:{}\r\n\
        icy-url:http://{}\r\n\
        icy-pub:{}\r\n\
        icy-br:{}\r\n\
        \r\n",
        cfg.station_name,
        cfg.genre.as_deref().unwrap_or("Broadcast / Speech"),
        cfg.server,
        if cfg.is_public { 1 } else { 0 },
        cfg.bitrate
    )
}

/// Validate the SHOUTcast DNAS handshake response.
/// Acceptance requires the presence of `"OK2"`.
pub fn validate_dnas_response(response: &str) -> Result<(), String> {
    let trimmed = response.trim();
    if trimmed.contains("OK2") {
        Ok(())
    } else if trimmed.to_lowercase().contains("invalid") {
        Err(format!(
            "SHOUTcast DNAS authentication rejected: {}",
            trimmed
        ))
    } else if trimmed.is_empty() {
        Err("SHOUTcast DNAS closed connection with empty response".to_string())
    } else {
        Err(format!(
            "SHOUTcast DNAS handshake failed (expected OK2, received: '{}')",
            trimmed
        ))
    }
}

/// Format the dynamic metadata update HTTP request for `/admin.cgi?mode=updinfo`.
pub fn format_metadata_update_request(cfg: &ShoutcastConfig, meta: &TrackMetadata) -> String {
    let pass = cfg.password.as_deref().unwrap_or_default();
    let song = format!("{} - {}", meta.artist, meta.title);
    let encoded_song = urlencoding::encode(&song);

    if cfg.stream_id > 1 {
        format!(
            "GET /admin.cgi?mode=updinfo&pass={}&song={}&sid={} HTTP/1.0\r\n\
            User-Agent: Broadcst-Studio/0.1.0\r\n\
            \r\n",
            pass, encoded_song, cfg.stream_id
        )
    } else {
        format!(
            "GET /admin.cgi?mode=updinfo&pass={}&song={} HTTP/1.0\r\n\
            User-Agent: Broadcst-Studio/0.1.0\r\n\
            \r\n",
            pass, encoded_song
        )
    }
}

pub fn validate_broadcast_preflight(
    cfg: &ShoutcastConfig,
    is_engine_running: bool,
    is_already_streaming: bool,
) -> Result<(), Vec<crate::models::BroadcastPreflightError>> {
    let mut errors = Vec::new();

    if is_already_streaming {
        errors.push(crate::models::BroadcastPreflightError {
            field: "state".to_string(),
            code: "ALREADY_STREAMING".to_string(),
            message: "A broadcast stream is already active".to_string(),
        });
    }

    if !is_engine_running {
        errors.push(crate::models::BroadcastPreflightError {
            field: "engine".to_string(),
            code: "AUDIO_ENGINE_STOPPED".to_string(),
            message: "Native real-time audio engine is not running".to_string(),
        });
    }

    if cfg.server.trim().is_empty() {
        errors.push(crate::models::BroadcastPreflightError {
            field: "server".to_string(),
            code: "SERVER_EMPTY".to_string(),
            message: "Server host or IP address cannot be empty".to_string(),
        });
    }

    if cfg.port == 0 {
        errors.push(crate::models::BroadcastPreflightError {
            field: "port".to_string(),
            code: "PORT_INVALID".to_string(),
            message: "DNAS source port must be between 1 and 65535".to_string(),
        });
    }

    if cfg.password.as_deref().unwrap_or("").trim().is_empty() {
        errors.push(crate::models::BroadcastPreflightError {
            field: "password".to_string(),
            code: "PASSWORD_EMPTY".to_string(),
            message: "DNAS stream password is required for authentication".to_string(),
        });
    }

    if cfg.stream_id < 1 {
        errors.push(crate::models::BroadcastPreflightError {
            field: "streamId".to_string(),
            code: "STREAM_ID_INVALID".to_string(),
            message: "Stream ID must be 1 or higher".to_string(),
        });
    }

    if cfg.bitrate < 32 || cfg.bitrate > 320 {
        errors.push(crate::models::BroadcastPreflightError {
            field: "bitrate".to_string(),
            code: "BITRATE_INVALID".to_string(),
            message: "Bitrate must be between 32 kbps and 320 kbps".to_string(),
        });
    }

    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors)
    }
}

pub struct ShoutcastClient {
    config: RwLock<ShoutcastConfig>,
    current_metadata: RwLock<TrackMetadata>,
    state: RwLock<BroadcastState>,
    is_running: Arc<AtomicBool>,
    is_manual_stop: Arc<AtomicBool>,

    // Measured metrics
    bytes_sent: Arc<AtomicU64>,
    reconnect_count: Arc<AtomicU64>,
    uptime_seconds: Arc<AtomicU64>,
    last_connected_at: RwLock<Option<String>>,
    last_error_message: RwLock<Option<String>>,

    // Measured upload bitrate tracking
    window_bytes: Arc<AtomicU64>,
    measured_kbps: Arc<RwLock<f32>>,

    // Queue depth tracking for honest buffer health ratio
    network_queue_depth: Arc<AtomicU64>,
    network_queue_capacity: usize,

    // Worker signals
    metadata_updated: Arc<Notify>,
    dropped_network_packets: Arc<AtomicU64>,
    metadata_delivered: Arc<AtomicBool>,
    metadata_error: Arc<RwLock<Option<String>>>,
    transport_handle: Arc<parking_lot::Mutex<Option<tokio::task::JoinHandle<()>>>>,
}

impl ShoutcastClient {
    pub fn new(config: ShoutcastConfig) -> Arc<Self> {
        Arc::new(Self {
            config: RwLock::new(config),
            current_metadata: RwLock::new(TrackMetadata {
                title: "Broadcst Studio".to_string(),
                artist: "Live Station".to_string(),
                album: None,
                duration_ms: None,
                station_name: None,
            }),
            state: RwLock::new(BroadcastState::Offline),
            is_running: Arc::new(AtomicBool::new(false)),
            is_manual_stop: Arc::new(AtomicBool::new(false)),
            bytes_sent: Arc::new(AtomicU64::new(0)),
            reconnect_count: Arc::new(AtomicU64::new(0)),
            uptime_seconds: Arc::new(AtomicU64::new(0)),
            last_connected_at: RwLock::new(None),
            last_error_message: RwLock::new(None),
            window_bytes: Arc::new(AtomicU64::new(0)),
            measured_kbps: Arc::new(RwLock::new(0.0)),
            network_queue_depth: Arc::new(AtomicU64::new(0)),
            network_queue_capacity: 256,
            metadata_updated: Arc::new(Notify::new()),
            dropped_network_packets: Arc::new(AtomicU64::new(0)),
            metadata_delivered: Arc::new(AtomicBool::new(false)),
            metadata_error: Arc::new(RwLock::new(None)),
            transport_handle: Arc::new(parking_lot::Mutex::new(None)),
        })
    }

    pub fn set_config(&self, new_config: ShoutcastConfig) {
        *self.config.write() = new_config;
    }

    pub fn set_dropped_counter(&self, counter: Arc<AtomicU64>) {
        self.dropped_network_packets
            .store(counter.load(Ordering::Relaxed), Ordering::Relaxed);
    }

    /// Connect to SHOUTcast DNAS server, perform handshake, and start background streaming worker.
    pub async fn start(
        self: &Arc<Self>,
        network_rx: Receiver<Vec<u8>>,
    ) -> Result<BroadcastStatus, String> {
        self.is_manual_stop.store(false, Ordering::SeqCst);
        self.is_running.store(true, Ordering::SeqCst);
        *self.last_error_message.write() = None;

        let self_clone = self.clone();

        match self_clone.connect_and_handshake().await {
            Ok(stream) => {
                *self.state.write() = BroadcastState::Connected;
                *self.last_connected_at.write() = Some(chrono::Utc::now().to_rfc3339());

                let worker_self = self.clone();
                let handle = tokio::spawn(async move {
                    worker_self.run_transport_loop(stream, network_rx).await;
                });
                *self.transport_handle.lock() = Some(handle);

                Ok(self.get_status())
            }
            Err(e) => {
                *self.state.write() = BroadcastState::Error;
                *self.last_error_message.write() = Some(e.clone());
                Err(e)
            }
        }
    }

    /// Stop broadcasting immediately. Cancels any active reconnect loop and terminates transport worker.
    pub async fn stop(&self) -> BroadcastStatus {
        self.is_manual_stop.store(true, Ordering::SeqCst);
        self.is_running.store(false, Ordering::SeqCst);
        self.metadata_updated.notify_waiters();
        if let Some(handle) = self.transport_handle.lock().take() {
            handle.abort();
        }
        *self.state.write() = BroadcastState::Offline;
        self.get_status()
    }

    pub async fn reconnect(
        self: &Arc<Self>,
        network_rx: Receiver<Vec<u8>>,
    ) -> Result<BroadcastStatus, String> {
        self.reconnect_count.fetch_add(1, Ordering::SeqCst);
        *self.state.write() = BroadcastState::Reconnecting;
        tokio::time::sleep(Duration::from_millis(500)).await;
        self.start(network_rx).await
    }

    pub fn set_metadata(&self, meta: TrackMetadata) {
        *self.current_metadata.write() = meta;
        self.metadata_updated.notify_waiters();
    }

    /// Connect TCP socket, transmit password line, read and validate `OK2` response,
    /// then transmit the ICY headers.
    async fn connect_and_handshake(&self) -> Result<TcpStream, String> {
        *self.state.write() = BroadcastState::Connecting;
        let cfg = self.config.read().clone();
        let target_addr = format!("{}:{}", cfg.server, cfg.port);

        let mut stream = TcpStream::connect(&target_addr).await.map_err(|e| {
            format!(
                "Failed to connect to SHOUTcast DNAS at {}: {}",
                target_addr, e
            )
        })?;

        *self.state.write() = BroadcastState::Authenticating;

        // Step 1: Send SHOUTcast password line
        let auth_line = format_auth_line(&cfg);
        stream
            .write_all(auth_line.as_bytes())
            .await
            .map_err(|e| format!("Failed to write authentication line: {}", e))?;

        // Step 2: Read DNAS server response (expecting "OK2") with 5s timeout
        let mut resp_buf = [0u8; 512];
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut resp_buf))
            .await
            .map_err(|_| "DNAS server response timed out after 5 seconds".to_string())?
            .map_err(|e| format!("Failed to read DNAS server response: {}", e))?;

        if n == 0 {
            return Err("DNAS server closed connection during authentication".to_string());
        }

        let resp_str = String::from_utf8_lossy(&resp_buf[..n]);
        validate_dnas_response(&resp_str)?;

        // Step 3: Send ICY stream headers
        let icy_headers = format_icy_stream_headers(&cfg);
        stream
            .write_all(icy_headers.as_bytes())
            .await
            .map_err(|e| format!("Failed to write ICY stream headers: {}", e))?;

        Ok(stream)
    }

    /// Dedicated streaming loop maintaining persistent connection,
    /// writing encoded MP3 bytes, handling metadata updates, and executing backoff reconnects.
    async fn run_transport_loop(
        self: Arc<Self>,
        mut stream: TcpStream,
        network_rx: Receiver<Vec<u8>>,
    ) {
        let mut last_kbps_calc = Instant::now();
        let mut reconnect_attempts: u32 = 0;

        while self.is_running.load(Ordering::Relaxed) {
            tokio::select! {
                // Metadata update triggered
                _ = self.metadata_updated.notified() => {
                    if self.is_running.load(Ordering::Relaxed) {
                        self.push_metadata_update().await;
                    }
                }

                // Streaming audio packets
                _ = tokio::time::sleep(Duration::from_millis(5)) => {
                    self.network_queue_depth.store(network_rx.len() as u64, Ordering::Relaxed);

                    let mut socket_failed = false;
                    while let Ok(packet) = network_rx.try_recv() {
                        let write_fut = stream.write_all(&packet);
                        match tokio::time::timeout(Duration::from_secs(5), write_fut).await {
                            Ok(Ok(())) => {
                                let len = packet.len() as u64;
                                self.bytes_sent.fetch_add(len, Ordering::Relaxed);
                                self.window_bytes.fetch_add(len, Ordering::Relaxed);
                                reconnect_attempts = 0; // Successful write resets backoff
                            }
                            Ok(Err(e)) => {
                                *self.last_error_message.write() = Some(format!("TCP socket write failure: {}", e));
                                socket_failed = true;
                                break;
                            }
                            Err(_) => {
                                *self.last_error_message.write() = Some("TCP socket write timed out after 5s (broken connection)".to_string());
                                socket_failed = true;
                                break;
                            }
                        }
                    }

                    // Rolling 1-second upload bitrate calculation
                    if last_kbps_calc.elapsed() >= Duration::from_secs(1) {
                        let bytes = self.window_bytes.swap(0, Ordering::Relaxed);
                        let elapsed_secs = last_kbps_calc.elapsed().as_secs_f32();
                        let kbps = (bytes as f32 * 8.0) / (elapsed_secs * 1000.0);
                        *self.measured_kbps.write() = kbps;
                        self.uptime_seconds.fetch_add(1, Ordering::Relaxed);
                        last_kbps_calc = Instant::now();
                    }

                    // Handle broken socket / disconnect
                    if socket_failed {
                        if self.is_manual_stop.load(Ordering::Relaxed) {
                            break;
                        }

                        *self.state.write() = BroadcastState::Reconnecting;
                        self.reconnect_count.fetch_add(1, Ordering::Relaxed);
                        reconnect_attempts += 1;

                        // Exponential backoff: 1s, 2s, 4s, 8s, up to 30s
                        let backoff_secs = (1u64 << reconnect_attempts.min(5)).min(30);
                        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;

                        if self.is_manual_stop.load(Ordering::Relaxed) {
                            break;
                        }

                        match self.connect_and_handshake().await {
                            Ok(new_stream) => {
                                stream = new_stream;
                                *self.state.write() = BroadcastState::Connected;
                                *self.last_connected_at.write() = Some(chrono::Utc::now().to_rfc3339());
                            }
                            Err(e) => {
                                *self.last_error_message.write() = Some(format!("Reconnect attempt failed: {}", e));
                            }
                        }
                    }
                }
            }

            if self.is_manual_stop.load(Ordering::Relaxed) {
                break;
            }
        }

        let _ = stream.shutdown().await;
        *self.state.write() = BroadcastState::Offline;
    }

    /// Send dynamic metadata update to SHOUTcast DNAS `/admin.cgi?mode=updinfo` endpoint
    /// with delivery verification and response handling.
    async fn push_metadata_update(&self) {
        let cfg = self.config.read().clone();
        let meta = self.current_metadata.read().clone();
        let req = format_metadata_update_request(&cfg, &meta);

        let target_addr = format!("{}:{}", cfg.server, cfg.port);
        match tokio::time::timeout(Duration::from_secs(3), TcpStream::connect(&target_addr)).await {
            Ok(Ok(mut admin_stream)) => {
                let write_res = tokio::time::timeout(
                    Duration::from_secs(3),
                    admin_stream.write_all(req.as_bytes()),
                )
                .await;
                if write_res.is_ok() {
                    let mut resp_buf = [0u8; 512];
                    if let Ok(Ok(n)) = tokio::time::timeout(
                        Duration::from_secs(3),
                        admin_stream.read(&mut resp_buf),
                    )
                    .await
                    {
                        let resp_str = String::from_utf8_lossy(&resp_buf[..n]);
                        if resp_str.contains("200 OK")
                            || resp_str.contains("SHOUTcast")
                            || resp_str.contains("updinfo")
                        {
                            self.metadata_delivered.store(true, Ordering::Relaxed);
                            *self.metadata_error.write() = None;
                            return;
                        }
                    }
                    self.metadata_delivered.store(false, Ordering::Relaxed);
                    *self.metadata_error.write() =
                        Some("DNAS rejected or did not confirm metadata update".to_string());
                } else {
                    self.metadata_delivered.store(false, Ordering::Relaxed);
                    *self.metadata_error.write() =
                        Some("Timed out writing metadata to DNAS /admin.cgi".to_string());
                }
            }
            Ok(Err(e)) => {
                self.metadata_delivered.store(false, Ordering::Relaxed);
                *self.metadata_error.write() =
                    Some(format!("Failed to connect to DNAS admin port: {}", e));
            }
            Err(_) => {
                self.metadata_delivered.store(false, Ordering::Relaxed);
                *self.metadata_error.write() =
                    Some("Timed out connecting to DNAS admin port".to_string());
            }
        }
    }

    pub fn get_status(&self) -> BroadcastStatus {
        BroadcastStatus {
            state: self.state.read().clone(),
            uptime_seconds: self.uptime_seconds.load(Ordering::Relaxed),
            reconnect_count: self.reconnect_count.load(Ordering::Relaxed) as u32,
            error_message: self.last_error_message.read().clone(),
            last_connected_at: self.last_connected_at.read().clone(),
            metadata_delivered: self.metadata_delivered.load(Ordering::Relaxed),
            metadata_error: self.metadata_error.read().clone(),
            config: self.config.read().clone(),
        }
    }

    pub fn get_metrics(&self) -> StreamMetrics {
        let cfg = self.config.read();
        let bytes = self.bytes_sent.load(Ordering::Relaxed);
        let is_conn = *self.state.read() == BroadcastState::Connected;
        let actual_upload = *self.measured_kbps.read();

        // Calculate honest buffer health: remaining queue capacity ratio
        let depth = self.network_queue_depth.load(Ordering::Relaxed);
        let buffer_health = if is_conn && self.network_queue_capacity > 0 {
            (1.0 - (depth as f32 / self.network_queue_capacity as f32)).clamp(0.0, 1.0)
        } else {
            0.0
        };

        StreamMetrics {
            target_bitrate_kbps: cfg.bitrate,
            actual_upload_kbps: if is_conn { actual_upload } else { 0.0 },
            buffer_health_ratio: buffer_health,
            dropped_frames: self.dropped_network_packets.load(Ordering::Relaxed),
            bytes_sent: bytes,
            network_latency_ms: 0, // Honest 0 (unmeasured without ICMP probe)
        }
    }
}

// Minimal urlencoding helper
mod urlencoding {
    pub fn encode(data: &str) -> String {
        let mut escaped = String::new();
        for b in data.bytes() {
            match b {
                b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    escaped.push(b as char);
                }
                b' ' => escaped.push('+'),
                _ => escaped.push_str(&format!("%{:02X}", b)),
            }
        }
        escaped
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_auth_line_single_stream() {
        let mut cfg = ShoutcastConfig::default();
        cfg.password = Some("my_secret_pass".to_string());
        cfg.stream_id = 1;

        assert_eq!(format_auth_line(&cfg), "my_secret_pass\r\n");
    }

    #[test]
    fn test_auth_line_multi_stream() {
        let mut cfg = ShoutcastConfig::default();
        cfg.password = Some("adminpass".to_string());
        cfg.stream_id = 2;

        assert_eq!(format_auth_line(&cfg), "adminpass:#2\r\n");
    }

    #[test]
    fn test_icy_stream_headers() {
        let mut cfg = ShoutcastConfig::default();
        cfg.station_name = "Rock Station".to_string();
        cfg.genre = Some("Classic Rock".to_string());
        cfg.bitrate = 192;
        cfg.is_public = true;

        let headers = format_icy_stream_headers(&cfg);
        assert!(headers.contains("icy-name:Rock Station\r\n"));
        assert!(headers.contains("icy-genre:Classic Rock\r\n"));
        assert!(headers.contains("icy-br:192\r\n"));
        assert!(headers.contains("icy-pub:1\r\n"));
        assert!(headers.ends_with("\r\n\r\n"));
    }

    #[test]
    fn test_validate_dnas_response() {
        // Standard DNAS 1 & 2 responses
        assert!(validate_dnas_response("OK2\r\n").is_ok());
        assert!(validate_dnas_response("OK2\r\nicy-caps:11\r\n\r\n").is_ok());

        // Rejections
        assert!(validate_dnas_response("invalid password\r\n").is_err());
        assert!(validate_dnas_response("").is_err());
        assert!(validate_dnas_response("HTTP/1.0 401 Unauthorized").is_err());
    }

    #[test]
    fn test_metadata_update_request_formatting() {
        let mut cfg = ShoutcastConfig::default();
        cfg.password = Some("secret".to_string());
        cfg.stream_id = 1;

        let meta = TrackMetadata {
            title: "Bohemian Rhapsody".to_string(),
            artist: "Queen".to_string(),
            album: None,
            duration_ms: None,
            station_name: None,
        };

        let req = format_metadata_update_request(&cfg, &meta);
        assert!(req
            .starts_with("GET /admin.cgi?mode=updinfo&pass=secret&song=Queen+-+Bohemian+Rhapsody"));
        assert!(req.ends_with("\r\n\r\n"));
    }

    #[tokio::test]
    async fn test_shoutcast_state_and_stop_lifecycle() {
        let client = ShoutcastClient::new(ShoutcastConfig::default());
        assert_eq!(client.get_status().state, BroadcastState::Offline);

        let stopped_status = client.stop().await;
        assert_eq!(stopped_status.state, BroadcastState::Offline);
        assert!(!client.is_running.load(Ordering::Relaxed));
        assert!(client.is_manual_stop.load(Ordering::Relaxed));
    }

    #[test]
    fn test_byte_counters_and_metrics() {
        let client = ShoutcastClient::new(ShoutcastConfig::default());
        client.bytes_sent.store(204800, Ordering::Relaxed);
        let metrics = client.get_metrics();
        assert_eq!(metrics.bytes_sent, 204800);
        assert_eq!(metrics.network_latency_ms, 0); // Honest 0, not fake 18
    }
}
