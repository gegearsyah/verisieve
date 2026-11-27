"""README architecture GIFs in the hand-drawn register.

Papers 1-3: the measured pipeline plus, under each stage, the module or
function that actually runs, so the animation shows where the work happens
rather than a single "extraction" container.

Data architecture: the repository premise, a four-layer stack from scattered
company data to one model, kept distinct from Paper 4's pipeline scene.

Paper 4's animation is build_k7_architecture.build_gif(). This module reuses
that file's primitives so all of them read as one set: same wobbly stroke,
same dash-march loop. Seeded, reproducible.
"""
from pathlib import Path
import random
import shutil

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

import build_k7_architecture as k7
from build_k7_architecture import (
    _node, _dashed, _badge, _arrow_head, _txt,
    _icon_envelope, _icon_shield, _icon_lock, _icon_graph, _icon_db,
    _icon_gradcap, _icon_magnifier, _icon_plates,
    BG, FILL, SIDE, YELLOW, DASH_PERIOD,
)

OUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUT_DIR.parent.parent / "docs"
NODE_W = 146
NODE_GAP = 44
X0 = 238
Y_TOP = 96
FRAMES = 10
DUR_MS = 140
TEXT_MAX = NODE_W - 8


def _seed(seed):
    k7._rng = random.Random(seed)


def _canvas():
    fig, ax = plt.subplots(figsize=(k7.GIF_W / 100, k7.GIF_H / 100), dpi=100)
    fig.patch.set_facecolor(BG)
    ax.set_xlim(0, k7.GIF_W)
    ax.set_ylim(0, k7.GIF_H)
    ax.set_position([0, 0, 1, 1])
    ax.axis("off")
    return fig, ax


def _sidebar(ax, title, sub):
    ax.add_patch(FancyBboxPatch((14, 14), 198, k7.GIF_H - 28,
                                boxstyle="round,pad=0,rounding_size=16",
                                facecolor=SIDE, edgecolor="none", zorder=2))
    _txt(ax, 113, k7.GIF_H - 122, title, 19.0, bold=True)
    _txt(ax, 113, k7.GIF_H - 165, sub, 11.5, ls=1.35)


def _center(box):
    """Vertical centre in mpl coords for a _node return tuple."""
    mpl_top, _canvas_top, canvas_bottom, _h = box
    return (mpl_top + (k7.GIF_H - canvas_bottom)) / 2


def _link_h(ax, x_left, x_right, y, dash_off, badge):
    _dashed(ax, [(x_right - 11, y), (x_left + 5, y)], dash_off)
    _arrow_head(ax, (x_right - 5, y), (1, 0))
    _badge(ax, (x_left + x_right) / 2, y + 18, badge)


def _link_pts(ax, pts, dash_off, badge=None, badge_at=None):
    """Dashed polyline source-first; arrowhead on the last segment.

    The source end is extended back under the source box by the dash phase so a
    dash lands flush on the border instead of shimmering with the march (drawn
    at z=1.5 so the box fill hides the tail, same trick as _vlink).
    """
    pts = list(pts)
    total = sum(abs(b[0] - a[0]) + abs(b[1] - a[1]) for a, b in zip(pts[:-1], pts[1:]))
    e = -((total + dash_off) % DASH_PERIOD) % DASH_PERIOD
    dx, dy = pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]
    L = abs(dx) + abs(dy)
    if L > 12:
        pts[0] = (pts[0][0] - dx / L * (3 + e), pts[0][1] - dy / L * (3 + e))
    _dashed(ax, list(reversed(pts)), dash_off, z=1.5)
    dx = pts[-1][0] - pts[-2][0]
    dy = pts[-1][1] - pts[-2][1]
    _arrow_head(ax, pts[-1], (dx, dy))
    if badge is not None:
        if badge_at is None:
            a, b = pts[-2], pts[-1]
            badge_at = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 18)
        _badge(ax, badge_at[0], badge_at[1], badge)


def _vlink(ax, x, from_bottom, to_top, dash_off):
    """Vertical drop: from the bottom edge of one row to the top of the next.

    Extends the upper end by the dash phase so a dash always lands flush on the
    border instead of shimmering with the march (same trick as k7's fan-out).
    """
    mpl_border = k7.GIF_H - from_bottom
    tip = (x, k7.GIF_H - to_top)
    base_len = mpl_border - tip[1]
    e = -((base_len + dash_off) % DASH_PERIOD) % DASH_PERIOD
    _dashed(ax, [tip, (x, mpl_border + 3 + e)], dash_off, z=1.5)
    _arrow_head(ax, tip, (0, -1))


def _pipeline(ax, nodes, dash_off):
    xs = [X0 + i * (NODE_W + NODE_GAP) for i in range(len(nodes))]
    boxes = []
    for i, (icon, title, sub, fc) in enumerate(nodes):
        boxes.append(_node(ax, xs[i], Y_TOP, NODE_W, icon, title, sub, fc=fc))
    y = _center(boxes[0])
    for i in range(len(nodes) - 1):
        _link_h(ax, xs[i] + NODE_W, xs[i + 1], y, dash_off, i + 1)
    return boxes


def _detail(ax, x, y_top, title, body, fc=FILL, w=NODE_W):
    """Small card naming the module or function behind a pipeline stage."""
    pad = 11
    h = pad + 13.2 * len(title) + 4 + 12.5 * len(body) + pad
    y = k7.GIF_H - y_top - h
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                                boxstyle="round,pad=0,rounding_size=8",
                                facecolor=fc, edgecolor="none", zorder=2))
    k7._stroke(ax, k7._rrect_pts(x, y, w, h, 8), lw=1.4, close=True)
    _txt(ax, x + w / 2, y + h - pad, "\n".join(title), 8.9, bold=True, va="top", ls=1.15)
    _txt(ax, x + w / 2, y + pad - 1, "\n".join(body), 8.0, va="bottom", ls=1.2)
    return y + h


def _details(ax, y_top, cards):
    xs = [X0 + i * (NODE_W + NODE_GAP) for i in range(len(cards))]
    for x, (title, body) in zip(xs, cards):
        _detail(ax, x, y_top, title, body)


BAD = "#b91c1c"   # NO / abstain branch
OK = "#0f766e"    # YES / keep branch


def _tag(ax, x, y, s, color):
    _txt(ax, x, y, s, 9.3, bold=True, color=color, z=8)


# --- Paper 1: what data should lose ----------------------------------------
def draw_paper1(seed, dash_off):
    _seed(seed)
    k7.GIF_H = 620
    fig, ax = _canvas()
    _sidebar(ax, "Paper 1", "what data\nshould lose")
    boxes = _pipeline(ax, [
        (_icon_envelope, ["Source", "files"], ["PDF, forms,", "text, 1,207 docs"], FILL),
        (_icon_magnifier, ["Deterministic", "extraction"], ["CMap + 512 px", "overlapping tiles"], FILL),
        (_icon_shield, ["Redaction", "layer"], ["regex +", "334-word lexicon"], YELLOW),
        (_icon_lock, ["LTT gate"], ["certified risk,", "fails closed"], FILL),
        (_icon_plates, ["Clean", "handoff"], ["Markdown,", "SFT JSONL"], FILL),
    ], dash_off)
    xs = [X0 + i * (NODE_W + NODE_GAP) for i in range(5)]

    # Branch off extraction: no text layer -> OCR, then rejoin redaction.
    ocr = _node(ax, xs[1], 330, NODE_W, k7._icon_magnifier,
                ["No text layer?"], ["cactus.wasm OCR"], fc=FILL)
    _vlink(ax, xs[1] + NODE_W / 2, boxes[1][2], 330, dash_off)
    _tag(ax, xs[1] + NODE_W / 2 + 25, k7.GIF_H - 312, "NO", BAD)
    _link_pts(ax, [(xs[1] + NODE_W + 4, _center(ocr)),
                   (xs[2] + NODE_W / 2, _center(ocr)),
                   (xs[2] + NODE_W / 2, k7.GIF_H - boxes[2][2])], dash_off)

    # Branch off the gate: no certificate -> abstain instead of hand-off.
    _node(ax, xs[3], 330, NODE_W, k7._icon_cross, ["ABSTAIN"], ["human review"], fc=FILL)
    _vlink(ax, xs[3] + NODE_W / 2, boxes[3][2], 330, dash_off)
    _tag(ax, xs[3] + NODE_W / 2 + 23, k7.GIF_H - 312, "NO", BAD)
    _tag(ax, (xs[3] + NODE_W + xs[4]) / 2, _center(boxes[0]) - 17, "YES", OK)

    _details(ax, 500, [
        (["enterprise-", "parsers.js"], ["OOXML, .eml,", "RIFF, ISOBMFF"]),
        (["structure-", "extractor.js"], ["CMap tiles,", "cactus.wasm OCR"]),
        (["media.wasm"], ["NFKC, TR39,", "Luhn/IBAN/SSN"]),
        (["gatekeeper.js"], ["520-d logistic,", "BinomCDF gate"]),
        (["markdown +", "sftJsonl"], ["chunks, receipt"]),
    ])
    return fig


# --- Paper 2 (multimodal): what data should keep out -----------------------
def draw_paper2(seed, dash_off):
    _seed(seed)
    k7.GIF_H = 660
    fig, ax = _canvas()
    _sidebar(ax, "Paper 2", "what data\nshould keep out")
    boxes = _pipeline(ax, [
        (_icon_envelope, ["Enterprise", "containers"], ["mail, Office,", "audio, video"], FILL),
        (_icon_shield, ["media.wasm"], ["zero-import", "parsers + secrets"], FILL),
        (_icon_lock, ["SR-MP ring"], ["512 salted", "sketch anchors"], YELLOW),
        (_icon_graph, ["HC-CRC gate"], ["cluster-robust", "risk bound"], SIDE),
        (_icon_plates, ["Release", "decision"], ["redacted media,", "certificate"], FILL),
    ], dash_off)
    xs = [X0 + i * (NODE_W + NODE_GAP) for i in range(5)]

    # Branches under the stages that make decisions.
    _node(ax, xs[0], 330, NODE_W, _icon_plates,
          ["Archive paths"], ["sanitize_archive_path"], fc=FILL)
    _vlink(ax, xs[0] + NODE_W / 2, boxes[0][2], 330, dash_off)
    _node(ax, xs[2], 330, NODE_W, k7._icon_lock, ["Ring hit"], ["reuse HMAC id"], fc=YELLOW)
    _vlink(ax, xs[2] + NODE_W / 2, boxes[2][2], 330, dash_off)
    _node(ax, xs[3], 330, NODE_W, k7._icon_cross, ["ABSTAIN"], ["no certificate"], fc=FILL)
    _vlink(ax, xs[3] + NODE_W / 2, boxes[3][2], 330, dash_off)
    _tag(ax, xs[3] + NODE_W / 2 + 24, k7.GIF_H - 312, "NO", BAD)
    _tag(ax, (xs[3] + NODE_W + xs[4]) / 2, _center(boxes[0]) - 17, "YES", OK)
    _tag(ax, 881, k7.GIF_H - 86, "online default", OK)

    # AC-CRC: opt-in offline audit beside the online default gate.
    _detail(ax, 1000, 585, ["AC-CRC (opt-in", "offline audit)"],
            ["dual-channel e-value"], w=150)
    # Drop out of the gate's lower flank and run down the gap right of the
    # branch box, so the route never crosses the "YES" keep-branch label.
    _link_pts(ax, [(xs[3] + NODE_W + 6, _center(boxes[3]) - 40),
                   (986, _center(boxes[3]) - 40),
                   (986, k7.GIF_H - 617),
                   (997, k7.GIF_H - 617)], dash_off)
    _tag(ax, 1002, k7.GIF_H - 320, "OPT-IN, OFFLINE", OK)

    # Streaming loop: the next container re-enters the kernel from below, on the
    # open lane under the branch boxes, so it crosses neither box nor arrow.
    _link_pts(ax, [(xs[4] + NODE_W / 2, k7.GIF_H - boxes[4][2]),
                   (xs[4] + NODE_W / 2, k7.GIF_H - 470),
                   (xs[1] + NODE_W / 2, k7.GIF_H - 470),
                   (xs[1] + NODE_W / 2, k7.GIF_H - boxes[1][2])], dash_off)
    _tag(ax, 700, k7.GIF_H - 482, "next container", BAD)

    _details(ax, 500, [
        (["enterprise-", "parsers.js"], [".msg, .pptx,", ".xlsx, ISOBMFF"]),
        (["media.wasm"], ["DEFLATE, Zip-Slip,", "PPRL signature"]),
        (["srmp_seed_", "anchor"], ["512 slots,", "128-bit sketch"]),
        (["gatekeeper.js"], ["Kish DEFF,", "Ville E-LTT"]),
        (["release or", "ABSTAIN"], ["certificate +", "forensic counts"]),
    ])
    return fig


# --- Paper 3: what data should carry ---------------------------------------
def draw_paper3(seed, dash_off):
    _seed(seed)
    k7.GIF_H = 640
    fig, ax = _canvas()
    _sidebar(ax, "Paper 3", "what data\nshould carry")

    top = [
        (_icon_envelope, ["Redacted", "corpus"], ["matched raw/", "safe pairs"], FILL),
        (_icon_shield, ["PT-LM"], ["mask placeholder", "loss spans"], YELLOW),
        (_icon_gradcap, ["LoRA SFT"], ["0.5B-1.7B,", "8 GB GPU"], FILL),
    ]
    xs = [X0, X0 + NODE_W + NODE_GAP, X0 + 2 * (NODE_W + NODE_GAP)]
    boxes = [_node(ax, xs[i], Y_TOP, NODE_W, *t[:3], fc=t[3]) for i, t in enumerate(top)]
    y = _center(boxes[0])
    _link_h(ax, xs[0] + NODE_W, xs[1], y, dash_off, 1)
    _link_h(ax, xs[1] + NODE_W, xs[2], y, dash_off, 2)

    # IB-PT-LM: an exploratory offshoot of PT-LM, off the main path.
    _detail(ax, 421, 425, ["IB-PT-LM", "(exploratory)"],
            ["disjoint surrogate", "pools + symmetric KL,", "beta=0.2, ~2.05x cost"],
            w=160)
    _vlink(ax, xs[1] + NODE_W / 2, boxes[1][2], 425, dash_off)
    _tag(ax, 560, k7.GIF_H - 333, "EXPLORATORY", BAD)

    # Held-out QA shares the top row so all four stages sit on one line and the
    # LoRA -> QA link is a short in-row hop with badge 3 in the gap.
    qa = _node(ax, 850, Y_TOP, 200, _icon_plates, ["Held-out QA"],
               ["two blind", "judges"], fc=FILL)
    _link_h(ax, xs[2] + NODE_W, 850, _center(boxes[2]), dash_off, 3)

    ret = _node(ax, xs[2], 350, NODE_W, _icon_magnifier,
                ["Graph-PPR", "retrieval"], ["pprRetrieve,", "15 iterations"], fc=SIDE)
    ret_c = _center(ret)
    # Retrieval answers QA: out of the right edge, up into QA's bottom centre.
    _link_pts(ax, [(xs[2] + NODE_W + 4, ret_c),
                   (950, ret_c),
                   (950, k7.GIF_H - qa[2])], dash_off, badge=4,
              badge_at=(950, (ret_c + (k7.GIF_H - qa[2])) / 2))
    # Corpus feeds retrieval directly: the zero-training arm skips PT-LM and SFT.
    _link_pts(ax, [(xs[0] + NODE_W / 2, k7.GIF_H - boxes[0][2]),
                   (xs[0] + NODE_W / 2, k7.GIF_H - 315),
                   (xs[2] + NODE_W / 2, k7.GIF_H - 315),
                   (xs[2] + NODE_W / 2, k7.GIF_H - 350)], dash_off)
    _tag(ax, 365, k7.GIF_H - 300, "NO RETRAIN", OK)

    # Judge refuses the answer: rewrite the query and retrieve again.
    _link_pts(ax, [(1010, k7.GIF_H - qa[2]),
                   (1010, k7.GIF_H - 460),
                   (xs[2] + NODE_W + 4, k7.GIF_H - 460)], dash_off)
    _tag(ax, 935, k7.GIF_H - 474, "NO: re-query", BAD)

    _details(ax, 530, [
        (["matched pairs"], ["assistant-only", "loss"]),
        (["computePtlm", "MaskedSpans"], ["labels[t] = -100", "+ surrogates"]),
        (["PEFT LoRA"], ["80 steps,", "seed 42"]),
    ])
    return fig


# --- The premise: scattered data to one model ------------------------------
def draw_data(seed, dash_off):
    _seed(seed)
    k7.GIF_H = 600
    fig, ax = _canvas()
    _sidebar(ax, "Versieve", "scattered data,\none model")

    def chip(x, y_top, w, h, title, sub=None, fc=FILL):
        y = k7.GIF_H - y_top - h
        ax.add_patch(FancyBboxPatch((x, y), w, h,
                                    boxstyle="round,pad=0,rounding_size=9",
                                    facecolor=fc, edgecolor="none", zorder=2))
        k7._stroke(ax, k7._rrect_pts(x, y, w, h, 9), lw=1.9, close=True)
        if sub:
            _txt(ax, x + w / 2, y + h - 13, title, 10.6, bold=True, va="top")
            _txt(ax, x + w / 2, y + 11, sub, 8.8, va="bottom")
        else:
            _txt(ax, x + w / 2, y + h / 2, title, 10.4, bold=True)

    src = ["SQL", "CSV", "Email", "Transcripts", "Audio", "Decks"]
    sw, sg = 133, 18
    for i, name in enumerate(src):
        chip(X0 + i * (sw + sg), 84, sw, 64, name)

    bar_x, bar_w = X0, 888
    chip(bar_x, 210, bar_w, 86, "Perceive: 5 zero-import WASM kernels",
         "clean · media · graph · dl · sql")
    chip(bar_x, 330, bar_w, 86, "Vault and resolve identity",
         "salted placeholders · HMAC entity ids · per-sample provenance")

    _vlink(ax, bar_x + bar_w / 2, 148, 210, dash_off)
    _vlink(ax, bar_x + bar_w / 2, 296, 330, dash_off)

    cw, cg = 196, 36
    outs = [
        ("SFT corpora", "PT-LM JSONL", FILL),
        ("Graph-PPR", "pprRetrieve", FILL),
        ("CAG caches", "KV prefill", FILL),
        ("eraseEntity", "minus one entity", SIDE),
    ]
    for j, (title, sub, fc) in enumerate(outs):
        x = X0 + j * (cw + cg)
        chip(x, 460, cw, 78, title, sub, fc=fc)
        _vlink(ax, x + cw / 2, 416, 460, dash_off)
    return fig


SCENES = [
    ("architecture-a-extraction.gif", draw_paper1, True),
    ("architecture-d-multimodal.gif", draw_paper2, True),
    ("architecture-c-training.gif", draw_paper3, True),
    ("versieve-data-architecture.gif", draw_data, False),
]


def _check(fig, strict_width=True):
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    for t in fig.axes[0].texts:
        bb = t.get_window_extent(rend)
        assert bb.x0 >= 0 and bb.x1 <= k7.GIF_W, f"text off canvas: {t.get_text()!r}"
        assert bb.y0 >= 0 and bb.y1 <= k7.GIF_H, f"text off canvas: {t.get_text()!r}"
        if strict_width and t.get_fontsize() <= 10.9:
            assert bb.width <= TEXT_MAX, \
                f"text wider than node: {t.get_text()!r} {bb.width:.1f}px"


def build(name, draw, strict_width):
    from PIL import Image

    frames_dir = OUT_DIR / "_gif_frames"
    frames_dir.mkdir(exist_ok=True)
    paths = []
    for f in range(FRAMES):
        # Three dash periods per cycle: the 6.6 px/frame march reads as motion
        # while the border-flush dash alignment stays phase-stable.
        fig = draw(20251125 + f, (3 * DASH_PERIOD) * f / FRAMES)
        _check(fig, strict_width)
        p = frames_dir / f"{name}_{f}.png"
        fig.savefig(p, dpi=100)
        plt.close(fig)
        paths.append(p)
    ims = [Image.open(p).convert("RGB") for p in paths]
    pal = ims[0].quantize(colors=64)
    qims = [im.quantize(palette=pal, dither=Image.NONE) for im in ims]
    dest = DOCS_DIR / name
    qims[0].save(dest, save_all=True, append_images=qims[1:],
                 duration=[DUR_MS] * FRAMES, loop=0, optimize=True, disposal=2)
    shutil.rmtree(frames_dir)
    print(f"Wrote docs/{name} ({dest.stat().st_size} B, {k7.GIF_W}x{k7.GIF_H})")


if __name__ == "__main__":
    DOCS_DIR.mkdir(exist_ok=True)
    for name, draw, strict in SCENES:
        build(name, draw, strict)
