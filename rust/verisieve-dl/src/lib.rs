// Multiplatform compiled deep learning, BitNet b1.58 embedding, and VeRA core for MLE.
// Strict IEEE-754 f32 arithmetic: zero libm transcendentals, zero Wasm imports,
// 32/64-bit portable C99 ABI.

#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

use alloc::vec;
use alloc::vec::Vec;
use core::slice;

#[cfg(target_arch = "wasm32")]
mod wasm_rt {
    use core::alloc::{GlobalAlloc, Layout};
    use core::cell::UnsafeCell;
    use core::ptr;

    #[repr(C, align(16))]
    struct BlockHeader {
        size: usize,
        next_free: *mut BlockHeader,
        is_free: usize,
        _pad: usize,
    }

    struct WasmHeap {
        free_head: UnsafeCell<*mut BlockHeader>,
    }

    unsafe impl Sync for WasmHeap {}

    #[global_allocator]
    static ALLOCATOR: WasmHeap = WasmHeap {
        free_head: UnsafeCell::new(ptr::null_mut()),
    };

    #[inline(never)]
    unsafe fn insert_and_coalesce(head_ptr: *mut *mut BlockHeader, blk: *mut BlockHeader) {
        (*blk).is_free = 1;
        let mut prev: *mut BlockHeader = ptr::null_mut();
        let mut curr = *head_ptr;
        while !curr.is_null() && (curr as usize) < (blk as usize) {
            prev = curr;
            curr = (*curr).next_free;
        }

        if !curr.is_null() && (blk as usize) + 16 + (*blk).size == (curr as usize) {
            (*blk).size += 16 + (*curr).size;
            (*blk).next_free = (*curr).next_free;
        } else {
            (*blk).next_free = curr;
        }

        if !prev.is_null() {
            if (prev as usize) + 16 + (*prev).size == (blk as usize) {
                (*prev).size += 16 + (*blk).size;
                (*prev).next_free = (*blk).next_free;
            } else {
                (*prev).next_free = blk;
            }
        } else {
            *head_ptr = blk;
        }
    }

    unsafe impl GlobalAlloc for WasmHeap {
        #[inline(never)]
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            if layout.align() > 16 {
                return ptr::null_mut();
            }
            let req = (layout.size().max(16) + 15) & !15;
            let head_ptr = self.free_head.get();

            for _ in 0..2 {
                let mut prev: *mut BlockHeader = ptr::null_mut();
                let mut curr = *head_ptr;
                while !curr.is_null() {
                    if (*curr).size >= req {
                        if (*curr).size >= req + 32 {
                            let rem = (curr as *mut u8).add(16 + req) as *mut BlockHeader;
                            (*rem).size = (*curr).size - req - 16;
                            (*rem).next_free = (*curr).next_free;
                            (*rem).is_free = 1;
                            (*rem)._pad = 0;
                            if prev.is_null() {
                                *head_ptr = rem;
                            } else {
                                (*prev).next_free = rem;
                            }
                            (*curr).size = req;
                        } else if prev.is_null() {
                            *head_ptr = (*curr).next_free;
                        } else {
                            (*prev).next_free = (*curr).next_free;
                        }
                        (*curr).is_free = 0;
                        (*curr).next_free = ptr::null_mut();
                        return (curr as *mut u8).add(16);
                    }
                    prev = curr;
                    curr = (*curr).next_free;
                }

                let need_bytes = 16 + req;
                let grow_pages = ((need_bytes + 65535) >> 16).max(4);
                let prev_pages = core::arch::wasm32::memory_grow(0, grow_pages);
                if prev_pages == usize::MAX {
                    return ptr::null_mut();
                }
                let base_off = if prev_pages == 0 { 16 } else { prev_pages << 16 };
                let avail = (grow_pages << 16) - if prev_pages == 0 { 32 } else { 16 };
                let new_blk = base_off as *mut BlockHeader;
                (*new_blk).size = avail;
                (*new_blk).next_free = ptr::null_mut();
                (*new_blk).is_free = 1;
                (*new_blk)._pad = 0;
                insert_and_coalesce(head_ptr, new_blk);
            }
            ptr::null_mut()
        }

        #[inline(never)]
        unsafe fn dealloc(&self, ptr: *mut u8, _layout: Layout) {
            if !ptr.is_null() {
                insert_and_coalesce(self.free_head.get(), ptr.sub(16) as *mut BlockHeader);
            }
        }
    }

    #[panic_handler]
    fn handle_panic(_info: &core::panic::PanicInfo) -> ! {
        core::arch::wasm32::unreachable()
    }
}

// ============================================================================
// 1. Core ABI & 8-Byte-Aligned Linear Memory Allocator
// ============================================================================

#[no_mangle]
pub extern "C" fn mle_dl_abi_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn mle_dl_alloc(size: usize) -> *mut u8 {
    let words = if size == 0 { 1 } else { (size + 7) >> 3 };
    let mut buf = Vec::<u64>::with_capacity(words);
    let ptr = buf.as_mut_ptr() as *mut u8;
    core::mem::forget(buf);
    ptr
}

/// # Safety
/// `ptr` and `size` must match an allocation returned by `mle_dl_alloc`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_free(ptr: *mut u8, size: usize) {
    if ptr.is_null() {
        return;
    }
    let words = if size == 0 { 1 } else { (size + 7) >> 3 };
    drop(Vec::<u64>::from_raw_parts(ptr as *mut u64, 0, words));
}

// ============================================================================
// 2. Deterministic PRNG & Strict libm-Free IEEE-754 f32 Math
// ============================================================================

#[derive(Clone, Copy)]
struct Mulberry32(u32);

impl Mulberry32 {
    #[inline]
    fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut z = self.0;
        z = (z ^ (z >> 15)).wrapping_mul(z | 1);
        z ^= z.wrapping_add((z ^ (z >> 7)).wrapping_mul(z | 61));
        z ^ (z >> 14)
    }

    #[inline]
    fn next_f32(&mut self) -> f32 {
        ((self.next_u32() >> 8) as f32) * (1.0 / 16_777_216.0)
    }

    #[inline]
    fn uniform_sym(&mut self, bound: f32) -> f32 {
        (self.next_f32() * 2.0 - 1.0) * bound
    }
}

#[inline]
fn abs_f32(v: f32) -> f32 {
    f32::from_bits(v.to_bits() & 0x7fff_ffff)
}

#[inline]
fn clamp_f32(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}

#[inline]
fn max_f32(a: f32, b: f32) -> f32 {
    if a > b {
        a
    } else {
        b
    }
}

#[cfg(any(test, target_arch = "wasm32"))]
#[inline(never)]
fn sqrt_ieee754_nr(x: f32) -> f32 {
    if x <= 0.0 {
        return if x == 0.0 { x } else { f32::NAN };
    }
    if !x.is_finite() {
        return x;
    }
    let xd = x as f64;
    let bits = xd.to_bits();
    let exp = ((bits >> 52) & 0x7ff) as i64 - 1023;
    let mut m = f64::from_bits((bits & 0x000f_ffff_ffff_ffff) | 0x3ff0_0000_0000_0000);
    let half_exp = if (exp & 1) != 0 {
        m *= 2.0;
        (exp - 1) >> 1
    } else {
        exp >> 1
    };
    let mut y = 0.5 + 0.5 * m;
    y = 0.5 * (y + m / y);
    y = 0.5 * (y + m / y);
    y = 0.5 * (y + m / y);
    y = 0.5 * (y + m / y);
    let scale = f64::from_bits(((half_exp + 1023) as u64) << 52);
    (y * scale) as f32
}

#[inline]
fn sqrt_f32(x: f32) -> f32 {
    // Native builds use the IEEE-754 correctly rounded hardware sqrt. The Wasm
    // build is no_std on stable Rust, where neither f32::sqrt nor the f32.sqrt
    // intrinsic is available, so it uses the correctly rounded software routine
    // (tested 0-ULP against hardware sqrt; cross-target parity checked in CI).
    #[cfg(not(target_arch = "wasm32"))]
    {
        x.sqrt()
    }
    #[cfg(target_arch = "wasm32")]
    {
        sqrt_ieee754_nr(x)
    }
}

#[inline]
fn floor_clamped(v: f32) -> f32 {
    let xi = v as i32;
    let xf = xi as f32;
    if v < xf {
        xf - 1.0
    } else {
        xf
    }
}

#[inline(never)]
fn fast_exp(x: f32) -> f32 {
    let xc = clamp_f32(x, -20.0, 20.0);
    let k = floor_clamped(xc * core::f32::consts::LOG2_E + 0.5);
    let r = xc - k * core::f32::consts::LN_2;
    let p = 1.0
        + r * (1.0
            + r * (0.5
                + r * (0.166_666_67
                    + r * (0.041_666_668 + r * (0.008_333_334 + r * 0.001_388_888_9)))));
    p * f32::from_bits(((k as i32 + 127) as u32) << 23)
}

#[inline(never)]
fn fast_ln(x: f32) -> f32 {
    let xc = max_f32(x, 1.0e-30);
    let bits = xc.to_bits();
    let mut e = ((bits >> 23) & 0xff) as i32 - 127;
    let mut m = f32::from_bits((bits & 0x007f_ffff) | 0x3f80_0000);
    if m > core::f32::consts::SQRT_2 {
        m *= 0.5;
        e += 1;
    }
    let u = (m - 1.0) / (m + 1.0);
    let u2 = u * u;
    let ln_m = 2.0 * u * (1.0 + u2 * (0.333_333_34 + u2 * (0.2 + u2 * 0.142_857_15)));
    (e as f32) * core::f32::consts::LN_2 + ln_m
}

#[inline]
fn sigmoid_fast(z: f32) -> f32 {
    let zc = clamp_f32(z, -15.0, 15.0);
    1.0 / (1.0 + fast_exp(-zc))
}

#[inline]
fn gelu_fast(x: f32) -> (f32, f32) {
    let u = 1.702 * x;
    let s = sigmoid_fast(u);
    let ds = if u <= -15.0 || u >= 15.0 {
        0.0
    } else {
        1.702 * s * (1.0 - s)
    };
    (x * s, s + x * ds)
}

#[inline]
fn cos_decay_fast(t: f32) -> f32 {
    let t = clamp_f32(t, 0.0, 1.0);
    let s = core::f32::consts::PI * (t - 0.5);
    let s2 = s * s;
    let sin_s = s * (1.0 + s2 * (-0.166_666_67 + s2 * (0.008_333_334 - s2 * 0.000_198_412_7)));
    clamp_f32(0.5 * (1.0 - sin_s), 0.0, 1.0)
}

// ============================================================================
// 3. Shared Neural Building Blocks (Non-Inlined Kernels for Compact Wasm)
// ============================================================================

#[inline(never)]
fn matvec_fwd(
    x: &[f32],
    w: &[f32],
    bias: Option<&[f32]>,
    rows: usize,
    cols: usize,
    add_to_out: bool,
    out: &mut [f32],
) {
    for j in 0..cols {
        let mut sum = if add_to_out { out[j] } else { 0.0 };
        if let Some(b) = bias {
            sum += b[j];
        }
        for k in 0..rows {
            sum += x[k] * w[k * cols + j];
        }
        out[j] = sum;
    }
}

#[inline(never)]
fn matvec_bwd(
    x: &[f32],
    dy: &[f32],
    w: &[f32],
    gw: &mut [f32],
    gb: Option<&mut [f32]>,
    rows: usize,
    cols: usize,
    acc_dx: bool,
    mut dx: Option<&mut [f32]>,
) {
    if let Some(b) = gb {
        for j in 0..cols {
            b[j] += dy[j];
        }
    }
    for k in 0..rows {
        let xk = x[k];
        let mut sum = 0.0f32;
        let row_off = k * cols;
        for j in 0..cols {
            let dyj = dy[j];
            gw[row_off + j] += xk * dyj;
            if dx.is_some() {
                sum += dyj * w[row_off + j];
            }
        }
        if let Some(ref mut dx_buf) = dx {
            if acc_dx {
                dx_buf[k] += sum;
            } else {
                dx_buf[k] = sum;
            }
        }
    }
}

#[inline(never)]
fn rmsnorm_fwd(x: &[f32], gamma: &[f32], y: &mut [f32]) -> f32 {
    let d = x.len();
    let mut sum_sq = 0.0f32;
    for j in 0..d {
        sum_sq += x[j] * x[j];
    }
    let r = 1.0 / sqrt_f32(sum_sq / (d as f32) + 1.0e-5);
    for j in 0..d {
        y[j] = gamma[j] * x[j] * r;
    }
    r
}

#[inline(never)]
fn rmsnorm_fwd_unit(x: &[f32], y: &mut [f32]) {
    let d = x.len();
    let mut sum_sq = 0.0f32;
    for j in 0..d {
        sum_sq += x[j] * x[j];
    }
    let r = 1.0 / sqrt_f32(sum_sq / (d as f32) + 1.0e-5);
    for j in 0..d {
        y[j] = x[j] * r;
    }
}

#[inline(never)]
fn rmsnorm_bwd(
    dy: &[f32],
    x: &[f32],
    gamma: &[f32],
    r: f32,
    dgamma: &mut [f32],
    acc_dx: bool,
    dx_out: &mut [f32],
) {
    let d = x.len();
    let mut dot = 0.0f32;
    for j in 0..d {
        dgamma[j] += dy[j] * x[j] * r;
        dot += dy[j] * gamma[j] * x[j];
    }
    let coeff = (r * r / (d as f32)) * dot;
    for j in 0..d {
        let g = r * (dy[j] * gamma[j] - x[j] * coeff);
        if acc_dx {
            dx_out[j] += g;
        } else {
            dx_out[j] = g;
        }
    }
}

#[inline(never)]
fn softmax_inplace(scores: &mut [f32], len: usize) -> (f32, f32) {
    let mut m_max = scores[0];
    for i in 1..len {
        if scores[i] > m_max {
            m_max = scores[i];
        }
    }
    let mut sum_e = 0.0f32;
    for i in 0..len {
        let e = fast_exp(scores[i] - m_max);
        scores[i] = e;
        sum_e += e;
    }
    let inv_s = 1.0 / sum_e;
    for i in 0..len {
        scores[i] *= inv_s;
    }
    (m_max, sum_e)
}

#[inline(never)]
fn loss_and_dz(
    z: &[f32],
    y_val: f32,
    task: u32,
    n_out: usize,
    inv_n: f32,
    dz: &mut [f32],
    probs_buf: &mut [f32],
) -> f32 {
    if task == 0 {
        let z0 = z[0];
        let zc = clamp_f32(z0, -15.0, 15.0);
        let p = 1.0 / (1.0 + fast_exp(-zc));
        let loss = fast_ln(1.0 + fast_exp(-abs_f32(zc))) + max_f32(zc, 0.0) - y_val * zc;
        dz[0] = if z0 <= -15.0 || z0 >= 15.0 {
            0.0
        } else {
            (p - y_val) * inv_n
        };
        for k in 1..n_out {
            dz[k] = 0.0;
        }
        loss
    } else if task == 1 {
        probs_buf[0..n_out].copy_from_slice(&z[0..n_out]);
        let (m_max, sum_e) = softmax_inplace(probs_buf, n_out);
        let c_raw = (max_f32(y_val, 0.0) + 0.5) as usize;
        let c = if c_raw >= n_out { n_out - 1 } else { c_raw };
        let z_shift = clamp_f32(z[c] - m_max, -20.0, 0.0);
        let loss = -z_shift + fast_ln(sum_e);
        for k in 0..n_out {
            let target = if k == c { 1.0 } else { 0.0 };
            dz[k] = (probs_buf[k] - target) * inv_n;
        }
        loss
    } else {
        let diff = z[0] - y_val;
        dz[0] = diff * inv_n;
        for k in 1..n_out {
            dz[k] = 0.0;
        }
        0.5 * diff * diff
    }
}

#[inline(never)]
fn write_pred(z: &[f32], task: u32, n_out: usize, out_slice: &mut [f32]) {
    if task == 0 {
        out_slice[0] = sigmoid_fast(z[0]);
    } else if task == 1 {
        out_slice[0..n_out].copy_from_slice(&z[0..n_out]);
        softmax_inplace(out_slice, n_out);
    } else {
        out_slice[0] = z[0];
    }
}

#[inline]
fn packed_matrix_bytes(rows: usize, cols: usize) -> usize {
    (rows * cols + 3) >> 2
}

#[inline(never)]
fn init_ternary_matrix(
    packed_out: &mut [u8],
    rows: usize,
    cols: usize,
    rng: &mut Mulberry32,
) -> f32 {
    let n_w = rows * cols;
    packed_out.fill(0);
    if n_w == 0 {
        return 0.0;
    }
    let bound = sqrt_f32(3.0 / (rows.max(1) as f32));
    let mut latent = vec![0.0f32; n_w];
    let mut abs_sum = 0.0f32;
    for k in 0..n_w {
        let w = rng.uniform_sym(bound);
        latent[k] = w;
        abs_sum += abs_f32(w);
    }
    let scale = max_f32(abs_sum / (n_w as f32), 1.0e-6);
    let inv_scale = 1.0 / scale;
    for k in 0..n_w {
        let q = latent[k] * inv_scale;
        let code: u8 = if q > 0.5 {
            1
        } else if q < -0.5 {
            2
        } else {
            0
        };
        packed_out[k >> 2] |= code << ((k & 3) * 2);
    }
    scale
}

#[inline(never)]
fn ternary_matvec(
    u: &[f32],
    packed: &[u8],
    rows: usize,
    cols: usize,
    scale: f32,
    out: &mut [f32],
) {
    out[0..cols].fill(0.0);
    for i in 0..rows {
        let ui = u[i];
        if ui == 0.0 {
            continue;
        }
        let base = i * cols;
        for j in 0..cols {
            let k = base + j;
            let code = (packed[k >> 2] >> ((k & 3) * 2)) & 0x3;
            if code == 1 {
                out[j] += ui;
            } else if code == 2 {
                out[j] -= ui;
            }
        }
    }
    for j in 0..cols {
        out[j] *= scale;
    }
}

#[inline(never)]
fn ternary_matvec_t(
    dy: &[f32],
    packed: &[u8],
    rows: usize,
    cols: usize,
    scale: f32,
    du: &mut [f32],
) {
    for i in 0..rows {
        let base = i * cols;
        let mut acc = 0.0f32;
        for j in 0..cols {
            let k = base + j;
            let code = (packed[k >> 2] >> ((k & 3) * 2)) & 0x3;
            if code == 1 {
                acc += dy[j];
            } else if code == 2 {
                acc -= dy[j];
            }
        }
        du[i] = acc * scale;
    }
}

#[inline(never)]
fn fill_uniform(dst: &mut [f32], bound: f32, rng: &mut Mulberry32) {
    for v in dst.iter_mut() {
        *v = rng.uniform_sym(bound);
    }
}

#[inline(never)]
fn adamw_train(
    x: &[f32],
    y: &[f32],
    params: &mut [f32],
    decay_mask: &[u8],
    n: usize,
    f: usize,
    epochs: usize,
    batch_size: usize,
    lr: f32,
    weight_decay: f32,
    seed: u32,
    batch_fn: &mut dyn FnMut(&[f32], &[f32], usize, &[f32], &mut [f32], u32) -> f32,
) -> f32 {
    let p_len = params.len();
    if n == 0 || epochs == 0 || p_len == 0 {
        return 0.0;
    }
    let eff_bs = if batch_size == 0 || batch_size > n {
        n
    } else {
        batch_size
    };
    let steps_per_epoch = (n + eff_bs - 1) / eff_bs;
    let total_steps = epochs * steps_per_epoch;

    let mut m = vec![0.0f32; p_len];
    let mut v = vec![0.0f32; p_len];
    let mut grads = vec![0.0f32; p_len];
    let mut bx = vec![0.0f32; eff_bs * f];
    let mut by = vec![0.0f32; eff_bs];
    let mut order: Vec<usize> = (0..n).collect();

    let mut rng = Mulberry32(seed);
    let mut b1_pow = 1.0f32;
    let mut b2_pow = 1.0f32;
    let mut step_idx = 0usize;
    let mut last_loss = 0.0f32;

    for _ in 0..epochs {
        for i in (1..n).rev() {
            let j = (rng.next_u32() % (i as u32 + 1)) as usize;
            order.swap(i, j);
        }
        let mut epoch_loss_sum = 0.0f32;
        let mut start = 0usize;
        while start < n {
            let bs = eff_bs.min(n - start);
            for b in 0..bs {
                let row = order[start + b];
                if f > 0 {
                    bx[b * f..(b + 1) * f].copy_from_slice(&x[row * f..(row + 1) * f]);
                }
                by[b] = y[row];
            }
            let step_seed = rng.next_u32();
            let b_loss = batch_fn(&bx[0..bs * f], &by[0..bs], bs, params, &mut grads, step_seed);
            epoch_loss_sum += b_loss * (bs as f32);

            let mut g_norm_sq = 0.0f32;
            for i in 0..p_len {
                g_norm_sq += grads[i] * grads[i];
            }
            let g_norm = sqrt_f32(g_norm_sq);
            if g_norm > 5.0 {
                let clip_scale = 5.0 / g_norm;
                for i in 0..p_len {
                    grads[i] *= clip_scale;
                }
            }

            b1_pow *= 0.9f32;
            b2_pow *= 0.999f32;
            let inv_bc1 = 1.0 / (1.0 - b1_pow);
            let inv_bc2 = 1.0 / (1.0 - b2_pow);

            let progress = if total_steps > 1 {
                (step_idx as f32) / ((total_steps - 1) as f32)
            } else {
                0.0
            };
            let lr_t = lr * (0.1 + 0.9 * cos_decay_fast(progress));

            for i in 0..p_len {
                let g = grads[i];
                m[i] = 0.9 * m[i] + 0.1 * g;
                v[i] = 0.999 * v[i] + 0.001 * g * g;
                let m_hat = m[i] * inv_bc1;
                let v_hat = v[i] * inv_bc2;
                if decay_mask[i] != 0 && weight_decay != 0.0 {
                    params[i] *= 1.0 - lr_t * weight_decay;
                }
                params[i] -= lr_t * (m_hat / (sqrt_f32(v_hat) + 1.0e-8));
            }

            step_idx += 1;
            start += bs;
        }
        last_loss = epoch_loss_sum / (n as f32);
    }
    last_loss
}

// ============================================================================
// 4. Kernel Family 1: Subword Matryoshka Embeddings & BitNet b1.58 Encoder
// ============================================================================

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

#[inline]
fn fnv1a_init(seed: u32, domain: u8) -> u64 {
    let mut h = FNV_OFFSET ^ (seed as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    h ^= domain as u64;
    h.wrapping_mul(FNV_PRIME)
}

#[inline]
fn fnv1a_byte(mut h: u64, b: u8) -> u64 {
    h ^= b as u64;
    h.wrapping_mul(FNV_PRIME)
}

#[inline(never)]
fn fnv1a_bytes(mut h: u64, bytes: &[u8]) -> u64 {
    for &b in bytes {
        h = fnv1a_byte(h, b);
    }
    h
}

#[inline(never)]
fn project_hash(u: &mut [f32], mut h: u64, w: f32) {
    let d = u.len();
    if d == 0 {
        return;
    }
    let scaled = w * 0.353_553_38;
    for _ in 0..8 {
        h = h.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = h;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^= z >> 31;
        let idx = ((z >> 1) as usize) % d;
        let delta = if (z & 1) == 0 { scaled } else { -scaled };
        u[idx] += delta;
    }
}

#[inline(never)]
fn tokenize_utf8_spans(text: &[u8], norm_buf: &mut Vec<u8>, spans: &mut Vec<usize>) {
    norm_buf.clear();
    spans.clear();
    let mut word_start = 0usize;
    let mut in_word = false;
    for &b in text {
        if b < 0x80 {
            let low = if b >= b'A' && b <= b'Z' {
                b + 32
            } else if (b >= b'a' && b <= b'z') || (b >= b'0' && b <= b'9') {
                b
            } else {
                0
            };
            if low != 0 {
                if !in_word {
                    word_start = norm_buf.len();
                    in_word = true;
                }
                norm_buf.push(low);
            } else if in_word {
                spans.push(word_start);
                spans.push(norm_buf.len());
                in_word = false;
            }
        } else {
            if !in_word {
                word_start = norm_buf.len();
                in_word = true;
            }
            norm_buf.push(b);
        }
    }
    if in_word {
        spans.push(word_start);
        spans.push(norm_buf.len());
    }
}

#[inline(never)]
fn accumulate_word_subwords(
    word: &[u8],
    seed: u32,
    u: &mut [f32],
    wrapped: &mut Vec<u8>,
    char_offs: &mut Vec<usize>,
) {
    let h_uni = fnv1a_bytes(fnv1a_init(seed, 1), word);
    project_hash(u, h_uni, 1.0);

    wrapped.clear();
    wrapped.push(b'<');
    wrapped.extend_from_slice(word);
    wrapped.push(b'>');

    char_offs.clear();
    for (idx, &b) in wrapped.iter().enumerate() {
        if (b & 0xc0) != 0x80 {
            char_offs.push(idx);
        }
    }
    let n_chars = char_offs.len();
    char_offs.push(wrapped.len());

    let mut n_grams = 0usize;
    for n in 3..=5 {
        if n_chars >= n {
            n_grams += n_chars - n + 1;
        }
    }
    if n_grams > 0 {
        let ng_w = 0.5 / sqrt_f32(n_grams as f32);
        for n in 3..=5 {
            if n_chars >= n {
                let count = n_chars - n + 1;
                for start in 0..count {
                    let b0 = char_offs[start];
                    let b1 = char_offs[start + n];
                    let h_ng = fnv1a_bytes(fnv1a_init(seed, 3), &wrapped[b0..b1]);
                    project_hash(u, h_ng, ng_w);
                }
            }
        }
    }
}

#[inline(never)]
fn damp_slice_l2(u: &[f32], out_row: &mut [f32], dim: usize) {
    let mut norm_sq = 0.0f32;
    for j in 0..dim {
        let v = if j < u.len() { u[j] } else { 0.0 };
        let damped = v / (1.0 + 0.25 * abs_f32(v));
        out_row[j] = damped;
        norm_sq += damped * damped;
    }
    if norm_sq > 1.0e-30 {
        let inv_norm = 1.0 / sqrt_f32(norm_sq);
        for j in 0..dim {
            out_row[j] *= inv_norm;
        }
    }
}

/// # Safety
/// Pointers must reference valid buffers matching `(total_bytes, n_rows + 1, n_rows * dim)`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_embed_subword(
    text_bytes: *const u8,
    total_bytes: usize,
    offsets: *const u32,
    n_rows: usize,
    out: *mut f32,
    dim: usize,
    max_dim: usize,
    seed: u32,
) {
    if n_rows == 0 || dim == 0 || offsets.is_null() || out.is_null() {
        return;
    }
    let eff_max_dim = if max_dim < dim { dim } else { max_dim };
    let offs = slice::from_raw_parts(offsets, n_rows + 1);
    let out_buf = slice::from_raw_parts_mut(out, n_rows * dim);
    let all_bytes: &[u8] = if total_bytes == 0 || text_bytes.is_null() {
        &[]
    } else {
        slice::from_raw_parts(text_bytes, total_bytes)
    };

    let mut u = vec![0.0f32; eff_max_dim];
    let mut norm_buf = Vec::<u8>::new();
    let mut spans = Vec::<usize>::new();
    let mut wrapped = Vec::<u8>::new();
    let mut char_offs = Vec::<usize>::new();

    for r in 0..n_rows {
        let s0 = (offs[r] as usize).min(all_bytes.len());
        let s1 = (offs[r + 1] as usize).min(all_bytes.len()).max(s0);
        u.fill(0.0);
        tokenize_utf8_spans(&all_bytes[s0..s1], &mut norm_buf, &mut spans);

        let n_words = spans.len() >> 1;
        if n_words == 0 {
            project_hash(&mut u, fnv1a_init(seed, 4), 1.0);
        } else {
            for t in 0..n_words {
                let w_cur = &norm_buf[spans[2 * t]..spans[2 * t + 1]];
                accumulate_word_subwords(w_cur, seed, &mut u, &mut wrapped, &mut char_offs);
                if t > 0 {
                    let w_prev = &norm_buf[spans[2 * (t - 1)]..spans[2 * (t - 1) + 1]];
                    let mut h_bi = fnv1a_bytes(fnv1a_init(seed, 2), w_prev);
                    h_bi = fnv1a_byte(h_bi, 0xff);
                    h_bi = fnv1a_bytes(h_bi, w_cur);
                    project_hash(&mut u, h_bi, 0.75);
                }
            }
        }
        damp_slice_l2(&u, &mut out_buf[r * dim..(r + 1) * dim], dim);
    }
}

#[no_mangle]
pub extern "C" fn mle_dl_bitnet_packed_bytes(d_model: usize, n_layers: usize) -> usize {
    let d2 = packed_matrix_bytes(d_model, d_model);
    let d_ff = packed_matrix_bytes(d_model, 2 * d_model);
    n_layers * (4 * d2 + 2 * d_ff)
}

#[no_mangle]
pub extern "C" fn mle_dl_bitnet_scale_count(n_layers: usize) -> usize {
    6 * n_layers
}

/// # Safety
/// `packed_out` and `scales_out` must hold `mle_dl_bitnet_packed_bytes` and `mle_dl_bitnet_scale_count`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_bitnet_init(
    packed_out: *mut u8,
    scales_out: *mut f32,
    d_model: usize,
    n_layers: usize,
    seed: u32,
) {
    if n_layers == 0 || d_model == 0 || packed_out.is_null() || scales_out.is_null() {
        return;
    }
    let total_packed = mle_dl_bitnet_packed_bytes(d_model, n_layers);
    let packed = slice::from_raw_parts_mut(packed_out, total_packed);
    let scales = slice::from_raw_parts_mut(scales_out, 6 * n_layers);

    let d2 = packed_matrix_bytes(d_model, d_model);
    let d_ff = packed_matrix_bytes(d_model, 2 * d_model);
    let layer_bytes = 4 * d2 + 2 * d_ff;

    let mut rng = Mulberry32(seed);
    for l in 0..n_layers {
        let mut off = l * layer_bytes;
        for m_idx in 0..4 {
            scales[l * 6 + m_idx] =
                init_ternary_matrix(&mut packed[off..off + d2], d_model, d_model, &mut rng);
            off += d2;
        }
        scales[l * 6 + 4] =
            init_ternary_matrix(&mut packed[off..off + d_ff], d_model, 2 * d_model, &mut rng);
        off += d_ff;
        scales[l * 6 + 5] =
            init_ternary_matrix(&mut packed[off..off + d_ff], 2 * d_model, d_model, &mut rng);
    }
}

#[inline]
fn algebraic_pos_enc(pos: usize, j: usize) -> f32 {
    let freq = 1.0 / (1.0 + ((j >> 1) as f32));
    let phase_shift = if (j & 1) == 0 { 0.0 } else { 0.25 };
    let phase = (pos as f32) * freq * 0.17 + phase_shift;
    let frac = phase - floor_clamped(phase);
    let u = 4.0 * frac - 2.0;
    0.2 * (u * (2.0 - abs_f32(u)))
}

#[inline(never)]
fn mha_forward_seq(
    q_all: &[f32],
    k_all: &[f32],
    v_all: &[f32],
    seq_len: usize,
    d: usize,
    eff_heads: usize,
    attn_scale: f32,
    scores: &mut [f32],
    mut attn_save: Option<&mut [f32]>,
    ctx_all: &mut [f32],
) {
    let d_h = d / eff_heads;
    ctx_all[0..seq_len * d].fill(0.0);
    for h in 0..eff_heads {
        let c0 = h * d_h;
        let head_off = h * seq_len * seq_len;
        for t in 0..seq_len {
            let q_slice = &q_all[t * d + c0..t * d + c0 + d_h];
            for s in 0..seq_len {
                let k_slice = &k_all[s * d + c0..s * d + c0 + d_h];
                let mut dot = 0.0f32;
                for m in 0..d_h {
                    dot += q_slice[m] * k_slice[m];
                }
                scores[s] = dot * attn_scale;
            }
            softmax_inplace(scores, seq_len);
            if let Some(ref mut a_buf) = attn_save {
                a_buf[head_off + t * seq_len..head_off + (t + 1) * seq_len]
                    .copy_from_slice(&scores[0..seq_len]);
            }
            for s in 0..seq_len {
                let a = scores[s];
                let v_slice = &v_all[s * d + c0..s * d + c0 + d_h];
                for m in 0..d_h {
                    ctx_all[t * d + c0 + m] += a * v_slice[m];
                }
            }
        }
    }
}

/// # Safety
/// Pointers must reference valid buffers matching the BitNet encoder ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_bitnet_encode(
    text_bytes: *const u8,
    total_bytes: usize,
    offsets: *const u32,
    n_rows: usize,
    packed_w: *const u8,
    scales: *const f32,
    d_model: usize,
    n_heads: usize,
    n_layers: usize,
    max_seq: usize,
    out: *mut f32,
    dim: usize,
    seed: u32,
) {
    if n_rows == 0 || dim == 0 || d_model == 0 || offsets.is_null() || out.is_null() {
        return;
    }
    let offs = slice::from_raw_parts(offsets, n_rows + 1);
    let out_buf = slice::from_raw_parts_mut(out, n_rows * dim);
    let all_bytes: &[u8] = if total_bytes == 0 || text_bytes.is_null() {
        &[]
    } else {
        slice::from_raw_parts(text_bytes, total_bytes)
    };
    let total_packed = mle_dl_bitnet_packed_bytes(d_model, n_layers);
    let pw: &[u8] = if total_packed == 0 || packed_w.is_null() {
        &[]
    } else {
        slice::from_raw_parts(packed_w, total_packed)
    };
    let sc: &[f32] = if n_layers == 0 || scales.is_null() {
        &[]
    } else {
        slice::from_raw_parts(scales, 6 * n_layers)
    };

    let eff_max_seq = if max_seq == 0 { 1 } else { max_seq };
    let eff_heads = if n_heads == 0 || (d_model % n_heads) != 0 {
        1
    } else {
        n_heads
    };
    let attn_scale = 1.0 / sqrt_f32((d_model / eff_heads) as f32);

    let d2 = packed_matrix_bytes(d_model, d_model);
    let d_ff = packed_matrix_bytes(d_model, 2 * d_model);
    let layer_bytes = 4 * d2 + 2 * d_ff;

    let mut norm_buf = Vec::<u8>::new();
    let mut spans = Vec::<usize>::new();
    let mut wrapped = Vec::<u8>::new();
    let mut char_offs = Vec::<usize>::new();
    let mut tok_u = vec![0.0f32; d_model];

    let mut h_seq = vec![0.0f32; eff_max_seq * d_model];
    let mut h_norm = vec![0.0f32; d_model];
    let mut q_all = vec![0.0f32; eff_max_seq * d_model];
    let mut k_all = vec![0.0f32; eff_max_seq * d_model];
    let mut v_all = vec![0.0f32; eff_max_seq * d_model];
    let mut ctx_all = vec![0.0f32; eff_max_seq * d_model];
    let mut proj = vec![0.0f32; d_model];
    let mut ff_up = vec![0.0f32; 2 * d_model];
    let mut scores = vec![0.0f32; eff_max_seq];
    let mut pooled = vec![0.0f32; d_model];

    for r in 0..n_rows {
        let s0 = (offs[r] as usize).min(all_bytes.len());
        let s1 = (offs[r + 1] as usize).min(all_bytes.len()).max(s0);
        tokenize_utf8_spans(&all_bytes[s0..s1], &mut norm_buf, &mut spans);

        let n_words = spans.len() >> 1;
        let seq_len = if n_words == 0 {
            1
        } else {
            n_words.min(eff_max_seq)
        };

        for t in 0..seq_len {
            tok_u.fill(0.0);
            if n_words == 0 {
                project_hash(&mut tok_u, fnv1a_init(seed, 4), 1.0);
            } else {
                let w_cur = &norm_buf[spans[2 * t]..spans[2 * t + 1]];
                accumulate_word_subwords(w_cur, seed, &mut tok_u, &mut wrapped, &mut char_offs);
            }
            let dst = &mut h_seq[t * d_model..(t + 1) * d_model];
            damp_slice_l2(&tok_u, dst, d_model);
            for j in 0..d_model {
                dst[j] += algebraic_pos_enc(t, j);
            }
        }

        for l in 0..n_layers {
            let base = l * layer_bytes;
            let w_q = &pw[base..base + d2];
            let w_k = &pw[base + d2..base + 2 * d2];
            let w_v = &pw[base + 2 * d2..base + 3 * d2];
            let w_o = &pw[base + 3 * d2..base + 4 * d2];
            let w_up = &pw[base + 4 * d2..base + 4 * d2 + d_ff];
            let w_dn = &pw[base + 4 * d2 + d_ff..base + layer_bytes];

            for t in 0..seq_len {
                rmsnorm_fwd_unit(&h_seq[t * d_model..(t + 1) * d_model], &mut h_norm);
                ternary_matvec(
                    &h_norm,
                    w_q,
                    d_model,
                    d_model,
                    sc[l * 6],
                    &mut q_all[t * d_model..(t + 1) * d_model],
                );
                ternary_matvec(
                    &h_norm,
                    w_k,
                    d_model,
                    d_model,
                    sc[l * 6 + 1],
                    &mut k_all[t * d_model..(t + 1) * d_model],
                );
                ternary_matvec(
                    &h_norm,
                    w_v,
                    d_model,
                    d_model,
                    sc[l * 6 + 2],
                    &mut v_all[t * d_model..(t + 1) * d_model],
                );
            }

            mha_forward_seq(
                &q_all,
                &k_all,
                &v_all,
                seq_len,
                d_model,
                eff_heads,
                attn_scale,
                &mut scores,
                None,
                &mut ctx_all,
            );

            for t in 0..seq_len {
                ternary_matvec(
                    &ctx_all[t * d_model..(t + 1) * d_model],
                    w_o,
                    d_model,
                    d_model,
                    sc[l * 6 + 3],
                    &mut proj,
                );
                for j in 0..d_model {
                    h_seq[t * d_model + j] += proj[j];
                }
                rmsnorm_fwd_unit(&h_seq[t * d_model..(t + 1) * d_model], &mut h_norm);
                ternary_matvec(&h_norm, w_up, d_model, 2 * d_model, sc[l * 6 + 4], &mut ff_up);
                for m in 0..(2 * d_model) {
                    ff_up[m] = gelu_fast(ff_up[m]).0;
                }
                ternary_matvec(&ff_up, w_dn, 2 * d_model, d_model, sc[l * 6 + 5], &mut proj);
                for j in 0..d_model {
                    h_seq[t * d_model + j] += proj[j];
                }
            }
        }

        pooled.fill(0.0);
        let inv_seq = 1.0 / (seq_len as f32);
        for t in 0..seq_len {
            for j in 0..d_model {
                pooled[j] += h_seq[t * d_model + j] * inv_seq;
            }
        }

        let out_row = &mut out_buf[r * dim..(r + 1) * dim];
        let copy_len = dim.min(d_model);
        let mut norm_sq = 0.0f32;
        for j in 0..copy_len {
            out_row[j] = pooled[j];
            norm_sq += pooled[j] * pooled[j];
        }
        for j in copy_len..dim {
            out_row[j] = 0.0;
        }
        if norm_sq > 1.0e-30 {
            let inv_norm = 1.0 / sqrt_f32(norm_sq);
            for j in 0..copy_len {
                out_row[j] *= inv_norm;
            }
        }
    }
}

// ============================================================================
// 5. Kernel Family 2: Tabular / Embedding Residual Network (ResNet)
// ============================================================================

#[no_mangle]
pub extern "C" fn mle_dl_resnet_param_count(
    f: usize,
    d_model: usize,
    n_layers: usize,
    n_out: usize,
) -> usize {
    (f * d_model + d_model)
        + n_layers * (3 * d_model + 2 * d_model * d_model)
        + (d_model + d_model * n_out + n_out)
}

fn resnet_decay_mask(f: usize, d: usize, n_layers: usize, n_out: usize) -> Vec<u8> {
    let total = mle_dl_resnet_param_count(f, d, n_layers, n_out);
    let mut mask = vec![0u8; total];
    let mut off = 0usize;
    mask[off..off + f * d].fill(1);
    off += f * d + d;
    for _ in 0..n_layers {
        off += d;
        mask[off..off + d * d].fill(1);
        off += d * d + d;
        mask[off..off + d * d].fill(1);
        off += d * d + d;
    }
    off += d;
    mask[off..off + d * n_out].fill(1);
    mask
}

/// # Safety
/// `params` must point to at least `mle_dl_resnet_param_count` floats.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_resnet_init(
    params: *mut f32,
    f: usize,
    d_model: usize,
    n_layers: usize,
    n_out: usize,
    seed: u32,
) {
    let total = mle_dl_resnet_param_count(f, d_model, n_layers, n_out);
    if total == 0 || params.is_null() {
        return;
    }
    let p = slice::from_raw_parts_mut(params, total);
    p.fill(0.0);
    let mut rng = Mulberry32(seed);
    let d = d_model;
    let mut off = 0usize;

    fill_uniform(
        &mut p[off..off + f * d],
        sqrt_f32(2.0 / ((f + d).max(1) as f32)),
        &mut rng,
    );
    off += f * d + d;

    let b_w1 = sqrt_f32(2.0 / (d.max(1) as f32));
    let b_w2 = sqrt_f32(1.0 / ((d * n_layers.max(1)).max(1) as f32));
    for _ in 0..n_layers {
        p[off..off + d].fill(1.0);
        off += d;
        fill_uniform(&mut p[off..off + d * d], b_w1, &mut rng);
        off += d * d + d;
        fill_uniform(&mut p[off..off + d * d], b_w2, &mut rng);
        off += d * d + d;
    }

    p[off..off + d].fill(1.0);
    off += d;
    fill_uniform(
        &mut p[off..off + d * n_out],
        sqrt_f32(1.0 / (d.max(1) as f32)),
        &mut rng,
    );
}

#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn resnet_run_core(
    x: &[f32],
    y: Option<&[f32]>,
    p: &[f32],
    mut grads: Option<&mut [f32]>,
    mut preds_out: Option<&mut [f32]>,
    n: usize,
    f: usize,
    d: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
    dropout: f32,
    seed: u32,
) -> f32 {
    if let Some(ref mut g) = grads {
        g.fill(0.0);
    }
    if n == 0 || d == 0 || n_out == 0 {
        return 0.0;
    }

    let training = grads.is_some();
    let drop_p = if training {
        clamp_f32(dropout, 0.0, 0.9)
    } else {
        0.0
    };
    let use_drop = drop_p > 0.0;
    let keep_scale = if use_drop { 1.0 / (1.0 - drop_p) } else { 1.0 };
    let mut drop_rng = Mulberry32(seed);
    let pred_stride = if task == 1 { n_out } else { 1 };

    let blocks_base = f * d + d;
    let block_stride = 3 * d + 2 * d * d;
    let head_base = blocks_base + n_layers * block_stride;

    let mut h_states = vec![0.0f32; (n_layers + 1) * d];
    let mut dg0 = vec![0.0f32; d];
    let mut u_norms = vec![0.0f32; n_layers.max(1) * d];
    let mut r_norms = vec![0.0f32; n_layers.max(1)];
    let mut dg1 = vec![0.0f32; n_layers.max(1) * d];
    let mut masks = vec![1.0f32; n_layers.max(1) * d];
    let mut drop1 = vec![0.0f32; n_layers.max(1) * d];
    let mut pre_buf = vec![0.0f32; d];
    let mut h_out_norm = vec![0.0f32; d];
    let mut z = vec![0.0f32; n_out];
    let mut dz = vec![0.0f32; n_out];
    let mut probs = vec![0.0f32; n_out];

    let mut dh = vec![0.0f32; d];
    let mut dh_out_norm = vec![0.0f32; d];
    let mut ddrop1 = vec![0.0f32; d];
    let mut du_norm = vec![0.0f32; d];

    let inv_n = 1.0 / (n as f32);
    let mut total_loss = 0.0f32;

    for row_i in 0..n {
        let x_row = &x[row_i * f..(row_i + 1) * f];

        // Stem forward
        matvec_fwd(
            x_row,
            &p[0..f * d],
            Some(&p[f * d..blocks_base]),
            f,
            d,
            false,
            &mut pre_buf,
        );
        for j in 0..d {
            let (act, dg) = gelu_fast(pre_buf[j]);
            h_states[j] = act;
            dg0[j] = dg;
        }

        // Residual blocks forward
        for l in 0..n_layers {
            let b_off = blocks_base + l * block_stride;
            r_norms[l] = rmsnorm_fwd(
                &h_states[l * d..(l + 1) * d],
                &p[b_off..b_off + d],
                &mut u_norms[l * d..(l + 1) * d],
            );
            matvec_fwd(
                &u_norms[l * d..(l + 1) * d],
                &p[b_off + d..b_off + d + d * d],
                Some(&p[b_off + d + d * d..b_off + 2 * d + d * d]),
                d,
                d,
                false,
                &mut pre_buf,
            );
            for j in 0..d {
                let (act, dg) = gelu_fast(pre_buf[j]);
                dg1[l * d + j] = dg;
                let m = if use_drop {
                    if drop_rng.next_f32() < drop_p {
                        0.0
                    } else {
                        keep_scale
                    }
                } else {
                    1.0
                };
                masks[l * d + j] = m;
                drop1[l * d + j] = act * m;
            }
            for j in 0..d {
                h_states[(l + 1) * d + j] = h_states[l * d + j];
            }
            matvec_fwd(
                &drop1[l * d..(l + 1) * d],
                &p[b_off + 2 * d + d * d..b_off + 2 * d + 2 * d * d],
                Some(&p[b_off + 2 * d + 2 * d * d..b_off + block_stride]),
                d,
                d,
                true,
                &mut h_states[(l + 1) * d..(l + 2) * d],
            );
        }

        // Head forward
        let r_out = rmsnorm_fwd(
            &h_states[n_layers * d..(n_layers + 1) * d],
            &p[head_base..head_base + d],
            &mut h_out_norm,
        );
        matvec_fwd(
            &h_out_norm,
            &p[head_base + d..head_base + d + d * n_out],
            Some(&p[head_base + d + d * n_out..head_base + d + d * n_out + n_out]),
            d,
            n_out,
            false,
            &mut z,
        );

        if let Some(ref mut out_b) = preds_out {
            write_pred(
                &z,
                task,
                n_out,
                &mut out_b[row_i * pred_stride..(row_i + 1) * pred_stride],
            );
        }

        if let (Some(ys), Some(g)) = (y, grads.as_deref_mut()) {
            total_loss += loss_and_dz(&z, ys[row_i], task, n_out, inv_n, &mut dz, &mut probs);

            // Head backward
            {
                let (g_before_b, gb_out) = g.split_at_mut(head_base + d + d * n_out);
                let (_, gw_out) = g_before_b.split_at_mut(head_base + d);
                matvec_bwd(
                    &h_out_norm,
                    &dz,
                    &p[head_base + d..head_base + d + d * n_out],
                    gw_out,
                    Some(&mut gb_out[0..n_out]),
                    d,
                    n_out,
                    false,
                    Some(&mut dh_out_norm),
                );
            }
            rmsnorm_bwd(
                &dh_out_norm,
                &h_states[n_layers * d..(n_layers + 1) * d],
                &p[head_base..head_base + d],
                r_out,
                &mut g[head_base..head_base + d],
                false,
                &mut dh,
            );

            // Blocks backward
            for l in (0..n_layers).rev() {
                let b_off = blocks_base + l * block_stride;
                {
                    let (g_pre_b2, gb2_rest) = g.split_at_mut(b_off + 2 * d + 2 * d * d);
                    let (_, gw2) = g_pre_b2.split_at_mut(b_off + 2 * d + d * d);
                    matvec_bwd(
                        &drop1[l * d..(l + 1) * d],
                        &dh,
                        &p[b_off + 2 * d + d * d..b_off + 2 * d + 2 * d * d],
                        gw2,
                        Some(&mut gb2_rest[0..d]),
                        d,
                        d,
                        false,
                        Some(&mut ddrop1),
                    );
                }
                for k in 0..d {
                    ddrop1[k] *= masks[l * d + k] * dg1[l * d + k];
                }
                {
                    let (g_pre_b1, gb1_rest) = g.split_at_mut(b_off + d + d * d);
                    let (_, gw1) = g_pre_b1.split_at_mut(b_off + d);
                    matvec_bwd(
                        &u_norms[l * d..(l + 1) * d],
                        &ddrop1,
                        &p[b_off + d..b_off + d + d * d],
                        gw1,
                        Some(&mut gb1_rest[0..d]),
                        d,
                        d,
                        false,
                        Some(&mut du_norm),
                    );
                }
                rmsnorm_bwd(
                    &du_norm,
                    &h_states[l * d..(l + 1) * d],
                    &p[b_off..b_off + d],
                    r_norms[l],
                    &mut g[b_off..b_off + d],
                    true,
                    &mut dh,
                );
            }

            // Stem backward
            for j in 0..d {
                pre_buf[j] = dh[j] * dg0[j];
            }
            let (gw_in, gb_in_rest) = g.split_at_mut(f * d);
            matvec_bwd(
                x_row,
                &pre_buf,
                &p[0..f * d],
                gw_in,
                Some(&mut gb_in_rest[0..d]),
                f,
                d,
                false,
                None,
            );
        }
    }

    total_loss * inv_n
}

/// # Safety
/// Pointers must reference valid buffers matching `(n * f, n, param_count, param_count)`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_resnet_loss_grad(
    x: *const f32,
    y: *const f32,
    params: *const f32,
    grads: *mut f32,
    n: usize,
    f: usize,
    d_model: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
    dropout: f32,
    seed: u32,
) -> f32 {
    let p_len = mle_dl_resnet_param_count(f, d_model, n_layers, n_out);
    if n == 0 || p_len == 0 || x.is_null() || y.is_null() || params.is_null() || grads.is_null() {
        return 0.0;
    }
    resnet_run_core(
        slice::from_raw_parts(x, n * f),
        Some(slice::from_raw_parts(y, n)),
        slice::from_raw_parts(params, p_len),
        Some(slice::from_raw_parts_mut(grads, p_len)),
        None,
        n,
        f,
        d_model,
        n_layers,
        task,
        n_out,
        dropout,
        seed,
    )
}

/// # Safety
/// Pointers must reference valid buffers matching `(n * f, n, param_count)`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_resnet_train(
    x: *const f32,
    y: *const f32,
    params: *mut f32,
    n: usize,
    f: usize,
    d_model: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
    epochs: usize,
    batch_size: usize,
    lr: f32,
    weight_decay: f32,
    dropout: f32,
    seed: u32,
) -> f32 {
    let p_len = mle_dl_resnet_param_count(f, d_model, n_layers, n_out);
    if n == 0 || p_len == 0 || x.is_null() || y.is_null() || params.is_null() {
        return 0.0;
    }
    let xs = slice::from_raw_parts(x, n * f);
    let ys = slice::from_raw_parts(y, n);
    let ps = slice::from_raw_parts_mut(params, p_len);
    let mask = resnet_decay_mask(f, d_model, n_layers, n_out);

    let mut batch_fn =
        |bx: &[f32], by: &[f32], bs: usize, cur_p: &[f32], gs: &mut [f32], step_seed: u32| {
            resnet_run_core(
                bx,
                Some(by),
                cur_p,
                Some(gs),
                None,
                bs,
                f,
                d_model,
                n_layers,
                task,
                n_out,
                dropout,
                step_seed,
            )
        };
    adamw_train(
        xs,
        ys,
        ps,
        &mask,
        n,
        f,
        epochs,
        batch_size,
        lr,
        weight_decay,
        seed,
        &mut batch_fn,
    )
}

/// # Safety
/// Pointers must reference valid buffers matching `(n * f, param_count, pred_len)`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_resnet_predict(
    x: *const f32,
    params: *const f32,
    out: *mut f32,
    n: usize,
    f: usize,
    d_model: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
) {
    let p_len = mle_dl_resnet_param_count(f, d_model, n_layers, n_out);
    if n == 0 || d_model == 0 || n_out == 0 || x.is_null() || params.is_null() || out.is_null() {
        return;
    }
    let pred_stride = if task == 1 { n_out } else { 1 };
    resnet_run_core(
        slice::from_raw_parts(x, n * f),
        None,
        slice::from_raw_parts(params, p_len),
        None,
        Some(slice::from_raw_parts_mut(out, n * pred_stride)),
        n,
        f,
        d_model,
        n_layers,
        task,
        n_out,
        0.0,
        0,
    );
}

// ============================================================================
// 6. Kernel Family 3: Dual-Mode Self-Attention (FT-Transformer + Patch ViT)
// ============================================================================

#[inline]
fn is_ft_mode(f: usize, seq_len: usize, patch_dim: usize) -> bool {
    patch_dim == 1 && seq_len == f
}

#[no_mangle]
pub extern "C" fn mle_dl_transformer_param_count(
    f: usize,
    seq_len: usize,
    patch_dim: usize,
    d_model: usize,
    n_layers: usize,
    n_out: usize,
) -> usize {
    let tok = if is_ft_mode(f, seq_len, patch_dim) {
        2 * f * d_model
    } else {
        patch_dim * d_model + d_model + seq_len * d_model
    };
    tok + n_layers * (8 * d_model * d_model + 6 * d_model) + (d_model + d_model * n_out + n_out)
}

fn transformer_decay_mask(
    f: usize,
    seq_len: usize,
    patch_dim: usize,
    d: usize,
    n_layers: usize,
    n_out: usize,
) -> Vec<u8> {
    let total = mle_dl_transformer_param_count(f, seq_len, patch_dim, d, n_layers, n_out);
    let mut mask = vec![0u8; total];
    let mut off = 0usize;
    if is_ft_mode(f, seq_len, patch_dim) {
        mask[off..off + f * d].fill(1);
        off += 2 * f * d;
    } else {
        mask[off..off + patch_dim * d].fill(1);
        off += patch_dim * d + d + seq_len * d;
    }
    for _ in 0..n_layers {
        off += d;
        mask[off..off + 4 * d * d].fill(1);
        off += 4 * d * d + 2 * d;
        mask[off..off + 2 * d * d].fill(1);
        off += 2 * d * d + 2 * d;
        mask[off..off + 2 * d * d].fill(1);
        off += 2 * d * d + d;
    }
    off += d;
    mask[off..off + d * n_out].fill(1);
    mask
}

/// # Safety
/// `params` must point to at least `mle_dl_transformer_param_count` floats.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_transformer_init(
    params: *mut f32,
    f: usize,
    seq_len: usize,
    patch_dim: usize,
    d_model: usize,
    n_layers: usize,
    n_out: usize,
    seed: u32,
) {
    let total = mle_dl_transformer_param_count(f, seq_len, patch_dim, d_model, n_layers, n_out);
    if total == 0 || params.is_null() {
        return;
    }
    let p = slice::from_raw_parts_mut(params, total);
    p.fill(0.0);
    let mut rng = Mulberry32(seed);
    let d = d_model;
    let mut off = 0usize;

    let inv_sqrt_d = sqrt_f32(1.0 / (d.max(1) as f32));
    if is_ft_mode(f, seq_len, patch_dim) {
        fill_uniform(&mut p[off..off + f * d], inv_sqrt_d, &mut rng);
        off += f * d;
        fill_uniform(&mut p[off..off + f * d], inv_sqrt_d * 0.1, &mut rng);
        off += f * d;
    } else {
        fill_uniform(
            &mut p[off..off + patch_dim * d],
            sqrt_f32(2.0 / ((patch_dim + d).max(1) as f32)),
            &mut rng,
        );
        off += patch_dim * d + d;
        fill_uniform(&mut p[off..off + seq_len * d], inv_sqrt_d * 0.1, &mut rng);
        off += seq_len * d;
    }

    let b_wo = sqrt_f32(1.0 / ((d * n_layers.max(1)).max(1) as f32));
    let b_w1 = sqrt_f32(2.0 / ((3 * d).max(1) as f32));
    let b_w2 = sqrt_f32(1.0 / ((2 * d * n_layers.max(1)).max(1) as f32));

    for _ in 0..n_layers {
        p[off..off + d].fill(1.0);
        off += d;
        fill_uniform(&mut p[off..off + 3 * d * d], inv_sqrt_d, &mut rng);
        off += 3 * d * d;
        fill_uniform(&mut p[off..off + d * d], b_wo, &mut rng);
        off += d * d + d;

        p[off..off + d].fill(1.0);
        off += d;
        fill_uniform(&mut p[off..off + 2 * d * d], b_w1, &mut rng);
        off += 2 * d * d + 2 * d;
        fill_uniform(&mut p[off..off + 2 * d * d], b_w2, &mut rng);
        off += 2 * d * d + d;
    }

    p[off..off + d].fill(1.0);
    off += d;
    fill_uniform(&mut p[off..off + d * n_out], inv_sqrt_d, &mut rng);
}

#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn transformer_run_core(
    x: &[f32],
    y: Option<&[f32]>,
    p: &[f32],
    mut grads: Option<&mut [f32]>,
    mut preds_out: Option<&mut [f32]>,
    n: usize,
    f: usize,
    s_len: usize,
    patch_dim: usize,
    d: usize,
    n_heads: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
) -> f32 {
    if let Some(ref mut g) = grads {
        g.fill(0.0);
    }
    if n == 0 || s_len == 0 || d == 0 || n_out == 0 {
        return 0.0;
    }

    let ft = is_ft_mode(f, s_len, patch_dim);
    let eff_heads = if n_heads == 0 || (d % n_heads) != 0 {
        1
    } else {
        n_heads
    };
    let d_h = d / eff_heads;
    let attn_scale = 1.0 / sqrt_f32(d_h as f32);
    let pred_stride = if task == 1 { n_out } else { 1 };

    let tok_size = if ft {
        2 * f * d
    } else {
        patch_dim * d + d + s_len * d
    };
    let block_stride = 8 * d * d + 6 * d;
    let head_base = tok_size + n_layers * block_stride;
    let nl_cap = n_layers.max(1);

    let mut h_in_all = vec![0.0f32; (n_layers + 1) * s_len * d];
    let mut u1_all = vec![0.0f32; nl_cap * s_len * d];
    let mut r1_all = vec![0.0f32; nl_cap * s_len];
    let mut q_all = vec![0.0f32; nl_cap * s_len * d];
    let mut k_all = vec![0.0f32; nl_cap * s_len * d];
    let mut v_all = vec![0.0f32; nl_cap * s_len * d];
    let mut attn_all = vec![0.0f32; nl_cap * eff_heads * s_len * s_len];
    let mut ctx_all = vec![0.0f32; nl_cap * s_len * d];
    let mut h_mid_all = vec![0.0f32; nl_cap * s_len * d];
    let mut u2_all = vec![0.0f32; nl_cap * s_len * d];
    let mut r2_all = vec![0.0f32; nl_cap * s_len];
    let mut ff_act_all = vec![0.0f32; nl_cap * s_len * 2 * d];
    let mut ff_dg_all = vec![0.0f32; nl_cap * s_len * 2 * d];

    let mut patch_buf = vec![0.0f32; patch_dim.max(1)];
    let mut ff_pre = vec![0.0f32; 2 * d];
    let mut pooled = vec![0.0f32; d];
    let mut p_norm = vec![0.0f32; d];
    let mut z = vec![0.0f32; n_out];
    let mut dz = vec![0.0f32; n_out];
    let mut probs = vec![0.0f32; n_out];
    let mut scores = vec![0.0f32; s_len];

    let mut dp_norm = vec![0.0f32; d];
    let mut dpooled = vec![0.0f32; d];
    let mut dh = vec![0.0f32; s_len * d];
    let mut dh_mid = vec![0.0f32; s_len * d];
    let mut dh_in = vec![0.0f32; s_len * d];
    let mut du2 = vec![0.0f32; d];
    let mut dctx = vec![0.0f32; s_len * d];
    let mut dq = vec![0.0f32; s_len * d];
    let mut dk = vec![0.0f32; s_len * d];
    let mut dv = vec![0.0f32; s_len * d];
    let mut d_attn = vec![0.0f32; s_len];
    let mut du1 = vec![0.0f32; d];

    let inv_n = 1.0 / (n as f32);
    let inv_s = 1.0 / (s_len as f32);
    let mut total_loss = 0.0f32;

    for row_i in 0..n {
        let x_row = &x[row_i * f..(row_i + 1) * f];

        // 1. Tokenizer forward
        if ft {
            let w_tok = &p[0..f * d];
            let b_tok = &p[f * d..2 * f * d];
            for s in 0..s_len {
                let xv = x_row[s];
                for j in 0..d {
                    h_in_all[s * d + j] = xv * w_tok[s * d + j] + b_tok[s * d + j];
                }
            }
        } else {
            let w_patch = &p[0..patch_dim * d];
            let b_patch = &p[patch_dim * d..patch_dim * d + d];
            let p_pos = &p[patch_dim * d + d..tok_size];
            for s in 0..s_len {
                for m in 0..patch_dim {
                    let idx = s * patch_dim + m;
                    patch_buf[m] = if idx < f { x_row[idx] } else { 0.0 };
                }
                h_in_all[s * d..(s + 1) * d].copy_from_slice(&p_pos[s * d..(s + 1) * d]);
                matvec_fwd(
                    &patch_buf[0..patch_dim],
                    w_patch,
                    Some(b_patch),
                    patch_dim,
                    d,
                    true,
                    &mut h_in_all[s * d..(s + 1) * d],
                );
            }
        }

        // 2. Transformer blocks forward
        for l in 0..n_layers {
            let b_off = tok_size + l * block_stride;
            let ffn_off = b_off + 2 * d + 4 * d * d;
            let sd_off = l * s_len * d;

            for t in 0..s_len {
                let u1_t = &mut u1_all[sd_off + t * d..sd_off + (t + 1) * d];
                r1_all[l * s_len + t] = rmsnorm_fwd(
                    &h_in_all[sd_off + t * d..sd_off + (t + 1) * d],
                    &p[b_off..b_off + d],
                    u1_t,
                );
                matvec_fwd(
                    u1_t,
                    &p[b_off + d..b_off + d + d * d],
                    None,
                    d,
                    d,
                    false,
                    &mut q_all[sd_off + t * d..sd_off + (t + 1) * d],
                );
                matvec_fwd(
                    u1_t,
                    &p[b_off + d + d * d..b_off + d + 2 * d * d],
                    None,
                    d,
                    d,
                    false,
                    &mut k_all[sd_off + t * d..sd_off + (t + 1) * d],
                );
                matvec_fwd(
                    u1_t,
                    &p[b_off + d + 2 * d * d..b_off + d + 3 * d * d],
                    None,
                    d,
                    d,
                    false,
                    &mut v_all[sd_off + t * d..sd_off + (t + 1) * d],
                );
            }

            let a_off = l * eff_heads * s_len * s_len;
            mha_forward_seq(
                &q_all[sd_off..sd_off + s_len * d],
                &k_all[sd_off..sd_off + s_len * d],
                &v_all[sd_off..sd_off + s_len * d],
                s_len,
                d,
                eff_heads,
                attn_scale,
                &mut scores,
                Some(&mut attn_all[a_off..a_off + eff_heads * s_len * s_len]),
                &mut ctx_all[sd_off..sd_off + s_len * d],
            );

            let next_sd_off = (l + 1) * s_len * d;
            let ff_off = l * s_len * 2 * d;
            for t in 0..s_len {
                h_mid_all[sd_off + t * d..sd_off + (t + 1) * d]
                    .copy_from_slice(&h_in_all[sd_off + t * d..sd_off + (t + 1) * d]);
                matvec_fwd(
                    &ctx_all[sd_off + t * d..sd_off + (t + 1) * d],
                    &p[b_off + d + 3 * d * d..b_off + d + 4 * d * d],
                    Some(&p[b_off + d + 4 * d * d..ffn_off]),
                    d,
                    d,
                    true,
                    &mut h_mid_all[sd_off + t * d..sd_off + (t + 1) * d],
                );

                let u2_t = &mut u2_all[sd_off + t * d..sd_off + (t + 1) * d];
                r2_all[l * s_len + t] = rmsnorm_fwd(
                    &h_mid_all[sd_off + t * d..sd_off + (t + 1) * d],
                    &p[ffn_off..ffn_off + d],
                    u2_t,
                );
                matvec_fwd(
                    u2_t,
                    &p[ffn_off + d..ffn_off + d + 2 * d * d],
                    Some(&p[ffn_off + d + 2 * d * d..ffn_off + 3 * d + 2 * d * d]),
                    d,
                    2 * d,
                    false,
                    &mut ff_pre,
                );
                for m in 0..(2 * d) {
                    let (act, dg) = gelu_fast(ff_pre[m]);
                    ff_act_all[ff_off + t * (2 * d) + m] = act;
                    ff_dg_all[ff_off + t * (2 * d) + m] = dg;
                }
                h_in_all[next_sd_off + t * d..next_sd_off + (t + 1) * d]
                    .copy_from_slice(&h_mid_all[sd_off + t * d..sd_off + (t + 1) * d]);
                matvec_fwd(
                    &ff_act_all[ff_off + t * (2 * d)..ff_off + (t + 1) * (2 * d)],
                    &p[ffn_off + 3 * d + 2 * d * d..ffn_off + 3 * d + 4 * d * d],
                    Some(&p[ffn_off + 3 * d + 4 * d * d..b_off + block_stride]),
                    2 * d,
                    d,
                    true,
                    &mut h_in_all[next_sd_off + t * d..next_sd_off + (t + 1) * d],
                );
            }
        }

        // 3. Mean pool + Head forward
        pooled.fill(0.0);
        let top_off = n_layers * s_len * d;
        for t in 0..s_len {
            for j in 0..d {
                pooled[j] += h_in_all[top_off + t * d + j] * inv_s;
            }
        }
        let r_out = rmsnorm_fwd(&pooled, &p[head_base..head_base + d], &mut p_norm);
        matvec_fwd(
            &p_norm,
            &p[head_base + d..head_base + d + d * n_out],
            Some(&p[head_base + d + d * n_out..head_base + d + d * n_out + n_out]),
            d,
            n_out,
            false,
            &mut z,
        );

        if let Some(ref mut out_b) = preds_out {
            write_pred(
                &z,
                task,
                n_out,
                &mut out_b[row_i * pred_stride..(row_i + 1) * pred_stride],
            );
        }

        if let (Some(ys), Some(g)) = (y, grads.as_deref_mut()) {
            total_loss += loss_and_dz(&z, ys[row_i], task, n_out, inv_n, &mut dz, &mut probs);

            // 4. Head backward
            {
                let (g_pre_b, gb_out) = g.split_at_mut(head_base + d + d * n_out);
                let (_, gw_out) = g_pre_b.split_at_mut(head_base + d);
                matvec_bwd(
                    &p_norm,
                    &dz,
                    &p[head_base + d..head_base + d + d * n_out],
                    gw_out,
                    Some(&mut gb_out[0..n_out]),
                    d,
                    n_out,
                    false,
                    Some(&mut dp_norm),
                );
            }
            rmsnorm_bwd(
                &dp_norm,
                &pooled,
                &p[head_base..head_base + d],
                r_out,
                &mut g[head_base..head_base + d],
                false,
                &mut dpooled,
            );
            for t in 0..s_len {
                for j in 0..d {
                    dh[t * d + j] = dpooled[j] * inv_s;
                }
            }

            // 5. Blocks backward
            for l in (0..n_layers).rev() {
                let b_off = tok_size + l * block_stride;
                let ffn_off = b_off + 2 * d + 4 * d * d;
                let sd_off = l * s_len * d;
                let ff_off = l * s_len * 2 * d;

                dh_mid.copy_from_slice(&dh);
                for t in 0..s_len {
                    {
                        let (g_pre_b2, gb2_rest) = g.split_at_mut(ffn_off + 3 * d + 4 * d * d);
                        let (_, gw2) = g_pre_b2.split_at_mut(ffn_off + 3 * d + 2 * d * d);
                        matvec_bwd(
                            &ff_act_all[ff_off + t * (2 * d)..ff_off + (t + 1) * (2 * d)],
                            &dh[t * d..(t + 1) * d],
                            &p[ffn_off + 3 * d + 2 * d * d..ffn_off + 3 * d + 4 * d * d],
                            gw2,
                            Some(&mut gb2_rest[0..d]),
                            2 * d,
                            d,
                            false,
                            Some(&mut ff_pre),
                        );
                    }
                    for m in 0..(2 * d) {
                        ff_pre[m] *= ff_dg_all[ff_off + t * (2 * d) + m];
                    }
                    {
                        let (g_pre_b1, gb1_rest) = g.split_at_mut(ffn_off + d + 2 * d * d);
                        let (_, gw1) = g_pre_b1.split_at_mut(ffn_off + d);
                        matvec_bwd(
                            &u2_all[sd_off + t * d..sd_off + (t + 1) * d],
                            &ff_pre,
                            &p[ffn_off + d..ffn_off + d + 2 * d * d],
                            gw1,
                            Some(&mut gb1_rest[0..2 * d]),
                            d,
                            2 * d,
                            false,
                            Some(&mut du2),
                        );
                    }
                    rmsnorm_bwd(
                        &du2,
                        &h_mid_all[sd_off + t * d..sd_off + (t + 1) * d],
                        &p[ffn_off..ffn_off + d],
                        r2_all[l * s_len + t],
                        &mut g[ffn_off..ffn_off + d],
                        true,
                        &mut dh_mid[t * d..(t + 1) * d],
                    );
                }

                // Attention backward
                dh_in.copy_from_slice(&dh_mid);
                for t in 0..s_len {
                    let (g_pre_bo, gbo_rest) = g.split_at_mut(b_off + d + 4 * d * d);
                    let (_, gwo) = g_pre_bo.split_at_mut(b_off + d + 3 * d * d);
                    matvec_bwd(
                        &ctx_all[sd_off + t * d..sd_off + (t + 1) * d],
                        &dh_mid[t * d..(t + 1) * d],
                        &p[b_off + d + 3 * d * d..b_off + d + 4 * d * d],
                        gwo,
                        Some(&mut gbo_rest[0..d]),
                        d,
                        d,
                        false,
                        Some(&mut dctx[t * d..(t + 1) * d]),
                    );
                }

                dq.fill(0.0);
                dk.fill(0.0);
                dv.fill(0.0);
                for h in 0..eff_heads {
                    let c0 = h * d_h;
                    let a_head_off = (l * eff_heads + h) * s_len * s_len;
                    for t in 0..s_len {
                        let dctx_th = &dctx[t * d + c0..t * d + c0 + d_h];
                        let mut dot_da = 0.0f32;
                        for s in 0..s_len {
                            let a_ts = attn_all[a_head_off + t * s_len + s];
                            let v_sh = &v_all[sd_off + s * d + c0..sd_off + s * d + c0 + d_h];
                            let mut da = 0.0f32;
                            for m in 0..d_h {
                                da += dctx_th[m] * v_sh[m];
                                dv[s * d + c0 + m] += a_ts * dctx_th[m];
                            }
                            d_attn[s] = da;
                            dot_da += da * a_ts;
                        }
                        for s in 0..s_len {
                            let a_ts = attn_all[a_head_off + t * s_len + s];
                            let d_score = a_ts * (d_attn[s] - dot_da) * attn_scale;
                            for m in 0..d_h {
                                dq[t * d + c0 + m] += d_score * k_all[sd_off + s * d + c0 + m];
                                dk[s * d + c0 + m] += d_score * q_all[sd_off + t * d + c0 + m];
                            }
                        }
                    }
                }

                for t in 0..s_len {
                    let u1_t = &u1_all[sd_off + t * d..sd_off + (t + 1) * d];
                    matvec_bwd(
                        u1_t,
                        &dq[t * d..(t + 1) * d],
                        &p[b_off + d..b_off + d + d * d],
                        &mut g[b_off + d..b_off + d + d * d],
                        None,
                        d,
                        d,
                        false,
                        Some(&mut du1),
                    );
                    matvec_bwd(
                        u1_t,
                        &dk[t * d..(t + 1) * d],
                        &p[b_off + d + d * d..b_off + d + 2 * d * d],
                        &mut g[b_off + d + d * d..b_off + d + 2 * d * d],
                        None,
                        d,
                        d,
                        true,
                        Some(&mut du1),
                    );
                    matvec_bwd(
                        u1_t,
                        &dv[t * d..(t + 1) * d],
                        &p[b_off + d + 2 * d * d..b_off + d + 3 * d * d],
                        &mut g[b_off + d + 2 * d * d..b_off + d + 3 * d * d],
                        None,
                        d,
                        d,
                        true,
                        Some(&mut du1),
                    );
                    rmsnorm_bwd(
                        &du1,
                        &h_in_all[sd_off + t * d..sd_off + (t + 1) * d],
                        &p[b_off..b_off + d],
                        r1_all[l * s_len + t],
                        &mut g[b_off..b_off + d],
                        true,
                        &mut dh_in[t * d..(t + 1) * d],
                    );
                }

                dh.copy_from_slice(&dh_in);
            }

            // 6. Tokenizer backward
            if ft {
                let gb_tok_base = f * d;
                for s in 0..s_len {
                    let xv = x_row[s];
                    for j in 0..d {
                        let gt = dh[s * d + j];
                        g[s * d + j] += xv * gt;
                        g[gb_tok_base + s * d + j] += gt;
                    }
                }
            } else {
                let gp_pos_base = patch_dim * d + d;
                for s in 0..s_len {
                    for m in 0..patch_dim {
                        let idx = s * patch_dim + m;
                        patch_buf[m] = if idx < f { x_row[idx] } else { 0.0 };
                    }
                    for j in 0..d {
                        g[gp_pos_base + s * d + j] += dh[s * d + j];
                    }
                    let (gw_patch, gb_patch_rest) = g.split_at_mut(patch_dim * d);
                    matvec_bwd(
                        &patch_buf[0..patch_dim],
                        &dh[s * d..(s + 1) * d],
                        &p[0..patch_dim * d],
                        gw_patch,
                        Some(&mut gb_patch_rest[0..d]),
                        patch_dim,
                        d,
                        false,
                        None,
                    );
                }
            }
        }
    }

    total_loss * inv_n
}

/// # Safety
/// Pointers must reference valid buffers matching the Transformer loss/grad ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_transformer_loss_grad(
    x: *const f32,
    y: *const f32,
    params: *const f32,
    grads: *mut f32,
    n: usize,
    f: usize,
    seq_len: usize,
    patch_dim: usize,
    d_model: usize,
    n_heads: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
) -> f32 {
    let p_len = mle_dl_transformer_param_count(f, seq_len, patch_dim, d_model, n_layers, n_out);
    if n == 0 || p_len == 0 || x.is_null() || y.is_null() || params.is_null() || grads.is_null() {
        return 0.0;
    }
    transformer_run_core(
        slice::from_raw_parts(x, n * f),
        Some(slice::from_raw_parts(y, n)),
        slice::from_raw_parts(params, p_len),
        Some(slice::from_raw_parts_mut(grads, p_len)),
        None,
        n,
        f,
        seq_len,
        patch_dim,
        d_model,
        n_heads,
        n_layers,
        task,
        n_out,
    )
}

/// # Safety
/// Pointers must reference valid buffers matching the Transformer train ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_transformer_train(
    x: *const f32,
    y: *const f32,
    params: *mut f32,
    n: usize,
    f: usize,
    seq_len: usize,
    patch_dim: usize,
    d_model: usize,
    n_heads: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
    epochs: usize,
    batch_size: usize,
    lr: f32,
    weight_decay: f32,
    seed: u32,
) -> f32 {
    let p_len = mle_dl_transformer_param_count(f, seq_len, patch_dim, d_model, n_layers, n_out);
    if n == 0 || p_len == 0 || x.is_null() || y.is_null() || params.is_null() {
        return 0.0;
    }
    let xs = slice::from_raw_parts(x, n * f);
    let ys = slice::from_raw_parts(y, n);
    let ps = slice::from_raw_parts_mut(params, p_len);
    let mask = transformer_decay_mask(f, seq_len, patch_dim, d_model, n_layers, n_out);

    let mut batch_fn =
        |bx: &[f32], by: &[f32], bs: usize, cur_p: &[f32], gs: &mut [f32], _step_seed: u32| {
            transformer_run_core(
                bx,
                Some(by),
                cur_p,
                Some(gs),
                None,
                bs,
                f,
                seq_len,
                patch_dim,
                d_model,
                n_heads,
                n_layers,
                task,
                n_out,
            )
        };
    adamw_train(
        xs,
        ys,
        ps,
        &mask,
        n,
        f,
        epochs,
        batch_size,
        lr,
        weight_decay,
        seed,
        &mut batch_fn,
    )
}

/// # Safety
/// Pointers must reference valid buffers matching the Transformer predict ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_transformer_predict(
    x: *const f32,
    params: *const f32,
    out: *mut f32,
    n: usize,
    f: usize,
    seq_len: usize,
    patch_dim: usize,
    d_model: usize,
    n_heads: usize,
    n_layers: usize,
    task: u32,
    n_out: usize,
) {
    let p_len = mle_dl_transformer_param_count(f, seq_len, patch_dim, d_model, n_layers, n_out);
    if n == 0
        || seq_len == 0
        || d_model == 0
        || n_out == 0
        || x.is_null()
        || params.is_null()
        || out.is_null()
    {
        return;
    }
    let pred_stride = if task == 1 { n_out } else { 1 };
    transformer_run_core(
        slice::from_raw_parts(x, n * f),
        None,
        slice::from_raw_parts(params, p_len),
        None,
        Some(slice::from_raw_parts_mut(out, n * pred_stride)),
        n,
        f,
        seq_len,
        patch_dim,
        d_model,
        n_heads,
        n_layers,
        task,
        n_out,
    );
}

// ============================================================================
// 7. Kernel Family 4: VeRA Fine-Tuning over Frozen 2-bit BitNet b1.58 Backbone
// ============================================================================

#[no_mangle]
pub extern "C" fn mle_dl_vera_backbone_bytes(f: usize, d_model: usize, n_layers: usize) -> usize {
    packed_matrix_bytes(f, d_model) + n_layers * packed_matrix_bytes(d_model, d_model)
}

#[no_mangle]
pub extern "C" fn mle_dl_vera_scale_count(n_layers: usize) -> usize {
    1 + n_layers
}

/// # Safety
/// `packed_out` and `scales_out` must hold `mle_dl_vera_backbone_bytes` and `mle_dl_vera_scale_count`.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_vera_init_backbone(
    packed_out: *mut u8,
    scales_out: *mut f32,
    f: usize,
    d_model: usize,
    n_layers: usize,
    backbone_seed: u32,
) {
    let total_bytes = mle_dl_vera_backbone_bytes(f, d_model, n_layers);
    let total_scales = mle_dl_vera_scale_count(n_layers);
    if total_bytes == 0 || packed_out.is_null() || scales_out.is_null() {
        return;
    }
    let packed = slice::from_raw_parts_mut(packed_out, total_bytes);
    let scales = slice::from_raw_parts_mut(scales_out, total_scales);

    let mut rng = Mulberry32(backbone_seed);
    let stem_b = packed_matrix_bytes(f, d_model);
    let blk_b = packed_matrix_bytes(d_model, d_model);

    scales[0] = init_ternary_matrix(&mut packed[0..stem_b], f, d_model, &mut rng);
    let mut off = stem_b;
    for l in 0..n_layers {
        scales[1 + l] =
            init_ternary_matrix(&mut packed[off..off + blk_b], d_model, d_model, &mut rng);
        off += blk_b;
    }
}

#[no_mangle]
pub extern "C" fn mle_dl_vera_param_count(
    d_model: usize,
    n_layers: usize,
    rank: usize,
    n_out: usize,
) -> usize {
    (rank + 2 * d_model)
        + n_layers * (rank + 3 * d_model)
        + (d_model + d_model * n_out + n_out)
}

fn vera_decay_mask(d: usize, n_layers: usize, rank: usize, n_out: usize) -> Vec<u8> {
    let total = mle_dl_vera_param_count(d, n_layers, rank, n_out);
    let mut mask = vec![0u8; total];
    let head_w_off = (rank + 2 * d) + n_layers * (rank + 3 * d) + d;
    mask[head_w_off..head_w_off + d * n_out].fill(1);
    mask
}

/// # Safety
/// `params` must point to `mle_dl_vera_param_count` floats.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_vera_init_params(
    params: *mut f32,
    d_model: usize,
    n_layers: usize,
    rank: usize,
    n_out: usize,
    seed: u32,
) {
    let total = mle_dl_vera_param_count(d_model, n_layers, rank, n_out);
    if total == 0 || params.is_null() {
        return;
    }
    let p = slice::from_raw_parts_mut(params, total);
    p.fill(0.0);
    let d = d_model;
    let mut off = 0usize;

    p[off..off + rank].fill(1.0);
    off += rank + 2 * d;

    for _ in 0..n_layers {
        p[off..off + d + rank].fill(1.0);
        off += rank + 3 * d;
    }

    p[off..off + d].fill(1.0);
    off += d;
    let mut rng = Mulberry32(seed);
    fill_uniform(
        &mut p[off..off + d * n_out],
        sqrt_f32(1.0 / (d.max(1) as f32)),
        &mut rng,
    );
}

#[inline]
fn rademacher_seed_a(backbone_seed: u32, layer_idx: usize) -> u32 {
    backbone_seed ^ ((layer_idx as u32).wrapping_add(1).wrapping_mul(0x9e37_79b9))
}

#[inline]
fn rademacher_seed_b(backbone_seed: u32, layer_idx: usize) -> u32 {
    backbone_seed ^ ((layer_idx as u32).wrapping_add(1).wrapping_mul(0x85eb_ca6b))
}

#[inline(never)]
fn rademacher_matvec(u: &[f32], rows: usize, cols: usize, scale: f32, seed: u32, out: &mut [f32]) {
    out[0..cols].fill(0.0);
    let mut rng = Mulberry32(seed);
    let mut bits = 0u32;
    let mut bit_pos = 32u32;
    for i in 0..rows {
        let ui = u[i];
        for j in 0..cols {
            if bit_pos == 32 {
                bits = rng.next_u32();
                bit_pos = 0;
            }
            let neg = ((bits >> bit_pos) & 1) != 0;
            bit_pos += 1;
            if neg {
                out[j] -= ui;
            } else {
                out[j] += ui;
            }
        }
    }
    for j in 0..cols {
        out[j] *= scale;
    }
}

#[inline(never)]
fn rademacher_matvec_t(
    dy: &[f32],
    rows: usize,
    cols: usize,
    scale: f32,
    seed: u32,
    out: &mut [f32],
) {
    let mut rng = Mulberry32(seed);
    let mut bits = 0u32;
    let mut bit_pos = 32u32;
    for i in 0..rows {
        let mut acc = 0.0f32;
        for j in 0..cols {
            if bit_pos == 32 {
                bits = rng.next_u32();
                bit_pos = 0;
            }
            let neg = ((bits >> bit_pos) & 1) != 0;
            bit_pos += 1;
            if neg {
                acc -= dy[j];
            } else {
                acc += dy[j];
            }
        }
        out[i] = acc * scale;
    }
}

#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn vera_linear_fwd(
    u: &[f32],
    fan_in: usize,
    d_model: usize,
    rank: usize,
    w0_packed: &[u8],
    alpha: f32,
    d_vec: &[f32],
    b_vec: &[f32],
    bias_vec: &[f32],
    backbone_seed: u32,
    layer_idx: usize,
    v_out: &mut [f32],
    w_out: &mut [f32],
    q_scratch: &mut [f32],
    pre_out: &mut [f32],
) {
    ternary_matvec(u, w0_packed, fan_in, d_model, alpha, pre_out);
    if rank > 0 {
        let scale_a = 1.0 / sqrt_f32(fan_in.max(1) as f32);
        let scale_b = 1.0 / sqrt_f32(rank as f32);
        rademacher_matvec(
            u,
            fan_in,
            rank,
            scale_a,
            rademacher_seed_a(backbone_seed, layer_idx),
            v_out,
        );
        for r in 0..rank {
            q_scratch[r] = d_vec[r] * v_out[r];
        }
        rademacher_matvec(
            q_scratch,
            rank,
            d_model,
            scale_b,
            rademacher_seed_b(backbone_seed, layer_idx),
            w_out,
        );
        for j in 0..d_model {
            pre_out[j] += b_vec[j] * w_out[j] + bias_vec[j];
        }
    } else {
        w_out[0..d_model].fill(0.0);
        for j in 0..d_model {
            pre_out[j] += bias_vec[j];
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[inline(never)]
fn vera_run_core(
    x: &[f32],
    y: Option<&[f32]>,
    backbone: &[u8],
    scales: &[f32],
    p: &[f32],
    mut grads: Option<&mut [f32]>,
    mut preds_out: Option<&mut [f32]>,
    n: usize,
    f: usize,
    d: usize,
    n_layers: usize,
    rank: usize,
    task: u32,
    n_out: usize,
    backbone_seed: u32,
) -> f32 {
    if let Some(ref mut g) = grads {
        g.fill(0.0);
    }
    if n == 0 || d == 0 || n_out == 0 {
        return 0.0;
    }

    let pred_stride = if task == 1 { n_out } else { 1 };
    let stem_bb = packed_matrix_bytes(f, d);
    let blk_bb = packed_matrix_bytes(d, d);
    let stem_p_size = rank + 2 * d;
    let blk_p_stride = rank + 3 * d;
    let head_base = stem_p_size + n_layers * blk_p_stride;

    let mut h_states = vec![0.0f32; (n_layers + 1) * d];
    let mut dg_all = vec![0.0f32; (n_layers + 1) * d];
    let mut v_all = vec![0.0f32; (n_layers + 1) * rank.max(1)];
    let mut w_all = vec![0.0f32; (n_layers + 1) * d];
    let mut u_norms = vec![0.0f32; n_layers.max(1) * d];
    let mut r_norms = vec![0.0f32; n_layers.max(1)];

    let mut q_scratch = vec![0.0f32; rank.max(1)];
    let mut pre = vec![0.0f32; d];
    let mut h_out_norm = vec![0.0f32; d];
    let mut z = vec![0.0f32; n_out];
    let mut dz = vec![0.0f32; n_out];
    let mut probs = vec![0.0f32; n_out];

    let mut dh_out_norm = vec![0.0f32; d];
    let mut dh = vec![0.0f32; d];
    let mut dpre = vec![0.0f32; d];
    let mut db_scaled = vec![0.0f32; d];
    let mut dq = vec![0.0f32; rank.max(1)];
    let mut dv = vec![0.0f32; rank.max(1)];
    let mut du_w0 = vec![0.0f32; d];
    let mut du_vera = vec![0.0f32; d];

    let inv_n = 1.0 / (n as f32);
    let scale_b = if rank > 0 {
        1.0 / sqrt_f32(rank as f32)
    } else {
        0.0
    };
    let scale_a_blk = 1.0 / sqrt_f32(d as f32);
    let mut total_loss = 0.0f32;

    for row_i in 0..n {
        let x_row = &x[row_i * f..(row_i + 1) * f];

        // 1. Stem forward
        vera_linear_fwd(
            x_row,
            f,
            d,
            rank,
            &backbone[0..stem_bb],
            scales[0],
            &p[0..rank],
            &p[rank..rank + d],
            &p[rank + d..stem_p_size],
            backbone_seed,
            0,
            &mut v_all[0..rank],
            &mut w_all[0..d],
            &mut q_scratch,
            &mut pre,
        );
        for j in 0..d {
            let (act, dg) = gelu_fast(pre[j]);
            h_states[j] = act;
            dg_all[j] = dg;
        }

        // 2. Blocks forward
        for l in 0..n_layers {
            let p_off = stem_p_size + l * blk_p_stride;
            r_norms[l] = rmsnorm_fwd(
                &h_states[l * d..(l + 1) * d],
                &p[p_off..p_off + d],
                &mut u_norms[l * d..(l + 1) * d],
            );
            let bb_off = stem_bb + l * blk_bb;
            vera_linear_fwd(
                &u_norms[l * d..(l + 1) * d],
                d,
                d,
                rank,
                &backbone[bb_off..bb_off + blk_bb],
                scales[1 + l],
                &p[p_off + d..p_off + d + rank],
                &p[p_off + d + rank..p_off + 2 * d + rank],
                &p[p_off + 2 * d + rank..p_off + blk_p_stride],
                backbone_seed,
                1 + l,
                &mut v_all[(l + 1) * rank..(l + 2) * rank],
                &mut w_all[(l + 1) * d..(l + 2) * d],
                &mut q_scratch,
                &mut pre,
            );
            for j in 0..d {
                let (act, dg) = gelu_fast(pre[j]);
                h_states[(l + 1) * d + j] = h_states[l * d + j] + act;
                dg_all[(l + 1) * d + j] = dg;
            }
        }

        // 3. Head forward
        let r_out = rmsnorm_fwd(
            &h_states[n_layers * d..(n_layers + 1) * d],
            &p[head_base..head_base + d],
            &mut h_out_norm,
        );
        matvec_fwd(
            &h_out_norm,
            &p[head_base + d..head_base + d + d * n_out],
            Some(&p[head_base + d + d * n_out..head_base + d + d * n_out + n_out]),
            d,
            n_out,
            false,
            &mut z,
        );

        if let Some(ref mut out_b) = preds_out {
            write_pred(
                &z,
                task,
                n_out,
                &mut out_b[row_i * pred_stride..(row_i + 1) * pred_stride],
            );
        }

        if let (Some(ys), Some(g)) = (y, grads.as_deref_mut()) {
            total_loss += loss_and_dz(&z, ys[row_i], task, n_out, inv_n, &mut dz, &mut probs);

            // 4. Head backward
            {
                let (g_pre_b, gb_out) = g.split_at_mut(head_base + d + d * n_out);
                let (_, gw_out) = g_pre_b.split_at_mut(head_base + d);
                matvec_bwd(
                    &h_out_norm,
                    &dz,
                    &p[head_base + d..head_base + d + d * n_out],
                    gw_out,
                    Some(&mut gb_out[0..n_out]),
                    d,
                    n_out,
                    false,
                    Some(&mut dh_out_norm),
                );
            }
            rmsnorm_bwd(
                &dh_out_norm,
                &h_states[n_layers * d..(n_layers + 1) * d],
                &p[head_base..head_base + d],
                r_out,
                &mut g[head_base..head_base + d],
                false,
                &mut dh,
            );

            // 5. Blocks backward
            for l in (0..n_layers).rev() {
                let p_off = stem_p_size + l * blk_p_stride;
                let d_l = &p[p_off + d..p_off + d + rank];
                let b_l = &p[p_off + d + rank..p_off + 2 * d + rank];

                for j in 0..d {
                    let gp = dh[j] * dg_all[(l + 1) * d + j];
                    dpre[j] = gp;
                    g[p_off + 2 * d + rank + j] += gp;
                    g[p_off + d + rank + j] += gp * w_all[(l + 1) * d + j];
                    db_scaled[j] = gp * b_l[j];
                }

                let bb_off = stem_bb + l * blk_bb;
                ternary_matvec_t(
                    &dpre,
                    &backbone[bb_off..bb_off + blk_bb],
                    d,
                    d,
                    scales[1 + l],
                    &mut du_w0,
                );

                if rank > 0 {
                    rademacher_matvec_t(
                        &db_scaled,
                        rank,
                        d,
                        scale_b,
                        rademacher_seed_b(backbone_seed, 1 + l),
                        &mut dq,
                    );
                    for r in 0..rank {
                        g[p_off + d + r] += dq[r] * v_all[(l + 1) * rank + r];
                        dv[r] = dq[r] * d_l[r];
                    }
                    rademacher_matvec_t(
                        &dv,
                        d,
                        rank,
                        scale_a_blk,
                        rademacher_seed_a(backbone_seed, 1 + l),
                        &mut du_vera,
                    );
                    for j in 0..d {
                        du_w0[j] += du_vera[j];
                    }
                }

                rmsnorm_bwd(
                    &du_w0,
                    &h_states[l * d..(l + 1) * d],
                    &p[p_off..p_off + d],
                    r_norms[l],
                    &mut g[p_off..p_off + d],
                    true,
                    &mut dh,
                );
            }

            // 6. Stem backward
            let b_0 = &p[rank..rank + d];
            for j in 0..d {
                let gp = dh[j] * dg_all[j];
                g[rank + d + j] += gp;
                g[rank + j] += gp * w_all[j];
                db_scaled[j] = gp * b_0[j];
            }
            if rank > 0 {
                rademacher_matvec_t(
                    &db_scaled,
                    rank,
                    d,
                    scale_b,
                    rademacher_seed_b(backbone_seed, 0),
                    &mut dq,
                );
                for r in 0..rank {
                    g[r] += dq[r] * v_all[r];
                }
            }
        }
    }

    total_loss * inv_n
}

/// # Safety
/// Pointers must reference valid buffers matching the VeRA loss/grad ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_vera_loss_grad(
    x: *const f32,
    y: *const f32,
    packed_backbone: *const u8,
    scales: *const f32,
    params: *const f32,
    grads: *mut f32,
    n: usize,
    f: usize,
    d_model: usize,
    n_layers: usize,
    rank: usize,
    task: u32,
    n_out: usize,
    backbone_seed: u32,
) -> f32 {
    let bb_len = mle_dl_vera_backbone_bytes(f, d_model, n_layers);
    let sc_len = mle_dl_vera_scale_count(n_layers);
    let p_len = mle_dl_vera_param_count(d_model, n_layers, rank, n_out);
    if n == 0
        || p_len == 0
        || x.is_null()
        || y.is_null()
        || packed_backbone.is_null()
        || scales.is_null()
        || params.is_null()
        || grads.is_null()
    {
        return 0.0;
    }
    vera_run_core(
        slice::from_raw_parts(x, n * f),
        Some(slice::from_raw_parts(y, n)),
        slice::from_raw_parts(packed_backbone, bb_len),
        slice::from_raw_parts(scales, sc_len),
        slice::from_raw_parts(params, p_len),
        Some(slice::from_raw_parts_mut(grads, p_len)),
        None,
        n,
        f,
        d_model,
        n_layers,
        rank,
        task,
        n_out,
        backbone_seed,
    )
}

/// # Safety
/// Pointers must reference valid buffers matching the VeRA train ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_vera_train(
    x: *const f32,
    y: *const f32,
    packed_backbone: *const u8,
    scales: *const f32,
    params: *mut f32,
    n: usize,
    f: usize,
    d_model: usize,
    n_layers: usize,
    rank: usize,
    task: u32,
    n_out: usize,
    epochs: usize,
    batch_size: usize,
    lr: f32,
    weight_decay: f32,
    backbone_seed: u32,
    train_seed: u32,
) -> f32 {
    let bb_len = mle_dl_vera_backbone_bytes(f, d_model, n_layers);
    let sc_len = mle_dl_vera_scale_count(n_layers);
    let p_len = mle_dl_vera_param_count(d_model, n_layers, rank, n_out);
    if n == 0
        || p_len == 0
        || x.is_null()
        || y.is_null()
        || packed_backbone.is_null()
        || scales.is_null()
        || params.is_null()
    {
        return 0.0;
    }
    let xs = slice::from_raw_parts(x, n * f);
    let ys = slice::from_raw_parts(y, n);
    let bb = slice::from_raw_parts(packed_backbone, bb_len);
    let sc = slice::from_raw_parts(scales, sc_len);
    let ps = slice::from_raw_parts_mut(params, p_len);
    let mask = vera_decay_mask(d_model, n_layers, rank, n_out);

    let mut batch_fn =
        |bx: &[f32], by: &[f32], bs: usize, cur_p: &[f32], gs: &mut [f32], _step_seed: u32| {
            vera_run_core(
                bx,
                Some(by),
                bb,
                sc,
                cur_p,
                Some(gs),
                None,
                bs,
                f,
                d_model,
                n_layers,
                rank,
                task,
                n_out,
                backbone_seed,
            )
        };
    adamw_train(
        xs,
        ys,
        ps,
        &mask,
        n,
        f,
        epochs,
        batch_size,
        lr,
        weight_decay,
        train_seed,
        &mut batch_fn,
    )
}

/// # Safety
/// Pointers must reference valid buffers matching the VeRA predict ABI.
#[no_mangle]
pub unsafe extern "C" fn mle_dl_vera_predict(
    x: *const f32,
    packed_backbone: *const u8,
    scales: *const f32,
    params: *const f32,
    out: *mut f32,
    n: usize,
    f: usize,
    d_model: usize,
    n_layers: usize,
    rank: usize,
    task: u32,
    n_out: usize,
    backbone_seed: u32,
) {
    let bb_len = mle_dl_vera_backbone_bytes(f, d_model, n_layers);
    let sc_len = mle_dl_vera_scale_count(n_layers);
    let p_len = mle_dl_vera_param_count(d_model, n_layers, rank, n_out);
    if n == 0
        || d_model == 0
        || n_out == 0
        || x.is_null()
        || packed_backbone.is_null()
        || scales.is_null()
        || params.is_null()
        || out.is_null()
    {
        return;
    }
    let pred_stride = if task == 1 { n_out } else { 1 };
    vera_run_core(
        slice::from_raw_parts(x, n * f),
        None,
        slice::from_raw_parts(packed_backbone, bb_len),
        slice::from_raw_parts(scales, sc_len),
        slice::from_raw_parts(params, p_len),
        None,
        Some(slice::from_raw_parts_mut(out, n * pred_stride)),
        n,
        f,
        d_model,
        n_layers,
        rank,
        task,
        n_out,
        backbone_seed,
    );
}

// ============================================================================
// 8. Unit Tests: Math, Finite-Difference Gradients, Convergence, Embeddings
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_grad_close(analytical: &[f32], numerical: &[f32], label: &str) {
        assert_eq!(analytical.len(), numerical.len());
        let mut max_err = 0.0f32;
        for i in 0..analytical.len() {
            let a = analytical[i];
            let n = numerical[i];
            let diff = abs_f32(a - n);
            let denom = max_f32(max_f32(abs_f32(a), abs_f32(n)), 1.0);
            let rel = diff / denom;
            if rel > max_err {
                max_err = rel;
            }
            assert!(
                rel < 1.0e-3,
                "{} param[{}]: analytical={} numerical={} rel_err={}",
                label,
                i,
                a,
                n,
                rel
            );
        }
        assert!(max_err < 1.0e-3);
    }

    fn make_toy_xy(n: usize, f: usize, task: u32, n_out: usize, seed: u32) -> (Vec<f32>, Vec<f32>) {
        let mut rng = Mulberry32(seed);
        let mut x = vec![0.0f32; n * f];
        for v in x.iter_mut() {
            *v = rng.uniform_sym(1.2);
        }
        let mut y = vec![0.0f32; n];
        for i in 0..n {
            if task == 0 {
                y[i] = if (i & 1) == 0 { 0.0 } else { 1.0 };
            } else if task == 1 {
                y[i] = (i % n_out) as f32;
            } else {
                y[i] = x[i * f] * 1.5 - x[i * f + 1] * 0.8 + 0.3;
            }
        }
        (x, y)
    }

    #[test]
    fn test_math_primitives_accuracy() {
        assert_eq!(floor_clamped(2.7), 2.0);
        assert_eq!(floor_clamped(-2.7), -3.0);
        assert_eq!(floor_clamped(-2.0), -2.0);
        assert_eq!(floor_clamped(0.0), 0.0);

        // 0-ULP bit-identity between sqrt_ieee754_nr and hardware IEEE-754 f32::sqrt
        let mut rng = Mulberry32(0x1234_5678);
        for _ in 0..100_000 {
            let raw = (rng.next_u32() & 0x7fff_ffff) | 1;
            let v = f32::from_bits(raw);
            if v.is_finite() && v >= 0.0 {
                assert_eq!(
                    sqrt_ieee754_nr(v).to_bits(),
                    v.sqrt().to_bits(),
                    "0-ULP sqrt mismatch on v={}",
                    v
                );
            }
        }
        assert_eq!(sqrt_ieee754_nr(0.0).to_bits(), 0.0f32.to_bits());
        assert_eq!(sqrt_ieee754_nr(-0.0).to_bits(), (-0.0f32).to_bits());

        // exp(ln(x)) == x roundtrip across orders of magnitude
        for &v in &[0.01f32, 0.25, 0.7, 1.0, 1.4142, 2.5, 10.0, 50.0] {
            let rt = fast_exp(fast_ln(v));
            let rel = abs_f32(rt - v) / v;
            assert!(rel < 1.0e-5, "v={} rt={} rel={}", v, rt, rel);
        }

        // gelu_fast analytical derivative vs central difference
        let eps = 1.0e-3f32;
        for step in -30..=30 {
            let x = (step as f32) * 0.2;
            let (_, dg) = gelu_fast(x);
            let num = (gelu_fast(x + eps).0 - gelu_fast(x - eps).0) / (2.0 * eps);
            assert!(abs_f32(dg - num) < 5.0e-4, "x={} dg={} num={}", x, dg, num);
        }

        // cos_decay_fast endpoints and midpoint
        assert!(abs_f32(cos_decay_fast(0.0) - 1.0) < 1.0e-4);
        assert!(abs_f32(cos_decay_fast(0.5) - 0.5) < 1.0e-6);
        assert!(abs_f32(cos_decay_fast(1.0) - 0.0) < 1.0e-4);
    }

    #[test]
    fn test_alloc_free_and_abi() {
        assert_eq!(mle_dl_abi_version(), 1);
        unsafe {
            let p = mle_dl_alloc(128);
            assert!(!p.is_null());
            assert_eq!((p as usize) % 8, 0);
            *p.add(127) = 42;
            assert_eq!(*p.add(127), 42);
            mle_dl_free(p, 128);
        }
    }

    #[test]
    fn test_adamw_weight_decay_mask_selectivity() {
        let rm = resnet_decay_mask(4, 6, 1, 2);
        assert_eq!(rm[0], 1);
        assert_eq!(rm[24], 0);
        assert_eq!(rm[30], 0);
        assert_eq!(rm[36], 1);

        let tm_patch = transformer_decay_mask(6, 2, 3, 4, 1, 1);
        assert_eq!(tm_patch[0], 1);
        assert_eq!(tm_patch[12], 0);
        assert_eq!(tm_patch[16], 0);
        assert_eq!(tm_patch[24], 0);
        assert_eq!(tm_patch[28], 1);

        let vm = vera_decay_mask(8, 2, 4, 3);
        let head_w_off = (4 + 16) + 2 * (4 + 24) + 8;
        for (idx, &decays) in vm.iter().enumerate() {
            if idx >= head_w_off && idx < head_w_off + 24 {
                assert_eq!(decays, 1);
            } else {
                assert_eq!(decays, 0);
            }
        }
    }

    #[test]
    fn test_resnet_finite_diff_all_tasks_and_dropout() {
        let n = 5usize;
        let f = 4usize;
        let d = 6usize;
        let n_layers = 2usize;
        let eps = 1.0e-3f32;

        for &(task, n_out) in &[(0u32, 1usize), (1u32, 3usize), (2u32, 1usize)] {
            for &dropout in &[0.0f32, 0.2f32] {
                let (x, y) = make_toy_xy(n, f, task, n_out, 100 + task);
                let p_cnt = mle_dl_resnet_param_count(f, d, n_layers, n_out);
                let mut params = vec![0.0f32; p_cnt];
                let mut grads = vec![0.0f32; p_cnt];
                let mut scratch_g = vec![0.0f32; p_cnt];
                let mut num_grads = vec![0.0f32; p_cnt];

                unsafe {
                    mle_dl_resnet_init(params.as_mut_ptr(), f, d, n_layers, n_out, 42 + task);
                    let mut rng = Mulberry32(777);
                    for v in params.iter_mut() {
                        *v += rng.uniform_sym(0.05);
                    }
                    mle_dl_resnet_loss_grad(
                        x.as_ptr(),
                        y.as_ptr(),
                        params.as_ptr(),
                        grads.as_mut_ptr(),
                        n,
                        f,
                        d,
                        n_layers,
                        task,
                        n_out,
                        dropout,
                        999,
                    );

                    for i in 0..p_cnt {
                        let orig = params[i];
                        params[i] = orig + eps;
                        let lp = mle_dl_resnet_loss_grad(
                            x.as_ptr(),
                            y.as_ptr(),
                            params.as_ptr(),
                            scratch_g.as_mut_ptr(),
                            n,
                            f,
                            d,
                            n_layers,
                            task,
                            n_out,
                            dropout,
                            999,
                        );
                        params[i] = orig - eps;
                        let lm = mle_dl_resnet_loss_grad(
                            x.as_ptr(),
                            y.as_ptr(),
                            params.as_ptr(),
                            scratch_g.as_mut_ptr(),
                            n,
                            f,
                            d,
                            n_layers,
                            task,
                            n_out,
                            dropout,
                            999,
                        );
                        params[i] = orig;
                        num_grads[i] = (lp - lm) / (2.0 * eps);
                    }
                }
                assert_grad_close(&grads, &num_grads, "resnet");
            }
        }
    }

    #[test]
    fn test_transformer_finite_diff_ft_and_patch_modes() {
        let n = 4usize;
        let d = 8usize;
        let n_heads = 2usize;
        let n_layers = 2usize;
        let eps = 1.0e-3f32;

        for &(f, seq_len, patch_dim, mode_tag) in
            &[(4usize, 4usize, 1usize, "ft"), (10usize, 3usize, 4usize, "patch")]
        {
            for &(task, n_out) in &[(0u32, 1usize), (1u32, 3usize), (2u32, 1usize)] {
                let (x, y) = make_toy_xy(n, f, task, n_out, 200 + task);
                let p_cnt =
                    mle_dl_transformer_param_count(f, seq_len, patch_dim, d, n_layers, n_out);
                let mut params = vec![0.0f32; p_cnt];
                let mut grads = vec![0.0f32; p_cnt];
                let mut scratch_g = vec![0.0f32; p_cnt];
                let mut num_grads = vec![0.0f32; p_cnt];

                unsafe {
                    mle_dl_transformer_init(
                        params.as_mut_ptr(),
                        f,
                        seq_len,
                        patch_dim,
                        d,
                        n_layers,
                        n_out,
                        55 + task,
                    );
                    let mut rng = Mulberry32(888);
                    for v in params.iter_mut() {
                        *v += rng.uniform_sym(0.05);
                    }
                    mle_dl_transformer_loss_grad(
                        x.as_ptr(),
                        y.as_ptr(),
                        params.as_ptr(),
                        grads.as_mut_ptr(),
                        n,
                        f,
                        seq_len,
                        patch_dim,
                        d,
                        n_heads,
                        n_layers,
                        task,
                        n_out,
                    );

                    for i in 0..p_cnt {
                        let orig = params[i];
                        params[i] = orig + eps;
                        let lp = mle_dl_transformer_loss_grad(
                            x.as_ptr(),
                            y.as_ptr(),
                            params.as_ptr(),
                            scratch_g.as_mut_ptr(),
                            n,
                            f,
                            seq_len,
                            patch_dim,
                            d,
                            n_heads,
                            n_layers,
                            task,
                            n_out,
                        );
                        params[i] = orig - eps;
                        let lm = mle_dl_transformer_loss_grad(
                            x.as_ptr(),
                            y.as_ptr(),
                            params.as_ptr(),
                            scratch_g.as_mut_ptr(),
                            n,
                            f,
                            seq_len,
                            patch_dim,
                            d,
                            n_heads,
                            n_layers,
                            task,
                            n_out,
                        );
                        params[i] = orig;
                        num_grads[i] = (lp - lm) / (2.0 * eps);
                    }
                }
                assert_grad_close(&grads, &num_grads, mode_tag);
            }
        }
    }

    #[test]
    fn test_vera_finite_diff_all_tasks() {
        let n = 5usize;
        let f = 6usize;
        let d = 8usize;
        let n_layers = 2usize;
        let rank = 4usize;
        let bb_seed = 12345u32;
        let eps = 1.0e-3f32;

        let bb_bytes = mle_dl_vera_backbone_bytes(f, d, n_layers);
        let sc_cnt = mle_dl_vera_scale_count(n_layers);
        let mut backbone = vec![0u8; bb_bytes];
        let mut scales = vec![0.0f32; sc_cnt];
        unsafe {
            mle_dl_vera_init_backbone(
                backbone.as_mut_ptr(),
                scales.as_mut_ptr(),
                f,
                d,
                n_layers,
                bb_seed,
            );
        }

        for &(task, n_out) in &[(0u32, 1usize), (1u32, 3usize), (2u32, 1usize)] {
            let (x, y) = make_toy_xy(n, f, task, n_out, 300 + task);
            let p_cnt = mle_dl_vera_param_count(d, n_layers, rank, n_out);
            let mut params = vec![0.0f32; p_cnt];
            let mut grads = vec![0.0f32; p_cnt];
            let mut scratch_g = vec![0.0f32; p_cnt];
            let mut num_grads = vec![0.0f32; p_cnt];

            unsafe {
                mle_dl_vera_init_params(params.as_mut_ptr(), d, n_layers, rank, n_out, 77 + task);
                let mut rng = Mulberry32(999 + task);
                for v in params.iter_mut() {
                    *v += rng.uniform_sym(0.25);
                }

                mle_dl_vera_loss_grad(
                    x.as_ptr(),
                    y.as_ptr(),
                    backbone.as_ptr(),
                    scales.as_ptr(),
                    params.as_ptr(),
                    grads.as_mut_ptr(),
                    n,
                    f,
                    d,
                    n_layers,
                    rank,
                    task,
                    n_out,
                    bb_seed,
                );

                let mut d0_energy = 0.0f32;
                for r in 0..rank {
                    d0_energy += abs_f32(grads[r]);
                }
                assert!(d0_energy > 1.0e-5, "expected non-zero d_0 gradient");

                for i in 0..p_cnt {
                    let orig = params[i];
                    params[i] = orig + eps;
                    let lp = mle_dl_vera_loss_grad(
                        x.as_ptr(),
                        y.as_ptr(),
                        backbone.as_ptr(),
                        scales.as_ptr(),
                        params.as_ptr(),
                        scratch_g.as_mut_ptr(),
                        n,
                        f,
                        d,
                        n_layers,
                        rank,
                        task,
                        n_out,
                        bb_seed,
                    );
                    params[i] = orig - eps;
                    let lm = mle_dl_vera_loss_grad(
                        x.as_ptr(),
                        y.as_ptr(),
                        backbone.as_ptr(),
                        scales.as_ptr(),
                        params.as_ptr(),
                        scratch_g.as_mut_ptr(),
                        n,
                        f,
                        d,
                        n_layers,
                        rank,
                        task,
                        n_out,
                        bb_seed,
                    );
                    params[i] = orig;
                    num_grads[i] = (lp - lm) / (2.0 * eps);
                }
            }
            assert_grad_close(&grads, &num_grads, "vera");
        }
    }

    #[test]
    fn test_training_convergence_all_models_and_tasks() {
        let n = 48usize;
        let f = 6usize;
        let mut rng = Mulberry32(2026);
        let mut x = vec![0.0f32; n * f];
        let mut y_bin = vec![0.0f32; n];
        let mut y_mc = vec![0.0f32; n];
        let mut y_reg = vec![0.0f32; n];

        for i in 0..n {
            for j in 0..f {
                x[i * f + j] = rng.uniform_sym(1.5);
            }
            let s = x[i * f] * x[i * f + 1] + 0.8 * x[i * f + 2] - 0.6 * x[i * f + 3];
            y_bin[i] = if s > 0.0 { 1.0 } else { 0.0 };
            y_mc[i] = if s < -0.4 {
                0.0
            } else if s < 0.4 {
                1.0
            } else {
                2.0
            };
            y_reg[i] = s;
        }

        unsafe {
            for &(task, n_out, y_ref) in &[
                (0u32, 1usize, &y_bin),
                (1u32, 3usize, &y_mc),
                (2u32, 1usize, &y_reg),
            ] {
                let d = 16usize;
                let nl = 2usize;
                let pc = mle_dl_resnet_param_count(f, d, nl, n_out);
                let mut params = vec![0.0f32; pc];
                let mut g = vec![0.0f32; pc];
                mle_dl_resnet_init(params.as_mut_ptr(), f, d, nl, n_out, 42);
                let l0 = mle_dl_resnet_loss_grad(
                    x.as_ptr(),
                    y_ref.as_ptr(),
                    params.as_ptr(),
                    g.as_mut_ptr(),
                    n,
                    f,
                    d,
                    nl,
                    task,
                    n_out,
                    0.0,
                    42,
                );
                let l_end = mle_dl_resnet_train(
                    x.as_ptr(),
                    y_ref.as_ptr(),
                    params.as_mut_ptr(),
                    n,
                    f,
                    d,
                    nl,
                    task,
                    n_out,
                    50,
                    16,
                    0.015,
                    1.0e-4,
                    0.0,
                    42,
                );
                assert!(l_end < l0 * 0.5, "resnet task={}: l0={} l_end={}", task, l0, l_end);

                let pred_len = if task == 1 { n * n_out } else { n };
                let mut preds = vec![0.0f32; pred_len];
                mle_dl_resnet_predict(
                    x.as_ptr(),
                    params.as_ptr(),
                    preds.as_mut_ptr(),
                    n,
                    f,
                    d,
                    nl,
                    task,
                    n_out,
                );
                if task == 0 {
                    for &pr in &preds {
                        assert!(pr > 0.0 && pr < 1.0);
                    }
                } else if task == 1 {
                    for i in 0..n {
                        let sum: f32 = preds[i * 3..(i + 1) * 3].iter().sum();
                        assert!(abs_f32(sum - 1.0) < 1.0e-5);
                    }
                }
            }

            for &(seq_len, patch_dim) in &[(f, 1usize), (2usize, 3usize)] {
                let d = 16usize;
                let pc = mle_dl_transformer_param_count(f, seq_len, patch_dim, d, 1, 3);
                let mut params = vec![0.0f32; pc];
                let mut g = vec![0.0f32; pc];
                mle_dl_transformer_init(params.as_mut_ptr(), f, seq_len, patch_dim, d, 1, 3, 42);
                let l0 = mle_dl_transformer_loss_grad(
                    x.as_ptr(),
                    y_mc.as_ptr(),
                    params.as_ptr(),
                    g.as_mut_ptr(),
                    n,
                    f,
                    seq_len,
                    patch_dim,
                    d,
                    2,
                    1,
                    1,
                    3,
                );
                let l_end = mle_dl_transformer_train(
                    x.as_ptr(),
                    y_mc.as_ptr(),
                    params.as_mut_ptr(),
                    n,
                    f,
                    seq_len,
                    patch_dim,
                    d,
                    2,
                    1,
                    1,
                    3,
                    50,
                    16,
                    0.015,
                    1.0e-4,
                    42,
                );
                assert!(l_end < l0 * 0.5, "transformer l0={} l_end={}", l0, l_end);
            }

            let d = 24usize;
            let nl = 2usize;
            let rank = 8usize;
            let mut bb = vec![0u8; mle_dl_vera_backbone_bytes(f, d, nl)];
            let mut sc = vec![0.0f32; mle_dl_vera_scale_count(nl)];
            mle_dl_vera_init_backbone(bb.as_mut_ptr(), sc.as_mut_ptr(), f, d, nl, 101);

            for &(task, n_out, y_ref) in &[
                (0u32, 1usize, &y_bin),
                (1u32, 3usize, &y_mc),
                (2u32, 1usize, &y_reg),
            ] {
                let pc = mle_dl_vera_param_count(d, nl, rank, n_out);
                let mut params = vec![0.0f32; pc];
                let mut g = vec![0.0f32; pc];
                mle_dl_vera_init_params(params.as_mut_ptr(), d, nl, rank, n_out, 42);
                let l0 = mle_dl_vera_loss_grad(
                    x.as_ptr(),
                    y_ref.as_ptr(),
                    bb.as_ptr(),
                    sc.as_ptr(),
                    params.as_ptr(),
                    g.as_mut_ptr(),
                    n,
                    f,
                    d,
                    nl,
                    rank,
                    task,
                    n_out,
                    101,
                );
                let l_end = mle_dl_vera_train(
                    x.as_ptr(),
                    y_ref.as_ptr(),
                    bb.as_ptr(),
                    sc.as_ptr(),
                    params.as_mut_ptr(),
                    n,
                    f,
                    d,
                    nl,
                    rank,
                    task,
                    n_out,
                    60,
                    16,
                    0.02,
                    1.0e-4,
                    101,
                    42,
                );
                assert!(l_end < l0 * 0.65, "vera task={}: l0={} l_end={}", task, l0, l_end);
            }
        }
    }

    #[test]
    fn test_embed_subword_and_bitnet_matryoshka_and_unit_norm() {
        let texts = [
            "Machine learning on tabular & vision data!",
            "machine LEARNING on tabular data",
            "Quantum chromodynamics and lattice gauge theory",
            "Café résumé naïve 東京",
        ];
        let mut bytes = Vec::<u8>::new();
        let mut offsets = vec![0u32];
        for t in &texts {
            bytes.extend_from_slice(t.as_bytes());
            offsets.push(bytes.len() as u32);
        }
        let n_rows = texts.len();

        unsafe {
            let mut out64 = vec![0.0f32; n_rows * 64];
            let mut out16 = vec![0.0f32; n_rows * 16];
            mle_dl_embed_subword(
                bytes.as_ptr(),
                bytes.len(),
                offsets.as_ptr(),
                n_rows,
                out64.as_mut_ptr(),
                64,
                64,
                42,
            );
            mle_dl_embed_subword(
                bytes.as_ptr(),
                bytes.len(),
                offsets.as_ptr(),
                n_rows,
                out16.as_mut_ptr(),
                16,
                64,
                42,
            );

            for r in 0..n_rows {
                let norm64: f32 = out64[r * 64..(r + 1) * 64].iter().map(|v| v * v).sum();
                let norm16: f32 = out16[r * 16..(r + 1) * 16].iter().map(|v| v * v).sum();
                assert!(abs_f32(norm64 - 1.0) < 1.0e-5);
                assert!(abs_f32(norm16 - 1.0) < 1.0e-5);

                let pref_norm = out64[r * 64..r * 64 + 16]
                    .iter()
                    .map(|v| v * v)
                    .sum::<f32>()
                    .sqrt();
                for j in 0..16 {
                    let expected = out64[r * 64 + j] / pref_norm;
                    assert!(abs_f32(expected - out16[r * 16 + j]) < 1.0e-5);
                }
            }

            let sim_01: f32 = (0..64).map(|j| out64[j] * out64[64 + j]).sum();
            let sim_02: f32 = (0..64).map(|j| out64[j] * out64[128 + j]).sum();
            assert!(sim_01 > 0.65 && sim_01 > sim_02 + 0.35);

            let d_model = 32usize;
            let n_layers = 2usize;
            let mut pw = vec![0u8; mle_dl_bitnet_packed_bytes(d_model, n_layers)];
            let mut sc = vec![0.0f32; mle_dl_bitnet_scale_count(n_layers)];
            mle_dl_bitnet_init(pw.as_mut_ptr(), sc.as_mut_ptr(), d_model, n_layers, 7);

            let mut bn32 = vec![0.0f32; n_rows * 32];
            let mut bn32_b = vec![0.0f32; n_rows * 32];
            let mut bn16 = vec![0.0f32; n_rows * 16];
            mle_dl_bitnet_encode(
                bytes.as_ptr(),
                bytes.len(),
                offsets.as_ptr(),
                n_rows,
                pw.as_ptr(),
                sc.as_ptr(),
                d_model,
                4,
                n_layers,
                16,
                bn32.as_mut_ptr(),
                32,
                7,
            );
            mle_dl_bitnet_encode(
                bytes.as_ptr(),
                bytes.len(),
                offsets.as_ptr(),
                n_rows,
                pw.as_ptr(),
                sc.as_ptr(),
                d_model,
                4,
                n_layers,
                16,
                bn32_b.as_mut_ptr(),
                32,
                7,
            );
            mle_dl_bitnet_encode(
                bytes.as_ptr(),
                bytes.len(),
                offsets.as_ptr(),
                n_rows,
                pw.as_ptr(),
                sc.as_ptr(),
                d_model,
                4,
                n_layers,
                16,
                bn16.as_mut_ptr(),
                16,
                7,
            );

            assert_eq!(bn32, bn32_b);
            for r in 0..n_rows {
                let n32: f32 = bn32[r * 32..(r + 1) * 32].iter().map(|v| v * v).sum();
                let n16: f32 = bn16[r * 16..(r + 1) * 16].iter().map(|v| v * v).sum();
                assert!(abs_f32(n32 - 1.0) < 1.0e-5);
                assert!(abs_f32(n16 - 1.0) < 1.0e-5);

                let pref_norm = bn32[r * 32..r * 32 + 16]
                    .iter()
                    .map(|v| v * v)
                    .sum::<f32>()
                    .sqrt();
                for j in 0..16 {
                    let expected = bn32[r * 32 + j] / pref_norm;
                    assert!(abs_f32(expected - bn16[r * 16 + j]) < 1.0e-5);
                }
            }
        }
    }
}
