use crate::models::AudioDevice;
use cpal::traits::{DeviceTrait, HostTrait};

pub struct AudioCaptureManager;

impl AudioCaptureManager {
    /// Enumerate all physical audio input devices available on the operating system host.
    pub fn enumerate_input_devices() -> Vec<AudioDevice> {
        let host = cpal::default_host();
        let mut devices = Vec::new();

        let default_device_name = host
            .default_input_device()
            .and_then(|d| d.name().ok());

        if let Ok(input_devices) = host.input_devices() {
            for (index, device) in input_devices.enumerate() {
                if let Ok(name) = device.name() {
                    let is_default = default_device_name
                        .as_ref()
                        .map(|def| def == &name)
                        .unwrap_or(index == 0);

                    // Fetch supported configs to derive channel count and sample rate
                    let (channels, sample_rate) = device
                        .default_input_config()
                        .map(|c| (c.channels(), c.sample_rate().0))
                        .unwrap_or((2, 48000));

                    devices.push(AudioDevice {
                        id: format!("dev-{}", index),
                        name,
                        is_default,
                        channels,
                        sample_rate,
                    });
                }
            }
        }

        // Fallback placeholder if no hardware device is active on machine
        if devices.is_empty() {
            devices.push(AudioDevice {
                id: "default-input".to_string(),
                name: "Default System Audio Capture".to_string(),
                is_default: true,
                channels: 2,
                sample_rate: 48000,
            });
        }

        devices
    }
}
