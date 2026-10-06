use crate::audio::mixer::{ChannelStrip, MasterBus};
use crate::models::AudioMetrics;
use parking_lot::RwLock;
use std::collections::HashMap;
use std::sync::Arc;

pub struct AudioEngine {
    channels: RwLock<HashMap<String, ChannelStrip>>,
    master: RwLock<MasterBus>,
    sample_rate: u32,
}

impl AudioEngine {
    pub fn new(sample_rate: u32) -> Arc<Self> {
        let mut initial_channels = HashMap::new();
        initial_channels.insert("mic".to_string(), ChannelStrip::new("mic", "Microphone"));
        initial_channels.insert("music".to_string(), ChannelStrip::new("music", "Music / Deck"));
        initial_channels.insert("aux".to_string(), ChannelStrip::new("aux", "Aux / Soundboard"));
        initial_channels.insert("sfx".to_string(), ChannelStrip::new("sfx", "Studio FX"));

        Arc::new(Self {
            channels: RwLock::new(initial_channels),
            master: RwLock::new(MasterBus::new()),
            sample_rate,
        })
    }

    pub fn set_channel_fader(&self, channel_id: &str, level: f32) {
        let mut chs = self.channels.write();
        if let Some(ch) = chs.get_mut(channel_id) {
            ch.fader = level.clamp(0.0, 1.0);
        }
    }

    pub fn set_channel_gain(&self, channel_id: &str, gain_db: f32) {
        let mut chs = self.channels.write();
        if let Some(ch) = chs.get_mut(channel_id) {
            ch.gain_db = gain_db.clamp(-30.0, 30.0);
        }
    }

    pub fn set_channel_mute(&self, channel_id: &str, mute: bool) {
        let mut chs = self.channels.write();
        if let Some(ch) = chs.get_mut(channel_id) {
            ch.mute = mute;
        }
    }

    pub fn get_channel_strips(&self) -> Vec<ChannelStrip> {
        self.channels.read().values().cloned().collect()
    }

    /// Process an input buffer block and sum into master bus.
    pub fn process_master_frame(&self, channel_id: &str, samples: &mut [f32]) {
        let gain = {
            let mut chs = self.channels.write();
            if let Some(ch) = chs.get_mut(channel_id) {
                ch.update_meters(samples);
                ch.compute_linear_gain()
            } else {
                1.0
            }
        };

        for s in samples.iter_mut() {
            *s *= gain;
        }

        let mut master = self.master.write();
        master.process_frame(samples);
    }

    pub fn get_metrics(&self) -> AudioMetrics {
        let chs = self.channels.read();
        let master = self.master.read();

        let mic_peak = chs.get("mic").map(|c| c.peak_db).unwrap_or(-90.0);
        let mic_rms = chs.get("mic").map(|c| c.rms_db).unwrap_or(-90.0);

        AudioMetrics {
            input_peak_db: mic_peak,
            input_rms_db: mic_rms,
            master_peak_db: master.peak_db,
            master_rms_db: master.rms_db,
            buffer_underruns: 0,
            latency_ms: (512.0 / self.sample_rate as f32) * 1000.0,
        }
    }
}
