use crate::audio::AudioEngine;
use crate::models::ShoutcastConfig;
use crate::recording::MasterRecorder;
use crate::shoutcast::ShoutcastClient;
use std::sync::Arc;

pub struct AppState {
    pub audio_engine: Arc<AudioEngine>,
    pub shoutcast_client: Arc<ShoutcastClient>,
    pub recorder: Arc<MasterRecorder>,
}

impl AppState {
    pub fn new() -> Self {
        let sample_rate = 48000;
        Self {
            audio_engine: AudioEngine::new(sample_rate),
            shoutcast_client: ShoutcastClient::new(ShoutcastConfig::default()),
            recorder: MasterRecorder::new(sample_rate),
        }
    }
}
