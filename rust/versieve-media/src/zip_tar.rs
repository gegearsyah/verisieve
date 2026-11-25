//! Hardened ZIP Central Directory (+ bit-3 + ZIP64) and POSIX USTAR/PAX TAR (+ .tar.gz)
//! container readers with strict Zip-Slip path sanitization and mid-stream bomb guards.

use crate::inflate::{crc32, gunzip_safe, inflate_raw_safe, ERR_BOMB_RATIO, ERR_BOMB_SIZE, ERR_CRC_MISMATCH};

pub const MAX_ZIP_ENTRIES: usize = 2048;

#[derive(Clone, Debug)]
pub struct ZipEntryMeta {
    pub index: usize,
    pub name: String,
    pub compression_method: u16,
    pub crc32: u32,
    pub compressed_size: u64,
    pub uncompressed_size: u64,
    pub local_header_offset: u64,
    pub is_dir: bool,
    pub is_encrypted: bool,
}

#[derive(Clone, Debug)]
pub struct TarEntryMeta {
    pub index: usize,
    pub name: String,
    pub size: usize,
    pub data_offset: usize,
    pub is_dir: bool,
}

#[inline]
fn read_u16_le(b: &[u8], off: usize) -> Option<u16> {
    if off + 2 > b.len() {
        return None;
    }
    Some(u16::from_le_bytes([b[off], b[off + 1]]))
}

#[inline]
fn read_u32_le(b: &[u8], off: usize) -> Option<u32> {
    if off + 4 > b.len() {
        return None;
    }
    Some(u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]]))
}

#[inline]
fn read_u64_le(b: &[u8], off: usize) -> Option<u64> {
    if off + 8 > b.len() {
        return None;
    }
    Some(u64::from_le_bytes([
        b[off],
        b[off + 1],
        b[off + 2],
        b[off + 3],
        b[off + 4],
        b[off + 5],
        b[off + 6],
        b[off + 7],
    ]))
}

/// Reject Zip-Slip path traversal, absolute paths, Windows drive prefixes, and NUL bytes.
pub fn sanitize_archive_path(raw: &str) -> Result<String, &'static str> {
    if raw.is_empty() || raw.contains('\0') {
        return Err("ZIP_SLIP_REJECTED");
    }
    let normalized = raw.replace('\\', "/");
    if normalized.starts_with('/') {
        return Err("ZIP_SLIP_REJECTED");
    }
    // Reject Windows drive letters like C:/ or C:foo
    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        return Err("ZIP_SLIP_REJECTED");
    }
    let mut parts: Vec<&str> = Vec::new();
    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return Err("ZIP_SLIP_REJECTED");
        }
        parts.push(seg);
    }
    if parts.is_empty() {
        return Err("ZIP_SLIP_REJECTED");
    }
    let mut out = parts.join("/");
    if normalized.ends_with('/') {
        out.push('/');
    }
    Ok(out)
}

fn find_eocd(data: &[u8]) -> Option<(usize, usize, u64, u64)> {
    if data.len() < 22 {
        return None;
    }
    let min_pos = data.len().saturating_sub(65557);
    let mut i = data.len() - 22;
    loop {
        if read_u32_le(data, i) == Some(0x0605_4b50) {
            let comment_len = read_u16_le(data, i + 20)? as usize;
            if i + 22 + comment_len <= data.len() {
                let mut total_entries = read_u16_le(data, i + 10)? as usize;
                let mut cd_size = read_u32_le(data, i + 12)? as u64;
                let mut cd_offset = read_u32_le(data, i + 16)? as u64;

                // Optional ZIP64 EOCD locator (20 bytes immediately before EOCD)
                if (total_entries == 0xFFFF || cd_size == 0xFFFF_FFFF || cd_offset == 0xFFFF_FFFF)
                    && i >= 20
                    && read_u32_le(data, i - 20) == Some(0x0706_4b50)
                {
                    if let Some(z64_off) = read_u64_le(data, i - 12) {
                        let z64 = z64_off as usize;
                        if read_u32_le(data, z64) == Some(0x0606_4b50) {
                            if let (Some(te), Some(sz), Some(off)) = (
                                read_u64_le(data, z64 + 32),
                                read_u64_le(data, z64 + 40),
                                read_u64_le(data, z64 + 48),
                            ) {
                                total_entries = te.min(MAX_ZIP_ENTRIES as u64 + 1) as usize;
                                cd_size = sz;
                                cd_offset = off;
                            }
                        }
                    }
                }
                return Some((i, total_entries, cd_size, cd_offset));
            }
        }
        if i == min_pos {
            break;
        }
        i -= 1;
    }
    None
}

pub fn zip_list_entries(data: &[u8]) -> Result<Vec<ZipEntryMeta>, &'static str> {
    let (_eocd_pos, total_entries, cd_size, cd_offset) =
        find_eocd(data).ok_or("ZIP_EOCD_NOT_FOUND")?;

    if total_entries > MAX_ZIP_ENTRIES {
        return Err("ZIP_TOO_MANY_ENTRIES");
    }
    let cd_start = cd_offset as usize;
    let cd_end = cd_start
        .checked_add(cd_size as usize)
        .unwrap_or(data.len())
        .min(data.len());
    if cd_start > data.len() {
        return Err("ZIP_CORRUPT_CD");
    }

    let mut pos = cd_start;
    let mut entries = Vec::with_capacity(total_entries.min(256));

    for idx in 0..total_entries {
        if pos + 46 > cd_end || read_u32_le(data, pos) != Some(0x0201_4b50) {
            break;
        }
        let flags = read_u16_le(data, pos + 8).ok_or("ZIP_CORRUPT_CD")?;
        let compression_method = read_u16_le(data, pos + 10).ok_or("ZIP_CORRUPT_CD")?;
        let entry_crc = read_u32_le(data, pos + 16).ok_or("ZIP_CORRUPT_CD")?;
        let mut comp_size = read_u32_le(data, pos + 20).ok_or("ZIP_CORRUPT_CD")? as u64;
        let mut uncomp_size = read_u32_le(data, pos + 24).ok_or("ZIP_CORRUPT_CD")? as u64;
        let name_len = read_u16_le(data, pos + 28).ok_or("ZIP_CORRUPT_CD")? as usize;
        let extra_len = read_u16_le(data, pos + 30).ok_or("ZIP_CORRUPT_CD")? as usize;
        let comment_len = read_u16_le(data, pos + 32).ok_or("ZIP_CORRUPT_CD")? as usize;
        let mut lfh_offset = read_u32_le(data, pos + 42).ok_or("ZIP_CORRUPT_CD")? as u64;

        let name_start = pos + 46;
        let name_end = name_start + name_len;
        let extra_end = name_end + extra_len;
        let next_pos = extra_end + comment_len;
        if next_pos > cd_end {
            return Err("ZIP_CORRUPT_CD");
        }

        // Parse ZIP64 extended information extra field (0x0001) if needed
        if comp_size == 0xFFFF_FFFF || uncomp_size == 0xFFFF_FFFF || lfh_offset == 0xFFFF_FFFF {
            let mut ep = name_end;
            while ep + 4 <= extra_end {
                let hdr_id = read_u16_le(data, ep).unwrap_or(0);
                let hdr_sz = read_u16_le(data, ep + 2).unwrap_or(0) as usize;
                let body = ep + 4;
                if body + hdr_sz > extra_end {
                    break;
                }
                if hdr_id == 0x0001 {
                    let mut p = body;
                    if uncomp_size == 0xFFFF_FFFF && p + 8 <= body + hdr_sz {
                        uncomp_size = read_u64_le(data, p).unwrap_or(uncomp_size);
                        p += 8;
                    }
                    if comp_size == 0xFFFF_FFFF && p + 8 <= body + hdr_sz {
                        comp_size = read_u64_le(data, p).unwrap_or(comp_size);
                        p += 8;
                    }
                    if lfh_offset == 0xFFFF_FFFF && p + 8 <= body + hdr_sz {
                        lfh_offset = read_u64_le(data, p).unwrap_or(lfh_offset);
                    }
                    break;
                }
                ep = body + hdr_sz;
            }
        }

        let raw_name = String::from_utf8_lossy(&data[name_start..name_end]).into_owned();
        let safe_name = sanitize_archive_path(&raw_name)?;
        let is_dir = safe_name.ends_with('/');
        entries.push(ZipEntryMeta {
            index: idx,
            name: safe_name,
            compression_method,
            crc32: entry_crc,
            compressed_size: comp_size,
            uncompressed_size: uncomp_size,
            local_header_offset: lfh_offset,
            is_dir,
            is_encrypted: (flags & 0x0001) != 0,
        });
        pos = next_pos;
    }

    Ok(entries)
}

pub fn zip_extract_entry(
    data: &[u8],
    entry_index: usize,
    max_out_bytes: usize,
    max_ratio: u32,
) -> Result<Vec<u8>, &'static str> {
    let entries = zip_list_entries(data)?;
    let entry = entries
        .get(entry_index)
        .ok_or("ZIP_ENTRY_INDEX_OUT_OF_RANGE")?;

    if entry.is_dir {
        return Ok(Vec::new());
    }
    if entry.is_encrypted {
        return Err("ZIP_ENCRYPTED_ENTRY_UNSUPPORTED");
    }
    if entry.uncompressed_size > max_out_bytes as u64 {
        return Err(ERR_BOMB_SIZE);
    }

    let lfh = entry.local_header_offset as usize;
    if lfh + 30 > data.len() || read_u32_le(data, lfh) != Some(0x0403_4b50) {
        return Err("ZIP_CORRUPT_LFH");
    }
    let lfh_name_len = read_u16_le(data, lfh + 26).ok_or("ZIP_CORRUPT_LFH")? as usize;
    let lfh_extra_len = read_u16_le(data, lfh + 28).ok_or("ZIP_CORRUPT_LFH")? as usize;
    let data_start = lfh + 30 + lfh_name_len + lfh_extra_len;
    let comp_len = entry.compressed_size as usize;
    let data_end = data_start.checked_add(comp_len).ok_or("ZIP_CORRUPT_BOUNDS")?;
    if data_end > data.len() {
        return Err("ZIP_CORRUPT_BOUNDS");
    }
    let payload = &data[data_start..data_end];

    let out = match entry.compression_method {
        0 => {
            if payload.len() > max_out_bytes {
                return Err(ERR_BOMB_SIZE);
            }
            if max_ratio > 0 {
                let limit = payload.len().max(1024).saturating_mul(max_ratio as usize);
                if payload.len() > limit {
                    return Err(ERR_BOMB_RATIO);
                }
            }
            payload.to_vec()
        }
        8 => {
            let (inflated, _consumed) = inflate_raw_safe(payload, max_out_bytes, max_ratio)?;
            inflated
        }
        _ => return Err("ZIP_UNSUPPORTED_METHOD"),
    };

    if entry.crc32 != 0 && crc32(&out) != entry.crc32 {
        return Err(ERR_CRC_MISMATCH);
    }
    Ok(out)
}

fn parse_octal(field: &[u8]) -> Option<usize> {
    let mut s = field;
    while !s.is_empty() && (s[0] == b' ' || s[0] == 0) {
        s = &s[1..];
    }
    let mut end = s.len();
    for (i, &b) in s.iter().enumerate() {
        if b == 0 || b == b' ' {
            end = i;
            break;
        }
    }
    let trimmed = &s[..end];
    if trimmed.is_empty() {
        return Some(0);
    }
    let mut acc: usize = 0;
    for &b in trimmed {
        if !(b'0'..=b'7').contains(&b) {
            return None;
        }
        acc = acc.checked_mul(8)?.checked_add((b - b'0') as usize)?;
    }
    Some(acc)
}

fn parse_tar_cstr(field: &[u8]) -> String {
    let end = field.iter().position(|&b| b == 0).unwrap_or(field.len());
    String::from_utf8_lossy(&field[..end]).into_owned()
}

/// Decode plain `.tar` or `.tar.gz` / `.tgz` into raw TAR buffer + entry table.
/// Rejects symlinks, hardlinks, device nodes, and Zip-Slip paths.
pub fn tar_parse_entries(
    raw: &[u8],
    max_total_bytes: usize,
    max_ratio: u32,
) -> Result<(Vec<u8>, Vec<TarEntryMeta>), &'static str> {
    let tar_bytes = if raw.len() >= 2 && raw[0] == 0x1F && raw[1] == 0x8B {
        gunzip_safe(raw, max_total_bytes, max_ratio)?
    } else {
        if raw.len() > max_total_bytes {
            return Err(ERR_BOMB_SIZE);
        }
        raw.to_vec()
    };

    let mut entries = Vec::new();
    let mut pos = 0usize;
    let mut pax_path_override: Option<String> = None;

    while pos + 512 <= tar_bytes.len() {
        let hdr = &tar_bytes[pos..pos + 512];
        if hdr.iter().all(|&b| b == 0) {
            break;
        }
        let size = parse_octal(&hdr[124..136]).ok_or("TAR_INVALID_HEADER")?;
        let typeflag = hdr[156];
        let name_part = parse_tar_cstr(&hdr[0..100]);
        let prefix = parse_tar_cstr(&hdr[345..500]);

        let data_start = pos + 512;
        let data_end = data_start.checked_add(size).ok_or("TAR_CORRUPT_BOUNDS")?;
        if data_end > tar_bytes.len() {
            return Err("TAR_CORRUPT_BOUNDS");
        }
        let padded_blocks = (size + 511) / 512;
        let next_pos = data_start
            .checked_add(padded_blocks * 512)
            .ok_or("TAR_CORRUPT_BOUNDS")?;

        // PAX extended header ('x') or GNU longname ('L')
        if typeflag == b'x' {
            let pax_str = String::from_utf8_lossy(&tar_bytes[data_start..data_end]);
            for line in pax_str.lines() {
                if let Some(rest) = line.split_once(' ').map(|x| x.1) {
                    if let Some(val) = rest.strip_prefix("path=") {
                        pax_path_override = Some(val.to_string());
                    }
                }
            }
            pos = next_pos;
            continue;
        }
        if typeflag == b'L' {
            pax_path_override = Some(parse_tar_cstr(&tar_bytes[data_start..data_end]));
            pos = next_pos;
            continue;
        }
        if typeflag == b'g' {
            pos = next_pos;
            continue;
        }

        // Security: reject symlinks ('2'), hardlinks ('1'), char/block/fifo devices ('3','4','6')
        if matches!(typeflag, b'1' | b'2' | b'3' | b'4' | b'6') {
            return Err("TAR_UNSAFE_ENTRY_TYPE");
        }

        let full_raw_name = if let Some(ov) = pax_path_override.take() {
            ov
        } else if !prefix.is_empty() {
            format!("{}/{}", prefix, name_part)
        } else {
            name_part
        };

        let safe_name = sanitize_archive_path(&full_raw_name)?;
        let is_dir = typeflag == b'5' || safe_name.ends_with('/');
        if entries.len() >= MAX_ZIP_ENTRIES {
            return Err("ZIP_TOO_MANY_ENTRIES");
        }
        entries.push(TarEntryMeta {
            index: entries.len(),
            name: safe_name,
            size,
            data_offset: data_start,
            is_dir,
        });
        pos = next_pos;
    }

    Ok((tar_bytes, entries))
}
