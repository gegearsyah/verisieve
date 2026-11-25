//! Pure-Rust Binary Media Forensic Metadata Scrubbers (JPEG / PNG / ISOBMFF MP4-MOV),
//! Fast RGB/RGBA Pixel Redactor (blackout / pixelate / separable Gaussian blur),
//! Video 64-bin RGB Histogram Scene-Change Detector, and Temporal Box Tracker.

#[derive(Clone, Debug)]
pub struct ScrubbedTag {
    pub tag: String,
    pub byte_len: usize,
    pub preview: String,
}

#[derive(Clone, Debug)]
pub struct MediaScrubResult {
    pub format: &'static str,
    pub clean_bytes: Vec<u8>,
    pub stripped_tags: Vec<ScrubbedTag>,
}

fn safe_preview(bytes: &[u8]) -> String {
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

/// Scrub JPEG metadata markers: strips APP1 (EXIF/GPS/XMP), APP13 (IPTC), COM, APP12.
/// Preserves SOI, APP0 (JFIF), APP2 (ICC color profile), quantization/Huffman tables, and SOS scan data.
pub fn scrub_jpeg_metadata(data: &[u8]) -> Result<MediaScrubResult, &'static str> {
    if data.len() < 4 || data[0] != 0xFF || data[1] != 0xD8 {
        return Err("JPEG_INVALID_HEADER");
    }
    let mut out = Vec::with_capacity(data.len());
    let mut stripped = Vec::new();
    out.extend_from_slice(&data[0..2]); // SOI
    let mut pos = 2usize;

    while pos + 2 <= data.len() {
        if data[pos] != 0xFF {
            out.extend_from_slice(&data[pos..]);
            break;
        }
        while pos < data.len() && data[pos] == 0xFF {
            pos += 1;
        }
        if pos >= data.len() {
            break;
        }
        let marker = data[pos];
        pos += 1;

        // EOI or standalone markers
        if marker == 0xD9 {
            out.push(0xFF);
            out.push(0xD9);
            break;
        }
        if (0xD0..=0xD8).contains(&marker) || marker == 0x01 {
            out.push(0xFF);
            out.push(marker);
            continue;
        }
        if pos + 2 > data.len() {
            return Err("JPEG_TRUNCATED_SEGMENT");
        }
        let seg_len = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
        if seg_len < 2 || pos + seg_len > data.len() {
            return Err("JPEG_CORRUPT_SEGMENT");
        }
        let payload = &data[pos + 2..pos + seg_len];

        // SOS (0xDA): copy header + rest of entropy-coded bitstream verbatim
        if marker == 0xDA {
            out.push(0xFF);
            out.push(marker);
            out.extend_from_slice(&data[pos..]);
            break;
        }

        let is_sensitive = matches!(marker, 0xE1 | 0xEC | 0xED | 0xFE);
        if is_sensitive {
            let label = match marker {
                0xE1 => {
                    if payload.starts_with(b"Exif") {
                        "JPEG_APP1_EXIF"
                    } else if payload.starts_with(b"http://ns.adobe.com/xap/") {
                        "JPEG_APP1_XMP"
                    } else {
                        "JPEG_APP1"
                    }
                }
                0xED => "JPEG_APP13_IPTC",
                0xFE => "JPEG_COM",
                _ => "JPEG_APP12",
            };
            stripped.push(ScrubbedTag {
                tag: label.to_string(),
                byte_len: payload.len(),
                preview: safe_preview(payload),
            });
        } else {
            out.push(0xFF);
            out.push(marker);
            out.extend_from_slice(&data[pos..pos + seg_len]);
        }

        pos += seg_len;
    }

    Ok(MediaScrubResult {
        format: "jpeg",
        clean_bytes: out,
        stripped_tags: stripped,
    })
}

/// Scrub PNG metadata chunks: strips tEXt, iTXt, zTXt, eXIf, tIME, dSIG.
pub fn scrub_png_metadata(data: &[u8]) -> Result<MediaScrubResult, &'static str> {
    const PNG_SIG: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if data.len() < 8 || data[0..8] != PNG_SIG {
        return Err("PNG_INVALID_HEADER");
    }
    let mut out = Vec::with_capacity(data.len());
    let mut stripped = Vec::new();
    out.extend_from_slice(&PNG_SIG);
    let mut pos = 8usize;

    while pos + 12 <= data.len() {
        let len = u32::from_be_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]])
            as usize;
        let ctype = &data[pos + 4..pos + 8];
        let total = 12usize.saturating_add(len);
        if pos + total > data.len() {
            return Err("PNG_TRUNCATED_CHUNK");
        }
        let body = &data[pos + 8..pos + 8 + len];

        let is_sensitive = matches!(
            ctype,
            b"tEXt" | b"iTXt" | b"zTXt" | b"eXIf" | b"tIME" | b"dSIG"
        );
        if is_sensitive {
            stripped.push(ScrubbedTag {
                tag: format!("PNG_{}", String::from_utf8_lossy(ctype)),
                byte_len: len,
                preview: safe_preview(body),
            });
        } else {
            out.extend_from_slice(&data[pos..pos + total]);
        }
        pos += total;
        if ctype == b"IEND" {
            break;
        }
    }

    Ok(MediaScrubResult {
        format: "png",
        clean_bytes: out,
        stripped_tags: stripped,
    })
}

/// Scrub ISOBMFF (`.mp4` / `.mov`) metadata boxes (`udta`, `meta`, `©xyz`, `XMP_`) in-place
/// by converting them to zeroed `free` atoms so `stco`/`co64` chunk offsets NEVER shift or corrupt!
pub fn scrub_isobmff_metadata(data: &[u8]) -> Result<MediaScrubResult, &'static str> {
    if data.len() < 12 {
        return Err("MP4_INVALID_HEADER");
    }
    let mut out = data.to_vec();
    let mut stripped = Vec::new();
    scrub_isobmff_range(&mut out, 0, data.len(), 0, &mut stripped);

    Ok(MediaScrubResult {
        format: "mp4",
        clean_bytes: out,
        stripped_tags: stripped,
    })
}

fn scrub_isobmff_range(
    buf: &mut [u8],
    start: usize,
    end: usize,
    depth: usize,
    stripped: &mut Vec<ScrubbedTag>,
) {
    if depth > 6 || start + 8 > end {
        return;
    }
    let mut pos = start;
    while pos + 8 <= end {
        let size32 = u32::from_be_bytes([buf[pos], buf[pos + 1], buf[pos + 2], buf[pos + 3]])
            as usize;
        let btype = [buf[pos + 4], buf[pos + 5], buf[pos + 6], buf[pos + 7]];
        let (box_size, header_len) = if size32 == 0 {
            (end - pos, 8)
        } else if size32 == 1 {
            if pos + 16 > end {
                break;
            }
            let sz64 = u64::from_be_bytes([
                buf[pos + 8],
                buf[pos + 9],
                buf[pos + 10],
                buf[pos + 11],
                buf[pos + 12],
                buf[pos + 13],
                buf[pos + 14],
                buf[pos + 15],
            ]) as usize;
            (sz64, 16)
        } else {
            (size32, 8)
        };

        if box_size < header_len || pos + box_size > end {
            break;
        }
        let body_start = pos + header_len;
        let box_end = pos + box_size;

        if matches!(
            &btype,
            b"udta" | b"meta" | b"uuid" | b"beam" | b"XMP_" | b"\xa9xyz" | b"\xa9nam" | b"\xa9too" | b"\xa9cmt"
        ) {
            let tag = format!("MP4_{}", String::from_utf8_lossy(&btype));
            stripped.push(ScrubbedTag {
                tag,
                byte_len: box_end - body_start,
                preview: safe_preview(&buf[body_start..box_end]),
            });
            // Neutralize in-place as `free` atom so absolute chunk offsets stay 100% valid
            buf[pos + 4..pos + 8].copy_from_slice(b"free");
            for byte in &mut buf[body_start..box_end] {
                *byte = 0;
            }
        } else if matches!(&btype, b"moov" | b"trak" | b"mdia" | b"edts" | b"moof") {
            scrub_isobmff_range(buf, body_start, box_end, depth + 1, stripped);
        }

        pos = box_end;
    }
}

/// Auto-detect binary image/video format by magic bytes and scrub metadata.
pub fn scrub_media_metadata_auto(data: &[u8]) -> Result<MediaScrubResult, &'static str> {
    if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
        return scrub_jpeg_metadata(data);
    }
    if data.len() >= 8 && data[0..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A] {
        return scrub_png_metadata(data);
    }
    if data.len() >= 12 && (&data[4..8] == b"ftyp" || &data[4..8] == b"moov" || &data[4..8] == b"wide") {
        return scrub_isobmff_metadata(data);
    }
    Err("MEDIA_FORMAT_UNSUPPORTED")
}

// ---------------------------------------------------------------------------
// Fast RGB / RGBA Pixel Redaction (Blackout / Pixelate / Box-Gaussian Blur)
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
pub struct PixelBox {
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
}

/// Apply pixel redaction to RGB (channels=3) or RGBA (channels=4) framebuffer in-place.
/// mode: 0 = Versieve dark blackout [18,18,22], 1 = pixelation mosaic, 2 = 3-pass separable blur.
pub fn redact_pixels_inplace(
    pixels: &mut [u8],
    width: usize,
    height: usize,
    channels: usize,
    boxes: &[PixelBox],
    mode: u32,
    strength: usize,
) -> usize {
    if width == 0 || height == 0 || (channels != 3 && channels != 4) {
        return 0;
    }
    if pixels.len() < width * height * channels {
        return 0;
    }

    let mut masked_pixels = 0usize;
    let block_sz = strength.clamp(4, 48);
    let radius = strength.clamp(2, 24);

    for b in boxes {
        let x1 = b.x1.clamp(0, width as i32) as usize;
        let y1 = b.y1.clamp(0, height as i32) as usize;
        let x2 = b.x2.clamp(0, width as i32) as usize;
        let y2 = b.y2.clamp(0, height as i32) as usize;
        if x2 <= x1 || y2 <= y1 {
            continue;
        }
        masked_pixels += (x2 - x1) * (y2 - y1);

        match mode {
            0 => {
                // Solid Versieve blackout [18, 18, 22]
                for y in y1..y2 {
                    for x in x1..x2 {
                        let off = (y * width + x) * channels;
                        pixels[off] = 18;
                        pixels[off + 1] = 18;
                        pixels[off + 2] = 22;
                        if channels == 4 {
                            pixels[off + 3] = 255;
                        }
                    }
                }
            }
            1 => {
                // Block mosaic pixelation
                let mut by = y1;
                while by < y2 {
                    let by_end = (by + block_sz).min(y2);
                    let mut bx = x1;
                    while bx < x2 {
                        let bx_end = (bx + block_sz).min(x2);
                        let mut sum = [0u32; 3];
                        let mut cnt = 0u32;
                        for y in by..by_end {
                            for x in bx..bx_end {
                                let off = (y * width + x) * channels;
                                sum[0] += pixels[off] as u32;
                                sum[1] += pixels[off + 1] as u32;
                                sum[2] += pixels[off + 2] as u32;
                                cnt += 1;
                            }
                        }
                        if cnt > 0 {
                            let avg = [
                                (sum[0] / cnt) as u8,
                                (sum[1] / cnt) as u8,
                                (sum[2] / cnt) as u8,
                            ];
                            for y in by..by_end {
                                for x in bx..bx_end {
                                    let off = (y * width + x) * channels;
                                    pixels[off] = avg[0];
                                    pixels[off + 1] = avg[1];
                                    pixels[off + 2] = avg[2];
                                }
                            }
                        }
                        bx = bx_end;
                    }
                    by = by_end;
                }
            }
            _ => {
                // 3-pass separable box blur (tight Gaussian approximation) strictly inside ROI
                let rw = x2 - x1;
                let rh = y2 - y1;
                let mut tmp = vec![0u8; rw * rh * 3];
                let mut cur = vec![0u8; rw * rh * 3];
                for y in 0..rh {
                    for x in 0..rw {
                        let src = ((y1 + y) * width + (x1 + x)) * channels;
                        let dst = (y * rw + x) * 3;
                        cur[dst] = pixels[src];
                        cur[dst + 1] = pixels[src + 1];
                        cur[dst + 2] = pixels[src + 2];
                    }
                }
                for _pass in 0..3 {
                    // Horizontal
                    for y in 0..rh {
                        for x in 0..rw {
                            let lx = x.saturating_sub(radius);
                            let rx = (x + radius).min(rw - 1);
                            let cnt = (rx - lx + 1) as u32;
                            let mut s = [0u32; 3];
                            for k in lx..=rx {
                                let p = (y * rw + k) * 3;
                                s[0] += cur[p] as u32;
                                s[1] += cur[p + 1] as u32;
                                s[2] += cur[p + 2] as u32;
                            }
                            let dst = (y * rw + x) * 3;
                            tmp[dst] = (s[0] / cnt) as u8;
                            tmp[dst + 1] = (s[1] / cnt) as u8;
                            tmp[dst + 2] = (s[2] / cnt) as u8;
                        }
                    }
                    // Vertical
                    for y in 0..rh {
                        let ty = y.saturating_sub(radius);
                        let by = (y + radius).min(rh - 1);
                        let cnt = (by - ty + 1) as u32;
                        for x in 0..rw {
                            let mut s = [0u32; 3];
                            for k in ty..=by {
                                let p = (k * rw + x) * 3;
                                s[0] += tmp[p] as u32;
                                s[1] += tmp[p + 1] as u32;
                                s[2] += tmp[p + 2] as u32;
                            }
                            let dst = (y * rw + x) * 3;
                            cur[dst] = (s[0] / cnt) as u8;
                            cur[dst + 1] = (s[1] / cnt) as u8;
                            cur[dst + 2] = (s[2] / cnt) as u8;
                        }
                    }
                }
                for y in 0..rh {
                    for x in 0..rw {
                        let dst = ((y1 + y) * width + (x1 + x)) * channels;
                        let src = (y * rw + x) * 3;
                        pixels[dst] = cur[src];
                        pixels[dst + 1] = cur[src + 1];
                        pixels[dst + 2] = cur[src + 2];
                    }
                }
            }
        }
    }

    masked_pixels
}

// ---------------------------------------------------------------------------
// Video Scene-Change Histogram L1 Delta & Temporal Box Hold/Interpolation
// ---------------------------------------------------------------------------

/// Compute 64-bin RGB (4x4x4) normalized histogram L1 delta in [0.0, 2.0].
/// Typical slide/screen-share scene cut threshold: > 0.12.
pub fn compute_frame_scene_delta(frame_a: &[u8], frame_b: &[u8], channels: usize) -> f32 {
    if (channels != 3 && channels != 4) || frame_a.len() < channels || frame_b.len() < channels {
        return 0.0;
    }
    let mut ha = [0u32; 64];
    let mut hb = [0u32; 64];
    let n_a = frame_a.len() / channels;
    let n_b = frame_b.len() / channels;
    // Subsample stride for ultra-fast 1080p/4K frame comparison
    let step_a = (n_a / 16_384).max(1);
    let step_b = (n_b / 16_384).max(1);
    let mut ca = 0u32;
    let mut cb = 0u32;

    let mut i = 0;
    while i < n_a {
        let off = i * channels;
        let bin = (((frame_a[off] >> 6) as usize) << 4)
            | (((frame_a[off + 1] >> 6) as usize) << 2)
            | ((frame_a[off + 2] >> 6) as usize);
        ha[bin] += 1;
        ca += 1;
        i += step_a;
    }
    let mut j = 0;
    while j < n_b {
        let off = j * channels;
        let bin = (((frame_b[off] >> 6) as usize) << 4)
            | (((frame_b[off + 1] >> 6) as usize) << 2)
            | ((frame_b[off + 2] >> 6) as usize);
        hb[bin] += 1;
        cb += 1;
        j += step_b;
    }
    if ca == 0 || cb == 0 {
        return 0.0;
    }
    let fa = ca as f32;
    let fb = cb as f32;
    let mut l1 = 0.0f32;
    for k in 0..64 {
        l1 += ((ha[k] as f32) / fa - (hb[k] as f32) / fb).abs();
    }
    l1
}

/// 64-bit difference hash (dHash) over caller-supplied RGB/RGBA bytes (no decode in the kernel —
/// PNG/JPEG decode stays in JS). Samples a 9x8 luma grid nearest-neighbor (BT.601 luma, integer),
/// then sets bit `y*8 + c` iff grid[y][c] > grid[y][c+1] (row y, columns c..c+1).
/// Returns 0 on empty/degenerate input; near-duplicate frames yield low Hamming distance.
pub fn compute_dhash64(pixels: &[u8], width: usize, height: usize, channels: usize) -> u64 {
    if width == 0 || height == 0 || channels < 3 {
        return 0;
    }
    let min_len = width * height * channels;
    if pixels.len() < min_len {
        return 0;
    }
    let mut grid = [0u8; 72];
    for gy in 0..8 {
        let sy = gy * height / 8;
        for gx in 0..9 {
            let sx = gx * width / 9;
            let off = (sy * width + sx) * channels;
            // BT.601 luma, integer (77+150+29 = 256): exact for R=G=B
            grid[gy * 9 + gx] =
                (((pixels[off] as u32) * 77 + (pixels[off + 1] as u32) * 150 + (pixels[off + 2] as u32) * 29) >> 8) as u8;
        }
    }
    let mut hash: u64 = 0;
    for y in 0..8 {
        for c in 0..8 {
            if grid[y * 9 + c] > grid[y * 9 + c + 1] {
                hash |= 1u64 << (y * 8 + c);
            }
        }
    }
    hash
}

#[derive(Clone, Copy, Debug)]
pub struct TimedBox {
    pub time_ms: u32,
    pub track_id: u32,
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
}

/// Evaluate active padded & temporally interpolated bounding boxes at `query_time_ms`.
/// Prevents 1-frame privacy flicker by holding boxes within `hold_ms` and linearly interpolating
/// between consecutive detections sharing the same `track_id`.
pub fn evaluate_temporal_boxes(
    detections: &[TimedBox],
    query_time_ms: u32,
    hold_ms: u32,
    pad_pct: f32,
) -> Vec<PixelBox> {
    // Group indices by track_id
    let mut track_ids: Vec<u32> = detections.iter().map(|d| d.track_id).collect();
    track_ids.sort_unstable();
    track_ids.dedup();

    let expand = |x1: f32, y1: f32, x2: f32, y2: f32| -> PixelBox {
        let w = (x2 - x1).max(1.0);
        let h = (y2 - y1).max(1.0);
        let px = w * pad_pct;
        let py = h * pad_pct;
        PixelBox {
            x1: (x1 - px).floor() as i32,
            y1: (y1 - py).floor() as i32,
            x2: (x2 + px).ceil() as i32,
            y2: (y2 + py).ceil() as i32,
        }
    };

    let mut out = Vec::new();
    for tid in track_ids {
        let mut prev: Option<TimedBox> = None;
        let mut next: Option<TimedBox> = None;
        for &d in detections {
            if d.track_id != tid {
                continue;
            }
            if d.time_ms <= query_time_ms {
                if prev.map_or(true, |p| d.time_ms >= p.time_ms) {
                    prev = Some(d);
                }
            }
            if d.time_ms >= query_time_ms {
                if next.map_or(true, |n| d.time_ms <= n.time_ms) {
                    next = Some(d);
                }
            }
        }

        match (prev, next) {
            (Some(p), Some(n)) if p.time_ms == n.time_ms => {
                out.push(expand(p.x1, p.y1, p.x2, p.y2));
            }
            (Some(p), Some(n)) if n.time_ms - p.time_ms <= hold_ms.saturating_mul(2) => {
                let alpha =
                    (query_time_ms - p.time_ms) as f32 / (n.time_ms - p.time_ms).max(1) as f32;
                let lerp = |a: f32, b: f32| a + (b - a) * alpha;
                out.push(expand(
                    lerp(p.x1, n.x1),
                    lerp(p.y1, n.y1),
                    lerp(p.x2, n.x2),
                    lerp(p.y2, n.y2),
                ));
            }
            (Some(p), _) if query_time_ms - p.time_ms <= hold_ms => {
                out.push(expand(p.x1, p.y1, p.x2, p.y2));
            }
            (_, Some(n)) if n.time_ms - query_time_ms <= hold_ms => {
                out.push(expand(n.x1, n.y1, n.x2, n.y2));
            }
            _ => {}
        }
    }

    out
}
