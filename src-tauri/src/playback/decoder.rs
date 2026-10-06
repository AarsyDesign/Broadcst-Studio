use serde::{Deserialize, Serialize};
use std::fs::File;
use std::path::Path;
use std::sync::Arc;
use symphonia::core::audio::{AudioBufferRef, Signal};
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub const CANONICAL_SAMPLE_RATE: u32 = 48000;
pub const CANONICAL_CHANNELS: usize = 2;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMetadataInfo {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub artist: String,
    pub album: Option<String>,
    pub duration_ms: u64,
}

pub struct DecodedTrack {
    pub info: TrackMetadataInfo,
    /// Interleaved stereo f32 samples at 48,000 Hz
    pub samples: Arc<Vec<f32>>,
}

impl DecodedTrack {
    pub fn total_frames(&self) -> u64 {
        (self.samples.len() / CANONICAL_CHANNELS) as u64
    }

    pub fn duration_ms(&self) -> u64 {
        self.info.duration_ms
    }
}

/// Decode any supported audio file (WAV, MP3, FLAC, OGG, etc.) into canonical 48kHz stereo f32.
/// Extracts ID3 / Vorbis tags with fallback to filename.
pub fn decode_audio_file<P: AsRef<Path>>(path: P) -> Result<DecodedTrack, String> {
    let path_ref = path.as_ref();
    let file = File::open(path_ref)
        .map_err(|e| format!("Failed to open audio file {:?}: {}", path_ref, e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = path_ref.extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let meta_opts: MetadataOptions = Default::default();
    let fmt_opts: FormatOptions = Default::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &fmt_opts, &meta_opts)
        .map_err(|e| format!("Unsupported or unreadable audio format: {}", e))?;

    let mut format = probed.format;

    // 1. Extract metadata from tags or fallback to filename
    let mut title = None;
    let mut artist = None;
    let mut album = None;

    if let Some(metadata) = format.metadata().current() {
        for tag in metadata.tags() {
            match tag.std_key {
                Some(symphonia::core::meta::StandardTagKey::TrackTitle) => {
                    title = Some(tag.value.to_string());
                }
                Some(symphonia::core::meta::StandardTagKey::Artist) => {
                    artist = Some(tag.value.to_string());
                }
                Some(symphonia::core::meta::StandardTagKey::Album) => {
                    album = Some(tag.value.to_string());
                }
                _ => {}
            }
        }
    }

    let file_stem = path_ref
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Unknown Track");

    let final_title = title.unwrap_or_else(|| {
        if file_stem.contains(" - ") {
            file_stem.split(" - ").nth(1).unwrap_or(file_stem).to_string()
        } else {
            file_stem.to_string()
        }
    });

    let final_artist = artist.unwrap_or_else(|| {
        if file_stem.contains(" - ") {
            file_stem.split(" - ").next().unwrap_or("Unknown Artist").to_string()
        } else {
            "Unknown Artist".to_string()
        }
    });

    // 2. Locate default audio track
    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
        .ok_or_else(|| "No supported audio tracks found in file".to_string())?;

    let track_id = track.id;
    let src_sample_rate = track
        .codec_params
        .sample_rate
        .unwrap_or(CANONICAL_SAMPLE_RATE);

    let dec_opts: DecoderOptions = Default::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &dec_opts)
        .map_err(|e| format!("Failed to create codec decoder: {}", e))?;

    let mut raw_stereo_samples: Vec<f32> = Vec::new();

    // 3. Decode all audio packets
    loop {
        let packet = match format.next_packet() {
            Ok(pkt) => pkt,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(e) => return Err(format!("Error reading packet: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                append_audio_buffer_as_stereo(&decoded, &mut raw_stereo_samples);
            }
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("Decode failure: {}", e)),
        }
    }

    if raw_stereo_samples.is_empty() {
        return Err("Decoded audio file produced 0 audio samples".to_string());
    }

    // 4. Resample to canonical 48000 Hz if necessary
    let canonical_samples = if src_sample_rate != CANONICAL_SAMPLE_RATE {
        resample_stereo_to_48k(&raw_stereo_samples, src_sample_rate)
    } else {
        raw_stereo_samples
    };

    let total_frames = (canonical_samples.len() / CANONICAL_CHANNELS) as u64;
    let duration_ms = ((total_frames as f64 / CANONICAL_SAMPLE_RATE as f64) * 1000.0) as u64;

    let id = format!(
        "trk-{}",
        chrono::Utc::now().timestamp_micros()
    );

    let info = TrackMetadataInfo {
        id,
        file_path: path_ref.to_string_lossy().to_string(),
        title: final_title,
        artist: final_artist,
        album,
        duration_ms,
    };

    Ok(DecodedTrack {
        info,
        samples: Arc::new(canonical_samples),
    })
}

/// Convert any Symphonia decoded audio buffer to interleaved stereo f32
fn append_audio_buffer_as_stereo(buf: &AudioBufferRef, out: &mut Vec<f32>) {
    match buf {
        AudioBufferRef::F32(b) => {
            let channels = b.spec().channels.count();
            let frames = b.frames();
            for f in 0..frames {
                if channels == 1 {
                    let s = b.chan(0)[f];
                    out.push(s);
                    out.push(s);
                } else {
                    out.push(b.chan(0)[f]);
                    out.push(b.chan(1)[f]);
                }
            }
        }
        AudioBufferRef::S16(b) => {
            let channels = b.spec().channels.count();
            let frames = b.frames();
            for f in 0..frames {
                if channels == 1 {
                    let s = b.chan(0)[f] as f32 / 32768.0;
                    out.push(s);
                    out.push(s);
                } else {
                    out.push(b.chan(0)[f] as f32 / 32768.0);
                    out.push(b.chan(1)[f] as f32 / 32768.0);
                }
            }
        }
        AudioBufferRef::U8(b) => {
            let channels = b.spec().channels.count();
            let frames = b.frames();
            for f in 0..frames {
                if channels == 1 {
                    let s = (b.chan(0)[f] as f32 - 128.0) / 128.0;
                    out.push(s);
                    out.push(s);
                } else {
                    out.push((b.chan(0)[f] as f32 - 128.0) / 128.0);
                    out.push((b.chan(1)[f] as f32 - 128.0) / 128.0);
                }
            }
        }
        AudioBufferRef::S32(b) => {
            let channels = b.spec().channels.count();
            let frames = b.frames();
            for f in 0..frames {
                if channels == 1 {
                    let s = b.chan(0)[f] as f32 / 2147483648.0;
                    out.push(s);
                    out.push(s);
                } else {
                    out.push(b.chan(0)[f] as f32 / 2147483648.0);
                    out.push(b.chan(1)[f] as f32 / 2147483648.0);
                }
            }
        }
        AudioBufferRef::F64(b) => {
            let channels = b.spec().channels.count();
            let frames = b.frames();
            for f in 0..frames {
                if channels == 1 {
                    let s = b.chan(0)[f] as f32;
                    out.push(s);
                    out.push(s);
                } else {
                    out.push(b.chan(0)[f] as f32);
                    out.push(b.chan(1)[f] as f32);
                }
            }
        }
        _ => {}
    }
}

/// Linear fractional delay resampling from src_rate to 48kHz
fn resample_stereo_to_48k(input_stereo: &[f32], src_rate: u32) -> Vec<f32> {
    let ratio = src_rate as f64 / CANONICAL_SAMPLE_RATE as f64;
    let input_frames = input_stereo.len() / 2;
    if input_frames < 2 {
        return input_stereo.to_vec();
    }

    let estimated_out_frames = ((input_frames as f64 / ratio).ceil() as usize).max(1);
    let mut output = Vec::with_capacity(estimated_out_frames * 2);

    let mut phase = 0.0;
    while phase < (input_frames - 1) as f64 {
        let idx = phase.floor() as usize;
        let alpha = (phase - idx as f64) as f32;

        let in0 = idx * 2;
        let in1 = (idx + 1) * 2;

        let l = input_stereo[in0] + alpha * (input_stereo[in1] - input_stereo[in0]);
        let r = input_stereo[in0 + 1] + alpha * (input_stereo[in1 + 1] - input_stereo[in0 + 1]);

        output.push(l);
        output.push(r);

        phase += ratio;
    }

    output
}
