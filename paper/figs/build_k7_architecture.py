"""Generate the Paper 4 architecture diagram (vector PDF + staging GIF for the README).

Two layouts live here:
  - draw_diagram(): the original 5-column storyboard. Feeds only the README GIF
    frames (build_gif); must stay byte-stable so the GIF regenerates identically.
  - draw_compact(): the small one-column pipeline figure for the paper PDF/PNG.
"""
from pathlib import Path
import shutil
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUT_DIR.parent.parent / "docs"

BLUE = "#1D4ED8"
BLUE_BG = "#EFF6FF"
BLUE_BORDER = "#93C5FD"
TEAL = "#0F766E"
TEAL_BG = "#F0FDFA"
TEAL_BORDER = "#5EEAD4"
CORAL = "#C2410C"
CORAL_BG = "#FFF7ED"
CORAL_BORDER = "#FDBA74"
SLATE = "#475569"
SLATE_BG = "#F8FAFC"
SLATE_BORDER = "#CBD5E1"
RED = "#B91C1C"
RED_BG = "#FEF2F2"
RED_BORDER = "#FCA5A5"
INK = "#0F172A"
SUB = "#334155"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})


def draw_box(ax, x, y, w, h, title, lines, fc, ec, title_color, title_size=7.2, body_size=6.2, lw=1.1):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.04,rounding_size=0.14",
        facecolor=fc, edgecolor=ec, linewidth=lw, zorder=3,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2, y + h - 0.14, title,
        ha="center", va="top", fontsize=title_size, fontweight="bold",
        color=title_color, zorder=4,
    )
    # Subtle divider under title
    ax.plot([x + 0.14, x + w - 0.14], [y + h - 0.42, y + h - 0.42], color=ec, linewidth=0.6, alpha=0.7, zorder=4)
    body = "\n".join(lines)
    ax.text(
        x + w / 2, y + (h - 0.44) / 2 + 0.01, body,
        ha="center", va="center", fontsize=body_size, color=SUB,
        linespacing=1.35, zorder=4,
    )


def draw_arrow(ax, x1, y1, x2, y2, color="#475569", lw=1.3, rad=0.0, ls="-"):
    arr = FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle="-|>", mutation_scale=10,
        color=color, linewidth=lw, linestyle=ls,
        connectionstyle=f"arc3,rad={rad}", zorder=5,
    )
    ax.add_patch(arr)


# Layout coordinates (data units, 1.55 units == 1 inch at figsize 10x4.2):
#   col1 documents x 0.22 w 2.20 | col2 perception x 2.78 w 2.80
#   (widened so the two-line title fits inside the borders with margin)
#   col3 graph x 5.94 w 2.70 (emphasized) | col4 seams x 9.00 w 2.34
#   col5 consumers x 12.18 w 3.10, four boxes h 1.10 spaced 1.40 (y 4.65 / 3.25 / 1.85 / 0.45)
#   erasure bypass arrow starts exactly on the graph box's visual bottom border
#   (rounding pad shifts the drawn border down by 0.04) and sags through the
#   bottom band below the corpus-seams column into eraseEntity's left edge.
X_LIM, Y_LIM = 15.5, 6.5
Y0, H = 1.05, 4.70
PAD = 0.04  # FancyBboxPatch boxstyle pad: visual border sits PAD outside the (x, y, w, h) rect
BOXES = {
    "docs": (0.22, Y0, 2.20, H),
    "perc": (2.78, Y0, 2.80, H),
    "graph": (5.94, 0.95, 2.70, 4.90),
    "seams": (9.00, Y0, 2.34, H),
}
CONS_X, CONS_W, CONS_H, CONS_STEP = 12.18, 3.10, 1.10, 1.40
CONS = [
    ("SFT training", ["LoRA adapter", "(sealed retrain recipe)"]),
    ("Graph-PPR retrieval", ["top-6 contexts to", "base model (RAG)"]),
    ("CAG caches", ["prefill KV cache: fixed set-cover", "per-question identity-keyed"]),
    ("eraseEntity", ["regenerate minus one entity,", "byte-diff receipt"]),
]
CONS_PAL = [
    (SLATE_BG, SLATE_BORDER, INK),
    (BLUE_BG, BLUE_BORDER, BLUE),
    (BLUE_BG, BLUE_BORDER, BLUE),
    (RED_BG, RED_BORDER, RED),
]


def draw_diagram(stage, erasure=None):
    """stage 1..5 = columns revealed so far; erasure None|'highlight'|'final'."""
    fig, ax = plt.subplots(figsize=(10, 4.2))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    ax.set_xlim(0, X_LIM)
    ax.set_ylim(0, Y_LIM)
    ax.axis("off")
    ax.text(
        X_LIM / 2, 6.28,
        "Estate Documents → One Resolved Entity Graph → Every Consumer",
        ha="center", va="center", fontsize=7.2, fontweight="bold", color=INK, zorder=6,
    )

    if stage >= 1:
        x, y, w, h = BOXES["docs"]
        draw_box(ax, x, y, w, h, "Estate documents", [
            "SQL dumps", "CSV rosters", "Email (.eml)", "Transcripts (VTT)",
            "Audio (PCM16)", "Decks (.pptx)",
        ], fc=SLATE_BG, ec=SLATE_BORDER, title_color=INK, body_size=6.0)
    if stage >= 2:
        x1, _, w1, _ = BOXES["docs"]
        x2, _, _, _ = BOXES["perc"]
        draw_arrow(ax, x1 + w1 + PAD, 3.40, x2 - PAD, 3.40, color=SLATE)
        x, y, w, h = BOXES["perc"]
        draw_box(ax, x, y, w, h, "Perception:\n5 zero-import WASM kernels", [
            "clean / SQL / graph / DL / media",
            "zero host imports",
            "0 B egress (traps armed)",
            "detect + mask + conformal gate",
        ], fc=BLUE_BG, ec=BLUE_BORDER, title_color=BLUE, body_size=6.0)
    if stage >= 3:
        x2, _, w2, _ = BOXES["perc"]
        x3, _, _, _ = BOXES["graph"]
        draw_arrow(ax, x2 + w2 + PAD, 3.40, x3 - PAD, 3.40, color=BLUE)
        x, y, w, h = BOXES["graph"]
        draw_box(ax, x, y, w, h, "Vaulted entity graph", [
            "salted placeholders (vault)",
            "stable HMAC entity ids",
            "per-sample provenance",
            "byte ranges",
            "per-sample certificates",
            "entity index: entity <-> samples",
        ], fc=TEAL_BG, ec=TEAL, title_color=TEAL, title_size=7.4, body_size=6.0, lw=1.6)
    if stage >= 4:
        x3, _, w3, _ = BOXES["graph"]
        x4, _, _, _ = BOXES["seams"]
        draw_arrow(ax, x3 + w3 + PAD, 3.40, x4 - PAD, 3.40, color=TEAL)
        x, y, w, h = BOXES["seams"]
        draw_box(ax, x, y, w, h, "Corpus seams\n(deterministic)", [
            "per-block JSONL",
            "composed per-entity records",
            "identity-contrastive pairs",
            "views: vaulted | readable",
        ], fc=CORAL_BG, ec=CORAL_BORDER, title_color=CORAL, body_size=5.8)
    if stage >= 5:
        seams_x, _, seams_w, _ = BOXES["seams"]
        for i, (title, lines) in enumerate(CONS):
            y = 4.65 - i * CONS_STEP
            yc = y + CONS_H / 2
            draw_arrow(ax, seams_x + seams_w + PAD, yc, CONS_X - PAD, yc, color=CORAL)
            fc, ec, tc = CONS_PAL[i]
            draw_box(ax, CONS_X, y, CONS_W, CONS_H, title, lines,
                     fc=fc, ec=ec, title_color=tc, title_size=6.4, body_size=5.6, lw=1.1)
    if erasure is not None:
        color = RED if erasure == "highlight" else TEAL
        lw = 1.7 if erasure == "highlight" else 1.2
        gx, gy, gw, _ = BOXES["graph"]
        # Start exactly on the drawn bottom border (visual edge = y - PAD), sag below
        # the seams box. arc3 control point: cy = y_mid - rad*dx, so positive rad sags DOWN.
        draw_arrow(ax, gx + 0.46, gy - PAD, CONS_X - PAD, 0.70, color=color, lw=lw, rad=0.07)
        ax.text(
            9.30, 0.22, "names the spans to remove",
            fontsize=5.8, color=color, ha="center", va="center", style="italic",
            bbox=dict(boxstyle="round,pad=0.14", fc="white", ec="none", alpha=0.92), zorder=6,
        )

    fig.subplots_adjust(left=0.005, right=0.995, top=0.995, bottom=0.005)
    return fig


# ---------------------------------------------------------------------------
# Compact one-column layout (paper PDF/PNG only)
# ---------------------------------------------------------------------------
# Data coords: 100 x 50 units on a 3.28 x 1.64 in canvas -> 1 unit = 2.36 pt,
# so the ~236 pt natural width renders ~1:1 at the paper's \columnwidth (227 pt).
CLIM_X, CLIM_Y = 100.0, 50.0
CMARGIN, CGAP = 1.0, 3.2
CW = (CLIM_X - 2 * CMARGIN - 3 * CGAP) / 4  # 22.1 units ~ 52 pt per box
CBX = [CMARGIN + i * (CW + CGAP) for i in range(4)]
CTOP_Y, CTOP_H = 25.0, 17.0
CCHIP_Y, CCHIP_H = 5.0, 10.0
CTOP = [
    ("Estate\ndocuments", [], SLATE_BG, SLATE_BORDER, INK, 1.0),
    ("Perception", ["5 WASM kernels,", "zero egress"], BLUE_BG, BLUE_BORDER, BLUE, 1.0),
    ("Vaulted\nentity graph", ["salted", "entity ids"], TEAL_BG, TEAL, TEAL, 1.7),
    ("Deterministic\ncorpus", ["entity-indexed", "rows"], CORAL_BG, CORAL_BORDER, CORAL, 1.0),
]
CCHIPS = ["SFT corpora", "Graph-PPR", "CAG caches", "eraseEntity"]
CCHIP_PAL = [
    (SLATE_BG, SLATE_BORDER, INK),
    (BLUE_BG, BLUE_BORDER, BLUE),
    (BLUE_BG, BLUE_BORDER, BLUE),
    (RED_BG, RED_BORDER, RED),
]


def draw_mini_box(ax, x, y, w, h, title, subs, fc, ec, tc, lw=1.0, tsize=6.3, ssize=5.3):
    ax.add_patch(FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.0,rounding_size=1.8",
        facecolor=fc, edgecolor=ec, linewidth=lw, zorder=3,
    ))
    if subs:
        ax.text(x + w / 2, y + h - 1.6, title, ha="center", va="top",
                fontsize=tsize, fontweight="bold", color=tc, linespacing=1.25, zorder=4)
        ax.text(x + w / 2, y + 1.7, "\n".join(subs), ha="center", va="bottom",
                fontsize=ssize, color=SUB, linespacing=1.35, zorder=4)
    else:
        ax.text(x + w / 2, y + h / 2, title, ha="center", va="center",
                fontsize=tsize, fontweight="bold", color=tc, linespacing=1.25, zorder=4)


def draw_arrow_c(ax, x1, y1, x2, y2, color=SLATE, lw=1.0, scale=5.0):
    ax.add_patch(FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle="-|>", mutation_scale=scale,
        color=color, linewidth=lw, zorder=2,
    ))


def draw_compact():
    fig, ax = plt.subplots(figsize=(3.28, 1.64))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    ax.set_xlim(0, CLIM_X)
    ax.set_ylim(0, CLIM_Y)
    ax.axis("off")
    ax.text(CLIM_X / 2, 47.6, "One graph, every consumer",
            ha="center", va="center", fontsize=7.0, fontweight="bold", color=INK, zorder=6)
    mid = CTOP_Y + CTOP_H / 2
    for i, c in enumerate([SLATE, BLUE, TEAL]):
        draw_arrow_c(ax, CBX[i] + CW, mid, CBX[i + 1], mid, color=c)
    for i, (title, subs, fc, ec, tc, lw) in enumerate(CTOP):
        draw_mini_box(ax, CBX[i], CTOP_Y, CW, CTOP_H, title, subs, fc, ec, tc, lw=lw)
    gxc = CBX[3] + CW / 2
    for i, name in enumerate(CCHIPS):
        fc, ec, tc = CCHIP_PAL[i]
        color = RED if name == "eraseEntity" else CORAL
        draw_arrow_c(ax, gxc, CTOP_Y, CBX[i] + CW / 2, CCHIP_Y + CCHIP_H, color=color)
        draw_mini_box(ax, CBX[i], CCHIP_Y, CW, CCHIP_H, name, [], fc, ec, tc,
                      lw=1.2 if name == "eraseEntity" else 0.9, tsize=5.8)
    fig.subplots_adjust(left=0.005, right=0.995, top=0.995, bottom=0.005)
    return fig


def self_check():
    """Machine-verify the compact layout: every box text fits its box interior."""
    fig = draw_compact()
    ax = fig.axes[0]
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    inv = ax.transData.inverted()

    def data_bb(t):
        bb = t.get_window_extent(rend)
        (x0, y0), (x1, y1) = inv.transform((bb.x0, bb.y0)), inv.transform((bb.x1, bb.y1))
        return min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1)

    rects = ([(CBX[i], CTOP_Y, CW, CTOP_H) for i in range(4)]
             + [(CBX[i], CCHIP_Y, CW, CCHIP_H) for i in range(4)])
    hosts = 0
    titles = 0
    for t in ax.texts:
        x0, y0, x1, y1 = data_bb(t)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        host = [r for r in rects if r[0] < cx < r[0] + r[2] and r[1] < cy < r[1] + r[3]]
        if not host:
            titles += 1
            assert x0 > 0.5 and x1 < CLIM_X - 0.5, f"title overflow: {t.get_text()!r}"
            assert y0 > CTOP_Y + CTOP_H, "title collides with top row"
            continue
        rx, ry, rw, rh = host[0]
        assert x0 > rx + 0.5 and x1 < rx + rw - 0.5, \
            (f"text wider than box: {t.get_text()[:24]!r} "
             f"{x0:.1f}..{x1:.1f} vs interior {rx + 0.5:.1f}..{rx + rw - 0.5:.1f}")
        assert y0 > ry + 0.3 and y1 < ry + rh - 0.3, \
            f"text taller than box: {t.get_text()[:24]!r} {y0:.1f}..{y1:.1f} vs {ry:.1f}..{ry + rh:.1f}"
        hosts += 1
    assert titles == 1, f"expected 1 figure title, found {titles}"
    assert hosts == 11, f"expected 11 texts hosted in boxes, found {hosts}"
    plt.close(fig)
    print(f"self-check ok: {hosts} box texts fit interiors, title clears edges")


def build_pdf_and_preview():
    fig = draw_compact()
    fig.savefig(OUT_DIR / "fig_k7_architecture.pdf")
    fig.savefig(OUT_DIR / "_preview_fig_k7_architecture.png", dpi=200)
    plt.close(fig)
    print("Wrote fig_k7_architecture.pdf + _preview_fig_k7_architecture.png")


def build_gif():
    from PIL import Image

    stages = [(1, None), (2, None), (3, None), (4, None), (5, None), (5, "highlight"), (5, "final")]
    durations = [900] * 6 + [1800]
    frames_dir = OUT_DIR / "_gif_frames"
    frames_dir.mkdir(exist_ok=True)
    paths = []
    for i, (stage, erasure) in enumerate(stages):
        fig = draw_diagram(stage, erasure=erasure)
        p = frames_dir / f"frame_{i}.png"
        fig.savefig(p, dpi=100)
        plt.close(fig)
        paths.append(p)
    ims = [Image.open(p).convert("P", palette=Image.ADAPTIVE) for p in paths]
    ims[0].save(
        DOCS_DIR / "verisieve-architecture.gif",
        save_all=True, append_images=ims[1:], duration=durations, loop=0, optimize=True, disposal=2,
    )
    shutil.rmtree(frames_dir)
    print(f"Wrote docs/verisieve-architecture.gif ({(DOCS_DIR / 'verisieve-architecture.gif').stat().st_size} B)")


if __name__ == "__main__":
    DOCS_DIR.mkdir(exist_ok=True)
    self_check()
    build_pdf_and_preview()
    build_gif()
