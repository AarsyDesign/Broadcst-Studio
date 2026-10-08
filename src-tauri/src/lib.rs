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
            broadcast_update_config,
            audio_get_devices,
            audio_get_output_devices,
            audio_start,
            audio_stop,
            audio_set_device,
            audio_recover_devices,
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
            deck_restart,
            deck_unload,
            deck_seek,
            deck_set_cue_position,
            deck_return_to_cue,
            deck_start_from_cue,
            deck_set_cue,
            deck_set_gain,
            deck_set_mute,
            deck_trigger_transition,
            deck_set_crossfader,
            deck_set_auto_advance,
            deck_set_monitor_source,
            deck_set_cue_gain,
            deck_set_cue_muted,
            playback_get_snapshot,
            playlist_get,
            playlist_get_library,
            playlist_scan_folder,
            playlist_search,
            playlist_remove_missing,
            playlist_toggle_pinned,
            playlist_add_file,
            playlist_insert_next,
            playlist_remove,
            playlist_clear,
            playlist_reorder,
            playlist_play_index,
            recording_start,
            recording_stop,
            recording_get_status,
            recording_get_history,
            recording_open_folder,
            broadcast_preflight_validate,
            metadata_set,
            control_action,
            transcript_start,
            transcript_stop,
            transcript_get_segments,
            native_output_get_sinks,
            native_output_register_reference_sink,
            native_output_register_rtmp_sink,
            native_output_unregister_sink,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
