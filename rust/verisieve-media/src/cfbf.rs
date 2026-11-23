//! Pure-Rust CFBF / OLE2 Compound File Binary Format reader for Microsoft Outlook `.msg` files.
//! Handles v3 (512B sectors) & v4 (4096B sectors), DIFAT/FAT/MiniFAT chains with cycle guards,
//! MAPI Unicode/ASCII properties (`__substg1.0_*`), and embedded attachments (`__attach_version1.0_#*`).

const CFBF_MAGIC: [u8; 8] = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ENDOFCHAIN: u32 = 0xFFFF_FFFE;
const FREESECT: u32 = 0xFFFF_FFFF;
const NOSTREAM: u32 = 0xFFFF_FFFF;
const MAX_CHAIN_STEPS: usize = 65_536;

#[derive(Clone, Debug)]
pub struct MsgAttachment {
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

#[derive(Clone, Debug, Default)]
pub struct ParsedMsg {
    pub subject: String,
    pub sender_name: String,
    pub sender_email: String,
    pub display_to: String,
    pub display_cc: String,
    pub transport_headers: String,
    pub body_text: String,
    pub body_html: String,
    pub attachments: Vec<MsgAttachment>,
}

#[inline]
fn u16_le(b: &[u8], off: usize) -> Option<u16> {
    if off + 2 > b.len() {
        return None;
    }
    Some(u16::from_le_bytes([b[off], b[off + 1]]))
}

#[inline]
fn u32_le(b: &[u8], off: usize) -> Option<u32> {
    if off + 4 > b.len() {
        return None;
    }
    Some(u32::from_le_bytes([b[off], b[off + 1], b[off + 2], b[off + 3]]))
}

#[inline]
fn u64_le(b: &[u8], off: usize) -> Option<u64> {
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

fn decode_utf16le(bytes: &[u8]) -> String {
    let mut u16s = Vec::with_capacity(bytes.len() / 2);
    let mut i = 0;
    while i + 1 < bytes.len() {
        let code = u16::from_le_bytes([bytes[i], bytes[i + 1]]);
        if code == 0 {
            break;
        }
        u16s.push(code);
        i += 2;
    }
    String::from_utf16_lossy(&u16s)
}

fn decode_ascii_or_utf8(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).into_owned()
}

struct DirEntry {
    name: String,
    obj_type: u8,
    left_id: u32,
    right_id: u32,
    child_id: u32,
    start_sector: u32,
    stream_size: usize,
}

struct Cfbf<'a> {
    data: &'a [u8],
    sector_size: usize,
    mini_sector_size: usize,
    mini_cutoff: usize,
    fat: Vec<u32>,
    mini_fat: Vec<u32>,
    mini_stream: Vec<u8>,
    dirs: Vec<DirEntry>,
}

impl<'a> Cfbf<'a> {
    fn parse(data: &'a [u8]) -> Result<Self, &'static str> {
        if data.len() < 512 || data[0..8] != CFBF_MAGIC {
            return Err("CFBF_INVALID_MAGIC");
        }
        let sector_shift = u16_le(data, 30).ok_or("CFBF_CORRUPT_HEADER")?;
        let mini_shift = u16_le(data, 32).ok_or("CFBF_CORRUPT_HEADER")?;
        if !(9..=12).contains(&sector_shift) || !(6..=sector_shift).contains(&mini_shift) {
            return Err("CFBF_INVALID_SECTOR_SHIFT");
        }
        let sector_size = 1usize << sector_shift;
        let mini_sector_size = 1usize << mini_shift;
        let first_dir_sector = u32_le(data, 48).ok_or("CFBF_CORRUPT_HEADER")?;
        let mini_cutoff = u32_le(data, 56).ok_or("CFBF_CORRUPT_HEADER")? as usize;
        let first_mini_fat_sector = u32_le(data, 60).ok_or("CFBF_CORRUPT_HEADER")?;
        let num_mini_fat_sectors = u32_le(data, 64).ok_or("CFBF_CORRUPT_HEADER")? as usize;
        let first_difat_sector = u32_le(data, 68).ok_or("CFBF_CORRUPT_HEADER")?;
        let num_difat_sectors = u32_le(data, 72).ok_or("CFBF_CORRUPT_HEADER")? as usize;

        // Collect FAT sector IDs from header DIFAT (109 entries at offset 76)
        let mut fat_sector_ids = Vec::new();
        for i in 0..109 {
            let sid = u32_le(data, 76 + i * 4).unwrap_or(FREESECT);
            if sid != FREESECT && sid != ENDOFCHAIN {
                fat_sector_ids.push(sid);
            }
        }
        // Follow extra DIFAT sectors if present
        let mut difat_sid = first_difat_sector;
        let entries_per_sector = sector_size / 4;
        for _ in 0..num_difat_sectors.min(1024) {
            if difat_sid == ENDOFCHAIN || difat_sid == FREESECT {
                break;
            }
            let off = ((difat_sid as usize) + 1).saturating_mul(sector_size);
            if off + sector_size > data.len() {
                break;
            }
            for j in 0..(entries_per_sector - 1) {
                let sid = u32_le(data, off + j * 4).unwrap_or(FREESECT);
                if sid != FREESECT && sid != ENDOFCHAIN {
                    fat_sector_ids.push(sid);
                }
            }
            difat_sid = u32_le(data, off + (entries_per_sector - 1) * 4).unwrap_or(ENDOFCHAIN);
        }

        // Build FAT
        let mut fat = Vec::with_capacity(fat_sector_ids.len() * entries_per_sector);
        for sid in fat_sector_ids {
            let off = ((sid as usize) + 1).saturating_mul(sector_size);
            if off + sector_size > data.len() {
                continue;
            }
            for j in 0..entries_per_sector {
                fat.push(u32_le(data, off + j * 4).unwrap_or(FREESECT));
            }
        }

        // Helper to read a regular FAT chain
        let read_regular = |start_sid: u32, max_bytes: usize| -> Result<Vec<u8>, &'static str> {
            let mut out = Vec::new();
            let mut cur = start_sid;
            let mut steps = 0usize;
            while cur != ENDOFCHAIN && cur != FREESECT {
                if steps >= MAX_CHAIN_STEPS {
                    return Err("CFBF_FAT_CYCLE_DETECTED");
                }
                steps += 1;
                let off = ((cur as usize) + 1).saturating_mul(sector_size);
                if off + sector_size > data.len() {
                    break;
                }
                let take = sector_size.min(max_bytes.saturating_sub(out.len()));
                out.extend_from_slice(&data[off..off + take]);
                if out.len() >= max_bytes {
                    break;
                }
                cur = *fat.get(cur as usize).unwrap_or(&ENDOFCHAIN);
            }
            Ok(out)
        };

        // Read directory stream
        let dir_bytes = read_regular(first_dir_sector, 16 * 1024 * 1024)?;
        let mut dirs = Vec::new();
        let mut off = 0usize;
        while off + 128 <= dir_bytes.len() {
            let entry = &dir_bytes[off..off + 128];
            let name_len = (u16_le(entry, 64).unwrap_or(0) as usize).min(64);
            let name = if name_len >= 2 {
                decode_utf16le(&entry[0..name_len])
            } else {
                String::new()
            };
            let obj_type = entry[66];
            let left_id = u32_le(entry, 68).unwrap_or(NOSTREAM);
            let right_id = u32_le(entry, 72).unwrap_or(NOSTREAM);
            let child_id = u32_le(entry, 76).unwrap_or(NOSTREAM);
            let start_sector = u32_le(entry, 116).unwrap_or(ENDOFCHAIN);
            let size_lo = u32_le(entry, 120).unwrap_or(0) as u64;
            let size_full = if sector_size == 4096 {
                u64_le(entry, 120).unwrap_or(size_lo)
            } else {
                size_lo
            };
            dirs.push(DirEntry {
                name,
                obj_type,
                left_id,
                right_id,
                child_id,
                start_sector,
                stream_size: (size_full as usize).min(64 * 1024 * 1024),
            });
            off += 128;
        }
        if dirs.is_empty() {
            return Err("CFBF_EMPTY_DIRECTORY");
        }

        // Build MiniFAT
        let mut mini_fat = Vec::new();
        if first_mini_fat_sector != ENDOFCHAIN && num_mini_fat_sectors > 0 {
            let mf_bytes = read_regular(
                first_mini_fat_sector,
                num_mini_fat_sectors.saturating_mul(sector_size).min(8 * 1024 * 1024),
            )?;
            let mut p = 0;
            while p + 4 <= mf_bytes.len() {
                mini_fat.push(u32_le(&mf_bytes, p).unwrap_or(FREESECT));
                p += 4;
            }
        }

        // Read Root Entry mini-stream container
        let mini_stream = if dirs[0].start_sector != ENDOFCHAIN && dirs[0].stream_size > 0 {
            read_regular(dirs[0].start_sector, dirs[0].stream_size)?
        } else {
            Vec::new()
        };

        Ok(Self {
            data,
            sector_size,
            mini_sector_size,
            mini_cutoff,
            fat,
            mini_fat,
            mini_stream,
            dirs,
        })
    }

    fn read_stream(&self, dir_idx: usize) -> Result<Vec<u8>, &'static str> {
        let d = self.dirs.get(dir_idx).ok_or("CFBF_INVALID_DIR")?;
        if d.stream_size == 0 || d.start_sector == ENDOFCHAIN || d.start_sector == FREESECT {
            return Ok(Vec::new());
        }
        if d.stream_size < self.mini_cutoff && !self.mini_stream.is_empty() {
            let mut out = Vec::with_capacity(d.stream_size);
            let mut cur = d.start_sector;
            let mut steps = 0usize;
            while cur != ENDOFCHAIN && cur != FREESECT && out.len() < d.stream_size {
                if steps >= MAX_CHAIN_STEPS {
                    return Err("CFBF_MINIFAT_CYCLE");
                }
                steps += 1;
                let off = (cur as usize).saturating_mul(self.mini_sector_size);
                if off + self.mini_sector_size > self.mini_stream.len() {
                    let avail = self.mini_stream.len().saturating_sub(off);
                    let take = avail.min(d.stream_size - out.len());
                    if take > 0 {
                        out.extend_from_slice(&self.mini_stream[off..off + take]);
                    }
                    break;
                }
                let take = self.mini_sector_size.min(d.stream_size - out.len());
                out.extend_from_slice(&self.mini_stream[off..off + take]);
                cur = *self.mini_fat.get(cur as usize).unwrap_or(&ENDOFCHAIN);
            }
            Ok(out)
        } else {
            let mut out = Vec::with_capacity(d.stream_size);
            let mut cur = d.start_sector;
            let mut steps = 0usize;
            while cur != ENDOFCHAIN && cur != FREESECT && out.len() < d.stream_size {
                if steps >= MAX_CHAIN_STEPS {
                    return Err("CFBF_FAT_CYCLE");
                }
                steps += 1;
                let off = ((cur as usize) + 1).saturating_mul(self.sector_size);
                if off >= self.data.len() {
                    break;
                }
                let avail = (self.data.len() - off).min(self.sector_size);
                let take = avail.min(d.stream_size - out.len());
                out.extend_from_slice(&self.data[off..off + take]);
                cur = *self.fat.get(cur as usize).unwrap_or(&ENDOFCHAIN);
            }
            Ok(out)
        }
    }

    fn collect_children(&self, storage_idx: usize) -> Vec<usize> {
        let mut result = Vec::new();
        let Some(root_child) = self.dirs.get(storage_idx).map(|d| d.child_id) else {
            return result;
        };
        if root_child == NOSTREAM {
            return result;
        }
        let mut stack = vec![root_child];
        let mut visited = vec![false; self.dirs.len()];
        while let Some(id) = stack.pop() {
            let idx = id as usize;
            if idx >= self.dirs.len() || visited[idx] {
                continue;
            }
            visited[idx] = true;
            result.push(idx);
            let d = &self.dirs[idx];
            if d.left_id != NOSTREAM {
                stack.push(d.left_id);
            }
            if d.right_id != NOSTREAM {
                stack.push(d.right_id);
            }
        }
        result
    }
}

fn decode_mapi_string(name: &str, bytes: &[u8]) -> String {
    if name.ends_with("001F") || name.ends_with("001f") {
        decode_utf16le(bytes)
    } else {
        decode_ascii_or_utf8(bytes)
    }
}

/// Parse an Outlook `.msg` CFBF binary into structured metadata, bodies, and attachments.
pub fn parse_outlook_msg(data: &[u8]) -> Result<ParsedMsg, &'static str> {
    let cfbf = Cfbf::parse(data)?;
    let mut msg = ParsedMsg::default();
    let root_children = cfbf.collect_children(0);

    for idx in root_children {
        let d = &cfbf.dirs[idx];
        let upper = d.name.to_ascii_uppercase();

        if d.obj_type == 2 && upper.starts_with("__SUBSTG1.0_") {
            let bytes = cfbf.read_stream(idx)?;
            let code = &upper["__SUBSTG1.0_".len()..];
            if code.starts_with("0037") {
                msg.subject = decode_mapi_string(code, &bytes);
            } else if code.starts_with("0C1A") {
                msg.sender_name = decode_mapi_string(code, &bytes);
            } else if code.starts_with("0C1F") || code.starts_with("5D01") {
                if msg.sender_email.is_empty() {
                    msg.sender_email = decode_mapi_string(code, &bytes);
                }
            } else if code.starts_with("0E04") {
                msg.display_to = decode_mapi_string(code, &bytes);
            } else if code.starts_with("0E03") {
                msg.display_cc = decode_mapi_string(code, &bytes);
            } else if code.starts_with("007D") {
                msg.transport_headers = decode_mapi_string(code, &bytes);
            } else if code.starts_with("1000") {
                msg.body_text = decode_mapi_string(code, &bytes);
            } else if code.starts_with("1013") {
                msg.body_html = if code.ends_with("0102") {
                    String::from_utf8_lossy(&bytes).into_owned()
                } else {
                    decode_mapi_string(code, &bytes)
                };
            }
        } else if d.obj_type == 1 && upper.starts_with("__ATTACH_VERSION1.0_") {
            let att_children = cfbf.collect_children(idx);
            let mut filename = String::new();
            let mut short_name = String::new();
            let mut mime_type = String::new();
            let mut att_data = Vec::new();

            for cidx in att_children {
                let cd = &cfbf.dirs[cidx];
                if cd.obj_type != 2 {
                    continue;
                }
                let cu = cd.name.to_ascii_uppercase();
                if let Some(code) = cu.strip_prefix("__SUBSTG1.0_") {
                    let bytes = cfbf.read_stream(cidx)?;
                    if code.starts_with("3707") {
                        filename = decode_mapi_string(code, &bytes);
                    } else if code.starts_with("3704") {
                        short_name = decode_mapi_string(code, &bytes);
                    } else if code.starts_with("370E") {
                        mime_type = decode_mapi_string(code, &bytes);
                    } else if code.starts_with("37010102") {
                        att_data = bytes;
                    }
                }
            }

            let final_name = if !filename.is_empty() {
                filename
            } else if !short_name.is_empty() {
                short_name
            } else {
                format!("attachment_{}.bin", msg.attachments.len() + 1)
            };
            if !att_data.is_empty() {
                msg.attachments.push(MsgAttachment {
                    filename: final_name,
                    mime_type,
                    data: att_data,
                });
            }
        }
    }

    Ok(msg)
}
