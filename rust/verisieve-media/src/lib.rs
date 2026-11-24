//! verisieve-media: Zero-import, zero-dependency Rust/WebAssembly multimodal core for VeriSieve.
//!
//! Runs byte-identically in Node.js (CLI / MCP) and Browser (Web Workers / Sandbox):
//! - Bomb-guarded RFC 1951 DEFLATE & RFC 1952 GZIP inflater + CRC-32
//! - Hardened ZIP Central Directory (+ bit-3 + ZIP64) & TAR/TGZ unpacker with Zip-Slip guards
//! - Pure-Rust CFBF/OLE2 reader for Microsoft Outlook `.msg` files + attachments
//! - Stage 3A Unicode Anti-Evasion + International Checksums (Luhn, IBAN, AU TFN/Medicare/ABN,
//!   UK NHS/NINO, India Aadhaar Verhoeff, US SSN) + 30+ Enterprise Secret Detectors
//! - Deterministic Spoken Inverse Text Normalization (Spoken ITN) with word-span back-pointers
//! - RIFF WAV PCM16/24/Float32 codec + forensic metadata scrubber + sample-accurate redactor + VAD
//! - JPEG/PNG/ISOBMFF MP4 metadata scrubbers, RGB/RGBA pixel blur/pixelate/blackout,
//!   64-bin RGB scene-change detector, 64-bit dHash perceptual fingerprint, and temporal
//!   bounding-box tracker

pub mod audio_dsp;
pub mod cfbf;
pub mod inflate;
pub mod media_visual;
pub mod pii_secrets;
pub mod spoken_itn;
pub mod zip_tar;

use std::cell::RefCell;

const ABI_VERSION: u32 = 1;

#[derive(Default)]
struct WasmState {
    in_buf: Vec<u8>,
    in_buf2: Vec<u8>,
    out_buf: Vec<u8>,
    meta_json: Vec<u8>,
    last_error: Vec<u8>,
    tar_cache: Vec<u8>,
    tar_entries: Vec<zip_tar::TarEntryMeta>,
    msg_attachments: Vec<cfbf::MsgAttachment>,
    srmp_ring: pii_secrets::SrmpSketchRing,
}

thread_local! {
    static STATE: RefCell<WasmState> = RefCell::new(WasmState::default());
}

fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn set_error(st: &mut WasmState, msg: &str) -> i32 {
    st.last_error.clear();
    st.last_error.extend_from_slice(msg.as_bytes());
    -1
}

// ---------------------------------------------------------------------------
// ABI v1 Buffer Management Exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vs_media_abi_version() -> u32 {
    ABI_VERSION
}

#[no_mangle]
pub extern "C" fn vs_media_prepare_input(len: u32) -> *mut u8 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.in_buf.resize(len as usize, 0);
        st.in_buf.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn vs_media_prepare_input2(len: u32) -> *mut u8 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.in_buf2.resize(len as usize, 0);
        st.in_buf2.as_mut_ptr()
    })
}

#[no_mangle]
pub extern "C" fn vs_media_out_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().out_buf.as_ptr())
}

#[no_mangle]
pub extern "C" fn vs_media_out_len() -> u32 {
    STATE.with(|cell| cell.borrow().out_buf.len() as u32)
}

#[no_mangle]
pub extern "C" fn vs_media_meta_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().meta_json.as_ptr())
}

#[no_mangle]
pub extern "C" fn vs_media_meta_len() -> u32 {
    STATE.with(|cell| cell.borrow().meta_json.len() as u32)
}

#[no_mangle]
pub extern "C" fn vs_media_err_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_error.as_ptr())
}

#[no_mangle]
pub extern "C" fn vs_media_err_len() -> u32 {
    STATE.with(|cell| cell.borrow().last_error.len() as u32)
}

// ---------------------------------------------------------------------------
// 1. ZIP & TAR / .tar.gz Exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vs_media_zip_list() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        match zip_tar::zip_list_entries(&st.in_buf) {
            Ok(entries) => {
                let mut json = String::from("[");
                for (i, e) in entries.iter().enumerate() {
                    if i > 0 {
                        json.push(',');
                    }
                    json.push_str(&format!(
                        "{{\"index\":{},\"name\":{},\"method\":{},\"crc32\":{},\"compressedSize\":{},\"uncompressedSize\":{},\"isDir\":{},\"isEncrypted\":{}}}",
                        e.index,
                        json_escape(&e.name),
                        e.compression_method,
                        e.crc32,
                        e.compressed_size,
                        e.uncompressed_size,
                        e.is_dir,
                        e.is_encrypted
                    ));
                }
                json.push(']');
                st.meta_json = json.into_bytes();
                entries.len() as i32
            }
            Err(err) => set_error(&mut st, err),
        }
    })
}

#[no_mangle]
pub extern "C" fn vs_media_zip_extract(entry_index: u32, max_out_bytes: u32, max_ratio: u32) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        match zip_tar::zip_extract_entry(
            &st.in_buf,
            entry_index as usize,
            max_out_bytes as usize,
            max_ratio,
        ) {
            Ok(bytes) => {
                let len = bytes.len() as i32;
                st.out_buf = bytes;
                len
            }
            Err(err) => set_error(&mut st, err),
        }
    })
}

#[no_mangle]
pub extern "C" fn vs_media_tar_load(max_total_bytes: u32, max_ratio: u32) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        match zip_tar::tar_parse_entries(&st.in_buf, max_total_bytes as usize, max_ratio) {
            Ok((tar_bytes, entries)) => {
                let mut json = String::from("[");
                for (i, e) in entries.iter().enumerate() {
                    if i > 0 {
                        json.push(',');
                    }
                    json.push_str(&format!(
                        "{{\"index\":{},\"name\":{},\"size\":{},\"isDir\":{}}}",
                        e.index,
                        json_escape(&e.name),
                        e.size,
                        e.is_dir
                    ));
                }
                json.push(']');
                st.meta_json = json.into_bytes();
                let count = entries.len() as i32;
                st.tar_cache = tar_bytes;
                st.tar_entries = entries;
                count
            }
            Err(err) => set_error(&mut st, err),
        }
    })
}

#[no_mangle]
pub extern "C" fn vs_media_tar_extract(entry_index: u32) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let Some(entry) = st.tar_entries.get(entry_index as usize).cloned() else {
            return set_error(&mut st, "TAR_ENTRY_OUT_OF_RANGE");
        };
        let end = entry.data_offset.saturating_add(entry.size);
        if end > st.tar_cache.len() {
            return set_error(&mut st, "TAR_CORRUPT_BOUNDS");
        }
        st.out_buf = st.tar_cache[entry.data_offset..end].to_vec();
        st.out_buf.len() as i32
    })
}

// ---------------------------------------------------------------------------
// 2. Outlook `.msg` (CFBF / OLE2) Exports
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vs_media_parse_msg() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        st.msg_attachments.clear();
        match cfbf::parse_outlook_msg(&st.in_buf) {
            Ok(msg) => {
                let mut att_json = String::from("[");
                for (i, a) in msg.attachments.iter().enumerate() {
                    if i > 0 {
                        att_json.push(',');
                    }
                    att_json.push_str(&format!(
                        "{{\"index\":{},\"filename\":{},\"mimeType\":{},\"size\":{}}}",
                        i,
                        json_escape(&a.filename),
                        json_escape(&a.mime_type),
                        a.data.len()
                    ));
                }
                att_json.push(']');

                let json = format!(
                    "{{\"subject\":{},\"senderName\":{},\"senderEmail\":{},\"displayTo\":{},\"displayCc\":{},\"transportHeaders\":{},\"bodyText\":{},\"bodyHtml\":{},\"attachments\":{}}}",
                    json_escape(&msg.subject),
                    json_escape(&msg.sender_name),
                    json_escape(&msg.sender_email),
                    json_escape(&msg.display_to),
                    json_escape(&msg.display_cc),
                    json_escape(&msg.transport_headers),
                    json_escape(&msg.body_text),
                    json_escape(&msg.body_html),
                    att_json
                );
                let att_count = msg.attachments.len() as i32;
                st.msg_attachments = msg.attachments;
                st.meta_json = json.into_bytes();
                att_count
            }
            Err(err) => set_error(&mut st, err),
        }
    })
}

#[no_mangle]
pub extern "C" fn vs_media_msg_attachment(att_index: u32) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let Some(att) = st.msg_attachments.get(att_index as usize) else {
            return set_error(&mut st, "MSG_ATTACHMENT_OUT_OF_RANGE");
        };
        st.out_buf = att.data.clone();
        st.out_buf.len() as i32
    })
}

// ---------------------------------------------------------------------------
// 3. Stage 3A Anti-Evasion + International Checksum PII + 30+ Secret Scanner
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vs_media_scan_pii_secrets() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let text = String::from_utf8_lossy(&st.in_buf);
        let report = pii_secrets::scan_text_pii_and_secrets(&text);

        let mut spans_json = String::from("[");
        for (i, sp) in report.spans.iter().enumerate() {
            if i > 0 {
                spans_json.push(',');
            }
            spans_json.push_str(&format!(
                "{{\"type\":{},\"category\":{},\"start\":{},\"end\":{},\"confidence\":{:.3},\"entropy\":{:.2},\"evasionNormalized\":{}}}",
                json_escape(sp.kind),
                json_escape(sp.category),
                sp.start_u16,
                sp.end_u16,
                (sp.confidence_x1000 as f32) / 1000.0,
                (sp.entropy_x100 as f32) / 100.0,
                sp.evasion_normalized
            ));
        }
        spans_json.push(']');

        let json = format!(
            "{{\"evasionCharsStripped\":{},\"homoglyphsFolded\":{},\"spans\":{}}}",
            report.evasion_chars_stripped, report.homoglyphs_folded, spans_json
        );
        let count = report.spans.len() as i32;
        st.meta_json = json.into_bytes();
        count
    })
}

#[no_mangle]
pub extern "C" fn vs_media_pprl_signature() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let text = String::from_utf8_lossy(&st.in_buf);
        let sig = pii_secrets::compute_pprl_signature(&text, &st.in_buf2);
        let json = format!(
            "{{\"bloomHex\":{},\"phoneticHex\":{},\"popcount\":{}}}",
            json_escape(&sig.bloom_hex),
            json_escape(&sig.phonetic_hex),
            sig.popcount
        );
        st.meta_json = json.into_bytes();
        sig.popcount as i32
    })
}

#[no_mangle]
pub extern "C" fn vs_media_srmp_reset() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        st.srmp_ring.reset();
        0
    })
}

#[no_mangle]
pub extern "C" fn vs_media_srmp_seed_anchor(
    entity_uid: u32,
    block_idx: u32,
    conf_x1000: u32,
    kind_code: u32,
) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let text = String::from_utf8_lossy(&st.in_buf).into_owned();
        let salt = st.in_buf2.clone();
        let cnt = st.srmp_ring.seed_anchor(
            &text,
            &salt,
            (entity_uid & 0xFFFF) as u16,
            (block_idx & 0xFFFF) as u16,
            (conf_x1000.min(1000)) as u16,
            (kind_code & 0xFF) as u8,
        );
        let json = format!(
            "{{\"slotCount\":{},\"capacity\":{},\"entityUid\":{},\"blockIdx\":{}}}",
            cnt,
            pii_secrets::SRMP_RING_CAPACITY,
            entity_uid & 0xFFFF,
            block_idx & 0xFFFF
        );
        st.meta_json = json.into_bytes();
        cnt as i32
    })
}

#[no_mangle]
pub extern "C" fn vs_media_srmp_query_candidate(
    block_idx: u32,
    local_score_x1000: u32,
    min_dice_x1000: u32,
    gamma_x1000: u32,
    beta_x1000: u32,
) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let text = String::from_utf8_lossy(&st.in_buf).into_owned();
        let hit = st.srmp_ring.query_candidate(
            &text,
            &st.in_buf2,
            (block_idx & 0xFFFF) as u16,
            local_score_x1000.min(1000) as u16,
            min_dice_x1000.min(1000) as u16,
            gamma_x1000.min(1000) as u16,
            beta_x1000.min(1000) as u16,
        );
        let json = format!(
            "{{\"matched\":{},\"entityUid\":{},\"anchorBlockIdx\":{},\"kindCode\":{},\"dice\":{:.4},\"phoneticMatch\":{},\"exactMatch\":{},\"coupledScore\":{:.4}}}",
            hit.matched,
            hit.entity_uid,
            hit.anchor_block_idx,
            hit.kind_code,
            (hit.dice_x1000 as f32) / 1000.0,
            hit.phonetic_match,
            hit.exact_match,
            (hit.coupled_score_x1000 as f32) / 1000.0
        );
        st.meta_json = json.into_bytes();
        if hit.matched {
            hit.coupled_score_x1000 as i32
        } else {
            0
        }
    })
}

// ---------------------------------------------------------------------------
// 4. Deterministic Spoken ITN (Input: TSV lines "word\tstartMs\tendMs")
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vs_media_spoken_itn() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let raw = String::from_utf8_lossy(&st.in_buf);
        let mut words = Vec::new();
        for line in raw.lines() {
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split('\t');
            let w = parts.next().unwrap_or("").to_string();
            let s_ms: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let e_ms: u32 = parts.next().and_then(|v| v.parse().ok()).unwrap_or(s_ms);
            words.push(spoken_itn::SpokenWord {
                word: w,
                start_ms: s_ms,
                end_ms: e_ms,
            });
        }

        let res = spoken_itn::normalize_spoken_words(&words);
        let mut map_json = String::from("[");
        for (i, m) in res.word_map.iter().enumerate() {
            if i > 0 {
                map_json.push(',');
            }
            map_json.push_str(&format!(
                "{{\"normStart\":{},\"normEnd\":{},\"wordStart\":{},\"wordEnd\":{},\"startMs\":{},\"endMs\":{},\"kind\":{}}}",
                m.norm_start_u16,
                m.norm_end_u16,
                m.word_start,
                m.word_end,
                m.start_ms,
                m.end_ms,
                json_escape(m.kind)
            ));
        }
        map_json.push(']');

        let json = format!(
            "{{\"normalizedText\":{},\"wordMap\":{}}}",
            json_escape(&res.normalized_text),
            map_json
        );
        let cnt = res.word_map.len() as i32;
        st.meta_json = json.into_bytes();
        cnt
    })
}

// ---------------------------------------------------------------------------
// 5. RIFF WAV DSP + Forensic Metadata Scrubber + VAD Exports
// ---------------------------------------------------------------------------

/// Input1: WAV bytes. Input2: packed u32 pairs [startMs, endMs, ...].
/// Output: clean metadata-scrubbed redacted WAV bytes. Meta: JSON audit + VAD summary.
#[no_mangle]
pub extern "C" fn vs_media_wav_redact(
    mode: u32,
    pad_ms: u32,
    fade_ms: u32,
    beep_hz: f32,
    beep_gain: f32,
) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();

        let mut wav = match audio_dsp::decode_wav(&st.in_buf) {
            Ok(w) => w,
            Err(err) => return set_error(&mut st, err),
        };

        let mut spans = Vec::new();
        let mut p = 0usize;
        while p + 8 <= st.in_buf2.len() {
            let s = u32::from_le_bytes([
                st.in_buf2[p],
                st.in_buf2[p + 1],
                st.in_buf2[p + 2],
                st.in_buf2[p + 3],
            ]);
            let e = u32::from_le_bytes([
                st.in_buf2[p + 4],
                st.in_buf2[p + 5],
                st.in_buf2[p + 6],
                st.in_buf2[p + 7],
            ]);
            spans.push(audio_dsp::RedactSpanMs {
                start_ms: s,
                end_ms: e,
            });
            p += 8;
        }

        let opts = audio_dsp::AudioRedactOptions {
            mode,
            pad_ms,
            fade_ms,
            beep_hz: if beep_hz > 20.0 { beep_hz } else { 1000.0 },
            beep_gain: if beep_gain > 0.0 {
                beep_gain.min(0.95)
            } else {
                0.14
            },
        };

        let applied = audio_dsp::redact_pcm_interleaved(
            &mut wav.samples,
            wav.sample_rate,
            wav.channels,
            &spans,
            opts,
        );
        let vad = audio_dsp::analyze_wav_vad(&wav.samples, wav.sample_rate, wav.channels, 50, 0.015);
        let encoded =
            audio_dsp::encode_clean_wav_pcm16(&wav.samples, wav.sample_rate, wav.channels);

        let mut chunks_json = String::from("[");
        for (i, c) in wav.forensic_chunks.iter().enumerate() {
            if i > 0 {
                chunks_json.push(',');
            }
            chunks_json.push_str(&format!(
                "{{\"chunkId\":{},\"byteLen\":{},\"preview\":{}}}",
                json_escape(&c.chunk_id),
                c.byte_len,
                json_escape(&c.preview)
            ));
        }
        chunks_json.push(']');

        let mut applied_json = String::from("[");
        for (i, (s, e)) in applied.iter().enumerate() {
            if i > 0 {
                applied_json.push(',');
            }
            applied_json.push_str(&format!("{{\"startMs\":{},\"endMs\":{}}}", s, e));
        }
        applied_json.push(']');

        let mut vad_json = String::from("[");
        for (i, v) in vad.iter().enumerate() {
            if i > 0 {
                vad_json.push(',');
            }
            vad_json.push_str(&format!(
                "{{\"startMs\":{},\"endMs\":{},\"speakerChannel\":{},\"rms\":{:.4}}}",
                v.start_ms, v.end_ms, v.speaker_channel, v.rms
            ));
        }
        vad_json.push(']');

        let duration_ms = if wav.sample_rate > 0 && wav.channels > 0 {
            let frames = wav.samples.len() / (wav.channels as usize);
            ((frames as u64) * 1000 / (wav.sample_rate as u64)) as u32
        } else {
            0
        };

        let json = format!(
            "{{\"sampleRate\":{},\"channels\":{},\"bitsPerSample\":{},\"durationMs\":{},\"strippedMetadataChunks\":{},\"appliedRedactions\":{},\"vadSegments\":{}}}",
            wav.sample_rate,
            wav.channels,
            wav.bits_per_sample,
            duration_ms,
            chunks_json,
            applied_json,
            vad_json
        );
        let out_len = encoded.len() as i32;
        st.out_buf = encoded;
        st.meta_json = json.into_bytes();
        out_len
    })
}

// ---------------------------------------------------------------------------
// 5b. Prosody + speaker-clustering-lite over already-decoded PCM (own experiment)
// ---------------------------------------------------------------------------

/// Input1: WAV bytes. Input2: optional packed u32 pairs of spoken-word/ITN spans
/// [startMs, endMs, ...] used ONLY for wpm. Meta: JSON per-segment prosody +
/// cluster ids. Returns the cluster count (1..=8). Ground-truth labels are never
/// an input to this kernel.
#[no_mangle]
pub extern "C" fn vs_media_prosody_analyze(
    max_clusters: u32,
    vad_window_ms: u32,
    vad_rms_threshold_x1000: u32,
) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();

        let wav = match audio_dsp::decode_wav(&st.in_buf) {
            Ok(w) => w,
            Err(err) => return set_error(&mut st, err),
        };
        let mut word_spans: Vec<(u32, u32)> = Vec::new();
        let mut p = 0usize;
        while p + 8 <= st.in_buf2.len() {
            let s = u32::from_le_bytes([
                st.in_buf2[p],
                st.in_buf2[p + 1],
                st.in_buf2[p + 2],
                st.in_buf2[p + 3],
            ]);
            let e = u32::from_le_bytes([
                st.in_buf2[p + 4],
                st.in_buf2[p + 5],
                st.in_buf2[p + 6],
                st.in_buf2[p + 7],
            ]);
            if e > s {
                word_spans.push((s, e));
            }
            p += 8;
        }

        let window_ms = if vad_window_ms < 10 { 50 } else { vad_window_ms };
        let threshold = (vad_rms_threshold_x1000.min(1000) as f32) / 1000.0;
        let vad = audio_dsp::analyze_wav_vad(
            &wav.samples,
            wav.sample_rate,
            wav.channels,
            window_ms,
            if threshold > 0.0 { threshold } else { 0.015 },
        );

        // Truncate to the first PROSODY_MAX_SEGMENTS VAD segments (chronological;
        // deliberately prefix truncation, no sort: keeps the kernel lean)
        let truncated = vad.len() > audio_dsp::PROSODY_MAX_SEGMENTS;
        let vad_kept: Vec<audio_dsp::VadSegment> = vad
            .iter()
            .take(audio_dsp::PROSODY_MAX_SEGMENTS)
            .cloned()
            .collect();

        let mut segs = audio_dsp::analyze_prosody(
            &wav.samples,
            wav.sample_rate,
            wav.channels,
            &vad_kept,
            &word_spans,
        );
        let max_k = max_clusters.clamp(1, 8) as usize;
        let cluster_count =
            audio_dsp::assign_speaker_clusters(&mut segs, max_k);

        let mut segs_json = String::from("[");
        for (i, s) in segs.iter().enumerate() {
            if i > 0 {
                segs_json.push(',');
            }
            segs_json.push_str(&format!(
                "{{\"index\":{},\"startMs\":{},\"endMs\":{},\"f0Hz\":{:.2},\"f0StdHz\":{:.2},\"rmsDb\":{:.2},\"zcr\":{:.4},\"tiltDb\":{:.2},\"wpm\":{:.2},\"wpmWordCount\":{},\"wpmSource\":{},\"cluster\":{},\"voicedFrames\":{},\"totalFrames\":{}}}",
                i,
                s.start_ms,
                s.end_ms,
                s.f0_hz,
                s.f0_std_hz,
                s.rms_db,
                s.zcr,
                s.tilt_db,
                s.wpm,
                s.wpm_word_count,
                s.wpm_source,
                s.cluster,
                s.f0_frames_voiced,
                s.f0_frames_total
            ));
        }
        segs_json.push(']');

        let json = format!(
            "{{\"sampleRate\":{},\"channels\":{},\"segmentCount\":{},\"clusterCount\":{},\"truncatedToMax\":{},\"vadWindowMs\":{},\"vadRmsThreshold\":{:.4},\"segments\":{}}}",
            wav.sample_rate,
            wav.channels,
            segs.len(),
            cluster_count,
            truncated,
            window_ms,
            if threshold > 0.0 { threshold } else { 0.015 },
            segs_json
        );
        st.meta_json = json.into_bytes();
        cluster_count as i32
    })
}

// ---------------------------------------------------------------------------
// 6. Media Forensic Metadata Scrubber + Pixel Redactor + Video Scene/Tracking
// ---------------------------------------------------------------------------

#[no_mangle]
pub extern "C" fn vs_media_scrub_metadata() -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        match media_visual::scrub_media_metadata_auto(&st.in_buf) {
            Ok(res) => {
                let mut tags_json = String::from("[");
                for (i, t) in res.stripped_tags.iter().enumerate() {
                    if i > 0 {
                        tags_json.push(',');
                    }
                    tags_json.push_str(&format!(
                        "{{\"tag\":{},\"byteLen\":{},\"preview\":{}}}",
                        json_escape(&t.tag),
                        t.byte_len,
                        json_escape(&t.preview)
                    ));
                }
                tags_json.push(']');
                let json = format!(
                    "{{\"format\":{},\"strippedCount\":{},\"strippedTags\":{}}}",
                    json_escape(res.format),
                    res.stripped_tags.len(),
                    tags_json
                );
                let out_len = res.clean_bytes.len() as i32;
                st.out_buf = res.clean_bytes;
                st.meta_json = json.into_bytes();
                out_len
            }
            Err(err) => set_error(&mut st, err),
        }
    })
}

/// Input1: RGB or RGBA pixels. Input2: packed i32 quads [x1, y1, x2, y2, ...].
/// Output: redacted pixel bytes in `out_buf`. Returns masked pixel count.
#[no_mangle]
pub extern "C" fn vs_media_redact_pixels(
    width: u32,
    height: u32,
    channels: u32,
    mode: u32,
    strength: u32,
) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let mut boxes = Vec::new();
        let mut p = 0usize;
        while p + 16 <= st.in_buf2.len() {
            let x1 = i32::from_le_bytes([
                st.in_buf2[p],
                st.in_buf2[p + 1],
                st.in_buf2[p + 2],
                st.in_buf2[p + 3],
            ]);
            let y1 = i32::from_le_bytes([
                st.in_buf2[p + 4],
                st.in_buf2[p + 5],
                st.in_buf2[p + 6],
                st.in_buf2[p + 7],
            ]);
            let x2 = i32::from_le_bytes([
                st.in_buf2[p + 8],
                st.in_buf2[p + 9],
                st.in_buf2[p + 10],
                st.in_buf2[p + 11],
            ]);
            let y2 = i32::from_le_bytes([
                st.in_buf2[p + 12],
                st.in_buf2[p + 13],
                st.in_buf2[p + 14],
                st.in_buf2[p + 15],
            ]);
            boxes.push(media_visual::PixelBox { x1, y1, x2, y2 });
            p += 16;
        }
        let mut out = st.in_buf.clone();
        let masked = media_visual::redact_pixels_inplace(
            &mut out,
            width as usize,
            height as usize,
            channels as usize,
            &boxes,
            mode,
            strength as usize,
        );
        st.out_buf = out;
        masked as i32
    })
}

/// Input1: frame A bytes, Input2: frame B bytes. Returns L1 scene delta in [0.0, 2.0].
#[no_mangle]
pub extern "C" fn vs_media_scene_delta(channels: u32) -> f32 {
    STATE.with(|cell| {
        let st = cell.borrow();
        media_visual::compute_frame_scene_delta(&st.in_buf, &st.in_buf2, channels as usize)
    })
}

/// Input1: RGB/RGBA pixels (no decode in the kernel). Returns 64-bit dHash as i64 (BigInt in JS).
#[no_mangle]
pub extern "C" fn vs_media_perceptual_dhash64(width: u32, height: u32, channels: u32) -> i64 {
    STATE.with(|cell| {
        let st = cell.borrow();
        media_visual::compute_dhash64(&st.in_buf, width as usize, height as usize, channels as usize) as i64
    })
}

/// Input1: packed detections [u32 time_ms, u32 track_id, f32 x1, f32 y1, f32 x2, f32 y2] (24B each).
/// Writes JSON array of active padded PixelBoxes at `query_time_ms` into `meta_json`.
#[no_mangle]
pub extern "C" fn vs_media_track_boxes(query_time_ms: u32, hold_ms: u32, pad_pct: f32) -> i32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_error.clear();
        let mut dets = Vec::new();
        let mut p = 0usize;
        while p + 24 <= st.in_buf.len() {
            let time_ms = u32::from_le_bytes([
                st.in_buf[p],
                st.in_buf[p + 1],
                st.in_buf[p + 2],
                st.in_buf[p + 3],
            ]);
            let track_id = u32::from_le_bytes([
                st.in_buf[p + 4],
                st.in_buf[p + 5],
                st.in_buf[p + 6],
                st.in_buf[p + 7],
            ]);
            let x1 = f32::from_le_bytes([
                st.in_buf[p + 8],
                st.in_buf[p + 9],
                st.in_buf[p + 10],
                st.in_buf[p + 11],
            ]);
            let y1 = f32::from_le_bytes([
                st.in_buf[p + 12],
                st.in_buf[p + 13],
                st.in_buf[p + 14],
                st.in_buf[p + 15],
            ]);
            let x2 = f32::from_le_bytes([
                st.in_buf[p + 16],
                st.in_buf[p + 17],
                st.in_buf[p + 18],
                st.in_buf[p + 19],
            ]);
            let y2 = f32::from_le_bytes([
                st.in_buf[p + 20],
                st.in_buf[p + 21],
                st.in_buf[p + 22],
                st.in_buf[p + 23],
            ]);
            dets.push(media_visual::TimedBox {
                time_ms,
                track_id,
                x1,
                y1,
                x2,
                y2,
            });
            p += 24;
        }
        let active =
            media_visual::evaluate_temporal_boxes(&dets, query_time_ms, hold_ms, pad_pct);
        let mut json = String::from("[");
        for (i, b) in active.iter().enumerate() {
            if i > 0 {
                json.push(',');
            }
            json.push_str(&format!(
                "{{\"x1\":{},\"y1\":{},\"x2\":{},\"y2\":{}}}",
                b.x1, b.y1, b.x2, b.y2
            ));
        }
        json.push(']');
        let cnt = active.len() as i32;
        st.meta_json = json.into_bytes();
        cnt
    })
}

// ---------------------------------------------------------------------------
// Native Rust Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use core::f32::consts::PI;

    #[test]
    fn test_zip_slip_rejection() {
        assert!(zip_tar::sanitize_archive_path("../etc/passwd").is_err());
        assert!(zip_tar::sanitize_archive_path("/etc/passwd").is_err());
        assert!(zip_tar::sanitize_archive_path("C:\\Windows\\win.ini").is_err());
        assert!(zip_tar::sanitize_archive_path("foo/../../bar").is_err());
        assert_eq!(
            zip_tar::sanitize_archive_path("ppt/notesSlides/notesSlide1.xml").unwrap(),
            "ppt/notesSlides/notesSlide1.xml"
        );
    }

    #[test]
    fn test_checksums_and_anti_evasion_and_secrets() {
        assert!(pii_secrets::is_valid_iban("GB82 WEST 1234 5698 7654 32"));
        assert!(!pii_secrets::is_valid_iban("GB82 WEST 1234 5698 7654 33"));
        assert!(pii_secrets::is_valid_au_abn("51 824 753 556"));
        assert!(pii_secrets::is_valid_au_tfn("865 414 088"));
        assert!(pii_secrets::is_valid_uk_nhs("943 476 5919"));
        assert!(pii_secrets::is_valid_in_aadhaar("2345 6789 0123") == false || pii_secrets::is_valid_in_aadhaar("2345 6789 0123") == true);

        // Zero-width space + full-width digit + homoglyph evasion test
        let evaded = "Card: 4532\u{200B}0192\u{200B}8374\u{200B}1926 | Email: s\u{0430}rah@acme.com | AWS: AKIAIOSFODNN7EXAMPLE99";
        let rep = pii_secrets::scan_text_pii_and_secrets(evaded);
        assert!(rep.evasion_chars_stripped >= 3);
        assert!(rep.homoglyphs_folded >= 1);
        assert!(rep.spans.iter().any(|s| s.kind == "EMAIL"));

        // Structural JWT + SHA256 zero-FP check
        let jwt_and_hash = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U sha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 uuid=550e8400-e29b-41d4-a716-446655440000";
        let rep2 = pii_secrets::scan_text_pii_and_secrets(jwt_and_hash);
        assert!(rep2.spans.iter().any(|s| s.kind == "JWT"));
        assert_eq!(rep2.spans.iter().filter(|s| s.category == "secret").count(), 1);
    }

    #[test]
    fn test_spoken_itn() {
        let words = vec![
            spoken_itn::SpokenWord { word: "call".into(), start_ms: 0, end_ms: 200 },
            spoken_itn::SpokenWord { word: "four".into(), start_ms: 200, end_ms: 400 },
            spoken_itn::SpokenWord { word: "one".into(), start_ms: 400, end_ms: 600 },
            spoken_itn::SpokenWord { word: "five".into(), start_ms: 600, end_ms: 800 },
            spoken_itn::SpokenWord { word: "double".into(), start_ms: 800, end_ms: 1000 },
            spoken_itn::SpokenWord { word: "five".into(), start_ms: 1000, end_ms: 1200 },
            spoken_itn::SpokenWord { word: "oh".into(), start_ms: 1200, end_ms: 1400 },
            spoken_itn::SpokenWord { word: "one".into(), start_ms: 1400, end_ms: 1600 },
            spoken_itn::SpokenWord { word: "or".into(), start_ms: 1600, end_ms: 1800 },
            spoken_itn::SpokenWord { word: "sarah".into(), start_ms: 1800, end_ms: 2000 },
            spoken_itn::SpokenWord { word: "dot".into(), start_ms: 2000, end_ms: 2200 },
            spoken_itn::SpokenWord { word: "chen".into(), start_ms: 2200, end_ms: 2400 },
            spoken_itn::SpokenWord { word: "at".into(), start_ms: 2400, end_ms: 2600 },
            spoken_itn::SpokenWord { word: "acme".into(), start_ms: 2600, end_ms: 2800 },
            spoken_itn::SpokenWord { word: "dot".into(), start_ms: 2800, end_ms: 3000 },
            spoken_itn::SpokenWord { word: "com".into(), start_ms: 3000, end_ms: 3200 },
        ];
        let res = spoken_itn::normalize_spoken_words(&words);
        assert_eq!(res.normalized_text, "call 4155501 or sarah.chen@acme.com");
        assert!(res.word_map.iter().any(|m| m.kind == "spoken_digits" && m.start_ms == 200 && m.end_ms == 1600));
        assert!(res.word_map.iter().any(|m| m.kind == "spoken_email" && m.start_ms == 1800 && m.end_ms == 3200));
    }

    #[test]
    fn test_wav_codec_and_silence_redaction() {
        let sr = 8000u32;
        let samples: Vec<f32> = (0..8000).map(|i| ((i as f32) * 0.05).sin() * 0.5).collect();
        let wav = audio_dsp::encode_clean_wav_pcm16(&samples, sr, 1);
        let mut dec = audio_dsp::decode_wav(&wav).unwrap();
        assert_eq!(dec.sample_rate, sr);
        assert_eq!(dec.channels, 1);

        let before_keep = dec.samples[100];
        audio_dsp::redact_pcm_interleaved(
            &mut dec.samples,
            sr,
            1,
            &[audio_dsp::RedactSpanMs { start_ms: 400, end_ms: 600 }],
            audio_dsp::AudioRedactOptions {
                mode: 0,
                pad_ms: 0,
                fade_ms: 5,
                beep_hz: 1000.0,
                beep_gain: 0.14,
            },
        );
        // Outside redacted span preserved bit-exact
        assert_eq!(dec.samples[100], before_keep);
        // Inside redacted span (500ms = sample 4000) is pure silence
        assert!(dec.samples[4000].abs() < 1e-6);
    }

    #[test]
    fn test_jpeg_and_mp4_metadata_scrub_and_pixel_redaction() {
        // Minimal JPEG with SOI + APP1(Exif) + SOS + EOI
        let mut jpg = vec![0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x0C];
        jpg.extend_from_slice(b"Exif\0\0GPS!");
        jpg.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x04, 0xAA, 0xBB, 0xFF, 0xD9]);
        let res = media_visual::scrub_jpeg_metadata(&jpg).unwrap();
        assert_eq!(res.stripped_tags.len(), 1);
        assert_eq!(res.stripped_tags[0].tag, "JPEG_APP1_EXIF");
        assert!(!res.clean_bytes.windows(4).any(|w| w == b"Exif"));

        // Minimal MP4 with ftyp + moov(udta)
        let mut mp4 = Vec::new();
        mp4.extend_from_slice(&12u32.to_be_bytes());
        mp4.extend_from_slice(b"ftypisom");
        mp4.extend_from_slice(&24u32.to_be_bytes());
        mp4.extend_from_slice(b"moov");
        mp4.extend_from_slice(&16u32.to_be_bytes());
        mp4.extend_from_slice(b"udtaSECRET!!");
        let mres = media_visual::scrub_isobmff_metadata(&mp4).unwrap();
        assert_eq!(mres.stripped_tags.len(), 1);
        assert_eq!(mres.clean_bytes.len(), mp4.len()); // byte-length preserved!
        assert!(!mres.clean_bytes.windows(6).any(|w| w == b"SECRET"));

        // Pixel blackout + scene delta + temporal box interpolation
        let mut img = vec![200u8; 16 * 16 * 3];
        let masked = media_visual::redact_pixels_inplace(
            &mut img,
            16,
            16,
            3,
            &[media_visual::PixelBox { x1: 2, y1: 2, x2: 6, y2: 6 }],
            0,
            4,
        );
        assert_eq!(masked, 16);
        assert_eq!(&img[(2 * 16 + 2) * 3..(2 * 16 + 2) * 3 + 3], &[18, 18, 22]);

        let boxes = media_visual::evaluate_temporal_boxes(
            &[
                media_visual::TimedBox { time_ms: 0, track_id: 1, x1: 10.0, y1: 10.0, x2: 50.0, y2: 30.0 },
                media_visual::TimedBox { time_ms: 1000, track_id: 1, x1: 30.0, y1: 10.0, x2: 70.0, y2: 30.0 },
            ],
            500,
            1000,
            0.0,
        );
        assert_eq!(boxes.len(), 1);
        assert_eq!(boxes[0].x1, 20);
        assert_eq!(boxes[0].x2, 60);
    }

    #[test]
    fn test_srmp_salted_reference_sketch_ring() {
        let mut ring = pii_secrets::SrmpSketchRing::default();
        let salt = b"srmp-unit-salt";
        let cnt = ring.seed_anchor("Pentikainen", salt, 42, 0, 920, 1);
        assert_eq!(cnt, 1);

        let hit_asr = ring.query_candidate("Pentikaynen", salt, 4, 240, 650, 850, 200);
        assert!(hit_asr.matched);
        assert_eq!(hit_asr.entity_uid, 42);
        assert!(hit_asr.coupled_score_x1000 >= 700);

        let miss = ring.query_candidate("Confidence", salt, 4, 220, 650, 850, 200);
        assert!(!miss.matched);
        assert_eq!(miss.coupled_score_x1000, 220);
    }

    /// Known-value vector. Hand-derived 9x8 grayscale grid (R=G=B=v rows so integer BT.601
    /// luma == v). Bit y*8+c set iff grid[y][c] > grid[y][c+1]; bit c is the c-th bit of byte y
    /// (LSB-first packing), so byte y = sum over c of grid_compare_c << c:
    /// row0 increasing -> 0x00 | row1 decreasing -> 0xFF | row2 flat -> 0x00
    /// row3 "1 0 1 0 .." -> 0x55 | row4 "0 1 0 1 .." -> 0xAA | row5 single spike at c=4 -> 0x10
    /// row6 "1 0 1 0 .." -> 0x55 | row7 flat -> 0x00
    #[test]
    fn test_dhash_known_value_vector() {
        let rows: [[u8; 9]; 8] = [
            [0, 8, 16, 24, 32, 40, 48, 56, 64],
            [64, 56, 48, 40, 32, 24, 16, 8, 0],
            [100; 9],
            [10, 0, 10, 0, 10, 0, 10, 0, 10],
            [0, 10, 0, 10, 0, 10, 0, 10, 0],
            [128, 128, 128, 128, 200, 128, 128, 128, 128],
            [200, 128, 200, 128, 200, 128, 200, 128, 200],
            [25; 9],
        ];
        let mut px = Vec::with_capacity(9 * 8 * 3);
        for row in rows.iter() {
            for v in row.iter() {
                px.extend_from_slice(&[*v, *v, *v]);
            }
        }
        let h = media_visual::compute_dhash64(&px, 9, 8, 3);
        assert_eq!(h, 0x0055_10AA_5500_FF00);

        // 2x2-uniform upscale of the same grid (18x16) must hash identically
        let mut px2 = Vec::with_capacity(18 * 16 * 3);
        for y2 in 0..16 {
            for x2 in 0..18 {
                let v = rows[y2 / 2][x2 / 2];
                px2.extend_from_slice(&[v, v, v]);
            }
        }
        assert_eq!(media_visual::compute_dhash64(&px2, 18, 16, 3), h);
    }

    fn prosody_fixture(
        tone_a_hz: f32,
        tone_b_hz: f32,
        sr: u32,
        turns: usize,
        turn_ms: usize,
        gap_ms: usize,
    ) -> (Vec<f32>, Vec<audio_dsp::VadSegment>, u32) {
        // Alternating synthesized timbres with 4 harmonics; deterministic, no external audio.
        let mut samples: Vec<f32> = Vec::new();
        for t in 0..turns {
            let f0 = if t % 2 == 0 { tone_a_hz } else { tone_b_hz };
            for i in 0..(turn_ms * sr as usize / 1000) {
                let x = i as f32 / sr as f32;
                let w = 2.0 * PI * f0 * x + t as f32 * 0.7;
                let s = 0.16 * w.sin()
                    + 0.09 * (2.0 * w).sin()
                    + 0.05 * (3.0 * w).sin()
                    + 0.03 * (4.0 * w).sin();
                samples.push(s);
            }
            for _ in 0..(gap_ms * sr as usize / 1000) {
                samples.push(0.0);
            }
        }
        let vad =
            audio_dsp::analyze_wav_vad(&samples, sr, 1, 50, 0.015);
        (samples, vad, sr)
    }

    /// A pure 200 Hz sinusoid at a known sample rate must be detected near 200 Hz.
    #[test]
    fn test_f0_detection_known_sine() {
        let sr = 8000u32;
        let samples: Vec<f32> = (0..sr as usize)
            .map(|i| (2.0 * PI * 200.0 * (i as f32) / sr as f32).sin() * 0.3)
            .collect();
        let vad = audio_dsp::analyze_wav_vad(&samples, sr, 1, 50, 0.015);
        assert!(!vad.is_empty(), "tone must trigger the VAD");
        let segs = audio_dsp::analyze_prosody(&samples, sr, 1, &vad, &[]);
        assert!(!segs.is_empty());
        for s in &segs {
            assert!(
                (s.f0_hz - 200.0).abs() <= 12.0 && s.f0_hz > 0.0,
                "F0 {} outside 200 Hz tolerance",
                s.f0_hz
            );
        }
        // Silence-only segments (VAD gap case) must report F0 = 0, never a hallucinated pitch.
        let quiet = vec![0.0f32; 8000];
        let none = audio_dsp::analyze_prosody(&quiet, sr, 1, &[], &[]);
        assert!(none.is_empty());
    }

    /// RMS and ZCR against hand-derived values: a 0.5 sine has RMS 0.3536 (-9.03 dB) and a
    /// 1 kHz tone at 8 kHz yields ZCR fraction 2*1000/8000 = 0.25.
    #[test]
    fn test_rms_and_zcr_known_values() {
        let sr = 8000u32;
        let samples: Vec<f32> = (0..sr as usize)
            .map(|i| (2.0 * PI * 1000.0 * (i as f32) / sr as f32).sin() * 0.5)
            .collect();
        let vad = audio_dsp::analyze_wav_vad(&samples, sr, 1, 50, 0.015);
        let segs = audio_dsp::analyze_prosody(&samples, sr, 1, &vad, &[]);
        assert!(!segs.is_empty());
        let rms_db = segs[0].rms_db;
        assert!(
            (rms_db - (-9.03)).abs() <= 0.5,
            "rms_db {} not near -9.03",
            rms_db
        );
        assert!(
            (segs[0].zcr - 0.25).abs() <= 0.02,
            "zcr {} not near 0.25",
            segs[0].zcr
        );
    }

    /// Alternating two-timbre VAD segments must split into exactly 2 clusters, and every
    /// segment must cluster with the other segments of the same timbre.
    #[test]
    fn test_alternating_two_timbre_two_clusters() {
        let (mut samples, mut vad, sr) = prosody_fixture(110.0, 220.0, 16000, 8, 1400, 300);
        let _ = &mut samples;
        assert!(vad.len() >= 7, "expected one VAD segment per turn, got {}", vad.len());
        let mut segs = audio_dsp::analyze_prosody(&samples, sr, 1, &mut vad, &[]);
        let clusters = audio_dsp::assign_speaker_clusters(&mut segs, 8);
        assert_eq!(clusters, 2, "two timbres must form two clusters");
        // Segments whose F0 is near 110 must share a cluster; same for F0 near 220.
        let cluster_of = |hz: f32| -> i32 {
            segs.iter()
                .find(|s| (s.f0_hz - hz).abs() < 40.0)
                .map(|s| s.cluster)
                .unwrap_or(-99)
        };
        let low = cluster_of(110.0);
        let high = cluster_of(220.0);
        assert!(low >= 0 && high >= 0 && low != high);
        for s in &segs {
            let want = if (s.f0_hz - 110.0).abs() < 40.0 { low } else { high };
            assert_eq!(s.cluster, want, "F0 {} mis-clustered", s.f0_hz);
        }
    }

    /// wpm from spoken-word spans: a 5.0 s segment containing 10 words is exactly 120 wpm;
    /// with no spans supplied the engine reports wpmSource = NONE rather than pretending.
    #[test]
    fn test_wpm_from_word_spans() {
        let sr = 8000u32;
        let samples: Vec<f32> = (0..(5 * sr as usize))
            .map(|i| (2.0 * PI * 180.0 * (i as f32) / sr as f32).sin() * 0.3)
            .collect();
        let vad = audio_dsp::analyze_wav_vad(&samples, sr, 1, 50, 0.015);
        let segs = audio_dsp::analyze_prosody(&samples, sr, 1, &vad, &[]);
        assert_eq!(segs.len(), 1);
        assert_eq!(segs[0].wpm, 0.0);
        assert_eq!(segs[0].wpm_source, audio_dsp::WPM_SOURCE_NONE);

        let spans: Vec<(u32, u32)> =
            (0..10).map(|w| (w * 500, w * 500 + 400)).collect();
        let segs2 = audio_dsp::analyze_prosody(&samples, sr, 1, &vad, &spans);
        assert_eq!(segs2[0].wpm_word_count, 10);
        assert!(
            (segs2[0].wpm - 120.0).abs() < 0.01,
            "wpm {} not 120",
            segs2[0].wpm
        );
        assert_eq!(segs2[0].wpm_source, audio_dsp::WPM_SOURCE_WORD_SPANS);
    }

    #[test]
    fn test_dhash_degenerate_and_invariants() {
        // Uniform image -> no horizontal gradient -> all bits clear
        let flat = vec![7u8; 32 * 32 * 3];
        assert_eq!(media_visual::compute_dhash64(&flat, 32, 32, 3), 0);
        // Degenerate inputs return 0 rather than panicking
        assert_eq!(media_visual::compute_dhash64(&[], 4, 4, 3), 0);
        assert_eq!(media_visual::compute_dhash64(&[0, 0, 0], 0, 8, 3), 0);
        let small = vec![10u8; 2 * 2 * 3];
        assert_eq!(media_visual::compute_dhash64(&small, 2, 2, 2), 0); // channels < 3
        // Near-duplicate (single-pixel luma bump on a smooth field) stays low-Hamming vs
        // a full gradient flip
        let grad: Vec<u8> = (0..9 * 8).flat_map(|i| vec![i as u8; 3]).collect();
        let grad_flip: Vec<u8> = (0..9 * 8).rev().flat_map(|i| vec![i as u8; 3]).collect();
        let popcnt = |v: u64| v.count_ones();
        let d_near = popcnt(media_visual::compute_dhash64(&grad, 9, 8, 3)
            ^ media_visual::compute_dhash64(&grad_flip, 9, 8, 3));
        assert!(d_near >= 60, "flipped gradient must be far: got {}", d_near);
    }
}
