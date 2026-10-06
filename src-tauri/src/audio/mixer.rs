use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

/// Atomic f32 wrapper for real-time safe parameter modulation.
#[inline]
pub fn load_atomic_f32(atomic: &AtomicU32) -> f32 {
    f32::from_bits(atomic.load(Ordering::Relaxed))
}

#[inline]
pub fn store_atomic_f32(atomic: &AtomicU32, val: f32) {
    atomic.store(val.to_bits(), Ordering::Relaxed);
}

/// Single audio channel strip with wait-free atomic parameters.
pub struct ChannelStrip {
    pub id: String,
    pub name: String,
    pub is_hardware: bool,
    gain_db: AtomicU32,
    fader: AtomicU32,
    mute: AtomicBool,
    solo: AtomicBool,
    peak_db: AtomicU32,
    rms_db: AtomicU32,
}

impl ChannelStrip {
    pub fn new(id: &str, name: &str, is_hardware: bool) -> Arc<Self> {
        Arc::new(Self {
            id: id.to_string(),
            name: name.to_string(),
            is_hardware,
            gain_db: AtomicU32::new(0.0f32.to_bits()),
            fader: AtomicU32::new(0.85f32.to_bits()),
            mute: AtomicBool::new(false),
            solo: AtomicBool::new(false),
            peak_db: AtomicU32::new((-90.0f32).to_bits()),
            rms_db: AtomicU32::new((-90.0f32).to_bits()),
        })
    }

    pub fn set_gain_db(&self, db: f32) {
        let clamped = db.clamp(-60.0, 30.0);
        store_atomic_f32(&self.gain_db, clamped);
    }

    pub fn get_gain_db(&self) -> f32 {
        load_atomic_f32(&self.gain_db)
    }

    pub fn set_fader(&self, level: f32) {
        let clamped = level.clamp(0.0, 1.0);
        store_atomic_f32(&self.fader, clamped);
    }

    pub fn get_fader(&self) -> f32 {
        load_atomic_f32(&self.fader)
    }

    pub fn set_mute(&self, muted: bool) {
        self.mute.store(muted, Ordering::Relaxed);
    }

    pub fn get_mute(&self) -> bool {
        self.mute.load(Ordering::Relaxed)
    }

    pub fn set_solo(&self, soloed: bool) {
        self.solo.store(soloed, Ordering::Relaxed);
    }

    pub fn get_solo(&self) -> bool {
        self.solo.load(Ordering::Relaxed)
    }

    pub fn get_peak_db(&self) -> f32 {
        load_atomic_f32(&self.peak_db)
    }

    pub fn get_rms_db(&self) -> f32 {
        load_atomic_f32(&self.rms_db)
    }

    /// Real-time safe linear gain computation: 10^(gain_db / 20) * (fader^2)
    #[inline]
    pub fn compute_linear_gain(&self) -> f32 {
        if self.get_mute() {
            return 0.0;
        }
        let gain_db = self.get_gain_db();
        let fader = self.get_fader();
        let linear = 10.0f32.powf(gain_db / 20.0);
        linear * (fader * fader)
    }

    /// Update peak and RMS meters from processed samples. Wait-free.
    pub fn update_meters(&self, samples: &[f32]) {
        if samples.is_empty() {
            store_atomic_f32(&self.peak_db, -90.0);
            store_atomic_f32(&self.rms_db, -90.0);
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

        let peak_db = if max_abs > 0.00001 {
            (20.0 * max_abs.log10()).clamp(-90.0, 6.0)
        } else {
            -90.0
        };

        let rms_db = if rms > 0.00001 {
            (20.0 * rms.log10()).clamp(-90.0, 6.0)
        } else {
            -90.0
        };

        store_atomic_f32(&self.peak_db, peak_db);
        store_atomic_f32(&self.rms_db, rms_db);
    }

    pub fn snapshot(&self) -> ChannelStripSnapshot {
        ChannelStripSnapshot {
            id: self.id.clone(),
            name: self.name.clone(),
            gain_db: self.get_gain_db(),
            fader: self.get_fader(),
            mute: self.get_mute(),
            solo: self.get_solo(),
            peak_db: self.get_peak_db(),
            rms_db: self.get_rms_db(),
            is_hardware: self.is_hardware,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStripSnapshot {
    pub id: String,
    pub name: String,
    pub gain_db: f32,
    pub fader: f32,
    pub mute: bool,
    pub solo: bool,
    pub peak_db: f32,
    pub rms_db: f32,
    pub is_hardware: bool,
}

/// Master bus with atomic fader, soft limiter, and real-time metering.
pub struct MasterBus {
    fader: AtomicU32,
    ceiling_db: AtomicU32,
    peak_db: AtomicU32,
    rms_db: AtomicU32,
}

impl MasterBus {
    pub fn new() -> Self {
        Self {
            fader: AtomicU32::new(0.85f32.to_bits()),
            ceiling_db: AtomicU32::new((-0.5f32).to_bits()),
            peak_db: AtomicU32::new((-90.0f32).to_bits()),
            rms_db: AtomicU32::new((-90.0f32).to_bits()),
        }
    }

    pub fn set_fader(&self, level: f32) {
        let clamped = level.clamp(0.0, 1.0);
        store_atomic_f32(&self.fader, clamped);
    }

    pub fn get_fader(&self) -> f32 {
        load_atomic_f32(&self.fader)
    }

    pub fn set_ceiling_db(&self, db: f32) {
        let clamped = db.clamp(-12.0, 0.0);
        store_atomic_f32(&self.ceiling_db, clamped);
    }

    pub fn get_ceiling_db(&self) -> f32 {
        load_atomic_f32(&self.ceiling_db)
    }

    pub fn get_peak_db(&self) -> f32 {
        load_atomic_f32(&self.peak_db)
    }

    pub fn get_rms_db(&self) -> f32 {
        load_atomic_f32(&self.rms_db)
    }

    /// Process and soft-limit master stereo frame buffer. Wait-free, zero allocation.
    #[inline]
    pub fn process_master(&self, samples: &mut [f32]) {
        let fader = self.get_fader();
        let master_gain = fader * fader;
        let ceiling_db = self.get_ceiling_db();
        let ceiling_linear = 10.0f32.powf(ceiling_db / 20.0);

        let mut max_abs: f32 = 0.0;
        let mut sum_sq: f32 = 0.0;

        for s in samples.iter_mut() {
            let scaled = *s * master_gain;
            // Soft-knee limiter curve
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

        let peak_db = if max_abs > 0.00001 {
            (20.0 * max_abs.log10()).clamp(-90.0, 6.0)
        } else {
            -90.0
        };

        let rms_db = if rms > 0.00001 {
            (20.0 * rms.log10()).clamp(-90.0, 6.0)
        } else {
            -90.0
        };

        store_atomic_f32(&self.peak_db, peak_db);
        store_atomic_f32(&self.rms_db, rms_db);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_channel_gain_and_fader() {
        let ch = ChannelStrip::new("mic", "Microphone", true);
        ch.set_gain_db(0.0);
        ch.set_fader(1.0);
        assert!((ch.compute_linear_gain() - 1.0).abs() < 1e-4);

        ch.set_gain_db(6.0206); // +6 dB ~ 2.0x linear
        assert!((ch.compute_linear_gain() - 2.0).abs() < 1e-2);

        ch.set_fader(0.5); // fader^2 = 0.25
        assert!((ch.compute_linear_gain() - 0.5).abs() < 1e-2);

        ch.set_mute(true);
        assert_eq!(ch.compute_linear_gain(), 0.0);
    }

    #[test]
    fn test_master_limiter() {
        let master = MasterBus::new();
        master.set_fader(1.0);
        master.set_ceiling_db(-0.5); // ~0.944 linear

        let mut samples = [2.0, -2.0, 0.5];
        master.process_master(&mut samples);

        assert!(
            samples[0] < 1.1,
            "Sample should be soft-limited, got {}",
            samples[0]
        );
        assert!(
            samples[1] > -1.1,
            "Sample should be soft-limited, got {}",
            samples[1]
        );
        assert_eq!(samples[2], 0.5);
        assert!(master.get_peak_db() > -90.0);
    }

    #[test]
    fn test_channel_meters() {
        let ch = ChannelStrip::new("mic", "Microphone", true);
        // Sine wave peak 1.0, RMS ~0.707 (-3 dB)
        let samples = [1.0, -1.0, 0.5, -0.5];
        ch.update_meters(&samples);

        // Peak of 1.0 is 0.0 dBFS
        assert!((ch.get_peak_db() - 0.0).abs() < 0.1);
        // RMS of sqrt((1 + 1 + 0.25 + 0.25) / 4) = sqrt(2.5 / 4) = sqrt(0.625) ~ 0.79 -> ~-2.04 dBFS
        assert!(ch.get_rms_db() < 0.0 && ch.get_rms_db() > -10.0);

        ch.update_meters(&[]);
        assert_eq!(ch.get_peak_db(), -90.0);
        assert_eq!(ch.get_rms_db(), -90.0);
    }
}
