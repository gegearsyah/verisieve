//! Pure-Rust RFC 1951 DEFLATE & RFC 1952 GZIP inflater with mid-stream bomb guards
//! and IEEE 802.3 CRC-32 verification. Zero external crates.

pub const ERR_INVALID_STREAM: &str = "DEFLATE_INVALID_STREAM";
pub const ERR_BOMB_SIZE: &str = "ZIP_BOMB_SIZE_EXCEEDED";
pub const ERR_BOMB_RATIO: &str = "ZIP_BOMB_RATIO_EXCEEDED";
pub const ERR_CRC_MISMATCH: &str = "CRC32_MISMATCH";

/// Standard IEEE 802.3 CRC-32 (polynomial 0xEDB88320).
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

struct BitReader<'a> {
    data: &'a [u8],
    byte_pos: usize,
    bit_buf: u64,
    bit_cnt: u32,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self {
            data,
            byte_pos: 0,
            bit_buf: 0,
            bit_cnt: 0,
        }
    }

    #[inline]
    fn ensure_bits(&mut self, n: u32) {
        while self.bit_cnt < n && self.byte_pos < self.data.len() {
            self.bit_buf |= (self.data[self.byte_pos] as u64) << self.bit_cnt;
            self.byte_pos += 1;
            self.bit_cnt += 8;
        }
    }

    #[inline]
    fn read_bits(&mut self, n: u32) -> Result<u32, &'static str> {
        if n == 0 {
            return Ok(0);
        }
        self.ensure_bits(n);
        if self.bit_cnt < n {
            return Err(ERR_INVALID_STREAM);
        }
        let val = (self.bit_buf & ((1u64 << n) - 1)) as u32;
        self.bit_buf >>= n;
        self.bit_cnt -= n;
        Ok(val)
    }

    fn align_byte(&mut self) {
        let drop = self.bit_cnt & 7;
        if drop > 0 {
            self.bit_buf >>= drop;
            self.bit_cnt -= drop;
        }
    }

    fn read_u16_aligned(&mut self) -> Result<u16, &'static str> {
        let lo = self.read_bits(8)? as u16;
        let hi = self.read_bits(8)? as u16;
        Ok(lo | (hi << 8))
    }

    fn read_exact_aligned(&mut self, len: usize, out: &mut Vec<u8>) -> Result<(), &'static str> {
        self.align_byte();
        let mut remaining = len;
        while remaining > 0 && self.bit_cnt >= 8 {
            out.push((self.bit_buf & 0xFF) as u8);
            self.bit_buf >>= 8;
            self.bit_cnt -= 8;
            remaining -= 1;
        }
        if remaining > 0 {
            if self.byte_pos + remaining > self.data.len() {
                return Err(ERR_INVALID_STREAM);
            }
            out.extend_from_slice(&self.data[self.byte_pos..self.byte_pos + remaining]);
            self.byte_pos += remaining;
        }
        Ok(())
    }

    fn bytes_consumed(&self) -> usize {
        self.byte_pos.saturating_sub((self.bit_cnt / 8) as usize)
    }
}

const MAX_BITS: usize = 15;

struct HuffTree {
    counts: [u16; MAX_BITS + 1],
    symbols: Vec<u16>,
}

impl HuffTree {
    fn from_lengths(lengths: &[u8]) -> Result<Self, &'static str> {
        let mut counts = [0u16; MAX_BITS + 1];
        for &l in lengths {
            if l as usize > MAX_BITS {
                return Err(ERR_INVALID_STREAM);
            }
            if l > 0 {
                counts[l as usize] += 1;
            }
        }
        // Validate Kraft inequality (allow empty tree for unused distance codes)
        let mut left: i32 = 1;
        for bits in 1..=MAX_BITS {
            left <<= 1;
            left -= counts[bits] as i32;
            if left < 0 {
                return Err(ERR_INVALID_STREAM);
            }
        }

        let mut offsets = [0u16; MAX_BITS + 1];
        let mut total = 0u16;
        for bits in 1..=MAX_BITS {
            offsets[bits] = total;
            total = total.wrapping_add(counts[bits]);
        }

        let mut symbols = vec![0u16; total as usize];
        for (sym, &len) in lengths.iter().enumerate() {
            if len > 0 {
                let idx = offsets[len as usize] as usize;
                symbols[idx] = sym as u16;
                offsets[len as usize] += 1;
            }
        }

        Ok(Self { counts, symbols })
    }

    #[inline]
    fn decode(&self, br: &mut BitReader<'_>) -> Result<u16, &'static str> {
        let mut code: i32 = 0;
        let mut first: i32 = 0;
        let mut index: i32 = 0;
        for len in 1..=MAX_BITS {
            let bit = br.read_bits(1)? as i32;
            code |= bit;
            let count = self.counts[len] as i32;
            if code - count < first {
                let pos = (index + (code - first)) as usize;
                return self.symbols.get(pos).copied().ok_or(ERR_INVALID_STREAM);
            }
            index += count;
            first += count;
            first <<= 1;
            code <<= 1;
        }
        Err(ERR_INVALID_STREAM)
    }
}

const LEN_BASE: [u16; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115,
    131, 163, 195, 227, 258,
];
const LEN_EXTRA: [u8; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE: [u16; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA: [u8; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];
const CL_ORDER: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

fn build_fixed_trees() -> (HuffTree, HuffTree) {
    let mut lit_len = [0u8; 288];
    for item in lit_len.iter_mut().take(144) {
        *item = 8;
    }
    for item in lit_len.iter_mut().skip(144).take(112) {
        *item = 9;
    }
    for item in lit_len.iter_mut().skip(256).take(24) {
        *item = 7;
    }
    for item in lit_len.iter_mut().skip(280).take(8) {
        *item = 8;
    }
    let dist_len = [5u8; 32];
    (
        HuffTree::from_lengths(&lit_len).expect("valid fixed lit tree"),
        HuffTree::from_lengths(&dist_len).expect("valid fixed dist tree"),
    )
}

#[inline]
fn check_limits(
    next_len: usize,
    max_out_bytes: usize,
    ratio_limit_bytes: usize,
) -> Result<(), &'static str> {
    if next_len > max_out_bytes {
        return Err(ERR_BOMB_SIZE);
    }
    if ratio_limit_bytes > 0 && next_len > ratio_limit_bytes {
        return Err(ERR_BOMB_RATIO);
    }
    Ok(())
}

/// Inflate raw RFC 1951 DEFLATE stream with strict mid-stream size & compression-ratio guards.
pub fn inflate_raw_safe(
    input: &[u8],
    max_out_bytes: usize,
    max_ratio: u32,
) -> Result<(Vec<u8>, usize), &'static str> {
    let ratio_limit_bytes = if max_ratio > 0 {
        let base = input.len().max(1024);
        base.saturating_mul(max_ratio as usize)
    } else {
        0
    };

    let mut br = BitReader::new(input);
    let mut out = Vec::with_capacity(input.len().min(65536).min(max_out_bytes));
    let mut fixed_cache: Option<(HuffTree, HuffTree)> = None;

    loop {
        let bfinal = br.read_bits(1)?;
        let btype = br.read_bits(2)?;

        match btype {
            0 => {
                // Uncompressed stored block
                br.align_byte();
                let len = br.read_u16_aligned()? as usize;
                let nlen = br.read_u16_aligned()?;
                if (len as u16) != !nlen {
                    return Err(ERR_INVALID_STREAM);
                }
                check_limits(out.len().saturating_add(len), max_out_bytes, ratio_limit_bytes)?;
                br.read_exact_aligned(len, &mut out)?;
            }
            1 | 2 => {
                let (lit_tree, dist_tree) = if btype == 1 {
                    let trees = fixed_cache.get_or_insert_with(build_fixed_trees);
                    (&trees.0, &trees.1)
                } else {
                    let hlit = (br.read_bits(5)? as usize) + 257;
                    let hdist = (br.read_bits(5)? as usize) + 1;
                    let hclen = (br.read_bits(4)? as usize) + 4;
                    if hlit > 286 || hdist > 30 {
                        return Err(ERR_INVALID_STREAM);
                    }
                    let mut cl_lengths = [0u8; 19];
                    for i in 0..hclen {
                        cl_lengths[CL_ORDER[i]] = br.read_bits(3)? as u8;
                    }
                    let cl_tree = HuffTree::from_lengths(&cl_lengths)?;
                    let total = hlit + hdist;
                    let mut lengths = Vec::with_capacity(total);
                    while lengths.len() < total {
                        let sym = cl_tree.decode(&mut br)?;
                        match sym {
                            0..=15 => lengths.push(sym as u8),
                            16 => {
                                let prev = *lengths.last().ok_or(ERR_INVALID_STREAM)?;
                                let repeat = (br.read_bits(2)? as usize) + 3;
                                if lengths.len() + repeat > total {
                                    return Err(ERR_INVALID_STREAM);
                                }
                                for _ in 0..repeat {
                                    lengths.push(prev);
                                }
                            }
                            17 => {
                                let repeat = (br.read_bits(3)? as usize) + 3;
                                if lengths.len() + repeat > total {
                                    return Err(ERR_INVALID_STREAM);
                                }
                                for _ in 0..repeat {
                                    lengths.push(0);
                                }
                            }
                            18 => {
                                let repeat = (br.read_bits(7)? as usize) + 11;
                                if lengths.len() + repeat > total {
                                    return Err(ERR_INVALID_STREAM);
                                }
                                for _ in 0..repeat {
                                    lengths.push(0);
                                }
                            }
                            _ => return Err(ERR_INVALID_STREAM),
                        }
                    }
                    let lt = HuffTree::from_lengths(&lengths[..hlit])?;
                    let dt = HuffTree::from_lengths(&lengths[hlit..])?;
                    // Decode dynamic block inline to avoid borrowing local trees across arm
                    decode_huffman_block(&mut br, &lt, &dt, &mut out, max_out_bytes, ratio_limit_bytes)?;
                    if bfinal != 0 {
                        break;
                    }
                    continue;
                };

                decode_huffman_block(
                    &mut br,
                    lit_tree,
                    dist_tree,
                    &mut out,
                    max_out_bytes,
                    ratio_limit_bytes,
                )?;
            }
            _ => return Err(ERR_INVALID_STREAM),
        }

        if bfinal != 0 {
            break;
        }
    }

    Ok((out, br.bytes_consumed()))
}

fn decode_huffman_block(
    br: &mut BitReader<'_>,
    lit_tree: &HuffTree,
    dist_tree: &HuffTree,
    out: &mut Vec<u8>,
    max_out_bytes: usize,
    ratio_limit_bytes: usize,
) -> Result<(), &'static str> {
    loop {
        let sym = lit_tree.decode(br)?;
        if sym < 256 {
            check_limits(out.len() + 1, max_out_bytes, ratio_limit_bytes)?;
            out.push(sym as u8);
        } else if sym == 256 {
            return Ok(());
        } else {
            let len_idx = (sym - 257) as usize;
            if len_idx >= LEN_BASE.len() {
                return Err(ERR_INVALID_STREAM);
            }
            let length =
                (LEN_BASE[len_idx] as usize) + (br.read_bits(LEN_EXTRA[len_idx] as u32)? as usize);

            let dist_sym = dist_tree.decode(br)? as usize;
            if dist_sym >= DIST_BASE.len() {
                return Err(ERR_INVALID_STREAM);
            }
            let distance = (DIST_BASE[dist_sym] as usize)
                + (br.read_bits(DIST_EXTRA[dist_sym] as u32)? as usize);

            if distance == 0 || distance > out.len() {
                return Err(ERR_INVALID_STREAM);
            }
            check_limits(
                out.len().saturating_add(length),
                max_out_bytes,
                ratio_limit_bytes,
            )?;

            let start = out.len() - distance;
            for i in 0..length {
                let b = out[start + (i % distance)];
                out.push(b);
            }
        }
    }
}

/// Inflate RFC 1952 GZIP container with mid-stream bomb guard and CRC-32 + ISIZE verification.
pub fn gunzip_safe(
    input: &[u8],
    max_out_bytes: usize,
    max_ratio: u32,
) -> Result<Vec<u8>, &'static str> {
    if input.len() < 18 || input[0] != 0x1F || input[1] != 0x8B || input[2] != 8 {
        return Err(ERR_INVALID_STREAM);
    }
    let flg = input[3];
    let mut pos = 10usize;
    if (flg & 0x04) != 0 {
        if pos + 2 > input.len() {
            return Err(ERR_INVALID_STREAM);
        }
        let xlen = u16::from_le_bytes([input[pos], input[pos + 1]]) as usize;
        pos += 2 + xlen;
    }
    if (flg & 0x08) != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1;
    }
    if (flg & 0x10) != 0 {
        while pos < input.len() && input[pos] != 0 {
            pos += 1;
        }
        pos += 1;
    }
    if (flg & 0x02) != 0 {
        pos += 2;
    }
    if pos + 8 > input.len() {
        return Err(ERR_INVALID_STREAM);
    }

    let deflate_slice = &input[pos..input.len() - 8];
    let (out, _consumed) = inflate_raw_safe(deflate_slice, max_out_bytes, max_ratio)?;

    let trailer_off = input.len() - 8;
    let expected_crc = u32::from_le_bytes([
        input[trailer_off],
        input[trailer_off + 1],
        input[trailer_off + 2],
        input[trailer_off + 3],
    ]);
    let expected_isize = u32::from_le_bytes([
        input[trailer_off + 4],
        input[trailer_off + 5],
        input[trailer_off + 6],
        input[trailer_off + 7],
    ]);

    if crc32(&out) != expected_crc || (out.len() as u32) != expected_isize {
        return Err(ERR_CRC_MISMATCH);
    }

    Ok(out)
}
