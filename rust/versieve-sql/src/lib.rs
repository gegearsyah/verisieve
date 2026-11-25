#![cfg_attr(not(test), no_std)]

use core::cmp::Ordering;
use core::slice;

const INPUT_CAP: usize = 16_384;
const TABLE_CAP: usize = 2_097_152;
const OUTPUT_CAP: usize = 1_048_576;

const MAX_COLS: usize = 32;
const MAX_ROWS: usize = 4_096;
const MAX_GROUPS: usize = 1_024;
const MAX_TOKENS: usize = 256;
const MAX_EXPR_NODES: usize = 128;
const MAX_SELECT: usize = 32;
const MAX_ORDER: usize = 8;
const MAX_JOIN_KEYS: usize = 8;
const JOIN_SENTINEL: u16 = 0xFFFF;

const TAG_NULL: u8 = 0;
const TAG_BOOL: u8 = 1;
const TAG_NUM: u8 = 2;
const TAG_STR: u8 = 3;

static mut SQL_BUF: [u8; INPUT_CAP] = [0; INPUT_CAP];
static mut TABLE_BUF: [u8; TABLE_CAP] = [0; TABLE_CAP];
static mut TABLE2_BUF: [u8; TABLE_CAP] = [0; TABLE_CAP];
static mut OUT_BUF: [u8; OUTPUT_CAP] = [0; OUTPUT_CAP];
static mut LAST_ERR_LEN: u32 = 0;

// Decoded table cell locations into TABLE_BUF
static mut CELL_OFFS: [u32; MAX_ROWS * MAX_COLS] = [0; MAX_ROWS * MAX_COLS];
static mut CELL_META: [u32; MAX_ROWS * MAX_COLS] = [0; MAX_ROWS * MAX_COLS]; // (tag << 29) | len
static mut FILTERED_ROWS: [u16; MAX_ROWS] = [0; MAX_ROWS];
static mut SORT_ORDER: [u16; MAX_ROWS] = [0; MAX_ROWS];
static mut GROUP_HASHES: [u64; MAX_GROUPS] = [0; MAX_GROUPS];
static mut GROUP_REPR_ROW: [u16; MAX_GROUPS] = [0; MAX_GROUPS];
static mut ROW_GROUP_ID: [u16; MAX_ROWS] = [0; MAX_ROWS];
// Join product rows: (left row, right row) pair index space; 0xFFFF right = unmatched
static mut JOIN_LROW: [u16; MAX_ROWS] = [0; MAX_ROWS];
static mut JOIN_RROW: [u16; MAX_ROWS] = [0; MAX_ROWS];
static mut JOIN_KEYS_L: [u8; MAX_JOIN_KEYS] = [0; MAX_JOIN_KEYS];
static mut JOIN_KEYS_R: [u8; MAX_JOIN_KEYS] = [0; MAX_JOIN_KEYS];
static mut JOIN_NKEYS: usize = 0;
// Encoded column refs in JOIN mode: bit 16 = pair-indexed, bit 17 = right side
const COL_JOIN_BIT: usize = 1 << 16;
const COL_SIDE_R_BIT: usize = 1 << 17;
const COL_IDX_MASK: usize = 0xFF;

#[derive(Clone, Copy)]
enum Val {
    Null,
    Bool(bool),
    Num(f64),
    Str(u32, u32), // offset + length in TABLE_BUF (or unescaped string slice flag via high bit)
}

const SQL_STR_FLAG: u32 = 0x8000_0000;
const TABLE2_STR_FLAG: u32 = 0x4000_0000;

static mut GROUP_OUT_CELLS: [Val; MAX_GROUPS * MAX_SELECT] = [Val::Null; MAX_GROUPS * MAX_SELECT];
static mut GROUP_ROW_LIST: [u16; MAX_ROWS] = [0; MAX_ROWS];
static mut GROUP_HEAD: [i32; MAX_GROUPS] = [-1; MAX_GROUPS];
static mut GROUP_NEXT: [i32; MAX_ROWS] = [-1; MAX_ROWS];

#[cfg(not(test))]
#[panic_handler]
fn panic(_info: &core::panic::PanicInfo) -> ! {
    #[cfg(target_arch = "wasm32")]
    {
        core::arch::wasm32::unreachable();
    }
    #[cfg(not(target_arch = "wasm32"))]
    loop {}
}

#[no_mangle]
pub extern "C" fn vs_sql_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn vs_sql_in_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(SQL_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn vs_sql_in_cap() -> u32 {
    INPUT_CAP as u32
}

#[no_mangle]
pub extern "C" fn vs_sql_table_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(TABLE_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn vs_sql_table_cap() -> u32 {
    TABLE_CAP as u32
}

#[no_mangle]
pub extern "C" fn vs_sql_table2_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(TABLE2_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn vs_sql_table2_cap() -> u32 {
    TABLE_CAP as u32
}

#[no_mangle]
pub extern "C" fn vs_sql_out_ptr() -> *mut u8 {
    core::ptr::addr_of_mut!(OUT_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn vs_sql_out_cap() -> u32 {
    OUTPUT_CAP as u32
}

#[no_mangle]
pub extern "C" fn vs_sql_last_err_len() -> u32 {
    unsafe { LAST_ERR_LEN }
}

fn write_error(msg: &[u8]) -> i32 {
    unsafe {
        let len = msg.len().min(OUTPUT_CAP);
        OUT_BUF[..len].copy_from_slice(&msg[..len]);
        LAST_ERR_LEN = len as u32;
    }
    -1
}

fn eq_ascii_icase(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if a[i].to_ascii_lowercase() != b[i].to_ascii_lowercase() {
            return false;
        }
    }
    true
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_ident_cont(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TokKind {
    Ident,
    Str,
    Num,
    Comma,
    Dot,
    Star,
    LParen,
    RParen,
    Semi,
    Eq,
    Neq,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Copy)]
struct Tok {
    kind: TokKind,
    start: u16,
    end: u16,
}

impl Tok {
    const EMPTY: Self = Self {
        kind: TokKind::Semi,
        start: 0,
        end: 0,
    };

    fn slice<'a>(&self, sql: &'a [u8]) -> &'a [u8] {
        &sql[self.start as usize..self.end as usize]
    }
}

fn tokenize_sql(sql: &[u8], out: &mut [Tok; MAX_TOKENS]) -> Result<usize, &'static [u8]> {
    let mut n = 0usize;
    let mut i = 0usize;
    let len = sql.len();

    while i < len {
        let b = sql[i];
        if b.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        // Reject SQL comments or line comments unless clean single query? Wait support -- line comments? Better reject ambiguous comment smuggling if malformed, or skip clean whitespace. Reject -- inside single statement to keep parser predictable.
        if b == b'-' && i + 1 < len && sql[i + 1] == b'-' {
            return Err(b"UNSUPPORTED_SQL_SYNTAX: SQL comments are not supported");
        }
        if b == b'/' && i + 1 < len && sql[i + 1] == b'*' {
            return Err(b"UNSUPPORTED_SQL_SYNTAX: SQL block comments are not supported");
        }

        if n >= MAX_TOKENS {
            return Err(b"SQL_SYNTAX_ERROR: query exceeds maximum token limit");
        }

        if b == b'\'' {
            let start = i + 1;
            i += 1;
            let mut closed = false;
            while i < len {
                if sql[i] == b'\'' {
                    if i + 1 < len && sql[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    closed = true;
                    break;
                }
                i += 1;
            }
            if !closed {
                return Err(b"SQL_SYNTAX_ERROR: unterminated string literal");
            }
            out[n] = Tok {
                kind: TokKind::Str,
                start: start as u16,
                end: i as u16,
            };
            n += 1;
            i += 1;
            continue;
        }

        if b == b'"' {
            let start = i + 1;
            i += 1;
            while i < len && sql[i] != b'"' {
                i += 1;
            }
            if i >= len || i == start {
                return Err(b"SQL_SYNTAX_ERROR: unterminated or empty quoted identifier");
            }
            out[n] = Tok {
                kind: TokKind::Ident,
                start: start as u16,
                end: i as u16,
            };
            n += 1;
            i += 1;
            continue;
        }

        if is_ident_start(b) {
            let start = i;
            i += 1;
            while i < len && is_ident_cont(sql[i]) {
                i += 1;
            }
            out[n] = Tok {
                kind: TokKind::Ident,
                start: start as u16,
                end: i as u16,
            };
            n += 1;
            continue;
        }

        let is_signed_num = (b == b'-' || b == b'+')
            && i + 1 < len
            && sql[i + 1].is_ascii_digit()
            && (n == 0
                || !matches!(
                    out[n - 1].kind,
                    TokKind::Ident | TokKind::Num | TokKind::Str | TokKind::RParen
                ));
        if b.is_ascii_digit() || is_signed_num {
            let start = i;
            i += 1;
            let mut dots = 0u8;
            while i < len {
                let c = sql[i];
                if c.is_ascii_digit() {
                    i += 1;
                } else if c == b'.' && dots == 0 {
                    dots = 1;
                    i += 1;
                } else {
                    break;
                }
            }
            out[n] = Tok {
                kind: TokKind::Num,
                start: start as u16,
                end: i as u16,
            };
            n += 1;
            continue;
        }

        let (kind, adv) = match b {
            b',' => (TokKind::Comma, 1),
            b'.' => (TokKind::Dot, 1),
            b'*' => (TokKind::Star, 1),
            b'(' => (TokKind::LParen, 1),
            b')' => (TokKind::RParen, 1),
            b';' => (TokKind::Semi, 1),
            b'=' => (TokKind::Eq, 1),
            b'!' if i + 1 < len && sql[i + 1] == b'=' => (TokKind::Neq, 2),
            b'<' if i + 1 < len && sql[i + 1] == b'>' => (TokKind::Neq, 2),
            b'<' if i + 1 < len && sql[i + 1] == b'=' => (TokKind::Le, 2),
            b'<' => (TokKind::Lt, 1),
            b'>' if i + 1 < len && sql[i + 1] == b'=' => (TokKind::Ge, 2),
            b'>' => (TokKind::Gt, 1),
            _ => return Err(b"SQL_SYNTAX_ERROR: unexpected character or unsupported operator"),
        };
        out[n] = Tok {
            kind,
            start: i as u16,
            end: (i + adv) as u16,
        };
        n += 1;
        i += adv;
    }

    if n == 0 {
        return Err(b"EMPTY_SQL_ERROR: query must not be empty");
    }

    // Reject trailing tokens after `;`
    for k in 0..n {
        if out[k].kind == TokKind::Semi && k + 1 < n {
            return Err(b"MULTI_STATEMENT_SQL_REJECTED: multiple SQL statements are not allowed");
        }
    }
    if out[n - 1].kind == TokKind::Semi {
        n -= 1;
    }
    if n == 0 {
        return Err(b"EMPTY_SQL_ERROR: query must not be empty");
    }

    Ok(n)
}

fn parse_f64_ascii(s: &[u8]) -> Result<f64, &'static [u8]> {
    if s.is_empty() {
        return Err(b"SQL_SYNTAX_ERROR: empty number literal");
    }
    let mut i = 0usize;
    let mut neg = false;
    if s[0] == b'-' {
        neg = true;
        i = 1;
    } else if s[0] == b'+' {
        i = 1;
    }
    if i >= s.len() {
        return Err(b"SQL_SYNTAX_ERROR: malformed number literal");
    }
    let mut int_part: f64 = 0.0;
    let mut frac_part: f64 = 0.0;
    let mut frac_scale: f64 = 1.0;
    let mut seen_dot = false;
    let mut seen_digit = false;
    while i < s.len() {
        let c = s[i];
        if c.is_ascii_digit() {
            seen_digit = true;
            let d = (c - b'0') as f64;
            if !seen_dot {
                int_part = int_part * 10.0 + d;
            } else {
                frac_scale *= 10.0;
                frac_part += d / frac_scale;
            }
        } else if c == b'.' && !seen_dot {
            seen_dot = true;
        } else {
            return Err(b"SQL_SYNTAX_ERROR: invalid numeric literal");
        }
        i += 1;
    }
    if !seen_digit {
        return Err(b"SQL_SYNTAX_ERROR: invalid numeric literal");
    }
    let v = int_part + frac_part;
    Ok(if neg { -v } else { v })
}

fn parse_u32_ascii(s: &[u8]) -> Result<u32, &'static [u8]> {
    if s.is_empty() {
        return Err(b"SQL_SYNTAX_ERROR: expected non-negative integer");
    }
    let mut acc: u64 = 0;
    for &b in s {
        if !b.is_ascii_digit() {
            return Err(b"SQL_SYNTAX_ERROR: expected non-negative integer");
        }
        acc = acc * 10 + (b - b'0') as u64;
        if acc > u32::MAX as u64 {
            return Err(b"SQL_SYNTAX_ERROR: integer exceeds u32 range");
        }
    }
    Ok(acc as u32)
}

fn find_from_table<'a>(sql: &'a [u8], toks: &[Tok], n_toks: usize) -> Result<(usize, &'a [u8]), &'static [u8]> {
    if toks[0].kind != TokKind::Ident || !eq_ascii_icase(toks[0].slice(sql), b"SELECT") {
        return Err(b"UNSUPPORTED_SQL_STATEMENT: only SELECT queries are supported");
    }
    let mut depth: i32 = 0;
    let mut i = 1usize;
    while i < n_toks {
        match toks[i].kind {
            TokKind::LParen => depth += 1,
            TokKind::RParen => {
                depth -= 1;
                if depth < 0 {
                    return Err(b"SQL_SYNTAX_ERROR: unmatched closing parenthesis");
                }
            }
            TokKind::Ident if depth == 0 && eq_ascii_icase(toks[i].slice(sql), b"FROM") => {
                if i + 1 >= n_toks {
                    return Err(b"SQL_SYNTAX_ERROR: expected table name after FROM");
                }
                if toks[i + 1].kind == TokKind::LParen {
                    return Err(b"UNSUPPORTED_SQL_SYNTAX: subqueries in FROM are not supported");
                }
                if toks[i + 1].kind != TokKind::Ident {
                    return Err(b"SQL_SYNTAX_ERROR: expected table identifier after FROM");
                }
                return Ok((i + 1, toks[i + 1].slice(sql)));
            }
            _ => {}
        }
        i += 1;
    }
    Err(b"SQL_SYNTAX_ERROR: missing FROM clause")
}

#[no_mangle]
pub extern "C" fn vs_sql_probe_table(sql_len: u32) -> i32 {
    unsafe {
        LAST_ERR_LEN = 0;
    }
    let sl = (sql_len as usize).min(INPUT_CAP);
    let sql = unsafe { &SQL_BUF[..sl] };
    let mut toks = [Tok::EMPTY; MAX_TOKENS];
    let n_toks = match tokenize_sql(sql, &mut toks) {
        Ok(n) => n,
        Err(e) => return write_error(e),
    };
    let table = match find_from_table(sql, &toks, n_toks) {
        Ok((_, t)) => t,
        Err(e) => return write_error(e),
    };
    let len = table.len().min(OUTPUT_CAP);
    unsafe {
        OUT_BUF[..len].copy_from_slice(&table[..len]);
    }
    len as i32
}

// Light JOIN-table probe: returns the JOIN target ident written to OUT_BUF, 0 when the query
// has no JOIN, or -1 with an error message. Full validation happens in vs_sql_exec2 after both
// tables are loaded; this probe only locates the second table name so the host can encode it.
#[no_mangle]
pub extern "C" fn vs_sql_probe_join(sql_len: u32) -> i32 {
    unsafe {
        LAST_ERR_LEN = 0;
    }
    let sl = (sql_len as usize).min(INPUT_CAP);
    let sql = unsafe { &SQL_BUF[..sl] };
    let mut toks = [Tok::EMPTY; MAX_TOKENS];
    let n_toks = match tokenize_sql(sql, &mut toks) {
        Ok(n) => n,
        Err(e) => return write_error(e),
    };
    let (table_tok, _) = match find_from_table(sql, &toks, n_toks) {
        Ok(v) => v,
        Err(e) => return write_error(e),
    };
    let mut pos = table_tok + 1;
    if pos < n_toks && toks[pos].kind == TokKind::Ident {
        let w = toks[pos].slice(sql);
        if eq_ascii_icase(w, b"AS") {
            pos += 1;
            if pos < n_toks && toks[pos].kind == TokKind::Ident && !is_clause_boundary(sql, toks[pos]) {
                pos += 1;
            } else {
                return 0;
            }
        } else if !is_clause_boundary(sql, toks[pos]) && !eq_ascii_icase(w, b"ON") {
            pos += 1;
        }
    }
    let is_join = pos < n_toks && toks[pos].kind == TokKind::Ident && eq_ascii_icase(toks[pos].slice(sql), b"JOIN");
    let is_inner_join = pos + 2 < n_toks
        && toks[pos].kind == TokKind::Ident
        && eq_ascii_icase(toks[pos].slice(sql), b"INNER")
        && toks[pos + 1].kind == TokKind::Ident
        && eq_ascii_icase(toks[pos + 1].slice(sql), b"JOIN");
    let name_tok = if is_join {
        Some(pos + 1)
    } else if is_inner_join {
        Some(pos + 2)
    } else {
        None
    };
    match name_tok {
        Some(k) if k < n_toks && toks[k].kind == TokKind::Ident => {
            let t = toks[k].slice(sql);
            let len = t.len().min(OUTPUT_CAP);
            unsafe {
                OUT_BUF[..len].copy_from_slice(&t[..len]);
            }
            len as i32
        }
        _ => 0,
    }
}

struct TableView<'a> {
    col_names: [&'a [u8]; MAX_COLS],
    col_count: usize,
    row_count: usize,
    buf: &'a [u8],
    base: usize, // row offset into the shared CELL_* decode arrays (second table stacks above the first)
    flag: u32,   // marker ORed into string cell offsets so values remember their source buffer
}

fn read_u16_le(b: &[u8], off: &mut usize) -> Result<u16, &'static [u8]> {
    if *off + 2 > b.len() {
        return Err(b"TABLE_DECODE_ERROR: truncated u16");
    }
    let v = u16::from_le_bytes([b[*off], b[*off + 1]]);
    *off += 2;
    Ok(v)
}

fn read_u32_le(b: &[u8], off: &mut usize) -> Result<u32, &'static [u8]> {
    if *off + 4 > b.len() {
        return Err(b"TABLE_DECODE_ERROR: truncated u32");
    }
    let v = u32::from_le_bytes([b[*off], b[*off + 1], b[*off + 2], b[*off + 3]]);
    *off += 4;
    Ok(v)
}

fn decode_table<'a>(buf: &'a [u8], base: usize, flag: u32) -> Result<TableView<'a>, &'static [u8]> {
    let mut off = 0usize;
    let col_count = read_u16_le(buf, &mut off)? as usize;
    if col_count > MAX_COLS {
        return Err(b"TABLE_DECODE_ERROR: column count exceeds MAX_COLS");
    }
    let mut col_names: [&'a [u8]; MAX_COLS] = [&[]; MAX_COLS];
    for c in 0..col_count {
        let nlen = read_u16_le(buf, &mut off)? as usize;
        if off + nlen > buf.len() {
            return Err(b"TABLE_DECODE_ERROR: truncated column name");
        }
        col_names[c] = &buf[off..off + nlen];
        off += nlen;
    }
    let row_count = read_u32_le(buf, &mut off)? as usize;
    if base + row_count > MAX_ROWS {
        return Err(b"TABLE_DECODE_ERROR: row count exceeds MAX_ROWS");
    }

    for r in 0..row_count {
        for c in 0..col_count {
            if off >= buf.len() {
                return Err(b"TABLE_DECODE_ERROR: truncated cell tag");
            }
            let tag = buf[off];
            off += 1;
            let idx = (base + r) * MAX_COLS + c;
            match tag {
                TAG_NULL => unsafe {
                    CELL_OFFS[idx] = 0;
                    CELL_META[idx] = (TAG_NULL as u32) << 29;
                },
                TAG_BOOL => {
                    if off >= buf.len() {
                        return Err(b"TABLE_DECODE_ERROR: truncated bool cell");
                    }
                    unsafe {
                        CELL_OFFS[idx] = off as u32;
                        CELL_META[idx] = ((TAG_BOOL as u32) << 29) | 1;
                    }
                    off += 1;
                }
                TAG_NUM => {
                    if off + 8 > buf.len() {
                        return Err(b"TABLE_DECODE_ERROR: truncated f64 cell");
                    }
                    unsafe {
                        CELL_OFFS[idx] = off as u32;
                        CELL_META[idx] = ((TAG_NUM as u32) << 29) | 8;
                    }
                    off += 8;
                }
                TAG_STR => {
                    let slen = read_u32_le(buf, &mut off)? as usize;
                    if off + slen > buf.len() {
                        return Err(b"TABLE_DECODE_ERROR: truncated string cell");
                    }
                    unsafe {
                        CELL_OFFS[idx] = off as u32;
                        CELL_META[idx] = ((TAG_STR as u32) << 29) | (slen as u32 & 0x1fff_ffff);
                    }
                    off += slen;
                }
                _ => return Err(b"TABLE_DECODE_ERROR: invalid cell type tag"),
            }
        }
    }

    Ok(TableView {
        col_names,
        col_count,
        row_count,
        buf,
        base,
        flag,
    })
}

fn find_col(tv: &TableView, name: &[u8]) -> Option<usize> {
    for c in 0..tv.col_count {
        if eq_ascii_icase(tv.col_names[c], name) {
            return Some(c);
        }
    }
    None
}

fn raw_cell_val(tv: &TableView, row: usize, col: usize) -> Val {
    let idx = (tv.base + row) * MAX_COLS + col;
    let meta = unsafe { CELL_META[idx] };
    let off = unsafe { CELL_OFFS[idx] };
    let tag = (meta >> 29) as u8;
    let len = meta & 0x1fff_ffff;
    match tag {
        TAG_NULL => Val::Null,
        TAG_BOOL => Val::Bool(tv.buf[off as usize] != 0),
        TAG_NUM => {
            let p = off as usize;
            let bytes: [u8; 8] = [
                tv.buf[p],
                tv.buf[p + 1],
                tv.buf[p + 2],
                tv.buf[p + 3],
                tv.buf[p + 4],
                tv.buf[p + 5],
                tv.buf[p + 6],
                tv.buf[p + 7],
            ];
            Val::Num(f64::from_le_bytes(bytes))
        }
        TAG_STR => Val::Str(off | tv.flag, len),
        _ => Val::Null,
    }
}

// View pair threaded through evaluation: tv is the FROM table, tv2 the JOIN right side
// (equal to tv when the query does not join or joins two instances of one table).
#[derive(Clone, Copy)]
struct Views<'a> {
    sql: &'a [u8],
    tv: &'a TableView<'a>,
    tv2: &'a TableView<'a>,
}

// In JOIN mode flagged column refs address the (left,right) pair product, not the source row
fn read_cell_val(views: &Views, row: usize, col: usize) -> Val {
    let (tv, tv2) = (views.tv, views.tv2);
    if col & COL_JOIN_BIT != 0 {
        let c = col & COL_IDX_MASK;
        if col & COL_SIDE_R_BIT != 0 {
            let r = unsafe { JOIN_RROW[row] };
            if r == JOIN_SENTINEL {
                return Val::Null;
            }
            return raw_cell_val(tv2, r as usize, c);
        }
        let l = unsafe { JOIN_LROW[row] };
        return raw_cell_val(tv, l as usize, c);
    }
    raw_cell_val(tv, row, col)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum AggKind {
    CountAll,
    CountCol,
    Sum,
    Avg,
    Min,
    Max,
}

#[derive(Clone, Copy)]
enum SelectItemKind {
    Star,
    Col(usize),
    Agg {
        agg: AggKind,
        col: usize, // unused for CountAll
        round_digits: i8, // -1 if none
    },
    RoundCol {
        col: usize,
        digits: u8,
    },
}

#[derive(Clone, Copy)]
struct SelectItem {
    kind: SelectItemKind,
    alias_tok: i16, // index into toks or -1
    label_start: u16,
    label_end: u16,
}

impl SelectItem {
    const EMPTY: Self = Self {
        kind: SelectItemKind::Star,
        alias_tok: -1,
        label_start: 0,
        label_end: 0,
    };
}

#[derive(Clone, Copy)]
enum Operand {
    Col(usize),
    LitNum(f64),
    LitBool(bool),
    LitStr(u16, u16),
    LitNull,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CmpOp {
    Eq,
    Neq,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Clone, Copy)]
enum ExprNode {
    Or(u8, u8),
    And(u8, u8),
    Not(u8),
    Cmp(CmpOp, Operand, Operand),
    IsNull(usize, bool), // (col, negated)
    Like(usize, u16, u16, bool), // (col, pat_start, pat_end, negated)
}

impl ExprNode {
    const DUMMY: Self = Self::IsNull(0, false);
}

#[derive(Clone, Copy)]
struct OrderItem {
    name_start: u16,
    name_end: u16,
    desc: bool,
}

impl OrderItem {
    const EMPTY: Self = Self {
        name_start: 0,
        name_end: 0,
        desc: false,
    };
}

fn is_clause_boundary(sql: &[u8], tok: Tok) -> bool {
    tok.kind == TokKind::Ident
        && (eq_ascii_icase(tok.slice(sql), b"FROM")
            || eq_ascii_icase(tok.slice(sql), b"WHERE")
            || eq_ascii_icase(tok.slice(sql), b"GROUP")
            || eq_ascii_icase(tok.slice(sql), b"ORDER")
            || eq_ascii_icase(tok.slice(sql), b"LIMIT")
            || eq_ascii_icase(tok.slice(sql), b"HAVING")
            || eq_ascii_icase(tok.slice(sql), b"JOIN")
            || eq_ascii_icase(tok.slice(sql), b"INNER")
            || eq_ascii_icase(tok.slice(sql), b"LEFT")
            || eq_ascii_icase(tok.slice(sql), b"RIGHT")
            || eq_ascii_icase(tok.slice(sql), b"CROSS")
            || eq_ascii_icase(tok.slice(sql), b"UNION")
            || eq_ascii_icase(tok.slice(sql), b"OFFSET"))
}

fn check_unsupported_keyword(w: &[u8]) -> Result<(), &'static [u8]> {
    if eq_ascii_icase(w, b"JOIN")
        || eq_ascii_icase(w, b"INNER")
        || eq_ascii_icase(w, b"LEFT")
        || eq_ascii_icase(w, b"RIGHT")
        || eq_ascii_icase(w, b"CROSS")
        || eq_ascii_icase(w, b"HAVING")
        || eq_ascii_icase(w, b"UNION")
        || eq_ascii_icase(w, b"INTERSECT")
        || eq_ascii_icase(w, b"EXCEPT")
        || eq_ascii_icase(w, b"WITH")
        || eq_ascii_icase(w, b"OFFSET")
        || eq_ascii_icase(w, b"OVER")
        || eq_ascii_icase(w, b"INTO")
    {
        return Err(b"UNSUPPORTED_SQL_SYNTAX: clause/keyword is not supported in SQL subset");
    }
    Ok(())
}

fn parse_col_ref(
    sql: &[u8],
    views: &Views,
    table_name: &[u8],
    jctx: Option<(&[u8], &[u8])>,
    toks: &[Tok],
    pos: &mut usize,
    n_toks: usize,
) -> Result<usize, &'static [u8]> {
    if *pos >= n_toks || toks[*pos].kind != TokKind::Ident {
        return Err(b"SQL_SYNTAX_ERROR: expected column name");
    }
    let mut name = toks[*pos].slice(sql);
    *pos += 1;
    if *pos + 1 < n_toks && toks[*pos].kind == TokKind::Dot && toks[*pos + 1].kind == TokKind::Ident {
        if let Some((q1, q2)) = jctx {
            let side = if eq_ascii_icase(name, q1) {
                0usize
            } else if eq_ascii_icase(name, q2) {
                1usize
            } else {
                return Err(b"UNKNOWN_SQL_TABLE_QUALIFIER: unknown table prefix on column");
            };
            name = toks[*pos + 1].slice(sql);
            *pos += 2;
            let view = if side == 1 { views.tv2 } else { views.tv };
            let c = find_col(view, name).ok_or(b"UNKNOWN_SQL_COLUMN: column does not exist in table" as &[u8])?;
            return Ok(c | COL_JOIN_BIT | (side << 17));
        }
        if !eq_ascii_icase(name, table_name) {
            return Err(b"UNKNOWN_SQL_TABLE_QUALIFIER: unknown table prefix on column");
        }
        name = toks[*pos + 1].slice(sql);
        *pos += 2;
    }
    let c = find_col(views.tv, name).ok_or(b"UNKNOWN_SQL_COLUMN: column does not exist in table" as &[u8])?;
    if jctx.is_some() {
        return Err(b"SQL_VALIDATION_ERROR: unqualified column is ambiguous in JOIN query");
    }
    Ok(c)
}

// Parses the FROM tail: optional alias, then optionally JOIN <table> [alias] ON equi-key(s).
// In single-table mode (multi = false) only aliased instances of the FROM table may be joined;
// in two-table mode (multi = true) the JOIN target is a second host-encoded table.
// Returns the join context (side qualifiers) and the token position just past the clause.
fn parse_join_tail<'a>(
    sql: &'a [u8],
    views: &Views<'a>,
    table_name: &'a [u8],
    multi: bool,
    toks: &[Tok],
    mut pos: usize,
    n_toks: usize,
) -> Result<(Option<(&'a [u8], &'a [u8])>, usize), &'static [u8]> {
    let mut q1 = table_name;
    let mut q1_is_alias = false;
    if pos < n_toks && toks[pos].kind == TokKind::Ident {
        let w = toks[pos].slice(sql);
        if eq_ascii_icase(w, b"AS") {
            pos += 1;
            if pos >= n_toks || toks[pos].kind != TokKind::Ident || is_clause_boundary(sql, toks[pos]) {
                return Err(b"SQL_SYNTAX_ERROR: expected alias identifier after AS");
            }
            q1 = toks[pos].slice(sql);
            q1_is_alias = true;
            pos += 1;
        } else if !is_clause_boundary(sql, toks[pos]) && !eq_ascii_icase(w, b"ON") {
            q1 = w;
            q1_is_alias = true;
            pos += 1;
        }
    }
    if pos >= n_toks || toks[pos].kind != TokKind::Ident {
        return Ok((None, pos));
    }
    let kw = toks[pos].slice(sql);
    if eq_ascii_icase(kw, b"INNER") {
        pos += 1;
        if pos >= n_toks || toks[pos].kind != TokKind::Ident || !eq_ascii_icase(toks[pos].slice(sql), b"JOIN") {
            return Err(b"SQL_SYNTAX_ERROR: expected JOIN after INNER");
        }
        pos += 1;
    } else if eq_ascii_icase(kw, b"JOIN") {
        pos += 1;
    } else {
        return Ok((None, pos));
    }

    if pos >= n_toks || toks[pos].kind != TokKind::Ident {
        return Err(b"SQL_SYNTAX_ERROR: expected table name after JOIN");
    }
    let join_name = toks[pos].slice(sql);
    let same_table = eq_ascii_icase(join_name, table_name);
    if !multi && !same_table {
        return Err(b"UNSUPPORTED_SQL_JOIN: JOIN table is not the loaded table (aliased instances of the FROM table only)");
    }
    pos += 1;
    let mut q2 = join_name;
    if pos < n_toks && toks[pos].kind == TokKind::Ident {
        let aw = toks[pos].slice(sql);
        if eq_ascii_icase(aw, b"AS") {
            pos += 1;
            if pos >= n_toks || toks[pos].kind != TokKind::Ident || is_clause_boundary(sql, toks[pos]) {
                return Err(b"SQL_SYNTAX_ERROR: expected alias identifier after AS");
            }
            q2 = toks[pos].slice(sql);
            pos += 1;
        } else if !is_clause_boundary(sql, toks[pos]) && !eq_ascii_icase(aw, b"ON") {
            q2 = aw;
            pos += 1;
        }
    }
    if eq_ascii_icase(q1, q2) || (same_table && eq_ascii_icase(q2, table_name)) {
        return Err(b"SQL_VALIDATION_ERROR: JOIN requires distinct aliases for both sides");
    }
    if same_table && !q1_is_alias {
        return Err(b"SQL_VALIDATION_ERROR: JOIN requires an alias on the left instance too");
    }
    if pos >= n_toks || toks[pos].kind != TokKind::Ident || !eq_ascii_icase(toks[pos].slice(sql), b"ON") {
        return Err(b"SQL_SYNTAX_ERROR: expected ON after JOIN instance");
    }
    pos += 1;
    unsafe {
        JOIN_NKEYS = 0;
    }
    loop {
        let lc = parse_col_ref(sql, views, table_name, Some((q1, q2)), toks, &mut pos, n_toks)?;
        if pos >= n_toks || toks[pos].kind != TokKind::Eq {
            return Err(b"UNSUPPORTED_SQL_JOIN: only equi-join ON col = col comparisons are supported");
        }
        pos += 1;
        let rc = parse_col_ref(sql, views, table_name, Some((q1, q2)), toks, &mut pos, n_toks)?;
        let (l, r) = if lc & COL_SIDE_R_BIT != 0 {
            if rc & COL_SIDE_R_BIT != 0 {
                return Err(b"SQL_VALIDATION_ERROR: ON comparison must reference both join sides");
            }
            (rc & COL_IDX_MASK, lc & COL_IDX_MASK)
        } else {
            if rc & COL_SIDE_R_BIT == 0 {
                return Err(b"SQL_VALIDATION_ERROR: ON comparison must reference both join sides");
            }
            (lc & COL_IDX_MASK, rc & COL_IDX_MASK)
        };
        unsafe {
            if JOIN_NKEYS >= MAX_JOIN_KEYS {
                return Err(b"SQL_SYNTAX_ERROR: too many JOIN equality keys");
            }
            JOIN_KEYS_L[JOIN_NKEYS] = l as u8;
            JOIN_KEYS_R[JOIN_NKEYS] = r as u8;
            JOIN_NKEYS += 1;
        }
        if pos < n_toks && toks[pos].kind == TokKind::Ident && eq_ascii_icase(toks[pos].slice(sql), b"AND") {
            pos += 1;
            continue;
        }
        break;
    }
    Ok((Some((q1, q2)), pos))
}

fn parse_agg_call(
    sql: &[u8],
    views: &Views,
    table_name: &[u8],
    jctx: Option<(&[u8], &[u8])>,
    toks: &[Tok],
    pos: &mut usize,
    n_toks: usize,
) -> Result<(AggKind, usize), &'static [u8]> {
    let fn_name = toks[*pos].slice(sql);
    let agg_base = if eq_ascii_icase(fn_name, b"COUNT") {
        Some(AggKind::CountCol)
    } else if eq_ascii_icase(fn_name, b"SUM") {
        Some(AggKind::Sum)
    } else if eq_ascii_icase(fn_name, b"AVG") {
        Some(AggKind::Avg)
    } else if eq_ascii_icase(fn_name, b"MIN") {
        Some(AggKind::Min)
    } else if eq_ascii_icase(fn_name, b"MAX") {
        Some(AggKind::Max)
    } else {
        None
    };
    let agg_base = agg_base.ok_or(b"UNSUPPORTED_SQL_FUNCTION: unsupported SQL function call" as &[u8])?;
    *pos += 1;
    if *pos >= n_toks || toks[*pos].kind != TokKind::LParen {
        return Err(b"SQL_SYNTAX_ERROR: expected '(' after aggregate function");
    }
    *pos += 1;
    if *pos >= n_toks {
        return Err(b"SQL_SYNTAX_ERROR: unexpected end inside function call");
    }
    let (kind, col) = if agg_base == AggKind::CountCol && toks[*pos].kind == TokKind::Star {
        *pos += 1;
        (AggKind::CountAll, 0usize)
    } else {
        let c = parse_col_ref(sql, views, table_name, jctx, toks, pos, n_toks)?;
        (agg_base, c)
    };
    if *pos >= n_toks || toks[*pos].kind != TokKind::RParen {
        return Err(b"SQL_SYNTAX_ERROR: expected ')' closing aggregate call");
    }
    *pos += 1;
    Ok((kind, col))
}

fn parse_select_list(
    sql: &[u8],
    views: &Views,
    table_name: &[u8],
    jctx: Option<(&[u8], &[u8])>,
    toks: &[Tok],
    pos: &mut usize,
    n_toks: usize,
    items: &mut [SelectItem; MAX_SELECT],
) -> Result<usize, &'static [u8]> {
    let mut count = 0usize;
    loop {
        if *pos >= n_toks {
            return Err(b"SQL_SYNTAX_ERROR: missing FROM after SELECT list");
        }
        if count >= MAX_SELECT {
            return Err(b"SQL_SYNTAX_ERROR: too many SELECT items");
        }
        let item_start = toks[*pos].start;

        if toks[*pos].kind == TokKind::Star {
            *pos += 1;
            items[count] = SelectItem {
                kind: SelectItemKind::Star,
                alias_tok: -1,
                label_start: item_start,
                label_end: toks[*pos - 1].end,
            };
            count += 1;
        } else if toks[*pos].kind == TokKind::Ident {
            if *pos + 1 < n_toks && toks[*pos + 1].kind == TokKind::LParen {
                let fn_name = toks[*pos].slice(sql);
                let kind = if eq_ascii_icase(fn_name, b"ROUND") {
                    *pos += 2; // skip ROUND and (
                    if *pos >= n_toks {
                        return Err(b"SQL_SYNTAX_ERROR: expected argument in ROUND()");
                    }
                    let inner_agg = *pos + 1 < n_toks && toks[*pos].kind == TokKind::Ident && toks[*pos + 1].kind == TokKind::LParen;
                    let res_kind = if inner_agg {
                        let (agg, col) = parse_agg_call(sql, views, table_name, jctx, toks, pos, n_toks)?;
                        let mut digits: i8 = 0;
                        if *pos < n_toks && toks[*pos].kind == TokKind::Comma {
                            *pos += 1;
                            if *pos >= n_toks || toks[*pos].kind != TokKind::Num {
                                return Err(b"SQL_SYNTAX_ERROR: ROUND precision must be non-negative integer");
                            }
                            let d = parse_u32_ascii(toks[*pos].slice(sql))?;
                            digits = d.min(9) as i8;
                            *pos += 1;
                        }
                        SelectItemKind::Agg {
                            agg,
                            col,
                            round_digits: digits,
                        }
                    } else {
                        let col = parse_col_ref(sql, views, table_name, jctx, toks, pos, n_toks)?;
                        let mut digits: u8 = 0;
                        if *pos < n_toks && toks[*pos].kind == TokKind::Comma {
                            *pos += 1;
                            if *pos >= n_toks || toks[*pos].kind != TokKind::Num {
                                return Err(b"SQL_SYNTAX_ERROR: ROUND precision must be non-negative integer");
                            }
                            digits = parse_u32_ascii(toks[*pos].slice(sql))?.min(9) as u8;
                            *pos += 1;
                        }
                        SelectItemKind::RoundCol { col, digits }
                    };
                    if *pos >= n_toks || toks[*pos].kind != TokKind::RParen {
                        return Err(b"SQL_SYNTAX_ERROR: expected ')' closing ROUND()");
                    }
                    *pos += 1;
                    res_kind
                } else {
                    let (agg, col) = parse_agg_call(sql, views, table_name, jctx, toks, pos, n_toks)?;
                    SelectItemKind::Agg {
                        agg,
                        col,
                        round_digits: -1,
                    }
                };

                let expr_end = toks[*pos - 1].end;
                let mut alias_tok: i16 = -1;
                if *pos < n_toks && toks[*pos].kind == TokKind::Ident && eq_ascii_icase(toks[*pos].slice(sql), b"AS") {
                    *pos += 1;
                    if *pos >= n_toks || toks[*pos].kind != TokKind::Ident || is_clause_boundary(sql, toks[*pos]) {
                        return Err(b"SQL_SYNTAX_ERROR: expected alias identifier after AS");
                    }
                    alias_tok = *pos as i16;
                    *pos += 1;
                }
                items[count] = SelectItem {
                    kind,
                    alias_tok,
                    label_start: item_start,
                    label_end: expr_end,
                };
                count += 1;
            } else {
                if eq_ascii_icase(toks[*pos].slice(sql), b"FROM") {
                    return Err(b"SQL_SYNTAX_ERROR: empty SELECT column list before FROM");
                }
                let col = parse_col_ref(sql, views, table_name, jctx, toks, pos, n_toks)?;
                let expr_end = toks[*pos - 1].end;
                let mut alias_tok: i16 = -1;
                if *pos < n_toks && toks[*pos].kind == TokKind::Ident && eq_ascii_icase(toks[*pos].slice(sql), b"AS") {
                    *pos += 1;
                    if *pos >= n_toks || toks[*pos].kind != TokKind::Ident || is_clause_boundary(sql, toks[*pos]) {
                        return Err(b"SQL_SYNTAX_ERROR: expected alias identifier after AS");
                    }
                    alias_tok = *pos as i16;
                    *pos += 1;
                }
                items[count] = SelectItem {
                    kind: SelectItemKind::Col(col),
                    alias_tok,
                    label_start: item_start,
                    label_end: expr_end,
                };
                count += 1;
            }
        } else {
            return Err(b"SQL_SYNTAX_ERROR: invalid token in SELECT list");
        }

        if *pos < n_toks && toks[*pos].kind == TokKind::Comma {
            *pos += 1;
            continue;
        }
        break;
    }

    if count == 0 {
        return Err(b"SQL_SYNTAX_ERROR: SELECT list cannot be empty");
    }
    Ok(count)
}

struct ExprParser<'a> {
    sql: &'a [u8],
    views: &'a Views<'a>,
    table_name: &'a [u8],
    jctx: Option<(&'a [u8], &'a [u8])>,
    toks: &'a [Tok],
    n_toks: usize,
    pos: usize,
    nodes: [ExprNode; MAX_EXPR_NODES],
    n_nodes: usize,
}

impl<'a> ExprParser<'a> {
    fn push(&mut self, node: ExprNode) -> Result<u8, &'static [u8]> {
        if self.n_nodes >= MAX_EXPR_NODES {
            return Err(b"SQL_SYNTAX_ERROR: WHERE expression too complex");
        }
        let id = self.n_nodes as u8;
        self.nodes[self.n_nodes] = node;
        self.n_nodes += 1;
        Ok(id)
    }

    fn at_clause_end(&self) -> bool {
        if self.pos >= self.n_toks {
            return true;
        }
        let t = self.toks[self.pos];
        t.kind == TokKind::Ident
            && (eq_ascii_icase(t.slice(self.sql), b"GROUP")
                || eq_ascii_icase(t.slice(self.sql), b"ORDER")
                || eq_ascii_icase(t.slice(self.sql), b"LIMIT")
                || eq_ascii_icase(t.slice(self.sql), b"HAVING")
                || eq_ascii_icase(t.slice(self.sql), b"UNION")
                || eq_ascii_icase(t.slice(self.sql), b"JOIN"))
    }

    fn parse_or(&mut self) -> Result<u8, &'static [u8]> {
        let mut lhs = self.parse_and()?;
        while !self.at_clause_end()
            && self.toks[self.pos].kind == TokKind::Ident
            && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"OR")
        {
            self.pos += 1;
            let rhs = self.parse_and()?;
            lhs = self.push(ExprNode::Or(lhs, rhs))?;
        }
        Ok(lhs)
    }

    fn parse_and(&mut self) -> Result<u8, &'static [u8]> {
        let mut lhs = self.parse_not()?;
        while !self.at_clause_end()
            && self.toks[self.pos].kind == TokKind::Ident
            && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"AND")
        {
            self.pos += 1;
            let rhs = self.parse_not()?;
            lhs = self.push(ExprNode::And(lhs, rhs))?;
        }
        Ok(lhs)
    }

    fn parse_not(&mut self) -> Result<u8, &'static [u8]> {
        if self.pos < self.n_toks
            && self.toks[self.pos].kind == TokKind::Ident
            && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"NOT")
        {
            self.pos += 1;
            let inner = self.parse_not()?;
            return self.push(ExprNode::Not(inner));
        }
        self.parse_primary()
    }

    fn parse_operand(&mut self) -> Result<Operand, &'static [u8]> {
        if self.pos >= self.n_toks {
            return Err(b"SQL_SYNTAX_ERROR: unexpected end in WHERE operand");
        }
        let t = self.toks[self.pos];
        match t.kind {
            TokKind::Num => {
                let v = parse_f64_ascii(t.slice(self.sql))?;
                self.pos += 1;
                Ok(Operand::LitNum(v))
            }
            TokKind::Str => {
                self.pos += 1;
                Ok(Operand::LitStr(t.start, t.end))
            }
            TokKind::Ident => {
                let w = t.slice(self.sql);
                if eq_ascii_icase(w, b"TRUE") {
                    self.pos += 1;
                    Ok(Operand::LitBool(true))
                } else if eq_ascii_icase(w, b"FALSE") {
                    self.pos += 1;
                    Ok(Operand::LitBool(false))
                } else if eq_ascii_icase(w, b"NULL") {
                    self.pos += 1;
                    Ok(Operand::LitNull)
                } else {
                    let c = parse_col_ref(
                        self.sql,
                        self.views,
                        self.table_name,
                        self.jctx,
                        self.toks,
                        &mut self.pos,
                        self.n_toks,
                    )?;
                    Ok(Operand::Col(c))
                }
            }
            _ => Err(b"SQL_SYNTAX_ERROR: invalid operand in WHERE predicate"),
        }
    }

    fn parse_primary(&mut self) -> Result<u8, &'static [u8]> {
        if self.pos >= self.n_toks {
            return Err(b"SQL_SYNTAX_ERROR: expected predicate in WHERE clause");
        }
        if self.toks[self.pos].kind == TokKind::LParen {
            self.pos += 1;
            let inner = self.parse_or()?;
            if self.pos >= self.n_toks || self.toks[self.pos].kind != TokKind::RParen {
                return Err(b"SQL_SYNTAX_ERROR: missing ')' in WHERE expression");
            }
            self.pos += 1;
            return Ok(inner);
        }

        let lhs = self.parse_operand()?;
        if self.pos >= self.n_toks {
            return Err(b"SQL_SYNTAX_ERROR: incomplete comparison in WHERE clause");
        }

        // Check IS [NOT] NULL
        if let Operand::Col(col) = lhs {
            if self.toks[self.pos].kind == TokKind::Ident
                && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"IS")
            {
                self.pos += 1;
                let mut neg = false;
                if self.pos < self.n_toks
                    && self.toks[self.pos].kind == TokKind::Ident
                    && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"NOT")
                {
                    neg = true;
                    self.pos += 1;
                }
                if self.pos >= self.n_toks
                    || self.toks[self.pos].kind != TokKind::Ident
                    || !eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"NULL")
                {
                    return Err(b"SQL_SYNTAX_ERROR: expected NULL after IS");
                }
                self.pos += 1;
                return self.push(ExprNode::IsNull(col, neg));
            }

            // Check [NOT] LIKE
            let mut like_neg = false;
            let saved = self.pos;
            if self.toks[self.pos].kind == TokKind::Ident
                && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"NOT")
            {
                like_neg = true;
                self.pos += 1;
            }
            if self.pos < self.n_toks
                && self.toks[self.pos].kind == TokKind::Ident
                && eq_ascii_icase(self.toks[self.pos].slice(self.sql), b"LIKE")
            {
                self.pos += 1;
                if self.pos >= self.n_toks || self.toks[self.pos].kind != TokKind::Str {
                    return Err(b"SQL_SYNTAX_ERROR: expected string pattern after LIKE");
                }
                let pat = self.toks[self.pos];
                self.pos += 1;
                return self.push(ExprNode::Like(col, pat.start, pat.end, like_neg));
            }
            self.pos = saved;
        }

        let op = match self.toks[self.pos].kind {
            TokKind::Eq => CmpOp::Eq,
            TokKind::Neq => CmpOp::Neq,
            TokKind::Lt => CmpOp::Lt,
            TokKind::Le => CmpOp::Le,
            TokKind::Gt => CmpOp::Gt,
            TokKind::Ge => CmpOp::Ge,
            _ => return Err(b"SQL_SYNTAX_ERROR: expected comparison operator in WHERE predicate"),
        };
        self.pos += 1;
        let rhs = self.parse_operand()?;
        self.push(ExprNode::Cmp(op, lhs, rhs))
    }
}

fn eval_operand(views: &Views, row: usize, op: Operand) -> Val {
    match op {
        Operand::Col(c) => read_cell_val(views, row, c),
        Operand::LitNum(v) => Val::Num(v),
        Operand::LitBool(b) => Val::Bool(b),
        Operand::LitStr(s, e) => Val::Str((s as u32) | SQL_STR_FLAG, (e - s) as u32),
        Operand::LitNull => Val::Null,
    }
}

fn val_str_bytes<'v>(v: Val, views: &'v Views<'v>) -> Option<&'v [u8]> {
    match v {
        Val::Str(off, len) => {
            let f = off & (SQL_STR_FLAG | TABLE2_STR_FLAG);
            let s = (off & !(SQL_STR_FLAG | TABLE2_STR_FLAG)) as usize;
            let buf = if f == SQL_STR_FLAG {
                views.sql
            } else if f == TABLE2_STR_FLAG {
                views.tv2.buf
            } else {
                views.tv.buf
            };
            Some(&buf[s..s + len as usize])
        }
        _ => None,
    }
}

fn sql_str_eq(a: &[u8], a_from_sql: bool, b: &[u8], b_from_sql: bool) -> bool {
    let mut i = 0usize;
    let mut j = 0usize;
    while i < a.len() && j < b.len() {
        let ca = a[i];
        let cb = b[j];
        if a_from_sql && ca == b'\'' && i + 1 < a.len() && a[i + 1] == b'\'' {
            if b_from_sql && cb == b'\'' && j + 1 < b.len() && b[j + 1] == b'\'' {
                i += 2;
                j += 2;
                continue;
            }
            if cb != b'\'' {
                return false;
            }
            i += 2;
            j += 1;
            continue;
        }
        if b_from_sql && cb == b'\'' && j + 1 < b.len() && b[j + 1] == b'\'' {
            if ca != b'\'' {
                return false;
            }
            i += 1;
            j += 2;
            continue;
        }
        if ca != cb {
            return false;
        }
        i += 1;
        j += 1;
    }
    i == a.len() && j == b.len()
}

fn cmp_vals_exact(a: Val, b: Val, views: &Views) -> Option<Ordering> {
    match (a, b) {
        (Val::Null, _) | (_, Val::Null) => None,
        (Val::Num(x), Val::Num(y)) => x.partial_cmp(&y),
        (Val::Bool(x), Val::Bool(y)) => Some(x.cmp(&y)),
        (Val::Str(oa, _la), Val::Str(ob, _lb)) => {
            let a_sql = (oa & SQL_STR_FLAG) != 0;
            let b_sql = (ob & SQL_STR_FLAG) != 0;
            let sa = val_str_bytes(a, views)?;
            let sb = val_str_bytes(b, views)?;
            if !a_sql && !b_sql {
                Some(sa.cmp(sb))
            } else if sql_str_eq(sa, a_sql, sb, b_sql) {
                Some(Ordering::Equal)
            } else {
                Some(sa.cmp(sb))
            }
        }
        _ => None,
    }
}

fn like_match(text: &[u8], pat: &[u8]) -> bool {
    let (mut ti, mut pi) = (0usize, 0usize);
    let (mut star_pi, mut star_ti) = (usize::MAX, 0usize);
    while ti < text.len() {
        if pi < pat.len() && (pat[pi] == b'_' || pat[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pat.len() && pat[pi] == b'%' {
            star_pi = pi;
            star_ti = ti;
            pi += 1;
        } else if star_pi != usize::MAX {
            pi = star_pi + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
    while pi < pat.len() && pat[pi] == b'%' {
        pi += 1;
    }
    pi == pat.len()
}

fn eval_expr(nodes: &[ExprNode], id: u8, views: &Views, row: usize) -> bool {
    match nodes[id as usize] {
        ExprNode::Or(a, b) => eval_expr(nodes, a, views, row) || eval_expr(nodes, b, views, row),
        ExprNode::And(a, b) => eval_expr(nodes, a, views, row) && eval_expr(nodes, b, views, row),
        ExprNode::Not(a) => !eval_expr(nodes, a, views, row),
        ExprNode::IsNull(c, neg) => {
            let is_n = matches!(read_cell_val(views, row, c), Val::Null);
            if neg { !is_n } else { is_n }
        }
        ExprNode::Like(c, ps, pe, neg) => {
            let cv = read_cell_val(views, row, c);
            let m = match cv {
                Val::Str(_, _) => {
                    let s = val_str_bytes(cv, views).unwrap_or(&[]);
                    like_match(s, &views.sql[ps as usize..pe as usize])
                }
                _ => false,
            };
            if neg { !m } else { m }
        }
        ExprNode::Cmp(op, lhs, rhs) => {
            let va = eval_operand(views, row, lhs);
            let vb = eval_operand(views, row, rhs);
            match cmp_vals_exact(va, vb, views) {
                None => false,
                Some(ord) => match op {
                    CmpOp::Eq => ord == Ordering::Equal,
                    CmpOp::Neq => ord != Ordering::Equal,
                    CmpOp::Lt => ord == Ordering::Less,
                    CmpOp::Le => ord != Ordering::Greater,
                    CmpOp::Gt => ord == Ordering::Greater,
                    CmpOp::Ge => ord != Ordering::Less,
                },
            }
        }
    }
}

fn round_f64_digits(val: f64, digits: i8) -> f64 {
    if digits < 0 || !val.is_finite() {
        return val;
    }
    let mut scale: f64 = 1.0;
    for _ in 0..(digits as u8).min(9) {
        scale *= 10.0;
    }
    let scaled = val * scale;
    let abs_scaled = if scaled < 0.0 { -scaled } else { scaled };
    if abs_scaled > 4.5e15 {
        return val;
    }
    let rounded = if scaled >= 0.0 {
        (scaled + 0.5) as i64 as f64
    } else {
        (scaled - 0.5) as i64 as f64
    };
    let out = rounded / scale;
    if out == 0.0 { 0.0 } else { out }
}

fn fnv1a_val(h: u64, v: Val, views: &Views) -> u64 {
    let mut acc = h;
    let feed = |mut x: u64, b: u8| -> u64 {
        x ^= b as u64;
        x.wrapping_mul(1099511628211)
    };
    match v {
        Val::Null => feed(acc, 0),
        Val::Bool(b) => feed(feed(acc, 1), if b { 1 } else { 0 }),
        Val::Num(n) => {
            acc = feed(acc, 2);
            let norm = if n == 0.0 { 0.0f64 } else { n };
            for byte in norm.to_le_bytes() {
                acc = feed(acc, byte);
            }
            acc
        }
        Val::Str(_, _) => {
            acc = feed(acc, 3);
            let s = val_str_bytes(v, views).unwrap_or(&[]);
            for &byte in s {
                acc = feed(acc, byte);
            }
            feed(acc, 0xff)
        }
    }
}

fn vals_equal_group(a: Val, b: Val, views: &Views) -> bool {
    match (a, b) {
        (Val::Null, Val::Null) => true,
        (Val::Bool(x), Val::Bool(y)) => x == y,
        (Val::Num(x), Val::Num(y)) => x == y,
        (Val::Str(_, _), Val::Str(_, _)) => {
            let sa = val_str_bytes(a, views).unwrap_or(&[]);
            let sb = val_str_bytes(b, views).unwrap_or(&[]);
            sa == sb
        }
        _ => false,
    }
}

fn cmp_out_vals(a: Val, b: Val, views: &Views) -> Ordering {
    match (a, b) {
        (Val::Null, Val::Null) => Ordering::Equal,
        (Val::Null, _) => Ordering::Greater, // Nulls last
        (_, Val::Null) => Ordering::Less,
        (Val::Num(x), Val::Num(y)) => x.partial_cmp(&y).unwrap_or(Ordering::Equal),
        (Val::Bool(x), Val::Bool(y)) => x.cmp(&y),
        (Val::Str(_, _), Val::Str(_, _)) => {
            let sa = val_str_bytes(a, views).unwrap_or(&[]);
            let sb = val_str_bytes(b, views).unwrap_or(&[]);
            sa.cmp(sb)
        }
        (Val::Num(_), _) => Ordering::Less,
        (_, Val::Num(_)) => Ordering::Greater,
        _ => Ordering::Equal,
    }
}

fn push_u16(out: &mut [u8], pos: &mut usize, v: u16) -> Result<(), &'static [u8]> {
    if *pos + 2 > out.len() {
        return Err(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity");
    }
    let b = v.to_le_bytes();
    out[*pos] = b[0];
    out[*pos + 1] = b[1];
    *pos += 2;
    Ok(())
}

fn push_u32(out: &mut [u8], pos: &mut usize, v: u32) -> Result<(), &'static [u8]> {
    if *pos + 4 > out.len() {
        return Err(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity");
    }
    let b = v.to_le_bytes();
    out[*pos..*pos + 4].copy_from_slice(&b);
    *pos += 4;
    Ok(())
}

fn push_val(out: &mut [u8], pos: &mut usize, v: Val, views: &Views) -> Result<(), &'static [u8]> {
    if *pos >= out.len() {
        return Err(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity");
    }
    match v {
        Val::Null => {
            out[*pos] = TAG_NULL;
            *pos += 1;
        }
        Val::Bool(b) => {
            if *pos + 2 > out.len() {
                return Err(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity");
            }
            out[*pos] = TAG_BOOL;
            out[*pos + 1] = if b { 1 } else { 0 };
            *pos += 2;
        }
        Val::Num(n) => {
            if *pos + 9 > out.len() {
                return Err(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity");
            }
            out[*pos] = TAG_NUM;
            out[*pos + 1..*pos + 9].copy_from_slice(&n.to_le_bytes());
            *pos += 9;
        }
        Val::Str(_, len) => {
            let sl = len as usize;
            if *pos + 5 + sl > out.len() {
                return Err(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity");
            }
            out[*pos] = TAG_STR;
            *pos += 1;
            out[*pos..*pos + 4].copy_from_slice(&len.to_le_bytes());
            *pos += 4;
            let src = val_str_bytes(v, views)
                .ok_or(b"OUTPUT_BUFFER_OVERFLOW: result exceeds OUT_BUF capacity" as &[u8])?;
            out[*pos..*pos + sl].copy_from_slice(&src[..sl]);
            *pos += sl;
        }
    }
    Ok(())
}

fn exec_query(
    sql: &[u8],
    table_buf: &[u8],
    table2_buf: Option<&[u8]>,
    out_buf: &mut [u8],
) -> Result<usize, &'static [u8]> {
    let mut toks = [Tok::EMPTY; MAX_TOKENS];
    let n_toks = tokenize_sql(sql, &mut toks)?;
    let (table_tok, table_name) = find_from_table(sql, &toks, n_toks)?;
    let tv = decode_table(table_buf, 0, 0)?;
    let tv2_storage = table2_buf.map(|b2| decode_table(b2, tv.row_count, TABLE2_STR_FLAG)).transpose()?;
    let tv2_view = tv2_storage.as_ref().unwrap_or(&tv);
    let views = Views { sql, tv: &tv, tv2: tv2_view };

    if toks[0].kind != TokKind::Ident || !eq_ascii_icase(toks[0].slice(sql), b"SELECT") {
        return Err(b"UNSUPPORTED_SQL_STATEMENT: only SELECT queries are allowed");
    }
    // Parse the FROM/JOIN tail up front so the SELECT list and WHERE see the join ctx
    let (jctx, join_end) = parse_join_tail(sql, &views, table_name, table2_buf.is_some(), &toks, table_tok + 1, n_toks)?;

    let mut pos = 1usize;

    let mut raw_select = [SelectItem::EMPTY; MAX_SELECT];
    let n_raw_select = parse_select_list(sql, &views, table_name, jctx, &toks, &mut pos, n_toks, &mut raw_select)?;

    if pos >= n_toks || toks[pos].kind != TokKind::Ident || !eq_ascii_icase(toks[pos].slice(sql), b"FROM") {
        return Err(b"SQL_SYNTAX_ERROR: expected FROM after SELECT list");
    }
    pos = join_end;

    // Optional WHERE
    let mut where_root: Option<u8> = None;
    let mut expr_parser = ExprParser {
        sql,
        views: &views,
        table_name,
        jctx,
        toks: &toks,
        n_toks,
        pos,
        nodes: [ExprNode::DUMMY; MAX_EXPR_NODES],
        n_nodes: 0,
    };
    if pos < n_toks && toks[pos].kind == TokKind::Ident && eq_ascii_icase(toks[pos].slice(sql), b"WHERE") {
        expr_parser.pos = pos + 1;
        where_root = Some(expr_parser.parse_or()?);
        pos = expr_parser.pos;
    }

    // Check if next token is an unsupported keyword like JOIN / HAVING / UNION
    if pos < n_toks && toks[pos].kind == TokKind::Ident {
        check_unsupported_keyword(toks[pos].slice(sql))?;
    }

    // Optional GROUP BY
    let mut group_cols = [0usize; MAX_SELECT];
    let mut n_group_cols = 0usize;
    if pos < n_toks && toks[pos].kind == TokKind::Ident && eq_ascii_icase(toks[pos].slice(sql), b"GROUP") {
        pos += 1;
        if pos >= n_toks || toks[pos].kind != TokKind::Ident || !eq_ascii_icase(toks[pos].slice(sql), b"BY") {
            return Err(b"SQL_SYNTAX_ERROR: expected BY after GROUP");
        }
        pos += 1;
        loop {
            if n_group_cols >= MAX_SELECT {
                return Err(b"SQL_SYNTAX_ERROR: too many GROUP BY columns");
            }
            let c = parse_col_ref(sql, &views, table_name, jctx, &toks, &mut pos, n_toks)?;
            group_cols[n_group_cols] = c;
            n_group_cols += 1;
            if pos < n_toks && toks[pos].kind == TokKind::Comma {
                pos += 1;
                continue;
            }
            break;
        }
    }

    if pos < n_toks && toks[pos].kind == TokKind::Ident {
        check_unsupported_keyword(toks[pos].slice(sql))?;
    }

    // Optional ORDER BY
    let mut order_items = [OrderItem::EMPTY; MAX_ORDER];
    let mut n_order = 0usize;
    if pos < n_toks && toks[pos].kind == TokKind::Ident && eq_ascii_icase(toks[pos].slice(sql), b"ORDER") {
        pos += 1;
        if pos >= n_toks || toks[pos].kind != TokKind::Ident || !eq_ascii_icase(toks[pos].slice(sql), b"BY") {
            return Err(b"SQL_SYNTAX_ERROR: expected BY after ORDER");
        }
        pos += 1;
        loop {
            if pos >= n_toks || toks[pos].kind != TokKind::Ident {
                return Err(b"SQL_SYNTAX_ERROR: expected column or alias in ORDER BY");
            }
            if n_order >= MAX_ORDER {
                return Err(b"SQL_SYNTAX_ERROR: too many ORDER BY items");
            }
            let start = toks[pos].start;
            let mut end = toks[pos].end;
            pos += 1;
            if pos + 1 < n_toks && toks[pos].kind == TokKind::Dot && toks[pos + 1].kind == TokKind::Ident {
                end = toks[pos + 1].end;
                let pref = &sql[start as usize..toks[pos].start as usize];
                let qual_ok = match jctx {
                    Some((q1, q2)) => {
                        eq_ascii_icase(pref, q1) || eq_ascii_icase(pref, q2)
                    }
                    None => eq_ascii_icase(pref, table_name),
                };
                if !qual_ok {
                    return Err(b"UNKNOWN_SQL_TABLE_QUALIFIER: unknown table qualifier in ORDER BY");
                }
                let col_start = toks[pos + 1].start;
                pos += 2;
                // JOIN mode keeps the full qualified name so side resolution stays possible
                order_items[n_order] = OrderItem {
                    name_start: if jctx.is_some() { start } else { col_start },
                    name_end: end,
                    desc: false,
                };
            } else {
                order_items[n_order] = OrderItem {
                    name_start: start,
                    name_end: end,
                    desc: false,
                };
            }
            if pos < n_toks && toks[pos].kind == TokKind::Ident {
                if eq_ascii_icase(toks[pos].slice(sql), b"DESC") {
                    order_items[n_order].desc = true;
                    pos += 1;
                } else if eq_ascii_icase(toks[pos].slice(sql), b"ASC") {
                    order_items[n_order].desc = false;
                    pos += 1;
                }
            }
            n_order += 1;
            if pos < n_toks && toks[pos].kind == TokKind::Comma {
                pos += 1;
                continue;
            }
            break;
        }
    }

    if pos < n_toks && toks[pos].kind == TokKind::Ident {
        check_unsupported_keyword(toks[pos].slice(sql))?;
    }

    // Optional LIMIT
    let mut limit_val: Option<usize> = None;
    if pos < n_toks && toks[pos].kind == TokKind::Ident && eq_ascii_icase(toks[pos].slice(sql), b"LIMIT") {
        pos += 1;
        if pos >= n_toks || toks[pos].kind != TokKind::Num {
            return Err(b"SQL_SYNTAX_ERROR: LIMIT requires non-negative integer");
        }
        limit_val = Some(parse_u32_ascii(toks[pos].slice(sql))? as usize);
        pos += 1;
    }

    if pos < n_toks {
        return Err(b"UNSUPPORTED_SQL_SYNTAX: unexpected trailing tokens or unsupported SQL clause");
    }

    // Expand `*` and validate SELECT semantics vs GROUP BY / aggregates
    let mut proj_items = [SelectItem::EMPTY; MAX_SELECT];
    let mut n_proj = 0usize;
    let mut has_agg = false;
    let mut has_star = false;

    for i in 0..n_raw_select {
        match raw_select[i].kind {
            SelectItemKind::Star => {
                has_star = true;
                if jctx.is_some() {
                    return Err(b"SQL_VALIDATION_ERROR: SELECT * is not supported with JOIN");
                }
                if tv.col_count == 0 {
                    return Err(b"SQL_SCHEMA_ERROR: cannot expand SELECT * on table with 0 columns");
                }
                for c in 0..tv.col_count {
                    if n_proj >= MAX_SELECT {
                        return Err(b"SQL_SCHEMA_ERROR: projected column count exceeds MAX_SELECT");
                    }
                    proj_items[n_proj] = SelectItem {
                        kind: SelectItemKind::Col(c),
                        alias_tok: -1,
                        label_start: 0,
                        label_end: 0,
                    };
                    n_proj += 1;
                }
            }
            SelectItemKind::Agg { .. } => {
                has_agg = true;
                if n_proj >= MAX_SELECT {
                    return Err(b"SQL_SCHEMA_ERROR: projected column count exceeds MAX_SELECT");
                }
                proj_items[n_proj] = raw_select[i];
                n_proj += 1;
            }
            _ => {
                if n_proj >= MAX_SELECT {
                    return Err(b"SQL_SCHEMA_ERROR: projected column count exceeds MAX_SELECT");
                }
                proj_items[n_proj] = raw_select[i];
                n_proj += 1;
            }
        }
    }

    if has_star && (n_group_cols > 0 || has_agg) {
        return Err(b"SQL_VALIDATION_ERROR: SELECT * cannot be combined with GROUP BY or aggregates");
    }

    let is_grouped_mode = n_group_cols > 0 || has_agg;
    if is_grouped_mode {
        for i in 0..n_proj {
            let col_opt = match proj_items[i].kind {
                SelectItemKind::Col(c) | SelectItemKind::RoundCol { col: c, .. } => Some(c),
                _ => None,
            };
            if let Some(c) = col_opt {
                if n_group_cols == 0 {
                    return Err(b"SQL_VALIDATION_ERROR: ungrouped column combined with aggregate without GROUP BY");
                }
                let mut found = false;
                for g in 0..n_group_cols {
                    if group_cols[g] == c {
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err(b"SQL_VALIDATION_ERROR: SELECT column must appear in GROUP BY clause");
                }
            }
        }
    }

    // Resolve output column header slices
    let mut out_col_names: [&[u8]; MAX_SELECT] = [&[]; MAX_SELECT];
    for i in 0..n_proj {
        if proj_items[i].alias_tok >= 0 {
            out_col_names[i] = toks[proj_items[i].alias_tok as usize].slice(sql);
        } else {
            out_col_names[i] = match proj_items[i].kind {
                SelectItemKind::Col(c) => {
                    let view = if c & COL_SIDE_R_BIT != 0 { views.tv2 } else { views.tv };
                    view.col_names[c & COL_IDX_MASK]
                }
                SelectItemKind::Agg { agg: AggKind::CountAll, .. } => b"count",
                _ => &sql[proj_items[i].label_start as usize..proj_items[i].label_end as usize],
            };
        }
    }

    // Resolve ORDER BY targets into projected columns (or source columns for ungrouped)
    let mut order_proj_idx = [0usize; MAX_ORDER];
    let mut order_src_col: [Option<usize>; MAX_ORDER] = [None; MAX_ORDER];
    for k in 0..n_order {
        let oname = &sql[order_items[k].name_start as usize..order_items[k].name_end as usize];
        let mut matched_proj: Option<usize> = None;
        for j in 0..n_proj {
            if eq_ascii_icase(out_col_names[j], oname) {
                matched_proj = Some(j);
                break;
            }
        }
        if let Some(pj) = matched_proj {
            order_proj_idx[k] = pj;
        } else if !is_grouped_mode {
            if let Some((q1, q2)) = jctx {
                // JOIN mode: qualified name resolves to a side-flagged source column
                let dot = oname.iter().position(|&b| b == b'.');
                let d = match dot {
                    Some(d) => d,
                    None => return Err(b"UNKNOWN_SQL_COLUMN: ORDER BY column or alias not found"),
                };
                let (qual, colname) = (&oname[..d], &oname[d + 1..]);
                let side_bit = if eq_ascii_icase(qual, q2) {
                    COL_SIDE_R_BIT
                } else if eq_ascii_icase(qual, q1) {
                    0usize
                } else {
                    return Err(b"UNKNOWN_SQL_TABLE_QUALIFIER: unknown table qualifier in ORDER BY");
                };
                let view = if side_bit == COL_SIDE_R_BIT { views.tv2 } else { views.tv };
                let c = find_col(view, colname)
                    .ok_or(b"UNKNOWN_SQL_COLUMN: column does not exist in table" as &[u8])?;
                order_src_col[k] = Some(c | COL_JOIN_BIT | side_bit);
            } else if let Some(sc) = find_col(&tv, oname) {
                order_src_col[k] = Some(sc);
            } else {
                return Err(b"UNKNOWN_SQL_COLUMN: ORDER BY column or alias not found");
            }
        } else {
            return Err(b"UNKNOWN_SQL_COLUMN: ORDER BY column or alias not found in grouped projection");
        }
    }

    // Materialize the INNER equi-join product (nested loop; O(n*m), upgrade to hash probe if tables grow)
    let scan_rows = if jctx.is_some() {
        unsafe {
            let nk = JOIN_NKEYS;
            let mut jr = 0usize;
            for l in 0..tv.row_count {
                for r in 0..views.tv2.row_count {
                    let mut ok = true;
                    for k in 0..nk {
                        if !vals_equal_group(
                            raw_cell_val(&tv, l, JOIN_KEYS_L[k] as usize),
                            raw_cell_val(views.tv2, r, JOIN_KEYS_R[k] as usize),
                            &views,
                        ) {
                            ok = false;
                            break;
                        }
                    }
                    if ok {
                        if jr >= MAX_ROWS {
                            return Err(b"JOIN_CAPACITY_EXCEEDED: join result exceeds MAX_ROWS");
                        }
                        JOIN_LROW[jr] = l as u16;
                        JOIN_RROW[jr] = r as u16;
                        jr += 1;
                    }
                }
            }
            jr
        }
    } else {
        tv.row_count
    };

    // Filter rows using WHERE AST
    let mut n_filtered = 0usize;
    for r in 0..scan_rows {
        let keep = match where_root {
            None => true,
            Some(root) => eval_expr(&expr_parser.nodes[..expr_parser.n_nodes], root, &views, r),
        };
        if keep {
            unsafe {
                FILTERED_ROWS[n_filtered] = r as u16;
            }
            n_filtered += 1;
        }
    }

    let res_count: usize;
    if is_grouped_mode {
        let n_groups: usize;
        if n_group_cols == 0 {
            // Single aggregate group across all filtered rows
            n_groups = 1;
            unsafe {
                GROUP_HEAD[0] = -1;
            }
            for fi in 0..n_filtered {
                let row = unsafe { FILTERED_ROWS[fi] };
                unsafe {
                    GROUP_ROW_LIST[fi] = row;
                    GROUP_NEXT[fi] = GROUP_HEAD[0];
                    GROUP_HEAD[0] = fi as i32;
                }
            }
            if n_filtered > 0 {
                unsafe {
                    GROUP_REPR_ROW[0] = FILTERED_ROWS[0];
                }
            }
        } else {
            let mut g_count = 0usize;
            for fi in 0..n_filtered {
                let row = unsafe { FILTERED_ROWS[fi] } as usize;
                let mut h: u64 = 14695981039346656037;
                for g in 0..n_group_cols {
                    h = fnv1a_val(h, read_cell_val(&views, row, group_cols[g]), &views);
                }
                let mut found_g = usize::MAX;
                for gi in 0..g_count {
                    if unsafe { GROUP_HASHES[gi] } == h {
                        let repr = unsafe { GROUP_REPR_ROW[gi] } as usize;
                        let mut eq = true;
                        for g in 0..n_group_cols {
                            if !vals_equal_group(
                                read_cell_val(&views, row, group_cols[g]),
                                read_cell_val(&views, repr, group_cols[g]),
                                &views,
                            ) {
                                eq = false;
                                break;
                            }
                        }
                        if eq {
                            found_g = gi;
                            break;
                        }
                    }
                }
                if found_g == usize::MAX {
                    if g_count >= MAX_GROUPS {
                        return Err(b"GROUP_CAPACITY_EXCEEDED: GROUP BY exceeds MAX_GROUPS");
                    }
                    found_g = g_count;
                    unsafe {
                        GROUP_HASHES[found_g] = h;
                        GROUP_REPR_ROW[found_g] = row as u16;
                        GROUP_HEAD[found_g] = -1;
                    }
                    g_count += 1;
                }
                unsafe {
                    ROW_GROUP_ID[fi] = found_g as u16;
                    GROUP_ROW_LIST[fi] = row as u16;
                    GROUP_NEXT[fi] = GROUP_HEAD[found_g];
                    GROUP_HEAD[found_g] = fi as i32;
                }
            }
            n_groups = g_count;
        }

        // Compute aggregate/projected output cell per group
        for gi in 0..n_groups {
            for j in 0..n_proj {
                let val = match proj_items[j].kind {
                    SelectItemKind::Col(c) => {
                        if n_filtered == 0 {
                            Val::Null
                        } else {
                            read_cell_val(&views, unsafe { GROUP_REPR_ROW[gi] } as usize, c)
                        }
                    }
                    SelectItemKind::RoundCol { col, digits } => {
                        if n_filtered == 0 {
                            Val::Null
                        } else {
                            match read_cell_val(&views, unsafe { GROUP_REPR_ROW[gi] } as usize, col) {
                                Val::Num(x) => Val::Num(round_f64_digits(x, digits as i8)),
                                other => other,
                            }
                        }
                    }
                    SelectItemKind::Agg { agg, col, round_digits } => {
                        let mut cnt: u64 = 0;
                        let mut sum_v: f64 = 0.0;
                        let mut min_v: Option<Val> = None;
                        let mut max_v: Option<Val> = None;
                        let mut cur = unsafe { GROUP_HEAD[gi] };
                        while cur >= 0 {
                            let r = unsafe { GROUP_ROW_LIST[cur as usize] } as usize;
                            match agg {
                                AggKind::CountAll => cnt += 1,
                                AggKind::CountCol => {
                                    if !matches!(read_cell_val(&views, r, col), Val::Null) {
                                        cnt += 1;
                                    }
                                }
                                AggKind::Sum | AggKind::Avg => {
                                    if let Val::Num(x) = read_cell_val(&views, r, col) {
                                        sum_v += x;
                                        cnt += 1;
                                    }
                                }
                                AggKind::Min => {
                                    let cv = read_cell_val(&views, r, col);
                                    if !matches!(cv, Val::Null) {
                                        min_v = Some(match min_v {
                                            None => cv,
                                            Some(mv) => {
                                                if cmp_out_vals(cv, mv, &views) == Ordering::Less {
                                                    cv
                                                } else {
                                                    mv
                                                }
                                            }
                                        });
                                    }
                                }
                                AggKind::Max => {
                                    let cv = read_cell_val(&views, r, col);
                                    if !matches!(cv, Val::Null) {
                                        max_v = Some(match max_v {
                                            None => cv,
                                            Some(mv) => {
                                                if cmp_out_vals(cv, mv, &views) == Ordering::Greater {
                                                    cv
                                                } else {
                                                    mv
                                                }
                                            }
                                        });
                                    }
                                }
                            }
                            cur = unsafe { GROUP_NEXT[cur as usize] };
                        }
                        let raw_val = match agg {
                            AggKind::CountAll | AggKind::CountCol => Val::Num(cnt as f64),
                            AggKind::Sum => {
                                if cnt == 0 {
                                    Val::Null
                                } else {
                                    Val::Num(round_f64_digits(sum_v, round_digits))
                                }
                            }
                            AggKind::Avg => {
                                if cnt == 0 {
                                    Val::Null
                                } else {
                                    Val::Num(round_f64_digits(sum_v / (cnt as f64), round_digits))
                                }
                            }
                            AggKind::Min => match min_v {
                                Some(Val::Num(x)) => Val::Num(round_f64_digits(x, round_digits)),
                                Some(other) => other,
                                None => Val::Null,
                            },
                            AggKind::Max => match max_v {
                                Some(Val::Num(x)) => Val::Num(round_f64_digits(x, round_digits)),
                                Some(other) => other,
                                None => Val::Null,
                            },
                        };
                        raw_val
                    }
                    SelectItemKind::Star => Val::Null,
                };
                unsafe {
                    GROUP_OUT_CELLS[gi * MAX_SELECT + j] = val;
                }
            }
        }
        res_count = n_groups;
    } else {
        res_count = n_filtered;
    }

    for i in 0..res_count {
        unsafe {
            SORT_ORDER[i] = i as u16;
        }
    }

    if n_order > 0 && res_count > 1 {
        // Stable insertion/shell-hybrid? Insertion sort preserves input stability cleanly for <= 4096 rows
        for i in 1..res_count {
            let cur_slot = unsafe { SORT_ORDER[i] };
            let mut j = i;
            while j > 0 {
                let prev_slot = unsafe { SORT_ORDER[j - 1] };
                let mut ord = Ordering::Equal;
                for k in 0..n_order {
                    let get_val = |slot: usize| -> Val {
                        if is_grouped_mode {
                            unsafe { GROUP_OUT_CELLS[slot * MAX_SELECT + order_proj_idx[k]] }
                        } else if let Some(sc) = order_src_col[k] {
                            let r = unsafe { FILTERED_ROWS[slot] } as usize;
                            read_cell_val(&views, r, sc)
                        } else {
                            let r = unsafe { FILTERED_ROWS[slot] } as usize;
                            match proj_items[order_proj_idx[k]].kind {
                                SelectItemKind::Col(c) => read_cell_val(&views, r, c),
                                SelectItemKind::RoundCol { col, digits } => match read_cell_val(&views, r, col) {
                                    Val::Num(x) => Val::Num(round_f64_digits(x, digits as i8)),
                                    other => other,
                                },
                                _ => Val::Null,
                            }
                        }
                    };
                    let va = get_val(prev_slot as usize);
                    let vb = get_val(cur_slot as usize);
                    ord = cmp_out_vals(va, vb, &views);
                    if order_items[k].desc {
                        ord = ord.reverse();
                    }
                    if ord != Ordering::Equal {
                        break;
                    }
                }
                if ord == Ordering::Greater {
                    unsafe {
                        SORT_ORDER[j] = prev_slot;
                    }
                    j -= 1;
                } else {
                    break;
                }
            }
            unsafe {
                SORT_ORDER[j] = cur_slot;
            }
        }
    }

    let final_rows = match limit_val {
        Some(lim) => res_count.min(lim),
        None => res_count,
    };

    // Write binary output buffer
    let mut out_pos = 0usize;
    push_u32(out_buf, &mut out_pos, n_proj as u32)?;
    for j in 0..n_proj {
        let col_name = out_col_names[j];
        push_u16(out_buf, &mut out_pos, col_name.len() as u16)?;
        if out_pos + col_name.len() > out_buf.len() {
            return Err(b"OUTPUT_BUFFER_OVERFLOW: column headers exceed OUT_BUF");
        }
        out_buf[out_pos..out_pos + col_name.len()].copy_from_slice(col_name);
        out_pos += col_name.len();
    }
    push_u32(out_buf, &mut out_pos, final_rows as u32)?;

    for i in 0..final_rows {
        let slot = unsafe { SORT_ORDER[i] } as usize;
        for j in 0..n_proj {
            let val = if is_grouped_mode {
                unsafe { GROUP_OUT_CELLS[slot * MAX_SELECT + j] }
            } else {
                let r = unsafe { FILTERED_ROWS[slot] } as usize;
                match proj_items[j].kind {
                    SelectItemKind::Col(c) => read_cell_val(&views, r, c),
                    SelectItemKind::RoundCol { col, digits } => match read_cell_val(&views, r, col) {
                        Val::Num(x) => Val::Num(round_f64_digits(x, digits as i8)),
                        other => other,
                    },
                    _ => Val::Null,
                }
            };
            push_val(out_buf, &mut out_pos, val, &views)?;
        }
    }

    Ok(out_pos)
}

fn exec_impl(sql_len: u32, table_len: u32, table2_len: Option<u32>) -> i32 {
    unsafe {
        LAST_ERR_LEN = 0;
    }
    let sl = (sql_len as usize).min(INPUT_CAP);
    let tl = (table_len as usize).min(TABLE_CAP);
    let sql = unsafe { slice::from_raw_parts(core::ptr::addr_of!(SQL_BUF) as *const u8, sl) };
    let tbuf = unsafe { slice::from_raw_parts(core::ptr::addr_of!(TABLE_BUF) as *const u8, tl) };
    let t2buf = match table2_len {
        Some(l2) => unsafe {
            Some(slice::from_raw_parts(
                core::ptr::addr_of!(TABLE2_BUF) as *const u8,
                (l2 as usize).min(TABLE_CAP),
            ))
        },
        None => None,
    };
    let obuf = unsafe { slice::from_raw_parts_mut(core::ptr::addr_of_mut!(OUT_BUF) as *mut u8, OUTPUT_CAP) };
    match exec_query(sql, tbuf, t2buf, obuf) {
        Ok(n) => n as i32,
        Err(msg) => write_error(msg),
    }
}

#[no_mangle]
pub extern "C" fn vs_sql_exec(sql_len: u32, table_len: u32) -> i32 {
    exec_impl(sql_len, table_len, None)
}

// Two-table execution path: the JOIN right side is the host-encoded TABLE2_BUF.
#[no_mangle]
pub extern "C" fn vs_sql_exec2(sql_len: u32, table_len: u32, table2_len: u32) -> i32 {
    exec_impl(sql_len, table_len, Some(table2_len))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    // The engine decodes into process-global statics; parallel test threads would corrupt each other
    static TEST_MUTEX: Mutex<()> = Mutex::new(());

    fn encode_test_table(cols: &[&str], rows: &[&[TestVal]]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(cols.len() as u16).to_le_bytes());
        for c in cols {
            let b = c.as_bytes();
            out.extend_from_slice(&(b.len() as u16).to_le_bytes());
            out.extend_from_slice(b);
        }
        out.extend_from_slice(&(rows.len() as u32).to_le_bytes());
        for row in rows {
            for cell in *row {
                match cell {
                    TestVal::Null => out.push(TAG_NULL),
                    TestVal::Bool(b) => {
                        out.push(TAG_BOOL);
                        out.push(if *b { 1 } else { 0 });
                    }
                    TestVal::Num(n) => {
                        out.push(TAG_NUM);
                        out.extend_from_slice(&n.to_le_bytes());
                    }
                    TestVal::Str(s) => {
                        out.push(TAG_STR);
                        let sb = s.as_bytes();
                        out.extend_from_slice(&(sb.len() as u32).to_le_bytes());
                        out.extend_from_slice(sb);
                    }
                }
            }
        }
        out
    }

    enum TestVal<'a> {
        Null,
        Bool(bool),
        Num(f64),
        Str(&'a str),
    }

    fn run_sql2(sql: &str, tbuf: &[u8], tbuf2: Option<&[u8]>) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
        let _guard = TEST_MUTEX.lock().unwrap();
        let mut obuf = vec![0u8; OUTPUT_CAP];
        match exec_query(sql.as_bytes(), tbuf, tbuf2, &mut obuf) {
            Err(e) => Err(String::from_utf8_lossy(e).into_owned()),
            Ok(len) => {
                let b = &obuf[..len];
                let mut pos = 0usize;
                let ncol = u32::from_le_bytes([b[pos], b[pos + 1], b[pos + 2], b[pos + 3]]) as usize;
                pos += 4;
                let mut cols = Vec::new();
                for _ in 0..ncol {
                    let nlen = u16::from_le_bytes([b[pos], b[pos + 1]]) as usize;
                    pos += 2;
                    cols.push(String::from_utf8_lossy(&b[pos..pos + nlen]).into_owned());
                    pos += nlen;
                }
                let nrow = u32::from_le_bytes([b[pos], b[pos + 1], b[pos + 2], b[pos + 3]]) as usize;
                pos += 4;
                let mut rows = Vec::new();
                for _ in 0..nrow {
                    let mut r = Vec::new();
                    for _ in 0..ncol {
                        let tag = b[pos];
                        pos += 1;
                        match tag {
                            TAG_NULL => r.push("NULL".to_string()),
                            TAG_BOOL => {
                                r.push(if b[pos] != 0 { "true".to_string() } else { "false".to_string() });
                                pos += 1;
                            }
                            TAG_NUM => {
                                let v = f64::from_le_bytes(b[pos..pos + 8].try_into().unwrap());
                                pos += 8;
                                r.push(format!("{}", v));
                            }
                            TAG_STR => {
                                let sl = u32::from_le_bytes(b[pos..pos + 4].try_into().unwrap()) as usize;
                                pos += 4;
                                r.push(String::from_utf8_lossy(&b[pos..pos + sl]).into_owned());
                                pos += sl;
                            }
                            _ => panic!("bad output tag"),
                        }
                    }
                    rows.push(r);
                }
                Ok((cols, rows))
            }
        }
    }

    fn run_sql(sql: &str, tbuf: &[u8]) -> Result<(Vec<String>, Vec<Vec<String>>), String> {
        run_sql2(sql, tbuf, None)
    }

    #[test]
    fn executes_where_groupby_aggregates_orderby_limit() {
        let tbuf = encode_test_table(
            &["source_mode", "gatekeeper_action", "pii_detected", "pred_prob", "token_count"],
            &[
                &[TestVal::Str("pdf_text"), TestVal::Str("KEEP_SAFE"), TestVal::Bool(false), TestVal::Num(0.95), TestVal::Num(14.0)],
                &[TestVal::Str("pdf_text"), TestVal::Str("KEEP_SAFE"), TestVal::Bool(false), TestVal::Num(0.85), TestVal::Num(8.0)],
                &[TestVal::Str("ocr_scan"), TestVal::Str("KEEP_SAFE"), TestVal::Bool(false), TestVal::Num(0.91), TestVal::Num(18.0)],
                &[TestVal::Str("ocr_scan"), TestVal::Str("DROP_OR_QUARANTINE"), TestVal::Bool(true), TestVal::Num(0.08), TestVal::Null],
            ],
        );

        let (cols, rows) = run_sql(
            "SELECT source_mode, count(*) AS cnt, round(avg(pred_prob), 4) AS avg_p, sum(token_count) AS tok FROM documents WHERE gatekeeper_action = 'KEEP_SAFE' AND token_count >= 10 GROUP BY source_mode ORDER BY source_mode DESC LIMIT 5;",
            &tbuf,
        ).unwrap();

        assert_eq!(cols, vec!["source_mode", "cnt", "avg_p", "tok"]);
        assert_eq!(
            rows,
            vec![
                vec!["pdf_text", "1", "0.95", "14"],
                vec!["ocr_scan", "1", "0.91", "18"],
            ]
        );
    }

    #[test]
    fn rejects_unsupported_sql_and_injection() {
        let tbuf = encode_test_table(&["source_mode", "token_count"], &[&[TestVal::Str("pdf_text"), TestVal::Num(10.0)]]);
        assert!(run_sql("SELECT * FROM documents; DROP TABLE documents;", &tbuf).is_err());
        assert!(run_sql("SELECT * FROM documents JOIN other ON 1=1", &tbuf).is_err());
        assert!(run_sql("SELECT source_mode, count(*) FROM documents", &tbuf).is_err());
        assert!(run_sql("SELECT unknown_col FROM documents", &tbuf).is_err());
        assert!(run_sql("DROP TABLE documents", &tbuf).is_err());
    }

    #[test]
    fn executes_inner_equi_join_on_aliased_instances() {
        let tbuf = encode_test_table(
            &["source_mode", "token_count"],
            &[
                &[TestVal::Str("pdf_text"), TestVal::Num(14.0)],
                &[TestVal::Str("pdf_text"), TestVal::Num(8.0)],
                &[TestVal::Str("ocr_scan"), TestVal::Num(18.0)],
            ],
        );

        // Join product: pdf pairs (14,14),(14,8),(8,14),(8,8) plus ocr (18,18)
        let (cols, rows) = run_sql(
            "SELECT a.source_mode AS sm, b.token_count AS tk FROM documents a JOIN documents b ON a.source_mode = b.source_mode ORDER BY tk ASC, sm ASC;",
            &tbuf,
        )
        .unwrap();
        assert_eq!(cols, vec!["sm", "tk"]);
        assert_eq!(
            rows,
            vec![
                vec!["pdf_text", "8"],
                vec!["pdf_text", "8"],
                vec!["pdf_text", "14"],
                vec!["pdf_text", "14"],
                vec!["ocr_scan", "18"],
            ]
        );

        // Multi-key ON + INNER keyword + GROUP BY over the join product
        let (cols2, rows2) = run_sql(
            "SELECT a.source_mode AS sm, count(*) AS pairs FROM documents a INNER JOIN documents b ON a.source_mode = b.source_mode AND a.token_count = b.token_count GROUP BY a.source_mode ORDER BY pairs DESC;",
            &tbuf,
        )
        .unwrap();
        assert_eq!(cols2, vec!["sm", "pairs"]);
        assert_eq!(rows2, vec![vec!["pdf_text", "2"], vec!["ocr_scan", "1"]]);

        // WHERE over the join product with a right-side projection
        let (_, rows3) = run_sql(
            "SELECT a.source_mode AS sm, b.token_count AS tk FROM documents a JOIN documents b ON a.source_mode = b.source_mode WHERE a.token_count = 8 ORDER BY tk ASC;",
            &tbuf,
        )
        .unwrap();
        assert_eq!(rows3, vec![vec!["pdf_text", "8"], vec!["pdf_text", "14"]]);
    }

    #[test]
    fn rejects_malformed_and_cross_table_joins() {
        let tbuf = encode_test_table(&["source_mode", "token_count"], &[&[TestVal::Str("pdf_text"), TestVal::Num(10.0)]]);
        // Right table is not the loaded table (single-table ABI; cross-table needs host support)
        assert!(run_sql("SELECT a.source_mode FROM documents a JOIN other b ON a.source_mode = b.source_mode", &tbuf).is_err());
        // SELECT * inside a JOIN is rejected
        assert!(run_sql("SELECT * FROM documents a JOIN documents b ON a.source_mode = b.source_mode", &tbuf).is_err());
        // Unqualified column is ambiguous across join sides
        assert!(run_sql("SELECT source_mode FROM documents a JOIN documents b ON a.source_mode = b.source_mode", &tbuf).is_err());
        // Missing/distinct aliases and non-equi ON are rejected
        assert!(run_sql("SELECT a.source_mode FROM documents a JOIN documents ON a.source_mode = a.source_mode", &tbuf).is_err());
        assert!(run_sql("SELECT a.source_mode FROM documents a JOIN documents b ON a.token_count <= b.token_count", &tbuf).is_err());
        assert!(run_sql("SELECT a.source_mode FROM documents a JOIN documents b ON a.source_mode = b.source_mode OR 1=1", &tbuf).is_err());
    }

    #[test]
    fn executes_cross_table_inner_equi_join() {
        let docs = encode_test_table(
            &["doc_id", "source_mode", "token_count"],
            &[
                &[TestVal::Num(1.0), TestVal::Str("pdf_text"), TestVal::Num(14.0)],
                &[TestVal::Num(2.0), TestVal::Str("ocr_scan"), TestVal::Num(18.0)],
                &[TestVal::Num(3.0), TestVal::Str("pdf_text"), TestVal::Num(8.0)],
            ],
        );
        let tags = encode_test_table(
            &["doc_id", "tag"],
            &[
                &[TestVal::Num(1.0), TestVal::Str("alpha")],
                &[TestVal::Num(2.0), TestVal::Str("beta")],
                &[TestVal::Num(1.0), TestVal::Str("gamma")],
            ],
        );

        let (cols, rows) = run_sql2(
            "SELECT d.source_mode AS sm, t.tag AS tg FROM documents d JOIN tags t ON d.doc_id = t.doc_id ORDER BY tg ASC;",
            &docs,
            Some(&tags),
        )
        .unwrap();
        assert_eq!(cols, vec!["sm", "tg"]);
        assert_eq!(
            rows,
            vec![
                vec!["pdf_text", "alpha"],
                vec!["ocr_scan", "beta"],
                vec!["pdf_text", "gamma"],
            ]
        );

        // INNER keyword, right-side WHERE-free projection, and a string join key across two buffers
        let people = encode_test_table(
            &["name", "dept"],
            &[
                &[TestVal::Str("ada"), TestVal::Str("legal")],
                &[TestVal::Str("bob"), TestVal::Str("finance")],
                &[TestVal::Str("ada"), TestVal::Str("ops")],
            ],
        );
        let certs = encode_test_table(
            &["name", "status"],
            &[
                &[TestVal::Str("ada"), TestVal::Str("KEEP_SAFE")],
                &[TestVal::Str("zed"), TestVal::Str("DROP")],
            ],
        );
        let (cols2, rows2) = run_sql2(
            "SELECT p.name AS who, c.status AS st FROM people p INNER JOIN certs c ON p.name = c.name WHERE p.dept = 'legal' ORDER BY st ASC;",
            &people,
            Some(&certs),
        )
        .unwrap();
        assert_eq!(cols2, vec!["who", "st"]);
        assert_eq!(rows2, vec![vec!["ada", "KEEP_SAFE"]]);

        // GROUP BY over the cross-table product
        let (_, rows3) = run_sql2(
            "SELECT d.source_mode AS sm, count(*) AS links FROM documents d JOIN tags t ON d.doc_id = t.doc_id GROUP BY d.source_mode ORDER BY links DESC;",
            &docs,
            Some(&tags),
        )
        .unwrap();
        assert_eq!(rows3, vec![vec!["pdf_text", "2"], vec!["ocr_scan", "1"]]);
    }

    #[test]
    fn rejects_unsupported_cross_table_joins() {
        let docs = encode_test_table(
            &["doc_id", "source_mode"],
            &[&[TestVal::Num(1.0), TestVal::Str("pdf_text")]],
        );
        let tags = encode_test_table(
            &["doc_id", "tag"],
            &[&[TestVal::Num(1.0), TestVal::Str("alpha")]],
        );
        // SELECT * inside a JOIN stays rejected
        assert!(run_sql2("SELECT * FROM documents d JOIN tags t ON d.doc_id = t.doc_id", &docs, Some(&tags)).is_err());
        // Non-equi ON comparisons are rejected
        assert!(run_sql2("SELECT d.doc_id AS d1 FROM documents d JOIN tags t ON d.doc_id < t.doc_id", &docs, Some(&tags)).is_err());
        // Duplicate qualifiers are rejected
        assert!(run_sql2("SELECT d.doc_id AS d1 FROM documents d JOIN tags d ON d.doc_id = d.doc_id", &docs, Some(&tags)).is_err());
        // Unqualified columns are ambiguous across join sides
        assert!(run_sql2("SELECT doc_id AS d1 FROM documents d JOIN tags t ON d.doc_id = t.doc_id", &docs, Some(&tags)).is_err());
        // Unknown right-side columns are rejected
        assert!(run_sql2("SELECT d.doc_id AS d1, t.missing AS m FROM documents d JOIN tags t ON d.doc_id = t.doc_id", &docs, Some(&tags)).is_err());
        // The single-table ABI keeps rejecting cross-table joins (host parity: fallback cannot load two tables)
        assert!(run_sql("SELECT a.doc_id AS d1 FROM documents a JOIN tags t ON a.doc_id = t.doc_id", &docs).is_err());
    }

    #[test]
    fn probe_join_locates_second_table_name() {
        let _guard = TEST_MUTEX.lock().unwrap();
        let cases = [
            ("SELECT d.tag AS t FROM docs d JOIN tags_ref t ON d.id = t.id;", "tags_ref"),
            ("SELECT d.tag FROM docs AS d INNER JOIN tags_ref ON d.id = tags_ref.id;", "tags_ref"),
            ("SELECT tag FROM docs WHERE id = 1;", ""),
            ("SELECT tag FROM docs ORDER BY tag;", ""),
        ];
        for (sql, want) in cases {
            let sb = sql.as_bytes();
            unsafe {
                SQL_BUF[..sb.len()].copy_from_slice(sb);
                let n = vs_sql_probe_join(sb.len() as u32);
                if want.is_empty() {
                    assert_eq!(n, 0, "expected no join probe for {sql}");
                } else {
                    assert!(n > 0, "expected join probe for {sql}");
                    let name = String::from_utf8_lossy(&OUT_BUF[..n as usize]).into_owned();
                    assert_eq!(name, want, "join probe mismatch for {sql}");
                }
            }
        }
    }
}

