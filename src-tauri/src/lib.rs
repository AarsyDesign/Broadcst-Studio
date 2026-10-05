pub mod commands;
pub mod models;

use commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt::try_init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            broadcast_start,
            broadcast_stop,
            broadcast_reconnect,
            broadcast_get_status,
            audio_get_devices,
            audio_set_gain,
            audio_set_fader,
            audio_mute,
            audio_get_metrics,
            stream_get_metrics,
            telemetry_get_snapshot,
            transcript_start,
            transcript_stop,
            transcript_get_segments,
            recording_start,
            recording_stop,
            metadata_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
