//! Unified Stage 3A Anti-Evasion Normalizer, International Mathematical Checksum Validators,
//! and 30+ Enterprise Secret Detectors (keyword-prefiltered + capture-group Shannon entropy +
//! structural JWT JSON verification + zero-FP hash/UUID allowlist).

#[derive(Clone, Debug)]
pub struct ScanSpan {
    pub kind: &'static str,
    pub category: &'static str, // "pii" or "secret"
    pub start_u16: usize,
    pub end_u16: usize,
    pub confidence_x1000: u16,
    pub entropy_x100: u16,
    pub evasion_normalized: bool,
}

#[derive(Clone, Debug)]
pub struct ScanReport {
    pub spans: Vec<ScanSpan>,
    pub evasion_chars_stripped: usize,
    pub homoglyphs_folded: usize,
}

/// Normalized ASCII/UTF-8 view with per-byte back-map to UTF-16 code unit offsets in original text.
struct NormalizedText {
    norm: Vec<u8>,
    u16_start: Vec<usize>,
    u16_end: Vec<usize>,
    evasion_chars_stripped: usize,
    homoglyphs_folded: usize,
}

fn is_invisible_evasion_char(ch: char) -> bool {
    matches!(
        ch as u32,
        0x00AD
            | 0x034F
            | 0x061C
            | 0x180E
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x2069
            | 0xFEFF
    )
}

fn fold_homoglyph_or_fullwidth(ch: char) -> Option<char> {
    let cp = ch as u32;
    // Full-width ASCII variants (e.g. '１' -> '1', 'Ａ' -> 'A')
    if (0xFF01..=0xFF5E).contains(&cp) {
        return char::from_u32(cp - 0xFEE0);
    }
    if cp == 0x3000 {
        return Some(' ');
    }
    // Cyrillic & Greek confusable homoglyphs
    match ch {
        'А' | 'Α' => Some('A'),
        'В' | 'Β' => Some('B'),
        'Е' | 'Ε' => Some('E'),
        'К' | 'Κ' => Some('K'),
        'М' | 'Μ' => Some('M'),
        'Н' | 'Η' => Some('H'),
        'О' | 'Ο' => Some('O'),
        'Р' | 'Ρ' => Some('P'),
        'С' => Some('C'),
        'Т' | 'Τ' => Some('T'),
        'Х' | 'Χ' => Some('X'),
        'І' | 'Ι' => Some('I'),
        'Ј' => Some('J'),
        'Ѕ' => Some('S'),
        'а' | 'α' => Some('a'),
        'е' | 'ε' => Some('e'),
        'о' | 'ο' => Some('o'),
        'р' | 'ρ' => Some('p'),
        'с' => Some('c'),
        'х' | 'χ' => Some('x'),
        'у' => Some('y'),
        'і' | 'ι' => Some('i'),
        'ј' => Some('j'),
        'ѕ' => Some('s'),
        '‐' | '‑' | '‒' | '–' | '—' | '−' => Some('-'),
        _ => None,
    }
}

fn normalize_for_scan(input: &str) -> NormalizedText {
    let mut norm = Vec::with_capacity(input.len());
    let mut u16_start = Vec::with_capacity(input.len());
    let mut u16_end = Vec::with_capacity(input.len());
    let mut evasion_chars_stripped = 0usize;
    let mut homoglyphs_folded = 0usize;
    let mut cur_u16 = 0usize;

    for ch in input.chars() {
        let ch_u16_len = ch.len_utf16();
        let next_u16 = cur_u16 + ch_u16_len;

        if is_invisible_evasion_char(ch) {
            evasion_chars_stripped += 1;
            cur_u16 = next_u16;
            continue;
        }

        let mapped = if let Some(folded) = fold_homoglyph_or_fullwidth(ch) {
            if folded != '-' && folded != ' ' {
                homoglyphs_folded += 1;
            }
            folded
        } else {
            ch
        };

        let mut buf = [0u8; 4];
        let s = mapped.encode_utf8(&mut buf);
        for &b in s.as_bytes() {
            norm.push(b);
            u16_start.push(cur_u16);
            u16_end.push(next_u16);
        }
        cur_u16 = next_u16;
    }

    NormalizedText {
        norm,
        u16_start,
        u16_end,
        evasion_chars_stripped,
        homoglyphs_folded,
    }
}

// ---------------------------------------------------------------------------
// Mathematical Checksum Validators
// ---------------------------------------------------------------------------

pub fn luhn_check(digits: &[u8]) -> bool {
    if digits.is_empty() {
        return false;
    }
    let mut sum = 0u32;
    let mut dbl = false;
    for &d in digits.iter().rev() {
        if d > 9 {
            return false;
        }
        let mut v = d as u32;
        if dbl {
            v *= 2;
            if v > 9 {
                v -= 9;
            }
        }
        sum += v;
        dbl = !dbl;
    }
    sum % 10 == 0
}

pub fn is_valid_payment_card(raw: &str) -> bool {
    let digits: Vec<u8> = raw
        .bytes()
        .filter(|b| b.is_ascii_digit())
        .map(|b| b - b'0')
        .collect();
    let n = digits.len();
    if !(13..=19).contains(&n) {
        return false;
    }
    let d0 = digits[0];
    let p2 = (digits[0] as u32) * 10 + digits[1] as u32;
    let p4 = p2 * 100 + (digits[2] as u32) * 10 + digits[3] as u32;
    let is_visa = d0 == 4 && matches!(n, 13 | 16 | 19);
    let is_mc = n == 16 && ((51..=55).contains(&p2) || (2221..=2720).contains(&p4));
    let is_amex = n == 15 && (p2 == 34 || p2 == 37);
    let is_disc = n == 16 && (p4 == 6011 || p2 == 65 || (644..=649).contains(&(p4 / 10)));
    let is_jcb = n == 16 && (3528..=3589).contains(&p4);
    let is_diners = n == 14 && ((300..=305).contains(&(p4 / 10)) || p2 == 36 || p2 == 38);
    if !(is_visa || is_mc || is_amex || is_disc || is_jcb || is_diners) {
        return false;
    }
    luhn_check(&digits)
}

fn iban_country_len(cc: &[u8; 2]) -> Option<usize> {
    match cc {
        b"NO" => Some(15),
        b"BE" => Some(16),
        b"DK" | b"FI" | b"FO" | b"GL" | b"NL" => Some(18),
        b"MK" | b"SI" => Some(19),
        b"AT" | b"BA" | b"EE" | b"KZ" | b"LT" | b"LU" => Some(20),
        b"CH" | b"CR" | b"HR" | b"LI" | b"LV" => Some(21),
        b"BH" | b"BG" | b"DE" | b"GB" | b"GE" | b"IE" | b"ME" | b"RS" => Some(22),
        b"AE" | b"GI" | b"IL" => Some(23),
        b"AD" | b"CZ" | b"ES" | b"MD" | b"PK" | b"RO" | b"SA" | b"SE" | b"SK" | b"TN" => Some(24),
        b"PT" => Some(25),
        b"IS" | b"TR" => Some(26),
        b"FR" | b"GR" | b"IT" | b"MC" | b"SM" => Some(27),
        b"AL" | b"AZ" | b"CY" | b"DO" | b"GT" | b"HU" | b"LB" | b"PL" => Some(28),
        b"BR" | b"PS" | b"QA" | b"UA" => Some(29),
        b"JO" | b"KW" | b"MU" => Some(30),
        b"MT" => Some(31),
        _ => None,
    }
}

/// ISO 7064 Mod-97-10 IBAN validation.
pub fn is_valid_iban(raw: &str) -> bool {
    let clean: Vec<u8> = raw
        .bytes()
        .filter(|b| b.is_ascii_alphanumeric())
        .map(|b| b.to_ascii_uppercase())
        .collect();
    if clean.len() < 15 || clean.len() > 34 {
        return false;
    }
    if !clean[0].is_ascii_uppercase()
        || !clean[1].is_ascii_uppercase()
        || !clean[2].is_ascii_digit()
        || !clean[3].is_ascii_digit()
    {
        return false;
    }
    let cc = [clean[0], clean[1]];
    let Some(expected_len) = iban_country_len(&cc) else {
        return false;
    };
    if clean.len() != expected_len {
        return false;
    }

    let mut rem: u32 = 0;
    for &b in clean[4..].iter().chain(clean[..4].iter()) {
        if b.is_ascii_digit() {
            rem = (rem * 10 + (b - b'0') as u32) % 97;
        } else if b.is_ascii_uppercase() {
            let val = (b - b'A' + 10) as u32;
            rem = (rem * 100 + val) % 97;
        } else {
            return false;
        }
    }
    rem == 1
}

/// Australian Tax File Number (8 or 9 digits, weighted Mod-11).
pub fn is_valid_au_tfn(raw: &str) -> bool {
    let d: Vec<u32> = raw
        .bytes()
        .filter(|b| b.is_ascii_digit())
        .map(|b| (b - b'0') as u32)
        .collect();
    if d.iter().all(|&x| x == 0) {
        return false;
    }
    match d.len() {
        8 => {
            const W8: [u32; 8] = [10, 7, 8, 4, 6, 3, 5, 1];
            let sum: u32 = d.iter().zip(W8.iter()).map(|(a, b)| a * b).sum();
            sum % 11 == 0
        }
        9 => {
            const W9: [u32; 9] = [1, 4, 3, 7, 5, 8, 6, 9, 10];
            let sum: u32 = d.iter().zip(W9.iter()).map(|(a, b)| a * b).sum();
            sum % 11 == 0
        }
        _ => false,
    }
}

/// Australian Medicare Number (10 or 11 digits, starts with [2..6], weighted Mod-10 check at index 8).
pub fn is_valid_au_medicare(raw: &str) -> bool {
    let d: Vec<u32> = raw
        .bytes()
        .filter(|b| b.is_ascii_digit())
        .map(|b| (b - b'0') as u32)
        .collect();
    if d.len() != 10 && d.len() != 11 {
        return false;
    }
    if !(2..=6).contains(&d[0]) {
        return false;
    }
    if d[9] == 0 {
        return false;
    }
    const W: [u32; 8] = [1, 3, 7, 9, 1, 3, 7, 9];
    let sum: u32 = d[0..8].iter().zip(W.iter()).map(|(a, b)| a * b).sum();
    (sum % 10) == d[8]
}

/// Australian Business Number (11 digits, first digit - 1, weighted Mod-89).
pub fn is_valid_au_abn(raw: &str) -> bool {
    let d: Vec<u32> = raw
        .bytes()
        .filter(|b| b.is_ascii_digit())
        .map(|b| (b - b'0') as u32)
        .collect();
    if d.len() != 11 || d[0] == 0 {
        return false;
    }
    const W: [u32; 11] = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
    let mut sum = (d[0] - 1) * W[0];
    for i in 1..11 {
        sum += d[i] * W[i];
    }
    sum % 89 == 0
}

/// UK NHS Number (10 digits, weighted Mod-11).
pub fn is_valid_uk_nhs(raw: &str) -> bool {
    let d: Vec<u32> = raw
        .bytes()
        .filter(|b| b.is_ascii_digit())
        .map(|b| (b - b'0') as u32)
        .collect();
    if d.len() != 10 {
        return false;
    }
    let mut sum = 0u32;
    for i in 0..9 {
        sum += d[i] * (10 - i as u32);
    }
    let rem = 11 - (sum % 11);
    let check = if rem == 11 { 0 } else { rem };
    check != 10 && check == d[9]
}

/// India Aadhaar (12 digits, Verhoeff D5 dihedral checksum, cannot start with 0 or 1).
pub fn is_valid_in_aadhaar(raw: &str) -> bool {
    let d: Vec<usize> = raw
        .bytes()
        .filter(|b| b.is_ascii_digit())
        .map(|b| (b - b'0') as usize)
        .collect();
    if d.len() != 12 || d[0] < 2 {
        return false;
    }
    const D_TABLE: [[usize; 10]; 10] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
        [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
        [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
        [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
        [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
        [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
        [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
        [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
        [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
    ];
    const P_TABLE: [[usize; 10]; 8] = [
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
        [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
        [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
        [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
        [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
        [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
        [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
        [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
    ];
    let mut c = 0usize;
    for (i, &digit) in d.iter().rev().enumerate() {
        c = D_TABLE[c][P_TABLE[i % 8][digit]];
    }
    c == 0
}

pub fn is_valid_us_ssn(area: u32, group: u32, serial: u32) -> bool {
    if area == 0 || area == 666 || area >= 900 {
        return false;
    }
    if group == 0 || serial == 0 {
        return false;
    }
    true
}

/// Shannon entropy in bits per byte.
pub fn shannon_entropy(bytes: &[u8]) -> f32 {
    if bytes.is_empty() {
        return 0.0;
    }
    let mut counts = [0u32; 256];
    for &b in bytes {
        counts[b as usize] += 1;
    }
    let len = bytes.len() as f32;
    let mut h = 0.0f32;
    for &c in &counts {
        if c > 0 {
            let p = (c as f32) / len;
            h -= p * p.log2();
        }
    }
    h
}

fn is_hex_byte(b: u8) -> bool {
    b.is_ascii_hexdigit()
}

fn is_token_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b'+' | b'/' | b'=')
}

fn is_b64url_char(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

fn is_word_boundary(bytes: &[u8], idx: usize) -> bool {
    if idx == 0 || idx >= bytes.len() {
        return true;
    }
    !bytes[idx].is_ascii_alphanumeric() && bytes[idx] != b'_'
}

fn is_uuid_str(s: &[u8]) -> bool {
    if s.len() != 36 {
        return false;
    }
    for (i, &b) in s.iter().enumerate() {
        if matches!(i, 8 | 13 | 18 | 23) {
            if b != b'-' {
                return false;
            }
        } else if !b.is_ascii_hexdigit() {
            return false;
        }
    }
    true
}

fn is_placeholder_secret(val: &[u8]) -> bool {
    let lower: String = val.iter().map(|&b| (b as char).to_ascii_lowercase()).collect();
    if lower.contains("example")
        || lower.contains("your_api")
        || lower.contains("your-api")
        || lower.contains("changeme")
        || lower.contains("placeholder")
        || lower.contains("dummy")
        || lower.contains("<pii:")
        || lower.contains("<secret:")
    {
        return true;
    }
    // All same char like xxxxxxxxxxxxxxxx
    if val.len() >= 8 && val.iter().all(|&b| b == val[0]) {
        return true;
    }
    false
}

fn base64url_decode(seg: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity((seg.len() * 3) / 4);
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for &b in seg {
        let v = match b {
            b'A'..=b'Z' => (b - b'A') as u32,
            b'a'..=b'z' => (b - b'a' + 26) as u32,
            b'0'..=b'9' => (b - b'0' + 52) as u32,
            b'-' | b'+' => 62,
            b'_' | b'/' => 63,
            b'=' => break,
            _ => return None,
        };
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xFF) as u8);
        }
    }
    Some(out)
}

fn verify_jwt_header(header_b64: &[u8]) -> bool {
    let Some(decoded) = base64url_decode(header_b64) else {
        return false;
    };
    let Ok(s) = std::str::from_utf8(&decoded) else {
        return false;
    };
    let t = s.trim();
    t.starts_with('{') && (t.contains("\"alg\"") || t.contains("\"typ\""))
}

fn prefix_context_has_any(bytes: &[u8], start: usize, keywords: &[&str]) -> bool {
    let ctx_start = start.saturating_sub(48);
    let ctx = String::from_utf8_lossy(&bytes[ctx_start..start]).to_ascii_lowercase();
    keywords.iter().any(|k| ctx.contains(k))
}

fn push_span(
    spans: &mut Vec<ScanSpan>,
    nt: &NormalizedText,
    byte_start: usize,
    byte_end: usize,
    kind: &'static str,
    category: &'static str,
    confidence_x1000: u16,
    entropy_x100: u16,
) {
    if byte_start >= byte_end || byte_end > nt.norm.len() {
        return;
    }
    let s16 = nt.u16_start[byte_start];
    let e16 = nt.u16_end[byte_end - 1];
    let raw_len = e16.saturating_sub(s16);
    let norm_len = byte_end - byte_start;
    spans.push(ScanSpan {
        kind,
        category,
        start_u16: s16,
        end_u16: e16,
        confidence_x1000,
        entropy_x100,
        evasion_normalized: raw_len != norm_len || nt.homoglyphs_folded > 0,
    });
}

fn scan_prefix_secret(
    bytes: &[u8],
    nt: &NormalizedText,
    spans: &mut Vec<ScanSpan>,
    prefix: &[u8],
    min_body: usize,
    max_body: usize,
    min_entropy: f32,
    kind: &'static str,
) {
    let mut i = 0usize;
    while i + prefix.len() + min_body <= bytes.len() {
        if &bytes[i..i + prefix.len()] == prefix
            && (i == 0 || is_word_boundary(bytes, i - 1))
        {
            let mut end = i + prefix.len();
            while end < bytes.len() && end - (i + prefix.len()) < max_body && is_token_char(bytes[end])
            {
                end += 1;
            }
            let body_len = end - (i + prefix.len());
            if body_len >= min_body {
                let slice = &bytes[i..end];
                if !is_placeholder_secret(slice) {
                    let ent = shannon_entropy(&bytes[i + prefix.len()..end]);
                    if ent >= min_entropy {
                        push_span(
                            spans,
                            nt,
                            i,
                            end,
                            kind,
                            "secret",
                            980,
                            (ent * 100.0) as u16,
                        );
                        i = end;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
}

/// Full Stage 3A scan: Unicode anti-evasion + 30+ secrets + international checksum PII.
pub fn scan_text_pii_and_secrets(input: &str) -> ScanReport {
    let nt = normalize_for_scan(input);
    let b = &nt.norm;
    let n = b.len();
    let mut spans = Vec::new();

    // -----------------------------------------------------------------------
    // 1. PEM / OpenSSH / PGP Private Key Blocks
    // -----------------------------------------------------------------------
    let mut i = 0usize;
    while i + 25 < n {
        if b[i..].starts_with(b"-----BEGIN ") {
            if let Some(hdr_end_rel) = b[i..n.min(i + 80)].windows(5).position(|w| w == b"-----") {
                // Find the SECOND "-----" closing the BEGIN header
                let after_first = i + 5;
                if let Some(close_rel) =
                    b[after_first..n.min(after_first + 70)].windows(5).position(|w| w == b"-----")
                {
                    let hdr = &b[i..after_first + close_rel + 5];
                    let hdr_str = String::from_utf8_lossy(hdr).to_ascii_uppercase();
                    if hdr_str.contains("PRIVATE KEY") {
                        let search_start = after_first + close_rel + 5;
                        let mut end = n.min(search_start + 8192);
                        if let Some(end_rel) = b[search_start..end]
                            .windows(9)
                            .position(|w| w == b"-----END ")
                        {
                            let end_marker = search_start + end_rel + 9;
                            if let Some(tail_rel) = b[end_marker..n.min(end_marker + 64)]
                                .windows(5)
                                .position(|w| w == b"-----")
                            {
                                end = end_marker + tail_rel + 5;
                            }
                        }
                        push_span(&mut spans, &nt, i, end, "PRIVATE_KEY", "secret", 999, 550);
                        i = end;
                        continue;
                    }
                    let _ = hdr_end_rel;
                }
            }
        }
        i += 1;
    }

    // -----------------------------------------------------------------------
    // 2. High-Precision Prefixed API Keys & Cloud Tokens
    // -----------------------------------------------------------------------
    scan_prefix_secret(b, &nt, &mut spans, b"AKIA", 16, 16, 2.5, "AWS_ACCESS_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"ASIA", 16, 16, 2.5, "AWS_TEMP_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"sk-ant-", 20, 128, 3.2, "ANTHROPIC_API_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"sk-proj-", 20, 180, 3.2, "OPENAI_API_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"sk_live_", 18, 128, 3.2, "STRIPE_LIVE_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"rk_live_", 18, 128, 3.2, "STRIPE_RESTRICTED_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"sk_test_", 18, 128, 3.2, "STRIPE_TEST_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"ghp_", 30, 64, 3.2, "GITHUB_PAT");
    scan_prefix_secret(b, &nt, &mut spans, b"gho_", 30, 64, 3.2, "GITHUB_OAUTH");
    scan_prefix_secret(b, &nt, &mut spans, b"ghs_", 30, 64, 3.2, "GITHUB_APP_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"ghu_", 30, 64, 3.2, "GITHUB_USER_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"github_pat_", 32, 120, 3.2, "GITHUB_FINE_GRAINED_PAT");
    scan_prefix_secret(b, &nt, &mut spans, b"glpat-", 18, 64, 3.0, "GITLAB_PAT");
    scan_prefix_secret(b, &nt, &mut spans, b"xoxb-", 20, 100, 3.0, "SLACK_BOT_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"xoxp-", 20, 100, 3.0, "SLACK_USER_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"xoxa-", 20, 100, 3.0, "SLACK_APP_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"xoxr-", 20, 100, 3.0, "SLACK_REFRESH_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"AIza", 32, 40, 3.2, "GOOGLE_API_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"SG.", 24, 96, 3.3, "SENDGRID_API_KEY");
    scan_prefix_secret(b, &nt, &mut spans, b"npm_", 30, 64, 3.2, "NPM_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"pypi-", 32, 220, 3.2, "PYPI_TOKEN");
    scan_prefix_secret(b, &nt, &mut spans, b"hf_", 28, 64, 3.2, "HUGGINGFACE_TOKEN");
    scan_prefix_secret(
        b,
        &nt,
        &mut spans,
        b"https://hooks.slack.com/services/",
        20,
        96,
        2.8,
        "SLACK_WEBHOOK_URL",
    );
    // Legacy OpenAI `sk-...` (avoid matching sk-ant-/sk-proj- twice via dedup)
    scan_prefix_secret(b, &nt, &mut spans, b"sk-", 32, 160, 3.5, "OPENAI_API_KEY");

    // -----------------------------------------------------------------------
    // 3. Structurally Verified JWTs (`eyJ... . eyJ... . sig`)
    // -----------------------------------------------------------------------
    i = 0;
    while i + 20 < n {
        if b[i..].starts_with(b"eyJ") && (i == 0 || is_word_boundary(b, i - 1)) {
            let mut p = i;
            let mut dots = [0usize; 2];
            let mut dot_cnt = 0usize;
            while p < n && (is_b64url_char(b[p]) || b[p] == b'.') {
                if b[p] == b'.' {
                    if dot_cnt < 2 {
                        dots[dot_cnt] = p;
                    }
                    dot_cnt += 1;
                    if dot_cnt > 2 {
                        break;
                    }
                }
                p += 1;
            }
            if dot_cnt == 2 {
                let h = &b[i..dots[0]];
                let pay = &b[dots[0] + 1..dots[1]];
                let sig = &b[dots[1] + 1..p];
                if h.len() >= 10 && pay.len() >= 10 && sig.len() >= 16 && verify_jwt_header(h) {
                    let ent = shannon_entropy(sig);
                    push_span(&mut spans, &nt, i, p, "JWT", "secret", 990, (ent * 100.0) as u16);
                    i = p;
                    continue;
                }
            }
        }
        i += 1;
    }

    // -----------------------------------------------------------------------
    // 4. Database / Broker Connection URIs with Embedded Credentials
    // -----------------------------------------------------------------------
    const URI_SCHEMES: &[&[u8]] = &[
        b"postgres://",
        b"postgresql://",
        b"mysql://",
        b"mongodb://",
        b"mongodb+srv://",
        b"redis://",
        b"rediss://",
        b"amqp://",
        b"amqps://",
    ];
    i = 0;
    while i + 12 < n {
        let mut matched_scheme = None;
        for &scheme in URI_SCHEMES {
            if i + scheme.len() < n && b[i..i + scheme.len()].eq_ignore_ascii_case(scheme) {
                matched_scheme = Some(scheme.len());
                break;
            }
        }
        if let Some(slen) = matched_scheme {
            let mut end = i + slen;
            while end < n
                && !b[end].is_ascii_whitespace()
                && !matches!(b[end], b'"' | b'\'' | b'<' | b'>' | b')' | b']')
            {
                end += 1;
            }
            let auth_part = &b[i + slen..end];
            if let Some(at_pos) = auth_part.iter().position(|&c| c == b'@') {
                if auth_part[..at_pos].contains(&b':') && at_pos >= 3 {
                    let ent = shannon_entropy(&auth_part[..at_pos]);
                    push_span(
                        &mut spans,
                        &nt,
                        i,
                        end,
                        "DB_CONNECTION_URI",
                        "secret",
                        975,
                        (ent * 100.0) as u16,
                    );
                    i = end;
                    continue;
                }
            }
        }
        i += 1;
    }

    // -----------------------------------------------------------------------
    // 5. Generic Contextual Secret Assignments (Entropy-Gated, Zero-FP Allowlist)
    // -----------------------------------------------------------------------
    const SECRET_KEYS: &[&str] = &[
        "api_key",
        "apikey",
        "api-key",
        "secret_key",
        "secretkey",
        "client_secret",
        "aws_secret_access_key",
        "auth_token",
        "access_token",
        "bearer ",
        "private_key",
        "db_password",
        "password",
        "passwd",
        "signing_secret",
    ];
    i = 0;
    while i + 8 < n {
        if matches!(b[i], b'=' | b':' | b' ') {
            if prefix_context_has_any(b, i + 1, SECRET_KEYS) {
                let mut vs = i + 1;
                while vs < n && matches!(b[vs], b' ' | b'\t' | b'"' | b'\'') {
                    vs += 1;
                }
                let mut ve = vs;
                while ve < n && is_token_char(b[ve]) {
                    ve += 1;
                }
                let val = &b[vs..ve];
                if val.len() >= 16
                    && val.len() <= 256
                    && !is_uuid_str(val)
                    && !is_placeholder_secret(val)
                {
                    let all_hex64 = val.len() == 64 && val.iter().all(|&c| is_hex_byte(c));
                    // Ignore bare SHA-256 receipts unless explicitly prefixed with secret/key/token/password
                    let explicit_secret_ctx = prefix_context_has_any(
                        b,
                        i + 1,
                        &["secret", "password", "passwd", "api_key", "token", "bearer"],
                    );
                    if !all_hex64 || explicit_secret_ctx {
                        let ent = shannon_entropy(val);
                        if ent >= 3.45 {
                            push_span(
                                &mut spans,
                                &nt,
                                vs,
                                ve,
                                "GENERIC_SECRET",
                                "secret",
                                880,
                                (ent * 100.0) as u16,
                            );
                            i = ve;
                            continue;
                        }
                    }
                }
            }
        }
        i += 1;
    }

    // -----------------------------------------------------------------------
    // 6. International Checksummed PII (IBAN, Cards, AU TFN/Medicare/ABN, UK NHS/NINO, Aadhaar, SSN)
    // -----------------------------------------------------------------------
    // 6a. IBAN
    i = 0;
    while i + 15 <= n {
        if b[i].is_ascii_uppercase()
            && b[i + 1].is_ascii_uppercase()
            && b[i + 2].is_ascii_digit()
            && b[i + 3].is_ascii_digit()
            && (i == 0 || is_word_boundary(b, i - 1))
        {
            let mut end = i + 4;
            let mut alnum_cnt = 4usize;
            while end < n && alnum_cnt < 34 {
                if b[end].is_ascii_alphanumeric() {
                    alnum_cnt += 1;
                    end += 1;
                } else if b[end] == b' ' || b[end] == b'-' {
                    if end + 1 < n && b[end + 1].is_ascii_alphanumeric() {
                        end += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            let cand = String::from_utf8_lossy(&b[i..end]);
            if is_valid_iban(&cand) {
                push_span(&mut spans, &nt, i, end, "IBAN", "pii", 995, 0);
                i = end;
                continue;
            }
        }
        i += 1;
    }

    // 6b. UK NINO (`AA 12 34 56 C`)
    i = 0;
    while i + 9 <= n {
        if b[i].is_ascii_uppercase()
            && b[i + 1].is_ascii_uppercase()
            && (i == 0 || is_word_boundary(b, i - 1))
        {
            let c0 = b[i];
            let c1 = b[i + 1];
            let forbidden_first = matches!(c0, b'D' | b'F' | b'I' | b'Q' | b'U' | b'V');
            let forbidden_second = matches!(c1, b'D' | b'F' | b'I' | b'O' | b'Q' | b'U' | b'V');
            let forbidden_pair = matches!([c0, c1], [b'B', b'G'] | [b'G', b'B'] | [b'N', b'K'] | [b'K', b'N'] | [b'T', b'N'] | [b'N', b'T'] | [b'Z', b'Z']);
            if !forbidden_first && !forbidden_second && !forbidden_pair {
                let mut p = i + 2;
                let mut digits = 0usize;
                while p < n && digits < 6 {
                    if b[p].is_ascii_digit() {
                        digits += 1;
                        p += 1;
                    } else if b[p] == b' ' || b[p] == b'-' {
                        p += 1;
                    } else {
                        break;
                    }
                }
                if digits == 6 {
                    while p < n && (b[p] == b' ' || b[p] == b'-') {
                        p += 1;
                    }
                    if p < n && matches!(b[p], b'A'..=b'D') && is_word_boundary(b, p + 1) {
                        if prefix_context_has_any(
                            b,
                            i,
                            &["nino", "national insurance", "ni ", "ni:", "ni number", "hmrc"],
                        ) {
                            push_span(&mut spans, &nt, i, p + 1, "UK_NINO", "pii", 960, 0);
                            i = p + 1;
                            continue;
                        }
                    }
                }
            }
        }
        i += 1;
    }

    // 6c. Numeric Identifier Scanner (Cards 13-19, SSN 3-2-4, Aadhaar 12, ABN 11, Medicare 10-11, NHS 10, AU TFN 8-9)
    i = 0;
    while i < n {
        if b[i].is_ascii_digit() && (i == 0 || !b[i - 1].is_ascii_alphanumeric()) {
            let mut end = i;
            let mut digits = 0usize;
            let mut last_digit_end = i;
            while end < n && digits < 20 {
                if b[end].is_ascii_digit() {
                    digits += 1;
                    end += 1;
                    last_digit_end = end;
                } else if matches!(b[end], b'-' | b' ' | b'/') {
                    if end + 1 < n && b[end + 1].is_ascii_digit() {
                        end += 1;
                    } else {
                        break;
                    }
                } else {
                    break;
                }
            }
            let cand = String::from_utf8_lossy(&b[i..last_digit_end]);
            let trailing_ok = last_digit_end >= n || !b[last_digit_end].is_ascii_alphanumeric();

            if trailing_ok {
                if (13..=19).contains(&digits) && is_valid_payment_card(&cand) {
                    push_span(&mut spans, &nt, i, last_digit_end, "CREDIT_CARD", "pii", 995, 0);
                    i = last_digit_end;
                    continue;
                }

                // US SSN (NNN-NN-NNNN)
                if digits == 9 && last_digit_end - i == 11 && b[i + 3] == b'-' && b[i + 6] == b'-' {
                    let area: u32 = cand[0..3].parse().unwrap_or(0);
                    let group: u32 = cand[4..6].parse().unwrap_or(0);
                    let serial: u32 = cand[7..11].parse().unwrap_or(0);
                    if is_valid_us_ssn(area, group, serial) {
                        push_span(&mut spans, &nt, i, last_digit_end, "SSN", "pii", 985, 0);
                        i = last_digit_end;
                        continue;
                    }
                }

                // Context-validated international IDs (prevents random numbers from false-positiving!)
                if digits == 12
                    && is_valid_in_aadhaar(&cand)
                    && prefix_context_has_any(b, i, &["aadhaar", "aadhar", "uidai", "uid:"])
                {
                    push_span(&mut spans, &nt, i, last_digit_end, "IN_AADHAAR", "pii", 970, 0);
                    i = last_digit_end;
                    continue;
                }
                if digits == 11
                    && is_valid_au_abn(&cand)
                    && prefix_context_has_any(b, i, &["abn", "australian business"])
                {
                    push_span(&mut spans, &nt, i, last_digit_end, "AU_ABN", "pii", 970, 0);
                    i = last_digit_end;
                    continue;
                }
                if (digits == 10 || digits == 11)
                    && is_valid_au_medicare(&cand)
                    && prefix_context_has_any(b, i, &["medicare", "medicare no", "medicare #"])
                {
                    push_span(&mut spans, &nt, i, last_digit_end, "AU_MEDICARE", "pii", 975, 0);
                    i = last_digit_end;
                    continue;
                }
                if digits == 10
                    && is_valid_uk_nhs(&cand)
                    && prefix_context_has_any(b, i, &["nhs", "nhs no", "nhs number"])
                {
                    push_span(&mut spans, &nt, i, last_digit_end, "UK_NHS", "pii", 975, 0);
                    i = last_digit_end;
                    continue;
                }
                if (digits == 8 || digits == 9)
                    && is_valid_au_tfn(&cand)
                    && prefix_context_has_any(b, i, &["tfn", "tax file"])
                {
                    push_span(&mut spans, &nt, i, last_digit_end, "AU_TFN", "pii", 975, 0);
                    i = last_digit_end;
                    continue;
                }
                // Context-validated contiguous 10-11 digit phone numbers (common after Spoken ITN!)
                if (digits == 10 || digits == 11)
                    && prefix_context_has_any(
                        b,
                        i,
                        &["call", "phone", "mobile", "tel", "cell", "dial", "number", "reach", "fax"],
                    )
                {
                    push_span(&mut spans, &nt, i, last_digit_end, "PHONE", "pii", 950, 0);
                    i = last_digit_end;
                    continue;
                }
            }
            i = last_digit_end.max(i + 1);
            continue;
        }
        i += 1;
    }

    // 6d. University / Enterprise Student & Staff IDs (e.g. UNSW zID `z5653825`)
    i = 0;
    while i + 8 <= n {
        if matches!(b[i], b'z' | b'Z')
            && (i == 0 || is_word_boundary(b, i - 1))
            && b[i + 1..i + 8].iter().all(|c| c.is_ascii_digit())
            && is_word_boundary(b, i + 8)
        {
            push_span(&mut spans, &nt, i, i + 8, "STUDENT_ID", "pii", 940, 0);
            i += 8;
            continue;
        }
        i += 1;
    }

    // -----------------------------------------------------------------------
    // 7. Email Addresses (runs AFTER anti-evasion normalization!)
    // -----------------------------------------------------------------------
    i = 0;
    while i < n {
        if b[i] == b'@' && i > 0 && i + 4 < n {
            let mut ls = i;
            while ls > 0
                && (b[ls - 1].is_ascii_alphanumeric()
                    || matches!(b[ls - 1], b'.' | b'_' | b'%' | b'+' | b'-'))
            {
                ls -= 1;
            }
            let mut de = i + 1;
            let mut has_dot = false;
            while de < n
                && (b[de].is_ascii_alphanumeric() || matches!(b[de], b'.' | b'-'))
            {
                if b[de] == b'.' {
                    has_dot = true;
                }
                de += 1;
            }
            while de > i + 1 && b[de - 1] == b'.' {
                de -= 1;
            }
            if ls < i && has_dot && de > i + 4 {
                let domain = &b[i + 1..de];
                if let Some(last_dot) = domain.iter().rposition(|&c| c == b'.') {
                    let tld = &domain[last_dot + 1..];
                    if tld.len() >= 2 && tld.iter().all(|c| c.is_ascii_alphabetic()) {
                        push_span(&mut spans, &nt, ls, de, "EMAIL", "pii", 990, 0);
                        i = de;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }

    // Sort by start ASC, length DESC, confidence DESC and deduplicate overlaps
    spans.sort_by(|a, b| {
        a.start_u16
            .cmp(&b.start_u16)
            .then_with(|| (b.end_u16 - b.start_u16).cmp(&(a.end_u16 - a.start_u16)))
            .then_with(|| b.confidence_x1000.cmp(&a.confidence_x1000))
    });
    let mut deduped = Vec::with_capacity(spans.len());
    let mut last_end = 0usize;
    for s in spans {
        if s.start_u16 >= last_end {
            last_end = s.end_u16;
            deduped.push(s);
        }
    }

    ScanReport {
        spans: deduped,
        evasion_chars_stripped: nt.evasion_chars_stripped,
        homoglyphs_folded: nt.homoglyphs_folded,
    }
}

// ---------------------------------------------------------------------------
// Zero-Import Privacy-Preserving Record Linkage (PPRL):
// 128-bit Salted 2-Gram Bloom Filter + Soundex Phonetic Signature
// Enables noisy cross-modal GDPR Art. 17 erasure across OCR/ASR typos.
// ---------------------------------------------------------------------------

pub struct PprlSignature {
    pub bloom_hex: String,
    pub phonetic_hex: String,
    pub popcount: u32,
}

fn fnv1a_64_salted(salt: &[u8], domain: u8, data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in salt {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h ^= domain as u64;
    h = h.wrapping_mul(0x100000001b3);
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn soundex_word(word: &[u8]) -> [u8; 4] {
    let mut out = [b'0'; 4];
    let mut iter = word.iter().copied().filter(|c| c.is_ascii_alphabetic());
    let Some(first) = iter.next() else {
        return out;
    };
    let map_code = |c: u8| -> u8 {
        match c.to_ascii_lowercase() {
            b'b' | b'f' | b'p' | b'v' => b'1',
            b'c' | b'g' | b'j' | b'k' | b'q' | b's' | b'x' | b'z' => b'2',
            b'd' | b't' => b'3',
            b'l' => b'4',
            b'm' | b'n' => b'5',
            b'r' => b'6',
            _ => 0,
        }
    };
    // Fold initial C/K/Q -> K, Ph -> F style equivalence for ASR homophones (Katherine/Catherine)
    let first_l = first.to_ascii_lowercase();
    out[0] = match first_l {
        b'c' | b'q' => b'k',
        b'j' => b'g',
        b'z' => b's',
        other => other,
    };
    let mut prev = map_code(first_l);
    let mut idx = 1usize;
    for c in iter {
        let code = map_code(c);
        if code != 0 && code != prev {
            out[idx] = code;
            idx += 1;
            if idx == 4 {
                break;
            }
        }
        prev = code;
    }
    out
}

#[derive(Clone, Copy, Debug, Default)]
pub struct BinaryPprlSketch {
    pub bloom_lo: u64,
    pub bloom_hi: u64,
    pub phonetic_hash: u64,
    pub token_hash: u32,
    pub popcount: u8,
    pub canon_len: u8,
}

pub fn compute_pprl_binary(raw_text: &str, salt: &[u8]) -> BinaryPprlSketch {
    let nt = normalize_for_scan(raw_text);
    // Canonicalize ASCII + OCR visual confusables (0->o, 1->l, 5->s, |->l)
    let mut canon = Vec::with_capacity(nt.norm.len());
    let mut prev_space = true;
    for &b in &nt.norm {
        let mapped = match b {
            b'0' => b'o',
            b'1' | b'|' => b'l',
            b'5' => b's',
            b'A'..=b'Z' => b + 32,
            b'a'..=b'z' | b'2'..=b'9' => b,
            _ => b' ',
        };
        if mapped == b' ' {
            if !prev_space {
                canon.push(b' ');
                prev_space = true;
            }
        } else {
            canon.push(mapped);
            prev_space = false;
        }
    }
    while canon.last() == Some(&b' ') {
        canon.pop();
    }

    // Build 128-bit salted Bloom filter over padded 2-grams (k=2 hashes per 2-gram)
    let mut bits: [u64; 2] = [0, 0];
    let mut set_bit = |pos: usize| {
        let p = pos & 127;
        bits[p >> 6] |= 1u64 << (p & 63);
    };

    let mut padded = Vec::with_capacity(canon.len() + 2);
    padded.push(b'_');
    padded.extend_from_slice(&canon);
    padded.push(b'_');
    if padded.len() >= 2 {
        for w in padded.windows(2) {
            let h1 = fnv1a_64_salted(salt, 1, w);
            let h2 = fnv1a_64_salted(salt, 2, w);
            set_bit((h1 & 127) as usize);
            set_bit((h2 & 127) as usize);
        }
    }

    // Build sorted Soundex phonetic signature across words (handles ASR phonetic drift + order)
    let mut phon_codes: Vec<[u8; 4]> = canon
        .split(|&c| c == b' ')
        .filter(|w| w.len() >= 2)
        .map(soundex_word)
        .collect();
    phon_codes.sort();
    let mut phon_concat = Vec::with_capacity(phon_codes.len() * 4);
    for code in &phon_codes {
        phon_concat.extend_from_slice(code);
        // Also fold phonetic codes lightly into the Bloom filter so sound-alike pairs get a similarity boost
        let hp = fnv1a_64_salted(salt, 3, code);
        set_bit((hp & 127) as usize);
    }
    let phon_hash = fnv1a_64_salted(salt, 4, &phon_concat);
    let tok_hash = (fnv1a_64_salted(salt, 5, &canon) & 0xFFFF_FFFF) as u32;
    let pop = (bits[0].count_ones() + bits[1].count_ones()).min(128) as u8;

    BinaryPprlSketch {
        bloom_lo: bits[0],
        bloom_hi: bits[1],
        phonetic_hash: phon_hash,
        token_hash: tok_hash,
        popcount: pop,
        canon_len: canon.len().min(255) as u8,
    }
}

pub fn compute_pprl_signature(raw_text: &str, salt: &[u8]) -> PprlSignature {
    let bin = compute_pprl_binary(raw_text, salt);
    PprlSignature {
        bloom_hex: format!("{:016x}{:016x}", bin.bloom_lo, bin.bloom_hi),
        phonetic_hex: format!("{:016x}", bin.phonetic_hash),
        popcount: bin.popcount as u32,
    }
}

// ---------------------------------------------------------------------------
// Pillar 2: Zero-Import WASM SR-MP (Sparse-Reference Multimodal Perception)
// Fixed-Capacity 512-Slot Salted Reference Sketch Ring (512 * 32B = 16 KB)
// ---------------------------------------------------------------------------

pub const SRMP_RING_CAPACITY: usize = 512;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct SrmpAnchorSlot {
    pub bloom_lo: u64,      // 8B: lower 64 bits of 128-bit salted Bloom sketch
    pub bloom_hi: u64,      // 8B: upper 64 bits of 128-bit salted Bloom sketch
    pub phonetic_hash: u64, // 8B: 64-bit salted Soundex equivalence hash
    pub token_hash: u32,    // 4B: 32-bit salted exact normalized surface hash
    pub entity_uid: u16,    // 2B: SaltedPseudonymVault entity index
    pub block_idx: u16,     // 2B: origin block/frame/turn index
    pub conf_x1000: u16,    // 2B: anchor confidence in [0..1000]
    pub popcount: u8,       // 1B: cached 128-bit popcount
    pub canon_len: u8,      // 1B: canonical character length
    pub kind_code: u8,      // 1B: entity kind code (1=PERSON, 2=CODE, 3=EMAIL, 4=ORG, etc.)
    pub active: u8,         // 1B: 1 if occupied
}

pub struct SrmpSketchRing {
    pub slots: [SrmpAnchorSlot; SRMP_RING_CAPACITY],
    pub count: usize,
    pub write_cursor: usize,
}

impl Default for SrmpSketchRing {
    fn default() -> Self {
        Self {
            slots: [SrmpAnchorSlot::default(); SRMP_RING_CAPACITY],
            count: 0,
            write_cursor: 0,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct SrmpQueryHit {
    pub matched: bool,
    pub entity_uid: u16,
    pub anchor_block_idx: u16,
    pub kind_code: u8,
    pub dice_x1000: u16,
    pub phonetic_match: bool,
    pub exact_match: bool,
    pub coupled_score_x1000: u16,
}

impl SrmpSketchRing {
    pub fn reset(&mut self) {
        for s in self.slots.iter_mut() {
            *s = SrmpAnchorSlot::default();
        }
        self.count = 0;
        self.write_cursor = 0;
    }

    pub fn seed_anchor(
        &mut self,
        raw_text: &str,
        salt: &[u8],
        entity_uid: u16,
        block_idx: u16,
        conf_x1000: u16,
        kind_code: u8,
    ) -> usize {
        let sk = compute_pprl_binary(raw_text, salt);
        if sk.canon_len < 3 || sk.popcount == 0 {
            return self.count;
        }

        // Deduplicate by exact token_hash: update if higher confidence
        for i in 0..self.count {
            if self.slots[i].active == 1 && self.slots[i].token_hash == sk.token_hash {
                if conf_x1000 > self.slots[i].conf_x1000 {
                    self.slots[i].conf_x1000 = conf_x1000;
                    self.slots[i].entity_uid = entity_uid;
                }
                return self.count;
            }
        }

        let target_idx = if self.count < SRMP_RING_CAPACITY {
            let idx = self.count;
            self.count += 1;
            idx
        } else {
            let idx = self.write_cursor % SRMP_RING_CAPACITY;
            self.write_cursor = self.write_cursor.wrapping_add(1);
            idx
        };

        self.slots[target_idx] = SrmpAnchorSlot {
            bloom_lo: sk.bloom_lo,
            bloom_hi: sk.bloom_hi,
            phonetic_hash: sk.phonetic_hash,
            token_hash: sk.token_hash,
            entity_uid,
            block_idx,
            conf_x1000,
            popcount: sk.popcount,
            canon_len: sk.canon_len,
            kind_code,
            active: 1,
        };
        self.count
    }

    pub fn query_candidate(
        &self,
        raw_text: &str,
        salt: &[u8],
        block_idx: u16,
        local_score_x1000: u16,
        min_dice_x1000: u16,
        gamma_x1000: u16,
        beta_x1000: u16,
    ) -> SrmpQueryHit {
        let sk = compute_pprl_binary(raw_text, salt);
        if sk.canon_len < 3 || sk.popcount == 0 || self.count == 0 {
            return SrmpQueryHit {
                matched: false,
                entity_uid: 0,
                anchor_block_idx: 0,
                kind_code: 0,
                dice_x1000: 0,
                phonetic_match: false,
                exact_match: false,
                coupled_score_x1000: local_score_x1000,
            };
        }

        let s_local = (local_score_x1000.min(1000) as f32) / 1000.0;
        let min_dice = (min_dice_x1000.min(1000) as f32) / 1000.0;
        let gamma = (gamma_x1000.min(1000) as f32) / 1000.0;
        let beta = (beta_x1000.min(1000) as f32) / 1000.0;

        let mut best_coupled = s_local;
        let mut best_dice = 0.0f32;
        let mut best_slot: Option<&SrmpAnchorSlot> = None;
        let mut best_phon = false;
        let mut best_exact = false;

        for i in 0..self.count {
            let slot = &self.slots[i];
            if slot.active == 0 {
                continue;
            }
            let exact = slot.token_hash == sk.token_hash && slot.canon_len == sk.canon_len;
            if !exact && (slot.canon_len as i32 - sk.canon_len as i32).abs() > 2 {
                continue;
            }

            let inter = (slot.bloom_lo & sk.bloom_lo).count_ones()
                + (slot.bloom_hi & sk.bloom_hi).count_ones();
            let denom = (slot.popcount as u32) + (sk.popcount as u32);
            let dice = if denom > 0 {
                (2.0 * (inter as f32)) / (denom as f32)
            } else {
                0.0
            };
            let phon_match = slot.phonetic_hash == sk.phonetic_hash;

            let qualifies = exact || dice >= min_dice || (phon_match && dice >= 0.48);
            if !qualifies {
                continue;
            }

            let eff_sim = if exact {
                1.0
            } else if phon_match {
                dice.max(0.82)
            } else {
                dice
            };
            let dist = (block_idx as i32 - slot.block_idx as i32).unsigned_abs() as f32;
            let dist_decay = 1.0 / (1.0 + 0.05 * dist);
            let boost = (gamma * eff_sim * (1.0 + beta * dist_decay)).min(0.99);
            let coupled = 1.0 - (1.0 - s_local) * (1.0 - boost);

            if coupled > best_coupled {
                best_coupled = coupled;
                best_dice = if exact { 1.0 } else { dice };
                best_slot = Some(slot);
                best_phon = phon_match;
                best_exact = exact;
            }
        }

        if let Some(win) = best_slot {
            SrmpQueryHit {
                matched: true,
                entity_uid: win.entity_uid,
                anchor_block_idx: win.block_idx,
                kind_code: win.kind_code,
                dice_x1000: (best_dice * 1000.0).round() as u16,
                phonetic_match: best_phon,
                exact_match: best_exact,
                coupled_score_x1000: (best_coupled * 1000.0).round().min(1000.0) as u16,
            }
        } else {
            SrmpQueryHit {
                matched: false,
                entity_uid: 0,
                anchor_block_idx: 0,
                kind_code: 0,
                dice_x1000: 0,
                phonetic_match: false,
                exact_match: false,
                coupled_score_x1000: local_score_x1000,
            }
        }
    }
}
