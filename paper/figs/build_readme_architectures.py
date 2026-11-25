"""README architecture GIFs for Papers 1-3 in the hand-drawn register.

Paper 4's animation is build_k7_architecture.build_gif(). This module reuses
that file's primitives so all four read as one set: same canvas width, same
wobbly stroke, same dash-march loop. Seeded, reproducible.

Each scene is a pipeline plus a receipts row of measured values, so the canvas
height is per-scene and hugs the content instead of leaving empty space.
"""
from pathlib import Path
import random
import shutil

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon

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
DUR_MS = 30
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
    """Dashed polyline source-first; arrowhead on the last segment."""
    _dashed(ax, list(reversed(pts)), dash_off)
    dx = pts[-1][0] - pts[-2][0]
    dy = pts[-1][1] - pts[-2][1]
    _arrow_head(ax, pts[-1], (dx, dy))
    if badge is not None:
        if badge_at is None:
            a, b = pts[-2], pts[-1]
            badge_at = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 18)
        _badge(ax, badge_at[0], badge_at[1], badge)


def _pipeline(ax, nodes, dash_off):
    xs = [X0 + i * (NODE_W + NODE_GAP) for i in range(len(nodes))]
    boxes = []
    for i, (icon, title, sub, fc) in enumerate(nodes):
        boxes.append(_node(ax, xs[i], Y_TOP, NODE_W, icon, title, sub, fc=fc))
    y = _center(boxes[0])
    for i in range(len(nodes) - 1):
        _link_h(ax, xs[i] + NODE_W, xs[i + 1], y, dash_off, i + 1)
    return boxes


def _card(ax, x, y_top, value, label, fc=FILL, w=NODE_W):
    """Receipt card: one measured value over its caption."""
    pad = 12
    n_lines = len(label) if isinstance(label, list) else label.count("\n") + 1
    h = pad + 22 + 7 + 15.5 * n_lines + pad
    y = k7.GIF_H - y_top - h
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                                boxstyle="round,pad=0,rounding_size=9",
                                facecolor=fc, edgecolor="none", zorder=2))
    k7._stroke(ax, k7._rrect_pts(x, y, w, h, 9), lw=1.6, close=True)
    _txt(ax, x + w / 2, y + h - pad, value, 14.0, bold=True, va="top")
    _txt(ax, x + w / 2, y + pad - 1,
         label if isinstance(label, str) else "\n".join(label), 8.6, va="bottom")
    return y + h, y_top, y_top + h, h


def _receipts(ax, y_top, cards):
    xs = [X0 + i * (NODE_W + NODE_GAP) for i in range(len(cards))]
    for x, (value, label) in zip(xs, cards):
        _card(ax, x, y_top, value, label)


# --- Paper 1: what data should lose ----------------------------------------
def draw_paper1(seed, dash_off):
    _seed(seed)
    k7.GIF_H = 520
    fig, ax = _canvas()
    _sidebar(ax, "Paper 1", "what data\nshould lose")
    _pipeline(ax, [
        (_icon_envelope, ["Source", "files"], ["PDF, forms,", "text, 1,207 docs"], FILL),
        (_icon_magnifier, ["Deterministic", "extraction"], ["CMap + 512 px", "overlapping tiles"], FILL),
        (_icon_shield, ["Redaction", "layer"], ["regex +", "334-word lexicon"], YELLOW),
        (_icon_lock, ["LTT gate"], ["certified risk,", "fails closed"], FILL),
        (_icon_plates, ["Clean", "handoff"], ["Markdown,", "SFT JSONL"], FILL),
    ], dash_off)
    _receipts(ax, 352, [
        ("1,207 docs", "FUNSD, PMC,\nPubMedQA, ai4privacy"),
        ("8/8 PDFs", "209.02 ms,\nno raster OCR"),
        ("2.72x", "fewer Title-Case\nfalse positives"),
        ("0.0%", "conditional FPR\n(14.63% before)"),
        ("0 B", "network egress\nper run"),
    ])
    return fig


# --- Paper 2 (multimodal): what data should keep out -----------------------
def draw_paper2(seed, dash_off):
    _seed(seed)
    k7.GIF_H = 520
    fig, ax = _canvas()
    _sidebar(ax, "Paper 2", "what data\nshould keep out")
    _pipeline(ax, [
        (_icon_envelope, ["Enterprise", "containers"], ["mail, Office,", "audio, video"], FILL),
        (_icon_shield, ["media.wasm"], ["zero-import", "parsers + secrets"], FILL),
        (_icon_lock, ["SR-MP ring"], ["512 salted", "sketch anchors"], YELLOW),
        (_icon_graph, ["HC-CRC gate"], ["cluster-robust", "risk bound"], SIDE),
        (_icon_plates, ["Release", "decision"], ["redacted media,", "certificate"], FILL),
    ], dash_off)
    _receipts(ax, 352, [
        ("TAB", "127 ECHR\nrulings"),
        ("204,031 B", "29 exports,\n0 imports"),
        ("16 KB", "512 salted\nslots"),
        ("8.19%", "held-out FPR,\nα = 10%"),
        ("8.25%", "audio leak,\nwas 94.85%"),
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

    qa = _node(ax, 850, 170, 200, _icon_plates, ["Held-out QA"], ["two blind", "judges"], fc=FILL)
    lora_right = xs[2] + NODE_W
    _link_pts(ax, [(lora_right + 6, _center(boxes[2])),
                   (846, _center(qa))], dash_off, badge=3,
              badge_at=(806, (_center(boxes[2]) + _center(qa)) / 2))

    ret = _node(ax, xs[2], 350, NODE_W, _icon_magnifier,
                ["Graph-PPR", "retrieval"], ["no training,", "stronger default"], fc=SIDE)
    _link_pts(ax, [(xs[2] + NODE_W + 4, _center(ret)),
                   (950, _center(ret)),
                   (950, k7.GIF_H - qa[2])], dash_off, badge=4,
              badge_at=(950, (_center(ret) + k7.GIF_H - qa[2]) / 2))
    # Corpus feeds retrieval directly: the zero-training arm skips PT-LM and SFT.
    _link_pts(ax, [(xs[0] + NODE_W / 2, k7.GIF_H - boxes[0][2]),
                   (xs[0] + NODE_W / 2, k7.GIF_H - 325),
                   (xs[2] + NODE_W / 2, k7.GIF_H - 325),
                   (xs[2] + NODE_W / 2, k7.GIF_H - 350)], dash_off)
    _receipts(ax, 520, [
        ("0/210", "placeholder echoes\nafter PT-LM"),
        ("+0.194", "seen-doc F1,\nQwen 0.5B"),
        ("p=0.0005", "Graph-PPR beats\nevery LoRA arm"),
    ])
    return fig


SCENES = [
    ("architecture-a-extraction.gif", draw_paper1),
    ("architecture-d-multimodal.gif", draw_paper2),
    ("architecture-c-training.gif", draw_paper3),
]


def _check(fig):
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    for t in fig.axes[0].texts:
        bb = t.get_window_extent(rend)
        assert bb.x0 >= 0 and bb.x1 <= k7.GIF_W, f"text off canvas: {t.get_text()!r}"
        assert bb.y0 >= 0 and bb.y1 <= k7.GIF_H, f"text off canvas: {t.get_text()!r}"
        if t.get_fontsize() <= 10.9:
            assert bb.width <= TEXT_MAX, \
                f"text wider than node: {t.get_text()!r} {bb.width:.1f}px"


def build(name, draw):
    from PIL import Image

    frames_dir = OUT_DIR / "_gif_frames"
    frames_dir.mkdir(exist_ok=True)
    paths = []
    for f in range(FRAMES):
        fig = draw(20251125 + f, DASH_PERIOD * f / FRAMES)
        _check(fig)
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
    for name, draw in SCENES:
        build(name, draw)
