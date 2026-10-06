use crate::audio::{AudioEngine, CANONICAL_CHANNELS, CANONICAL_SAMPLE_RATE};
use crate::encoder::EncoderWorker;
use crate::models::ShoutcastConfig;
use crate::playback::PlaybackManager;
use crate::recording::MasterRecorder;
use crate::shoutcast::ShoutcastClient;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub playback_manager: Arc<PlaybackManager>,
    pub audio_engine: Arc<AudioEngine>,
    pub shoutcast_client: Arc<ShoutcastClient>,
    pub recorder: Arc<MasterRecorder>,
    pub active_encoder: Arc<Mutex<Option<EncoderWorker>>>,
}

impl AppState {
    pub fn new() -> Self {
        let playback_manager = PlaybackManager::new();
        let audio_engine = AudioEngine::new(CANONICAL_SAMPLE_RATE, playback_manager.clone());
        let shoutcast_client = ShoutcastClient::new(ShoutcastConfig::default());
        let recorder = MasterRecorder::new(CANONICAL_SAMPLE_RATE, CANONICAL_CHANNELS);

        Self {
            playback_manager,
            audio_engine,
            shoutcast_client,
            recorder,
            active_encoder: Arc::new(Mutex::new(None)),
        }
    }
}
