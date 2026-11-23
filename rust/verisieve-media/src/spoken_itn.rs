//! Deterministic Spoken Inverse Text Normalization (Spoken ITN) with exact word-span
//! back-pointers for sample-accurate audio PII redaction.
//!
//! Converts ASR spoken forms back to canonical written forms:
//! - Spoken digit sequences: "four one five double five oh one nine two" -> "415550192"
//! - Spoken email addresses: "sarah dot chen at acme dot com" -> "sarah.chen@acme.com"
//! - Spelled-out names/IDs:  "S A R A H" -> "SARAH"

#[derive(Clone, Debug)]
pub struct SpokenWord {
    pub word: String,
    pub start_ms: u32,
    pub end_ms: u32,
}

#[derive(Clone, Debug)]
pub struct ItnSpanMap {
    pub norm_start_u16: usize,
    pub norm_end_u16: usize,
    pub word_start: usize,
    pub word_end: usize, // exclusive
    pub start_ms: u32,
    pub end_ms: u32,
    pub kind: &'static str, // "word" | "spoken_digits" | "spoken_email" | "spelled_letters"
}

#[derive(Clone, Debug)]
pub struct ItnResult {
    pub normalized_text: String,
    pub word_map: Vec<ItnSpanMap>,
}

fn clean_token(w: &str) -> String {
    w.trim_matches(|c: char| matches!(c, ',' | '.' | ';' | ':' | '!' | '?' | '"' | '\''))
        .to_ascii_lowercase()
}

fn spoken_digit_value(tok: &str) -> Option<&'static str> {
    match tok {
        "zero" | "oh" | "o" | "0" => Some("0"),
        "one" | "1" => Some("1"),
        "two" | "2" => Some("2"),
        "three" | "3" => Some("3"),
        "four" | "4" => Some("4"),
        "five" | "5" => Some("5"),
        "six" | "6" => Some("6"),
        "seven" | "7" => Some("7"),
        "eight" | "8" => Some("8"),
        "nine" | "9" => Some("9"),
        _ => None,
    }
}

fn is_single_ascii_letter(tok: &str) -> bool {
    tok.len() == 1 && tok.as_bytes()[0].is_ascii_alphabetic()
}

fn is_tld(tok: &str) -> bool {
    matches!(
        tok,
        "com" | "org" | "net" | "edu" | "gov" | "io" | "ai" | "co" | "au" | "uk" | "us" | "ca"
            | "de" | "fr" | "jp" | "in" | "sg" | "nz" | "dev" | "app" | "me" | "info" | "biz"
    )
}

fn try_parse_spoken_email(words: &[SpokenWord], start: usize) -> Option<(String, usize)> {
    // Look ahead for "at" within 1..=5 tokens
    let max_look = (start + 12).min(words.len());
    let mut at_idx = None;
    for j in (start + 1)..(start + 6).min(words.len()) {
        if clean_token(&words[j].word) == "at" {
            at_idx = Some(j);
            break;
        }
    }
    let at_pos = at_idx?;
    if at_pos + 2 >= words.len() {
        return None;
    }

    // Build local part from start..at_pos
    let mut local = String::new();
    let mut prev_sep = true;
    for k in start..at_pos {
        let t = clean_token(&words[k].word);
        if t.is_empty() {
            return None;
        }
        match t.as_str() {
            "dot" | "point" => {
                if prev_sep {
                    return None;
                }
                local.push('.');
                prev_sep = true;
            }
            "underscore" => {
                if prev_sep {
                    return None;
                }
                local.push('_');
                prev_sep = true;
            }
            "dash" | "hyphen" => {
                if prev_sep {
                    return None;
                }
                local.push('-');
                prev_sep = true;
            }
            "plus" => {
                if prev_sep {
                    return None;
                }
                local.push('+');
                prev_sep = true;
            }
            other => {
                if !prev_sep {
                    // Reject multi-word English prose like "send email at ..." unless joined by dot/underscore/dash
                    return None;
                }
                if !other
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
                {
                    return None;
                }
                local.push_str(other);
                prev_sep = false;
            }
        }
    }
    if local.is_empty() || prev_sep {
        return None;
    }

    // Build domain part from at_pos+1..
    let mut domain = String::new();
    let mut has_dot = false;
    let mut last_label = String::new();
    let mut idx = at_pos + 1;
    let mut expect_label = true;

    while idx < max_look {
        let t = clean_token(&words[idx].word);
        if t.is_empty() {
            break;
        }
        if expect_label {
            if t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') {
                domain.push_str(&t);
                last_label = t;
                expect_label = false;
                idx += 1;
            } else {
                break;
            }
        } else if t == "dot" || t == "point" {
            domain.push('.');
            has_dot = true;
            expect_label = true;
            idx += 1;
        } else {
            break;
        }
    }

    if expect_label {
        // Trailing "dot" without following TLD -> roll back
        return None;
    }
    if !has_dot || !is_tld(&last_label) {
        return None;
    }

    Some((format!("{}@{}", local, domain), idx))
}

fn try_parse_spoken_digits(words: &[SpokenWord], start: usize) -> Option<(String, usize)> {
    let mut digits = String::new();
    let mut idx = start;
    let mut token_count = 0usize;

    while idx < words.len() {
        let t = clean_token(&words[idx].word);
        if t == "double" && idx + 1 < words.len() {
            if let Some(d) = spoken_digit_value(&clean_token(&words[idx + 1].word)) {
                digits.push_str(d);
                digits.push_str(d);
                idx += 2;
                token_count += 2;
                continue;
            }
        }
        if t == "triple" && idx + 1 < words.len() {
            if let Some(d) = spoken_digit_value(&clean_token(&words[idx + 1].word)) {
                digits.push_str(d);
                digits.push_str(d);
                digits.push_str(d);
                idx += 2;
                token_count += 2;
                continue;
            }
        }
        if let Some(d) = spoken_digit_value(&t) {
            digits.push_str(d);
            idx += 1;
            token_count += 1;
            continue;
        }
        // Allow numeric chunks already partially transcribed by ASR (e.g. "415" "five" "five" "five")
        if !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit()) {
            digits.push_str(&t);
            idx += 1;
            token_count += 1;
            continue;
        }
        if (t == "dash" || t == "hyphen") && !digits.is_empty() && idx + 1 < words.len() {
            let next = clean_token(&words[idx + 1].word);
            if spoken_digit_value(&next).is_some()
                || next == "double"
                || next == "triple"
                || (!next.is_empty() && next.bytes().all(|b| b.is_ascii_digit()))
            {
                digits.push('-');
                idx += 1;
                token_count += 1;
                continue;
            }
        }
        break;
    }

    let digit_only_count = digits.bytes().filter(|b| b.is_ascii_digit()).count();
    if digit_only_count >= 4 && token_count >= 2 {
        Some((digits, idx))
    } else {
        None
    }
}

fn try_parse_spelled_letters(words: &[SpokenWord], start: usize) -> Option<(String, usize)> {
    let mut out = String::new();
    let mut idx = start;
    while idx < words.len() {
        let raw = words[idx]
            .word
            .trim_matches(|c: char| matches!(c, ',' | '.' | '-' | ';' | ':'));
        if is_single_ascii_letter(raw) {
            // Avoid collapsing English article "a" unless next token is also a single letter
            if out.is_empty() && raw.eq_ignore_ascii_case("a") {
                if idx + 1 >= words.len() {
                    break;
                }
                let next_raw = words[idx + 1]
                    .word
                    .trim_matches(|c: char| matches!(c, ',' | '.' | '-' | ';' | ':'));
                if !is_single_ascii_letter(next_raw) {
                    break;
                }
            }
            out.push(raw.as_bytes()[0].to_ascii_uppercase() as char);
            idx += 1;
        } else {
            break;
        }
    }
    if out.len() >= 3 {
        Some((out, idx))
    } else {
        None
    }
}

/// Normalize spoken ASR words into written form while preserving exact word & millisecond mappings.
pub fn normalize_spoken_words(words: &[SpokenWord]) -> ItnResult {
    let mut text = String::new();
    let mut map = Vec::with_capacity(words.len());
    let mut cur_u16 = 0usize;
    let mut i = 0usize;

    while i < words.len() {
        if !text.is_empty() {
            text.push(' ');
            cur_u16 += 1;
        }

        if let Some((email, next_i)) = try_parse_spoken_email(words, i) {
            let len_u16 = email.encode_utf16().count();
            text.push_str(&email);
            map.push(ItnSpanMap {
                norm_start_u16: cur_u16,
                norm_end_u16: cur_u16 + len_u16,
                word_start: i,
                word_end: next_i,
                start_ms: words[i].start_ms,
                end_ms: words[next_i - 1].end_ms,
                kind: "spoken_email",
            });
            cur_u16 += len_u16;
            i = next_i;
            continue;
        }

        if let Some((digits, next_i)) = try_parse_spoken_digits(words, i) {
            let len_u16 = digits.encode_utf16().count();
            text.push_str(&digits);
            map.push(ItnSpanMap {
                norm_start_u16: cur_u16,
                norm_end_u16: cur_u16 + len_u16,
                word_start: i,
                word_end: next_i,
                start_ms: words[i].start_ms,
                end_ms: words[next_i - 1].end_ms,
                kind: "spoken_digits",
            });
            cur_u16 += len_u16;
            i = next_i;
            continue;
        }

        if let Some((spelled, next_i)) = try_parse_spelled_letters(words, i) {
            let len_u16 = spelled.encode_utf16().count();
            text.push_str(&spelled);
            map.push(ItnSpanMap {
                norm_start_u16: cur_u16,
                norm_end_u16: cur_u16 + len_u16,
                word_start: i,
                word_end: next_i,
                start_ms: words[i].start_ms,
                end_ms: words[next_i - 1].end_ms,
                kind: "spelled_letters",
            });
            cur_u16 += len_u16;
            i = next_i;
            continue;
        }

        let w = &words[i];
        let len_u16 = w.word.encode_utf16().count();
        text.push_str(&w.word);
        map.push(ItnSpanMap {
            norm_start_u16: cur_u16,
            norm_end_u16: cur_u16 + len_u16,
            word_start: i,
            word_end: i + 1,
            start_ms: w.start_ms,
            end_ms: w.end_ms,
            kind: "word",
        });
        cur_u16 += len_u16;
        i += 1;
    }

    ItnResult {
        normalized_text: text,
        word_map: map,
    }
}
