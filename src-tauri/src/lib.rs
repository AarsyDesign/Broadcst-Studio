pub mod audio;
pub mod commands;
pub mod encoder;
pub mod models;
pub mod playback;
pub mod recording;
pub mod shoutcast;
pub mod state;

use commands::*;
use state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt::try_init();

    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            broadcast_start,
            broadcast_stop,
            broadcast_reconnect,
            broadcast_get_status,
            audio_get_devices,
            audio_get_output_devices,
            audio_start,
            audio_stop,
            audio_set_device,
            audio_start_monitor,
            audio_stop_monitor,
            audio_set_gain,
            audio_set_fader,
            audio_mute,
            audio_get_channels,
            audio_get_metrics,
            stream_get_metrics,
            telemetry_get_snapshot,
            deck_load,
            deck_play,
            deck_pause,
            deck_stop,
            deck_seek,
            deck_set_crossfader,
            deck_set_auto_advance,
            playback_get_snapshot,
            playlist_get,
            playlist_add_file,
            playlist_remove,
            playlist_clear,
            playlist_play_index,
            recording_start,
            recording_stop,
            recording_get_status,
            metadata_set,
            control_action,
            transcript_start,
            transcript_stop,
            transcript_get_segments,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
