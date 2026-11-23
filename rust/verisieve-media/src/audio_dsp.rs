//! Pure-Rust RIFF WAV codec (PCM16, PCM24, IEEE Float32), forensic metadata auditor/scrubber
//! (strips LIST/INFO, bext, iXML, id3), sample-accurate waveform redactor (silence / 1 kHz beep /
//! pink noise with 5 ms cosine fade-in/out ramps), and stereo dual-channel + energy VAD analyzer.

use core::f32::consts::PI;

#[derive(Clone, Debug)]
pub struct WavMetadataChunk {
    pub chunk_id: String,
    pub byte_len: usize,
    pub preview: String,
}

#[derive(Clone, Debug)]
pub struct DecodedWav {
    pub sample_rate: u32,
    pub channels: u16,
    pub bits_per_sample: u16,
    pub audio_format: u16, // 1 = PCM, 3 = IEEE Float
    pub samples: Vec<f32>, // interleaved [-1.0, 1.0]
    pub forensic_chunks: Vec<WavMetadataChunk>,
}

#[derive(Clone, Copy, Debug)]
pub struct RedactSpanMs {
    pub start_ms: u32,
    pub end_ms: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct AudioRedactOptions {
    pub mode: u32, // 0 = silence, 1 = 1kHz beep, 2 = pink_noise
    pub pad_ms: u32,
    pub fade_ms: u32,
    pub beep_hz: f32,
    pub beep_gain: f32,
}

impl Default for AudioRedactOptions {
    fn default() -> Self {
        Self {
            mode: 1,
            pad_ms: 40,
            fade_ms: 5,
            beep_hz: 1000.0,
            beep_gain: 0.14,
        }
    }
}

fn u16_le(b: &[u8], off: usize) -> Option<u16> {
    if off + 2 > b.len() {
        return None;
    }
    Some(u16::from_le_bytes([b[off], b[off + 1]]))
}

fn u32_le(b: &[u8], off: usize) -> Option<u32> {
    if off + 4 > b.len() {
        return None;
    }
    Some(u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]]))
}

fn printable_preview(bytes: &[u8]) -> String {
    let mut s = String::new();
    for &b in bytes.iter().take(160) {
        if (0x20..=0x7E).contains(&b) {
            s.push(b as char);
        } else if !s.ends_with(' ') && !s.is_empty() {
            s.push(' ');
        }
    }
    s.trim().to_string()
}

pub fn decode_wav(bytes: &[u8]) -> Result<DecodedWav, &'static str> {
    if bytes.len() < 44 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("WAV_INVALID_HEADER");
    }

    let mut pos = 12usize;
    let mut audio_format = 0u16;
    let mut channels = 0u16;
    let mut sample_rate = 0u32;
    let mut bits_per_sample = 0u16;
    let mut data_slice: Option<&[u8]> = None;
    let mut forensic_chunks = Vec::new();

    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let sz = u32_le(bytes, pos + 4).ok_or("WAV_CORRUPT_CHUNK")? as usize;
        let body_start = pos + 8;
        let body_end = body_start.saturating_add(sz).min(bytes.len());
        let body = &bytes[body_start..body_end];

        if id == b"fmt " {
            if body.len() < 16 {
                return Err("WAV_CORRUPT_FMT");
            }
            audio_format = u16_le(body, 0).unwrap_or(0);
            channels = u16_le(body, 2).unwrap_or(0);
            sample_rate = u32_le(body, 4).unwrap_or(0);
            bits_per_sample = u16_le(body, 14).unwrap_or(0);
            // Handle WAVE_FORMAT_EXTENSIBLE (0xFFFE) subformat GUID
            if audio_format == 0xFFFE && body.len() >= 26 {
                audio_format = u16_le(body, 24).unwrap_or(1);
            }
        } else if id == b"data" {
            data_slice = Some(body);
        } else {
            let cid = String::from_utf8_lossy(id).into_owned();
            let is_metadata = matches!(
                id,
                b"LIST" | b"INFO" | b"bext" | b"iXML" | b"id3 " | b"ID3 " | b"DISP" | b"JUNK"
            );
            if is_metadata {
                forensic_chunks.push(WavMetadataChunk {
                    chunk_id: cid,
                    byte_len: body.len(),
                    preview: printable_preview(body),
                });
            }
        }

        // RIFF chunks are word-aligned (padded to even size)
        let advance = 8usize.saturating_add(sz).saturating_add(sz & 1);
        if advance == 0 || pos.saturating_add(advance) <= pos {
            break;
        }
        pos = pos.saturating_add(advance);
    }

    if channels == 0 || sample_rate == 0 {
        return Err("WAV_MISSING_FMT");
    }
    let data = data_slice.ok_or("WAV_MISSING_DATA")?;

    let mut samples = Vec::new();
    match (audio_format, bits_per_sample) {
        (1, 16) => {
            samples.reserve(data.len() / 2);
            let mut p = 0;
            while p + 2 <= data.len() {
                let s = i16::from_le_bytes([data[p], data[p + 1]]);
                samples.push((s as f32) / 32768.0);
                p += 2;
            }
        }
        (1, 24) => {
            samples.reserve(data.len() / 3);
            let mut p = 0;
            while p + 3 <= data.len() {
                let raw = ((data[p] as i32) << 8)
                    | ((data[p + 1] as i32) << 16)
                    | ((data[p + 2] as i32) << 24);
                samples.push((raw >> 8) as f32 / 8_388_608.0);
                p += 3;
            }
        }
        (3, 32) => {
            samples.reserve(data.len() / 4);
            let mut p = 0;
            while p + 4 <= data.len() {
                let s = f32::from_le_bytes([data[p], data[p + 1], data[p + 2], data[p + 3]]);
                samples.push(s.clamp(-1.0, 1.0));
                p += 4;
            }
        }
        _ => return Err("WAV_UNSUPPORTED_FORMAT"),
    }

    Ok(DecodedWav {
        sample_rate,
        channels,
        bits_per_sample,
        audio_format,
        samples,
        forensic_chunks,
    })
}

/// Encode clean metadata-free PCM16 RIFF WAV (`fmt ` + `data` chunks ONLY).
pub fn encode_clean_wav_pcm16(samples: &[f32], sample_rate: u32, channels: u16) -> Vec<u8> {
    let data_bytes = samples.len().saturating_mul(2);
    let riff_size = (36usize.saturating_add(data_bytes)) as u32;
    let byte_rate = sample_rate
        .saturating_mul(channels as u32)
        .saturating_mul(2);
    let block_align = channels.saturating_mul(2);

    let mut out = Vec::with_capacity(44 + data_bytes);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&riff_size.to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data_bytes as u32).to_le_bytes());

    for &s in samples {
        let clamped = s.clamp(-1.0, 1.0);
        let q = (clamped * 32767.0).round() as i16;
        out.extend_from_slice(&q.to_le_bytes());
    }
    out
}

/// Apply sample-accurate redaction over `[start_ms - pad_ms, end_ms + pad_ms]` with 5 ms cosine fades.
/// Preserves all samples outside redacted spans bit-identically.
pub fn redact_pcm_interleaved(
    samples: &mut [f32],
    sample_rate: u32,
    channels: u16,
    spans: &[RedactSpanMs],
    opts: AudioRedactOptions,
) -> Vec<(u32, u32)> {
    let ch = (channels as usize).max(1);
    let total_frames = samples.len() / ch;
    if total_frames == 0 || spans.is_empty() {
        return Vec::new();
    }

    // Expand by pad_ms and merge overlapping windows
    let mut intervals: Vec<(usize, usize)> = Vec::with_capacity(spans.len());
    for sp in spans {
        if sp.end_ms <= sp.start_ms {
            continue;
        }
        let s_ms = sp.start_ms.saturating_sub(opts.pad_ms) as u64;
        let e_ms = sp.end_ms.saturating_add(opts.pad_ms) as u64;
        let sf = ((s_ms * sample_rate as u64) / 1000) as usize;
        let ef = (((e_ms * sample_rate as u64) + 999) / 1000) as usize;
        let sf = sf.min(total_frames);
        let ef = ef.min(total_frames);
        if ef > sf {
            intervals.push((sf, ef));
        }
    }
    intervals.sort_by_key(|x| x.0);
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for (s, e) in intervals {
        if let Some(last) = merged.last_mut() {
            if s <= last.1 {
                if e > last.1 {
                    last.1 = e;
                }
                continue;
            }
        }
        merged.push((s, e));
    }

    let fade_frames = (((opts.fade_ms as u64) * (sample_rate as u64)) / 1000) as usize;
    let mut rng: u32 = 0x1234_5678;
    let mut pink_b0 = 0.0f32;
    let mut pink_b1 = 0.0f32;
    let mut pink_b2 = 0.0f32;

    let mut applied_ms = Vec::with_capacity(merged.len());

    for (sf, ef) in merged {
        let len = ef - sf;
        let actual_fade = fade_frames.min(len / 2);

        for f in sf..ef {
            let rel = f - sf;
            // Mask blend weight: 1.0 inside full mute/beep, cosine ramp at edges
            let mask_w = if actual_fade > 0 && rel < actual_fade {
                0.5 * (1.0 - ((PI * rel as f32) / actual_fade as f32).cos())
            } else if actual_fade > 0 && (ef - 1 - f) < actual_fade {
                let rem = ef - 1 - f;
                0.5 * (1.0 - ((PI * rem as f32) / actual_fade as f32).cos())
            } else {
                1.0
            };

            let replacement = match opts.mode {
                0 => 0.0f32, // pure silence
                1 => {
                    let t = (f as f32) / (sample_rate as f32);
                    (2.0 * PI * opts.beep_hz * t).sin() * opts.beep_gain
                }
                _ => {
                    // Deterministic pink noise (3-pole filter on LCG white noise)
                    rng = rng.wrapping_mul(1664525).wrapping_add(1013904223);
                    let white = ((rng >> 8) as f32 / 8_388_608.0) - 1.0;
                    pink_b0 = 0.997 * pink_b0 + white * 0.0299;
                    pink_b1 = 0.985 * pink_b1 + white * 0.0325;
                    pink_b2 = 0.950 * pink_b2 + white * 0.0481;
                    (pink_b0 + pink_b1 + pink_b2 + white * 0.018) * opts.beep_gain * 2.5
                }
            };

            let keep_w = 1.0 - mask_w;
            for c in 0..ch {
                let idx = f * ch + c;
                samples[idx] = samples[idx] * keep_w + replacement * mask_w;
            }
        }

        let out_s_ms = ((sf as u64) * 1000 / sample_rate as u64) as u32;
        let out_e_ms = ((ef as u64) * 1000 / sample_rate as u64) as u32;
        applied_ms.push((out_s_ms, out_e_ms));
    }

    applied_ms
}

#[derive(Clone, Debug)]
pub struct VadSegment {
    pub start_ms: u32,
    pub end_ms: u32,
    pub speaker_channel: i32, // -1 mono/mixed, 0 left/agent, 1 right/customer
    pub rms: f32,
}

/// Fast deterministic frame-energy VAD + stereo dual-channel speaker attribution.
pub fn analyze_wav_vad(
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    window_ms: u32,
    rms_threshold: f32,
) -> Vec<VadSegment> {
    let ch = (channels as usize).max(1);
    let total_frames = samples.len() / ch;
    let win_frames = (((window_ms.max(10) as u64) * (sample_rate as u64)) / 1000) as usize;
    if total_frames == 0 || win_frames == 0 {
        return Vec::new();
    }

    let mut segments: Vec<VadSegment> = Vec::new();
    let mut f = 0usize;

    while f < total_frames {
        let end = (f + win_frames).min(total_frames);
        let cnt = (end - f) as f32;

        let mut e_ch0 = 0.0f32;
        let mut e_ch1 = 0.0f32;
        let mut e_all = 0.0f32;

        for idx in f..end {
            let s0 = samples[idx * ch];
            e_ch0 += s0 * s0;
            if ch >= 2 {
                let s1 = samples[idx * ch + 1];
                e_ch1 += s1 * s1;
                let m = 0.5 * (s0 + s1);
                e_all += m * m;
            } else {
                e_all += s0 * s0;
            }
        }

        let rms0 = (e_ch0 / cnt).sqrt();
        let rms1 = if ch >= 2 { (e_ch1 / cnt).sqrt() } else { 0.0 };
        let rms = rms0.max(rms1).max((e_all / cnt).sqrt());

        if rms >= rms_threshold {
            let spk = if ch >= 2 {
                if rms0 > rms1 * 1.35 {
                    0
                } else if rms1 > rms0 * 1.35 {
                    1
                } else {
                    -1
                }
            } else {
                -1
            };
            let s_ms = ((f as u64) * 1000 / sample_rate as u64) as u32;
            let e_ms = ((end as u64) * 1000 / sample_rate as u64) as u32;

            if let Some(last) = segments.last_mut() {
                if last.speaker_channel == spk && s_ms <= last.end_ms + window_ms * 2 {
                    last.end_ms = e_ms;
                    last.rms = last.rms.max(rms);
                    f = end;
                    continue;
                }
            }
            segments.push(VadSegment {
                start_ms: s_ms,
                end_ms: e_ms,
                speaker_channel: spk,
                rms,
            });
        }

        f = end;
    }

    segments
}
