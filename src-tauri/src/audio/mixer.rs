use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStrip {
    pub id: String,
    pub name: String,
    pub gain_db: f32,
    pub fader: f32,
    pub mute: bool,
    pub solo: bool,
    pub peak_db: f32,
    pub rms_db: f32,
}

impl ChannelStrip {
    pub fn new(id: &str, name: &str) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            gain_db: 0.0,
            fader: 0.8,
            mute: false,
            solo: false,
            peak_db: -90.0,
            rms_db: -90.0,
        }
    }

    pub fn compute_linear_gain(&self) -> f32 {
        if self.mute {
            return 0.0;
        }
        let gain_linear = 10.0f32.powf(self.gain_db / 20.0);
        // Standard audio console fader curve: level^2
        gain_linear * (self.fader * self.fader)
    }

    pub fn update_meters(&mut self, samples: &[f32]) {
        if samples.is_empty() {
            self.peak_db = -90.0;
            self.rms_db = -90.0;
            return;
        }

        let mut max_abs: f32 = 0.0;
        let mut sum_sq: f32 = 0.0;

        for &s in samples {
            let abs_s = s.abs();
            if abs_s > max_abs {
                max_abs = abs_s;
            }
            sum_sq += s * s;
        }

        let rms = (sum_sq / samples.len() as f32).sqrt();

        self.peak_db = if max_abs > 0.00001 {
            (20.0 * max_abs.log10()).max(-90.0)
        } else {
            -90.0
        };

        self.rms_db = if rms > 0.00001 {
            (20.0 * rms.log10()).max(-90.0)
        } else {
            -90.0
        };
    }
}

pub struct MasterBus {
    pub fader: f32,
    pub ceiling_db: f32,
    pub peak_db: f32,
    pub rms_db: f32,
}

impl MasterBus {
    pub fn new() -> Self {
        Self {
            fader: 0.85,
            ceiling_db: -0.5,
            peak_db: -90.0,
            rms_db: -90.0,
        }
    }

    /// Process and soft-limit master stereo frame buffer.
    pub fn process_frame(&mut self, samples: &mut [f32]) {
        let master_gain = self.fader * self.fader;
        let ceiling_linear = 10.0f32.powf(self.ceiling_db / 20.0);

        let mut max_abs: f32 = 0.0;
        let mut sum_sq: f32 = 0.0;

        for s in samples.iter_mut() {
            let scaled = *s * master_gain;
            // Soft-clipping saturation limiter curve
            let limited = if scaled.abs() > ceiling_linear {
                let sign = if scaled >= 0.0 { 1.0 } else { -1.0 };
                let excess = scaled.abs() - ceiling_linear;
                sign * (ceiling_linear + (excess / (1.0 + excess * 2.0)) * 0.15)
            } else {
                scaled
            };

            *s = limited;

            let abs_val = limited.abs();
            if abs_val > max_abs {
                max_abs = abs_val;
            }
            sum_sq += limited * limited;
        }

        let rms = (sum_sq / samples.len().max(1) as f32).sqrt();

        self.peak_db = if max_abs > 0.00001 {
            (20.0 * max_abs.log10()).max(-90.0)
        } else {
            -90.0
        };

        self.rms_db = if rms > 0.00001 {
            (20.0 * rms.log10()).max(-90.0)
        } else {
            -90.0
        };
    }
}
