#![cfg_attr(not(test), no_std)]

const INPUT_CAP: usize = 524_288; // 512 KiB
const OUTPUT_CAP: usize = 524_288; // 512 KiB
const MAX_SPANS: usize = 4_096;
const MINHASH_LANES: usize = 64;
const MAX_DEDUP_SLOTS: usize = 2_048;

const FLAG_HTML: u32 = 1;
const FLAG_CHROME: u32 = 2;
const FLAG_AUTO_HTML: u32 = 4;

static mut IN_BUF: [u8; INPUT_CAP] = [0; INPUT_CAP];
static mut OUT_BUF: [u8; OUTPUT_CAP] = [0; OUTPUT_CAP];
// Triplets: [start_byte, end_byte, token_count]
static mut SPANS_BUF: [u32; MAX_SPANS * 3] = [0; MAX_SPANS * 3];

static mut DEDUP_HASHES: [u64; MAX_DEDUP_SLOTS] = [0; MAX_DEDUP_SLOTS];
static mut DEDUP_SIGS: [[u32; MINHASH_LANES]; MAX_DEDUP_SLOTS] = [[0; MINHASH_LANES]; MAX_DEDUP_SLOTS];
static mut DEDUP_COUNT: usize = 0;
static mut LAST_SIM_X1000: u32 = 0;
static mut LAST_MATCH_IDX: i32 = -1;

// Temporary word table for chunking (up to 32768 words per single input call)
const MAX_WORDS: usize = 32_768;
static mut WORD_STARTS: [u32; MAX_WORDS] = [0; MAX_WORDS];
static mut WORD_ENDS: [u32; MAX_WORDS] = [0; MAX_WORDS];
static mut WORD_COSTS: [u32; MAX_WORDS] = [0; MAX_WORDS];

// Scratch normalized byte buffer for MinHash / chrome line check
static mut NORM_BUF: [u8; INPUT_CAP] = [0; INPUT_CAP];

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[no_mangle]
pub extern "C" fn vs_clean_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn vs_clean_in_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(IN_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn vs_clean_out_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(OUT_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn vs_clean_spans_ptr() -> *mut u32 {
    core::ptr::addr_of_mut!(SPANS_BUF) as *mut u32
}

#[no_mangle]
pub extern "C" fn vs_clean_in_cap() -> u32 {
    INPUT_CAP as u32
}

#[no_mangle]
pub extern "C" fn vs_clean_out_cap() -> u32 {
    OUTPUT_CAP as u32
}

#[no_mangle]
pub extern "C" fn vs_clean_max_spans() -> u32 {
    MAX_SPANS as u32
}

#[no_mangle]
pub extern "C" fn vs_clean_last_sim_x1000() -> u32 {
    unsafe { LAST_SIM_X1000 }
}

#[no_mangle]
pub extern "C" fn vs_clean_last_match_idx() -> i32 {
    unsafe { LAST_MATCH_IDX }
}

#[no_mangle]
pub extern "C" fn vs_clean_dedup_count() -> u32 {
    unsafe { DEDUP_COUNT as u32 }
}

#[no_mangle]
pub extern "C" fn vs_clean_dedup_reset() {
    unsafe {
        DEDUP_COUNT = 0;
        LAST_SIM_X1000 = 0;
        LAST_MATCH_IDX = -1;
    }
}

#[inline]
fn to_lower_ascii(b: u8) -> u8 {
    if b >= b'A' && b <= b'Z' {
        b + 32
    } else {
        b
    }
}

#[inline]
fn is_ascii_ws(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

#[inline]
fn is_tag_delim(b: u8) -> bool {
    is_ascii_ws(b) || b == b'>' || b == b'/'
}

fn contains_ascii_ci(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if haystack.len() < needle.len() {
        return false;
    }
    let limit = haystack.len() - needle.len();
    for i in 0..=limit {
        let mut matched = true;
        for j in 0..needle.len() {
            if to_lower_ascii(haystack[i + j]) != to_lower_ascii(needle[j]) {
                matched = false;
                break;
            }
        }
        if matched {
            return true;
        }
    }
    false
}

fn eq_ascii_ci(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if to_lower_ascii(a[i]) != to_lower_ascii(b[i]) {
            return false;
        }
    }
    true
}

fn looks_like_html(input: &[u8]) -> bool {
    let probe = if input.len() > 8192 {
        &input[..8192]
    } else {
        input
    };
    contains_ascii_ci(probe, b"<html")
        || contains_ascii_ci(probe, b"<!doctype")
        || contains_ascii_ci(probe, b"<body")
        || contains_ascii_ci(probe, b"<nav")
        || contains_ascii_ci(probe, b"<header")
        || contains_ascii_ci(probe, b"<footer")
        || contains_ascii_ci(probe, b"<script")
        || contains_ascii_ci(probe, b"<style")
        || contains_ascii_ci(probe, b"<article")
        || contains_ascii_ci(probe, b"<main")
        || contains_ascii_ci(probe, b"<div")
        || contains_ascii_ci(probe, b"<p>")
        || contains_ascii_ci(probe, b"<p ")
}

fn is_skip_container_tag(tag: &[u8]) -> bool {
    eq_ascii_ci(tag, b"script")
        || eq_ascii_ci(tag, b"style")
        || eq_ascii_ci(tag, b"nav")
        || eq_ascii_ci(tag, b"header")
        || eq_ascii_ci(tag, b"footer")
        || eq_ascii_ci(tag, b"aside")
        || eq_ascii_ci(tag, b"svg")
        || eq_ascii_ci(tag, b"noscript")
        || eq_ascii_ci(tag, b"iframe")
}

fn is_block_tag(tag: &[u8]) -> bool {
    eq_ascii_ci(tag, b"p")
        || eq_ascii_ci(tag, b"div")
        || eq_ascii_ci(tag, b"li")
        || eq_ascii_ci(tag, b"tr")
        || eq_ascii_ci(tag, b"td")
        || eq_ascii_ci(tag, b"th")
        || eq_ascii_ci(tag, b"h1")
        || eq_ascii_ci(tag, b"h2")
        || eq_ascii_ci(tag, b"h3")
        || eq_ascii_ci(tag, b"h4")
        || eq_ascii_ci(tag, b"h5")
        || eq_ascii_ci(tag, b"h6")
        || eq_ascii_ci(tag, b"section")
        || eq_ascii_ci(tag, b"article")
        || eq_ascii_ci(tag, b"main")
        || eq_ascii_ci(tag, b"blockquote")
        || eq_ascii_ci(tag, b"br")
        || eq_ascii_ci(tag, b"hr")
        || eq_ascii_ci(tag, b"pre")
        || eq_ascii_ci(tag, b"title")
}

fn push_byte(out: &mut [u8], w: &mut usize, b: u8) {
    if *w < out.len() {
        out[*w] = b;
        *w += 1;
    }
}

fn push_newline_if_needed(out: &mut [u8], w: &mut usize) {
    if *w > 0 && out[*w - 1] != b'\n' {
        push_byte(out, w, b'\n');
    }
}

fn decode_entity(input: &[u8], start: usize) -> Option<(u8, usize)> {
    // input[start] == b'&'
    let max_scan = (start + 12).min(input.len());
    let mut semi = None;
    for j in (start + 1)..max_scan {
        if input[j] == b';' {
            semi = Some(j);
            break;
        }
        if is_ascii_ws(input[j]) || input[j] == b'<' || input[j] == b'&' {
            return None;
        }
    }
    let end = semi?;
    let ent = &input[(start + 1)..end];
    let decoded = if ent == b"amp" {
        b'&'
    } else if ent == b"lt" {
        b'<'
    } else if ent == b"gt" {
        b'>'
    } else if ent == b"quot" {
        b'"'
    } else if ent == b"apos" || ent == b"#39" {
        b'\''
    } else if ent == b"nbsp" || ent == b"#160" {
        b' '
    } else if ent == b"mdash" || ent == b"ndash" {
        b'-'
    } else if ent.starts_with(b"#x") || ent.starts_with(b"#X") {
        let mut val: u32 = 0;
        for &c in &ent[2..] {
            let d = match c {
                b'0'..=b'9' => (c - b'0') as u32,
                b'a'..=b'f' => (c - b'a' + 10) as u32,
                b'A'..=b'F' => (c - b'A' + 10) as u32,
                _ => return None,
            };
            val = val.saturating_mul(16).saturating_add(d);
        }
        if (0x20..=0x7e).contains(&val) {
            val as u8
        } else {
            b' '
        }
    } else if ent.starts_with(b"#") && ent.len() > 1 {
        let mut val: u32 = 0;
        for &c in &ent[1..] {
            if !c.is_ascii_digit() {
                return None;
            }
            val = val.saturating_mul(10).saturating_add((c - b'0') as u32);
        }
        if (0x20..=0x7e).contains(&val) {
            val as u8
        } else {
            b' '
        }
    } else {
        return None;
    };
    Some((decoded, end + 1))
}

fn find_tag_end(input: &[u8], start: usize) -> usize {
    let mut i = start;
    let mut quote: u8 = 0;
    while i < input.len() {
        let b = input[i];
        if quote != 0 {
            if b == quote {
                quote = 0;
            }
        } else if b == b'"' || b == b'\'' {
            quote = b;
        } else if b == b'>' {
            return i + 1;
        }
        i += 1;
    }
    input.len()
}

fn parse_tag_name(input: &[u8], lt_idx: usize) -> (bool, &[u8], bool) {
    let mut pos = lt_idx + 1;
    let mut is_close = false;
    if pos < input.len() && input[pos] == b'/' {
        is_close = true;
        pos += 1;
    }
    while pos < input.len() && is_ascii_ws(input[pos]) {
        pos += 1;
    }
    let name_start = pos;
    while pos < input.len() && !is_tag_delim(input[pos]) {
        pos += 1;
    }
    let name = &input[name_start..pos];
    let mut self_closing = false;
    let tag_end = find_tag_end(input, lt_idx + 1);
    if tag_end >= 2 && input[tag_end - 2] == b'/' {
        self_closing = true;
    }
    (is_close, name, self_closing)
}

fn skip_container_block(input: &[u8], open_lt: usize, target_tag: &[u8]) -> usize {
    let mut i = find_tag_end(input, open_lt + 1);
    let mut depth: usize = 1;
    while i < input.len() {
        if input[i] == b'<' {
            let (is_close, tag, self_closing) = parse_tag_name(input, i);
            let next_i = find_tag_end(input, i + 1);
            if eq_ascii_ci(tag, target_tag) {
                if is_close {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        return next_i;
                    }
                } else if !self_closing {
                    depth += 1;
                }
            }
            i = next_i;
        } else {
            i += 1;
        }
    }
    input.len()
}

fn strip_html_to_buf(input: &[u8], out: &mut [u8]) -> usize {
    let mut i = 0;
    let mut w = 0;
    while i < input.len() && w < out.len() {
        if input[i] == b'<' {
            // HTML comment <!-- ... -->
            if input.len() >= i + 4 && &input[i..i + 4] == b"<!--" {
                let mut j = i + 4;
                while j + 2 < input.len() {
                    if &input[j..j + 3] == b"-->" {
                        j += 3;
                        break;
                    }
                    j += 1;
                }
                i = if j + 2 >= input.len() && !input[j.saturating_sub(3)..].starts_with(b"-->") {
                    input.len()
                } else {
                    j
                };
                continue;
            }
            let (is_close, tag_name, self_closing) = parse_tag_name(input, i);
            if !tag_name.is_empty() && (tag_name[0].is_ascii_alphabetic() || tag_name[0] == b'!') {
                if !is_close && !self_closing && is_skip_container_tag(tag_name) {
                    i = skip_container_block(input, i, tag_name);
                    push_newline_if_needed(out, &mut w);
                    continue;
                }
                i = find_tag_end(input, i + 1);
                if is_block_tag(tag_name) {
                    push_newline_if_needed(out, &mut w);
                } else if matches!(out.get(w.saturating_sub(1)), Some(&c) if c != b'\n' && c != b' ') {
                    push_byte(out, &mut w, b' ');
                }
                continue;
            }
        }

        if input[i] == b'&' {
            if let Some((decoded, next_i)) = decode_entity(input, i) {
                push_byte(out, &mut w, decoded);
                i = next_i;
                continue;
            }
        }

        let b = input[i];
        if b == b'\r' {
            push_byte(out, &mut w, b'\n');
            if i + 1 < input.len() && input[i + 1] == b'\n' {
                i += 2;
                continue;
            }
        } else {
            push_byte(out, &mut w, b);
        }
        i += 1;
    }
    w
}

fn is_page_x_of_y(lower: &[u8]) -> bool {
    if !lower.starts_with(b"page ") || lower.len() > 24 {
        return false;
    }
    let rest = &lower[5..];
    let mut k = 0;
    let mut d1 = false;
    while k < rest.len() && rest[k].is_ascii_digit() {
        d1 = true;
        k += 1;
    }
    if !d1 || !rest[k..].starts_with(b" of ") {
        return false;
    }
    let tail = &rest[(k + 4)..];
    !tail.is_empty() && tail.iter().all(|b| b.is_ascii_digit())
}

fn is_chrome_line(trimmed: &[u8]) -> bool {
    if trimmed.is_empty() {
        return true;
    }
    if trimmed.len() <= 200 {
        let mut lower = [0u8; 200];
        let n = trimmed.len();
        let mut alpha_count = 0usize;
        let mut pipe_count = 0usize;
        for idx in 0..n {
            let b = to_lower_ascii(trimmed[idx]);
            lower[idx] = b;
            if b.is_ascii_alphabetic() {
                alpha_count += 1;
            } else if b == b'|' {
                pipe_count += 1;
            }
        }
        let l = &lower[..n];

        if alpha_count == 0 && n <= 48 {
            return true;
        }
        if is_page_x_of_y(l) {
            return true;
        }
        if contains_ascii_ci(l, b"accept all cookies")
            || contains_ascii_ci(l, b"cookie preferences")
            || contains_ascii_ci(l, b"manage cookies")
            || contains_ascii_ci(l, b"we use cookies")
            || contains_ascii_ci(l, b"all rights reserved")
            || contains_ascii_ci(l, b"skip to main content")
            || contains_ascii_ci(l, b"skip to content")
            || contains_ascii_ci(l, b"subscribe to our newsletter")
            || contains_ascii_ci(l, b"sign in |")
            || contains_ascii_ci(l, b"| sign in")
            || contains_ascii_ci(l, b"| log in")
            || contains_ascii_ci(l, b"log in |")
            || (n <= 96
                && (contains_ascii_ci(l, b"privacy policy")
                    || contains_ascii_ci(l, b"terms of service")
                    || contains_ascii_ci(l, b"terms of use")))
            || (n <= 96
                && (l.starts_with(b"copyright ")
                    || l.starts_with(b"confidential")
                    || l.starts_with(b"powered by ")
                    || l.starts_with(b"\xc2\xa9")
                    || contains_ascii_ci(l, b"\xc2\xa9 20")))
            || (n <= 80 && pipe_count >= 2)
        {
            return true;
        }
        if matches!(
            l,
            b"sign in"
                | b"log in"
                | b"create account"
                | b"register"
                | b"subscribe"
                | b"unsubscribe"
                | b"menu"
                | b"navigation"
                | b"navigation menu"
                | b"home"
        ) {
            return true;
        }
    }
    false
}

fn compact_and_filter_lines(buf: &mut [u8], len: usize, strip_chrome: bool) -> usize {
    let mut read_idx = 0usize;
    let mut write_idx = 0usize;
    while read_idx < len {
        let line_start = read_idx;
        while read_idx < len && buf[read_idx] != b'\n' {
            read_idx += 1;
        }
        let line_end = read_idx;
        if read_idx < len && buf[read_idx] == b'\n' {
            read_idx += 1;
        }

        // Collapse spaces/tabs strictly in-place within buf[line_start..line_end]
        let mut s_len = 0usize;
        let mut prev_space = true; // trims leading
        for k in line_start..line_end {
            let b = buf[k];
            if b == b' ' || b == b'\t' {
                if !prev_space {
                    buf[line_start + s_len] = b' ';
                    s_len += 1;
                    prev_space = true;
                }
            } else if b != b'\r' {
                buf[line_start + s_len] = b;
                s_len += 1;
                prev_space = false;
            }
        }
        while s_len > 0 && buf[line_start + s_len - 1] == b' ' {
            s_len -= 1;
        }
        if s_len == 0 {
            continue;
        }
        if strip_chrome && is_chrome_line(&buf[line_start..line_start + s_len]) {
            continue;
        }
        if write_idx > 0 && write_idx < buf.len() {
            buf[write_idx] = b'\n';
            write_idx += 1;
        }
        let max_copy = s_len.min(buf.len().saturating_sub(write_idx));
        buf.copy_within(line_start..line_start + max_copy, write_idx);
        write_idx += max_copy;
    }
    write_idx
}

pub fn strip_boilerplate_internal(input: &[u8], out: &mut [u8], flags: u32) -> usize {
    let effective_flags = if flags == 0 {
        FLAG_AUTO_HTML | FLAG_CHROME
    } else {
        flags
    };
    let use_html = (effective_flags & FLAG_HTML) != 0
        || ((effective_flags & FLAG_AUTO_HTML) != 0 && looks_like_html(input));
    let strip_chrome = (effective_flags & FLAG_CHROME) != 0;

    let raw_len = if use_html {
        strip_html_to_buf(input, out)
    } else {
        let copy_len = input.len().min(out.len());
        out[..copy_len].copy_from_slice(&input[..copy_len]);
        copy_len
    };
    compact_and_filter_lines(out, raw_len, strip_chrome)
}

#[no_mangle]
pub extern "C" fn vs_clean_strip_boilerplate(in_len: u32, flags: u32) -> u32 {
    let len = (in_len as usize).min(INPUT_CAP);
    unsafe {
        let input = core::slice::from_raw_parts(core::ptr::addr_of!(IN_BUF) as *const u8, len);
        let out = core::slice::from_raw_parts_mut(core::ptr::addr_of_mut!(OUT_BUF) as *mut u8, OUTPUT_CAP);
        let written = strip_boilerplate_internal(input, out, flags);
        written as u32
    }
}

#[inline]
fn fnv1a_64_step(mut hash: u64, b: u8) -> u64 {
    hash ^= b as u64;
    hash.wrapping_mul(0x1000_0000_01b3)
}

#[inline]
fn mix32(mut x: u64) -> u32 {
    x ^= x >> 33;
    x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
    x ^= x >> 33;
    x = x.wrapping_mul(0xc4ce_b9fe_1a85_ec53);
    x ^= x >> 33;
    (x & 0xffff_ffff) as u32
}

fn normalize_for_dedup(input: &[u8], out: &mut [u8]) -> (u64, usize) {
    let mut w = 0usize;
    let mut prev_space = true;
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in input {
        if b < 0x80 {
            if b.is_ascii_alphanumeric() {
                let lb = to_lower_ascii(b);
                hash = fnv1a_64_step(hash, lb);
                if w < out.len() {
                    out[w] = lb;
                    w += 1;
                }
                prev_space = false;
            } else if is_ascii_ws(b) && !prev_space {
                hash = fnv1a_64_step(hash, b' ');
                if w < out.len() {
                    out[w] = b' ';
                    w += 1;
                }
                prev_space = true;
            }
        } else {
            hash = fnv1a_64_step(hash, b);
            if w < out.len() {
                out[w] = b;
                w += 1;
            }
            prev_space = false;
        }
    }
    if w > 0 && out[w - 1] == b' ' {
        w -= 1;
        // Recompute hash cleanly on trimmed normalized bytes for consistency
        hash = 0xcbf2_9ce4_8422_2325;
        for &nb in &out[..w] {
            hash = fnv1a_64_step(hash, nb);
        }
    }
    (hash, w)
}

fn compute_minhash_sig(norm: &[u8]) -> [u32; MINHASH_LANES] {
    let mut sig = [u32::MAX; MINHASH_LANES];
    if norm.is_empty() {
        return sig;
    }
    if norm.len() < 3 {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for &b in norm {
            h = fnv1a_64_step(h, b);
        }
        for lane in 0..MINHASH_LANES {
            let seed = ((lane as u64).wrapping_add(1)).wrapping_mul(0x9e37_79b9_7f4a_7c15);
            sig[lane] = mix32(h ^ seed);
        }
        return sig;
    }
    for i in 0..=(norm.len() - 3) {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        h = fnv1a_64_step(h, norm[i]);
        h = fnv1a_64_step(h, norm[i + 1]);
        h = fnv1a_64_step(h, norm[i + 2]);
        for lane in 0..MINHASH_LANES {
            let seed = ((lane as u64).wrapping_add(1)).wrapping_mul(0x9e37_79b9_7f4a_7c15);
            let candidate = mix32(h ^ seed);
            if candidate < sig[lane] {
                sig[lane] = candidate;
            }
        }
    }
    sig
}

#[no_mangle]
pub extern "C" fn vs_clean_dedup_check(in_len: u32, threshold_x1000: u32) -> u32 {
    let len = (in_len as usize).min(INPUT_CAP);
    unsafe {
        let input = core::slice::from_raw_parts(core::ptr::addr_of!(IN_BUF) as *const u8, len);
        let norm = core::slice::from_raw_parts_mut(core::ptr::addr_of_mut!(NORM_BUF) as *mut u8, INPUT_CAP);
        let (exact_hash, norm_len) = normalize_for_dedup(input, norm);
        let sig = compute_minhash_sig(&norm[..norm_len]);

        let count = DEDUP_COUNT.min(MAX_DEDUP_SLOTS);
        let mut best_sim: u32 = 0;
        let mut best_idx: i32 = -1;

        for idx in 0..count {
            if DEDUP_HASHES[idx] == exact_hash {
                LAST_SIM_X1000 = 1000;
                LAST_MATCH_IDX = idx as i32;
                return 1; // EXACT_DUPLICATE
            }
            let mut matches: u32 = 0;
            for lane in 0..MINHASH_LANES {
                if DEDUP_SIGS[idx][lane] == sig[lane] {
                    matches += 1;
                }
            }
            let sim_x1000 = (matches * 1000) / (MINHASH_LANES as u32);
            if sim_x1000 > best_sim {
                best_sim = sim_x1000;
                best_idx = idx as i32;
            }
        }

        if best_sim >= threshold_x1000 {
            LAST_SIM_X1000 = best_sim;
            LAST_MATCH_IDX = best_idx;
            return 2; // NEAR_DUPLICATE
        }

        if DEDUP_COUNT < MAX_DEDUP_SLOTS {
            let slot = DEDUP_COUNT;
            DEDUP_HASHES[slot] = exact_hash;
            DEDUP_SIGS[slot] = sig;
            DEDUP_COUNT += 1;
        }
        LAST_SIM_X1000 = best_sim;
        LAST_MATCH_IDX = best_idx;
        0 // KEEP_UNIQUE
    }
}

fn is_pii_tag_token(word: &[u8]) -> bool {
    if !word.starts_with(b"<PII:") || !word.ends_with(b">") || word.len() <= 6 {
        return false;
    }
    word[5..word.len() - 1]
        .iter()
        .all(|&b| (b >= b'A' && b <= b'Z') || b == b'_')
}

fn word_token_cost(word: &[u8]) -> u32 {
    if is_pii_tag_token(word) {
        return 1;
    }
    // Count UTF-8 scalar count cleanly (matches char-level createTokenizer)
    let mut chars = 0u32;
    for &b in word {
        if (b & 0xc0) != 0x80 {
            chars += 1;
        }
    }
    chars.max(1)
}

#[no_mangle]
pub extern "C" fn vs_clean_chunk_windows(in_len: u32, max_tokens: u32, overlap_tokens: u32) -> u32 {
    let len = (in_len as usize).min(INPUT_CAP);
    if len == 0 {
        return 0;
    }
    let content_budget = max_tokens.saturating_sub(2).max(1);
    let overlap_budget = overlap_tokens.min(content_budget.saturating_sub(1));

    unsafe {
        let input = &IN_BUF[..len];
        let mut word_count = 0usize;
        let mut i = 0usize;

        while i < len && word_count < MAX_WORDS {
            while i < len && is_ascii_ws(input[i]) {
                i += 1;
            }
            if i >= len {
                break;
            }
            let w_start = i;
            while i < len && !is_ascii_ws(input[i]) {
                i += 1;
            }
            let w_end = i;
            let cost = word_token_cost(&input[w_start..w_end]);

            if cost <= content_budget {
                WORD_STARTS[word_count] = w_start as u32;
                WORD_ENDS[word_count] = w_end as u32;
                WORD_COSTS[word_count] = cost;
                word_count += 1;
            } else {
                // Split an oversized single word across valid UTF-8 codepoints so chunks never exceed max_tokens
                let mut cur = w_start;
                while cur < w_end && word_count < MAX_WORDS {
                    let sub_start = cur;
                    let mut sub_chars = 0u32;
                    while cur < w_end {
                        let next_byte = input[cur];
                        let char_width = if (next_byte & 0x80) == 0 {
                            1
                        } else if (next_byte & 0xe0) == 0xc0 {
                            2
                        } else if (next_byte & 0xf0) == 0xe0 {
                            3
                        } else {
                            4
                        };
                        if sub_chars > 0 && sub_chars + 1 > content_budget {
                            break;
                        }
                        cur = (cur + char_width).min(w_end);
                        sub_chars += 1;
                        if sub_chars >= content_budget {
                            break;
                        }
                    }
                    WORD_STARTS[word_count] = sub_start as u32;
                    WORD_ENDS[word_count] = cur as u32;
                    WORD_COSTS[word_count] = sub_chars.max(1);
                    word_count += 1;
                }
            }
        }

        if word_count == 0 {
            return 0;
        }

        let mut span_count = 0usize;
        let mut idx = 0usize;
        while idx < word_count && span_count < MAX_SPANS {
            let win_start_idx = idx;
            let mut sum_tokens = WORD_COSTS[idx];
            idx += 1;
            while idx < word_count {
                let next_cost = WORD_COSTS[idx] + 1; // +1 approximate word separator safety margin
                if sum_tokens + next_cost > content_budget {
                    break;
                }
                sum_tokens += WORD_COSTS[idx];
                idx += 1;
            }
            let win_end_idx = idx - 1;
            SPANS_BUF[span_count * 3] = WORD_STARTS[win_start_idx];
            SPANS_BUF[span_count * 3 + 1] = WORD_ENDS[win_end_idx];
            SPANS_BUF[span_count * 3 + 2] = sum_tokens + 2; // BOS + EOS
            span_count += 1;

            if idx >= word_count {
                break;
            }
            if overlap_budget > 0 {
                let mut back_tokens = 0u32;
                let mut next_start = idx;
                while next_start > win_start_idx + 1 {
                    next_start -= 1;
                    back_tokens += WORD_COSTS[next_start];
                    if back_tokens >= overlap_budget {
                        break;
                    }
                }
                if next_start > win_start_idx {
                    idx = next_start;
                }
            }
        }

        span_count as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static TEST_GUARD: Mutex<()> = Mutex::new(());

    #[test]
    fn strip_html_and_chrome() {
        let html = b"<nav>Sign in | Menu</nav><main><p>First clinical fact.</p><script>bad()</script></main><footer>All rights reserved</footer>";
        let mut out = [0u8; 4096];
        let n = strip_boilerplate_internal(html, &mut out, 0);
        let text = core::str::from_utf8(&out[..n]).unwrap();
        assert!(text.contains("First clinical fact."));
        assert!(!text.contains("bad()"));
        assert!(!text.contains("Sign in"));
        assert!(!text.contains("All rights reserved"));
    }

    #[test]
    fn dedup_exact_and_near() {
        let _lock = TEST_GUARD.lock().unwrap();
        vs_clean_dedup_reset();
        let a = b"Post-operative atrial fibrillation resolved within twelve hours after magnesium.";
        let b = b"Post-operative atrial fibrillation resolved within twelve hours after magnesium!";
        let c = b"Post-operative atrial fibrillation resolved within 12 hours after magnesium.";
        let d = b"Unrelated lumbar spine radiograph confirmed intact vertebral alignment.";

        unsafe {
            IN_BUF[..a.len()].copy_from_slice(a);
            assert_eq!(vs_clean_dedup_check(a.len() as u32, 800), 0);

            IN_BUF[..b.len()].copy_from_slice(b);
            assert_eq!(vs_clean_dedup_check(b.len() as u32, 800), 1);

            IN_BUF[..c.len()].copy_from_slice(c);
            assert_eq!(vs_clean_dedup_check(c.len() as u32, 720), 2);
            assert!(vs_clean_last_sim_x1000() >= 720);

            IN_BUF[..d.len()].copy_from_slice(d);
            assert_eq!(vs_clean_dedup_check(d.len() as u32, 720), 0);
        }
    }

    #[test]
    fn chunk_windows_preserves_pii_tag() {
        let _lock = TEST_GUARD.lock().unwrap();
        let msg = b"Alpha beta gamma <PII:EMAIL> delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma";
        unsafe {
            IN_BUF[..msg.len()].copy_from_slice(msg);
            let count = vs_clean_chunk_windows(msg.len() as u32, 48, 8) as usize;
            assert!(count >= 2);
            for k in 0..count {
                let s = SPANS_BUF[k * 3] as usize;
                let e = SPANS_BUF[k * 3 + 1] as usize;
                let tc = SPANS_BUF[k * 3 + 2];
                assert!(tc <= 48);
                let chunk = core::str::from_utf8(&IN_BUF[s..e]).unwrap();
                assert!(!chunk.ends_with("<PII:"));
            }
        }
    }
}
