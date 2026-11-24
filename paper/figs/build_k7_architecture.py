"""Generate the Paper 4 architecture diagram (vector PDF + staging GIF for the README)."""
from pathlib import Path
import shutil
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
from numpy import linspace

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


def self_check():
    """Machine-verify title fit and bypass-arrow clearance in data coords."""
    # 1) Perception box title fits inside the drawn borders with margin.
    fig = draw_diagram(2)
    ax = fig.axes[0]
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    title = [t for t in ax.texts if t.get_text().startswith("Perception")][0]
    tb = title.get_window_extent(rend)
    px, py, pw, _ = BOXES["perc"]
    left = ax.transData.transform((px + PAD, 0))[0]
    right = ax.transData.transform((px + pw - PAD, 0))[0]
    margin = min(tb.x0 - left, right - tb.x1)
    plt.close(fig)
    assert margin > 4.0, f"perception title overflow: margin {margin:.1f}px"
    # 2) Bypass arrow starts on the graph box's bottom border, clears the seams
    #    box entirely (stays below its bottom border - clearance), and enters
    #    eraseEntity at its left edge. FancyArrowPatch.get_path() is in mutation
    #    coords, so sample the arc3 curve directly (control = mid + rad*(-dy, dx)).
    fig = draw_diagram(5, erasure="final")
    ax = fig.axes[0]
    fig.canvas.draw()
    gx, gy, gw, _ = BOXES["graph"]
    sx, sy, sw, _ = BOXES["seams"]
    arrs = [p for p in ax.patches
            if isinstance(p, FancyArrowPatch)
            and abs(p._posA_posB[0][0] - (gx + 0.46)) < 1e-9
            and abs(p._posA_posB[0][1] - (gy - PAD)) < 1e-9]
    assert len(arrs) == 1, "bypass arrow not found"
    (x1, y1), (x2, y2) = arrs[0]._posA_posB
    assert abs(y1 - (gy - PAD)) < 1e-9, f"start not on border: {y1}"
    rad = arrs[0].get_connectionstyle().rad
    t = linspace(0.0, 1.0, 200)
    cx = (x1 + x2) / 2 + rad * -(y2 - y1)
    cy = (y1 + y2) / 2 - rad * (x2 - x1)
    xs = (1 - t) ** 2 * x1 + 2 * (1 - t) * t * cx + t ** 2 * x2
    ys = (1 - t) ** 2 * y1 + 2 * (1 - t) * t * cy + t ** 2 * y2
    seg = ys[(xs > sx - PAD) & (xs < sx + sw + PAD)]
    assert len(seg) and seg.max() < sy - PAD - 0.05, \
        f"bypass crosses seams box: max y {seg.max():.2f} vs bottom {sy - PAD:.2f}"
    assert x2 == CONS_X - PAD and abs(y2 - 0.70) < 1e-9, "bypass does not enter eraseEntity left edge"
    plt.close(fig)
    print(f"self-check ok: title margin {margin:.1f}px, bypass clear (max y {seg.max():.2f} < {sy - PAD:.2f})")


def build_pdf_and_preview():
    fig = draw_diagram(5, erasure="final")
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
