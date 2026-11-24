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

// ---------------------------------------------------------------------------
// Prosody kernel v1 (own experiment): per-VAD-segment F0 (YIN-style integer
// autocorrelation), RMS/ZCR/tilt stats, wpm from spoken-word spans, and
// speaker-clustering-lite (agglomerative + cosine distance with a BIC-style
// merge criterion). Operates on already-decoded PCM only; ground-truth labels
// are never an input.
// ---------------------------------------------------------------------------

pub const WPM_SOURCE_NONE: u8 = 0;
pub const WPM_SOURCE_WORD_SPANS: u8 = 1;
pub const PROSODY_MAX_SEGMENTS: usize = 64;
pub const PROSODY_MAX_CLUSTERS: usize = 8;

#[derive(Clone, Debug)]
pub struct ProsodySegment {
    pub start_ms: u32,
    pub end_ms: u32,
    pub f0_hz: f32,     // median voiced-frame F0 (0.0 = unvoiced/none)
    pub f0_std_hz: f32, // std of voiced-frame F0 within the segment
    pub rms_db: f32,
    pub zcr: f32,    // sign-change fraction in [0, 1]
    pub tilt_db: f32, // energy of first difference vs total (HF proxy), dB
    pub wpm: f32,
    pub wpm_word_count: u32,
    pub wpm_source: u8,
    pub cluster: i32, // filled by assign_speaker_clusters, -1 before
    pub f0_frames_voiced: usize,
    pub f0_frames_total: usize,
}

/// YIN-style integer F0 on one mono frame: i16-quantized samples, i64 accumulation.
/// Returns refined F0 in Hz, or 0.0 when the frame is judged unvoiced/aperiodic.
pub fn f0_frame_yin(mono: &[f32], sample_rate: u32, min_hz: f32, max_hz: f32) -> f32 {
    let n = mono.len();
    let lag_min = (sample_rate as f32 / max_hz).max(2.0) as usize;
    let lag_max = ((sample_rate as f32 / min_hz) as usize).min(n - 1);
    if n < 64 || lag_min >= lag_max {
        return 0.0;
    }
    // Integer autocorrelation domain: quantize to i16 once, accumulate in i64.
    let q: Vec<i32> = mono.iter().map(|&v| (v.clamp(-1.0, 1.0) * 32767.0) as i32).collect();

    let mut cum = 0i64; // running sum of d(j), j = 1..tau
    let mut best_tau = 0usize;
    let mut best_cmnd = f64::MAX;
    let mut first_below: Option<usize> = None;
    for tau in 1..lag_max + 1 {
        let mut d = 0i64;
        for i in 0..n - tau {
            let diff = q[i] - q[i + tau];
            d += (diff * diff) as i64;
        }
        let d_f = d as f64 / (n - tau) as f64;
        cum += (d_f * 1e6) as i64;
        // Cumulative mean normalized difference (CMND)
        let cmnd = if cum > 0 && tau > 0 {
            d_f * tau as f64 / (cum as f64 / 1e6)
        } else {
            f64::MAX
        };
        if cmnd < best_cmnd {
            best_cmnd = cmnd;
            best_tau = tau;
        }
        if first_below.is_none() && tau >= lag_min && cmnd < 0.10 {
            first_below = Some(tau);
        }
        if first_below.is_some() && cmnd > 1.0 && tau >= lag_min {
            break; // passed the first clear dip: stop scanning
        }
    }
    let tau = match first_below {
        Some(t) if best_cmnd < 0.25 => t,
        _ => {
            if best_cmnd < 0.25 && best_tau >= lag_min && best_tau <= lag_max {
                best_tau
            } else {
                return 0.0;
            }
        }
    };
    if best_tau == 0 || best_cmnd >= 0.25 {
        return 0.0;
    }
    // Parabolic refinement around the dip on d(tau) (recompute local 3 points).
    let dfun = |t: usize| -> f64 {
        if t < lag_min.saturating_sub(1).max(1) || t > lag_max {
            return f64::MAX;
        }
        let mut acc = 0i64;
        for i in 0..n - t.min(n - 1) {
            let diff = q[i] - q[i + t.min(n - 1)];
            acc += (diff * diff) as i64;
        }
        acc as f64 / (n - t.min(n - 1)) as f64
    };
    let t0 = tau.saturating_sub(1).max(1);
    let d0 = dfun(t0);
    let d1 = dfun(tau);
    let d2 = dfun((tau + 1).min(lag_max));
    let denom = d0 + d2 - 2.0 * d1;
    let shift = if denom.abs() > f64::EPSILON {
        (0.5 * (d0 - d2) / denom).clamp(-0.5, 0.5)
    } else {
        0.0
    };
    let refined = sample_rate as f64 / (tau as f64 + shift);
    let f0 = refined as f32;
    // Requantized PCM16 quantization noise widens the dip slightly; clamp to scan range.
    if f0 < min_hz * 0.9 || f0 > max_hz * 1.1 || f0 <= 0.0 {
        return 0.0;
    }
    f0
}

/// Per-VAD-segment prosody over already-decoded PCM. `word_spans` are optional
/// (startMs, endMs) spoken-word/ITN spans; when absent wpm is NOT estimated.
pub fn analyze_prosody(
    samples: &[f32],
    sample_rate: u32,
    channels: u16,
    vad: &[VadSegment],
    word_spans: &[(u32, u32)],
) -> Vec<ProsodySegment> {
    let ch = (channels as usize).max(1);
    let total_frames = samples.len() / ch;
    let mut out = Vec::with_capacity(vad.len().min(PROSODY_MAX_SEGMENTS));

    for seg in vad.iter().take(PROSODY_MAX_SEGMENTS) {
        let sf = (((seg.start_ms as u64) * (sample_rate as u64)) / 1000) as usize;
        let ef = (((seg.end_ms as u64) * (sample_rate as u64)) / 1000).min(total_frames as u64)
            as usize;
        let ef = ef.max(sf).min(total_frames);
        let dur_ms = seg.end_ms.saturating_sub(seg.start_ms);
        if ef <= sf || dur_ms == 0 {
            continue;
        }

        // Downmix to mono scratch
        let mut mono: Vec<f32> = Vec::with_capacity(ef - sf);
        let mut sq_sum = 0.0f64;
        let mut diff_sq = 0.0f64;
        let mut prev = 0.0f32;
        let mut zcr_count = 0u64;
        for f in sf..ef {
            let m = if ch >= 2 {
                0.5 * (samples[f * ch] + samples[f * ch + 1])
            } else {
                samples[f]
            };
            sq_sum += (m * m) as f64;
            diff_sq += ((m - prev) * (m - prev)) as f64;
            if (m < 0.0) != (prev < 0.0) {
                zcr_count += 1;
            }
            prev = m;
            mono.push(m);
        }
        let n = mono.len() as f64;
        let rms = (sq_sum / n).sqrt() as f32;
        let rms_db = 20.0 * rms.max(1e-6).log10();
        let zcr = zcr_count as f64 / n;
        let tilt_db = (10.0
            * (diff_sq.max(1e-9) / (2.0 * sq_sum.max(1e-9)))
                .min(1_000_000.0)
                .log10()) as f32;

        // Frame-wise F0 sweep: 40 ms frames, 20 ms hop
        let frame_len = (frame_us_len(sample_rate, 40)) as usize;
        let hop = (frame_us_len(sample_rate, 20)) as usize;
        let mut voiced: Vec<f32> = Vec::new();
        let mut frames_total = 0usize;
        let mut start = 0usize;
        while start + frame_len <= mono.len() {
            frames_total += 1;
            let f = f0_frame_yin(&mono[start..start + frame_len], sample_rate, 60.0, 400.0);
            if f > 0.0 {
                voiced.push(f);
            }
            start += hop;
        }
        // Insertion sort (small arrays; avoids a generic slice-sort instantiation)
        // so the median voiced F0 is robust to octave skips.
        for i in 1..voiced.len() {
            let mut j = i;
            while j > 0 && voiced[j] < voiced[j - 1] {
                voiced.swap(j, j - 1);
                j -= 1;
            }
        }
        let (f0_hz, f0_std) = if voiced.is_empty() {
            (0.0f32, 0.0f32)
        } else {
            let med = voiced[voiced.len() / 2];
            let mean = voiced.iter().sum::<f32>() / voiced.len() as f32;
            let var = voiced.iter().map(|v| (v - mean) * (v - mean)).sum::<f32>()
                / voiced.len() as f32;
            (med, var.sqrt())
        };

        // wpm strictly from provided spoken-word spans (overlap midpoint rule)
        let mut wpm_word_count = 0u32;
        for &(ws, we) in word_spans {
            let mid = (ws as u64 + we as u64) / 2;
            if mid >= seg.start_ms as u64 && mid <= seg.end_ms as u64 {
                wpm_word_count += 1;
            }
        }
        let have_spans = !word_spans.is_empty();
        let wpm = if have_spans {
            (wpm_word_count as f64 * 60000.0 / dur_ms as f64) as f32
        } else {
            0.0
        };

        out.push(ProsodySegment {
            start_ms: seg.start_ms,
            end_ms: seg.end_ms,
            f0_hz,
            f0_std_hz: f0_std,
            rms_db,
            zcr: zcr as f32,
            tilt_db,
            wpm,
            wpm_word_count,
            wpm_source: if have_spans {
                WPM_SOURCE_WORD_SPANS
            } else {
                WPM_SOURCE_NONE
            },
            cluster: -1,
            f0_frames_voiced: voiced.len(),
            f0_frames_total: frames_total,
        });
    }
    out
}

fn frame_us_len(sample_rate: u32, ms: u64) -> u64 {
    ((ms * sample_rate as u64) / 1000).max(1)
}

/// Cosine linkage threshold on z-scored features; the merge loop stops at the
/// first pair whose centroid distance is at or above this value.
pub const PROSODY_LINKAGE_THRESHOLD: f64 = 0.5;

/// Speaker-clustering-lite: agglomerative merging on cosine distance of the
/// z-scored segment feature vector, stopped when the closest pair of cluster
/// centroids reaches the linkage threshold (k capped at max_clusters, <= 8).
/// Returns the number of clusters (1..=max_clusters).
pub fn assign_speaker_clusters(segs: &mut [ProsodySegment], max_clusters: usize) -> usize {
    for s in segs.iter_mut() {
        s.cluster = -1;
    }
    let n = segs.len();
    if n == 0 {
        return 0;
    }
    // Feature dims: [f0, f0 jitter (coefficient of variation, floored at 5%
    // to treat sub-jitter values as noise), tilt_db, zcr, rms_db]
    const DIMS: usize = 5;
    let mut feats = vec![vec![0.0f64; DIMS]; n];
    for (i, s) in segs.iter().enumerate() {
        let f0 = s.f0_hz as f64;
        let cv = if f0 > 0.0 { s.f0_std_hz as f64 / f0 } else { 0.0 };
        feats[i][0] = f0;
        feats[i][1] = if cv < 0.05 { 0.0 } else { cv.min(2.0) };
        feats[i][2] = s.tilt_db as f64;
        feats[i][3] = s.zcr as f64;
        feats[i][4] = s.rms_db as f64;
    }
    // z-score each dim; constant dims become zeros (no weight in cosine space)
    for d in 0..DIMS {
        let mean = feats.iter().map(|f| f[d]).sum::<f64>() / n as f64;
        let var = feats.iter().map(|f| (f[d] - mean) * (f[d] - mean)).sum::<f64>() / n as f64;
        let sd = if var.sqrt() < 1e-9 { 0.0 } else { var.sqrt() };
        for f in feats.iter_mut() {
            f[d] = if sd > 0.0 { (f[d] - mean) / sd } else { 0.0 };
        }
    }
    let cos_dist = |a: &[f64], b: &[f64]| -> f64 {
        let na = a.iter().map(|v| v * v).sum::<f64>().sqrt();
        let nb = b.iter().map(|v| v * v).sum::<f64>().sqrt();
        if na < 1e-12 || nb < 1e-12 {
            return 1.0;
        }
        let dot = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum::<f64>() / (na * nb);
        1.0 - dot.clamp(-1.0, 1.0)
    };

    let max_k = max_clusters.min(PROSODY_MAX_CLUSTERS).max(1);
    let mut assignment: Vec<usize> = (0..n).collect();
    let mut k = n;
    debug_assert!(k <= PROSODY_MAX_SEGMENTS, "caller must pre-truncate segments");
    for _cycle in 0..2 * n {
        if k <= 1 {
            break;
        }
        // Build centroids
        let mut sum = vec![vec![0.0f64; DIMS]; k];
        let mut cnt = vec![0usize; k];
        for (i, a) in assignment.iter().enumerate() {
            for d in 0..DIMS {
                sum[*a][d] += feats[i][d];
            }
            cnt[*a] += 1;
        }
        let mut centroids = vec![vec![0.0f64; DIMS]; k];
        for c in 0..k {
            if cnt[c] > 0 {
                for d in 0..DIMS {
                    centroids[c][d] = sum[c][d] / cnt[c] as f64;
                }
            }
        }
        let mut best: Option<(f64, usize, usize)> = None;
        for a in 0..k {
            for b in (a + 1)..k {
                let d = cos_dist(&centroids[a], &centroids[b]);
                // merge the closest pair first; stop when even that pair is beyond threshold
                // unless k still exceeds the caller's cap (then merge closest regardless)
                if best.is_none() || d < best.unwrap().0 {
                    best = Some((d, a, b));
                }
            }
        }
        let (min_dist, _, _) = best.unwrap_or((1.0, 0, 1));
        if min_dist >= PROSODY_LINKAGE_THRESHOLD && k <= max_k {
            break;
        }
        match best {
            Some((_, a, b)) => {
                for x in assignment.iter_mut() {
                    if *x == b {
                        *x = a;
                    }
                }
                // contiguous re-label
                let mut next_id = 0usize;
                let mut seen: Vec<Option<usize>> = vec![None; k];
                for x in assignment.iter_mut() {
                    let slot = &mut seen[*x];
                    if slot.is_none() {
                        *slot = Some(next_id);
                        next_id += 1;
                    }
                    *x = slot.unwrap();
                }
                k = next_id;
            }
            None => break,
        }
    }
    for (i, s) in segs.iter_mut().enumerate() {
        s.cluster = assignment[i] as i32;
    }
    k
}
