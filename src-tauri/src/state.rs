use crate::audio::{AudioEngine, CANONICAL_CHANNELS, CANONICAL_SAMPLE_RATE};
use crate::encoder::EncoderWorker;
use crate::models::ShoutcastConfig;
use crate::recording::MasterRecorder;
use crate::shoutcast::ShoutcastClient;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct AppState {
    pub audio_engine: Arc<AudioEngine>,
    pub shoutcast_client: Arc<ShoutcastClient>,
    pub recorder: Arc<MasterRecorder>,
    pub active_encoder: Arc<Mutex<Option<EncoderWorker>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            audio_engine: AudioEngine::new(CANONICAL_SAMPLE_RATE),
            shoutcast_client: ShoutcastClient::new(ShoutcastConfig::default()),
            recorder: MasterRecorder::new(CANONICAL_SAMPLE_RATE, CANONICAL_CHANNELS),
            active_encoder: Arc::new(Mutex::new(None)),
        }
    }
}
