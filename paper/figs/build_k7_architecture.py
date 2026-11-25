"""Generate the Paper 4 architecture diagram (vector PDF + README GIF).

Two outputs live here:
  - draw_scene() + build_gif(): the hand-drawn README animation (ambient
    dash-march loop, no pop-in). Seeded, reproducible.
  - draw_compact(): the small one-column pipeline figure for the paper PDF/PNG.
    Byte-stable across runs; do not perturb.
"""
from pathlib import Path
import math
import random
import shutil
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Polygon, Circle, Ellipse

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


# ---------------------------------------------------------------------------
# README animation: hand-drawn scene, ambient dash-march loop (GIF only)
# ---------------------------------------------------------------------------
BG = "#f3f6fc"        # canvas
FILL = "#f0f2f6"      # default node fill
INK_G = "#32363e"       # charcoal ink
SIDE = "#c7d8ef"      # sidebar / resolved-graph fill
YELLOW = "#feec98"    # step badges + vaulted-values accent
PINK = "#efc0d9"      # eraseEntity fill
PINK_EDGE = "#e05a6b" # eraseEntity stroke
GREEN = "#b2f3bb"     # SFT corpora highlight
RED_X = "#e05a6b"     # cross-out icon

GIF_W, GIF_H = 1160, 750
GIF_FONT = "Comic Sans MS"  # hand-drawn register; falls back if absent
DASH = (8, 8)               # dash/gap in px
DASH_PERIOD = 16

_rng = random.Random(0)


def _rough(pts, step=11.0, amp=1.1, close=False, skip_ends=False):
    """Subdivide + perturb a polyline into a hand-drawn stroke (module RNG)."""
    out = []
    n_seg = len(pts) - 1 + (1 if close else 0)
    for i in range(n_seg):
        a, b = pts[i], pts[(i + 1) % len(pts)] if close else pts[i + 1]
        d = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(d // step))
        for k in range(n):
            t = k / n
            out.append((a[0] + (b[0] - a[0]) * t + _rng.uniform(-amp, amp),
                        a[1] + (b[1] - a[1]) * t + _rng.uniform(-amp, amp)))
    if close:
        out.append(out[0])
    else:
        out.append((pts[-1][0] + _rng.uniform(-amp, amp),
                    pts[-1][1] + _rng.uniform(-amp, amp)))
    return out


def _stroke(ax, pts, lw=2.0, color=INK_G, close=False, dashes=None, dash_off=0, skip_ends=False):
    xs, ys = zip(*_rough(pts, close=close, skip_ends=skip_ends))
    ls = (dash_off, dashes) if dashes else "-"
    ax.plot(xs, ys, color=color, lw=lw, linestyle=ls, solid_capstyle="round",
            solid_joinstyle="round", zorder=4)


def _shape(ax, pts, fc, lw=2.0, color=INK_G):
    ax.add_patch(Polygon(pts, closed=True, facecolor=fc, edgecolor="none", zorder=3))
    _stroke(ax, pts, lw=lw, color=color, close=True)


def _rrect_pts(x, y, w, h, r):
    return [
        (x + r, y + h), (x + w - r, y + h), (x + w, y + h - r), (x + w, y + r),
        (x + w - r, y), (x + r, y), (x, y + r), (x, y + h - r),
    ]


def _circle_pts(cx, cy, r, n=14):
    return [(cx + r * math.cos(2 * math.pi * k / n), cy + r * math.sin(2 * math.pi * k / n))
            for k in range(n)]


def _arc_pts(cx, cy, r, a0, a1, n=10):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def _txt(ax, x, y, s, size, bold=False, color=INK_G, va="center", ha="center", ls=1.2, z=6,
         rotation=0):
    ax.text(x, y, s, fontsize=size, fontweight="bold" if bold else "normal",
            color=color, ha=ha, va=va, linespacing=ls, fontname=GIF_FONT, zorder=z,
            rotation=rotation)


def _badge(ax, x, y, n):
    ax.add_patch(Circle((x, y), 10.5, facecolor=YELLOW, edgecolor=INK_G, lw=1.4, zorder=7))
    _txt(ax, x, y - 0.8, str(n), 8.6, bold=True, z=8)


def _arrow_head(ax, tip, direction, size=10.0, width=7.5):
    dx, dy = direction
    L = math.hypot(dx, dy)
    dx, dy = dx / L, dy / L
    bx, by = tip[0] - dx * size, tip[1] - dy * size
    px, py = -dy * width / 2, dx * width / 2
    ax.add_patch(Polygon([tip, (bx + px, by + py), (bx - px, by - py)],
                         closed=True, facecolor=INK_G, edgecolor="none", zorder=5))


def _dashed(ax, pts, dash_off, lw=1.9, z=2.5):
    # dash march moves toward pts[0], so callers order pts destination-first
    xs, ys = zip(*_rough(pts, amp=0.5, skip_ends=True))
    ax.plot(xs, ys, color=INK_G, lw=lw, linestyle=(dash_off, DASH),
            solid_capstyle="butt", zorder=z)


# --- icons (flat vector, from primitives; (cx, cy) = icon centre) -----------
def _icon_envelope(ax, cx, cy):
    _shape(ax, [(cx - 17, cy - 12), (cx + 17, cy - 12), (cx + 17, cy + 12), (cx - 17, cy + 12)], BG)
    _stroke(ax, [(cx - 15, cy + 10), (cx, cy - 2), (cx + 15, cy + 10)], lw=1.6)


def _icon_shield(ax, cx, cy):
    _shape(ax, [(cx - 14, cy + 11), (cx + 14, cy + 11), (cx + 14, cy - 4),
                (cx, cy - 13), (cx - 14, cy - 4)], BG, lw=2.2)
    _stroke(ax, [(cx - 6, cy + 2), (cx - 1.5, cy - 3.5), (cx + 7, cy - 11)], lw=2.0)


def _icon_lock(ax, cx, cy):
    _shape(ax, _rrect_pts(cx - 13, cy - 13, 26, 20, 3), BG, lw=2.0)
    _stroke(ax, _arc_pts(cx, cy + 7, 8, 0, 180), lw=2.0)
    _stroke(ax, _circle_pts(cx, cy - 3, 2.8, n=10), lw=1.6)
    _stroke(ax, [(cx, cy - 0.5), (cx, cy + 4.5)], lw=1.6, skip_ends=True)


def _icon_graph(ax, cx, cy):
    a, b, c = (cx - 12, cy - 8), (cx + 11, cy - 11), (cx - 1, cy + 10)
    _stroke(ax, [a, b], lw=1.6, skip_ends=True)
    _stroke(ax, [b, c], lw=1.6, skip_ends=True)
    _stroke(ax, [a, c], lw=1.6, skip_ends=True)
    for p in (a, b, c):
        ax.add_patch(Circle(p, 4.6, facecolor=BG, edgecolor=INK_G, lw=1.7, zorder=4))


def _icon_db(ax, cx, cy):
    _stroke(ax, [(cx - 15, cy - 9), (cx - 15, cy + 11)], lw=2.0, skip_ends=True)
    _stroke(ax, [(cx + 15, cy - 9), (cx + 15, cy + 11)], lw=2.0, skip_ends=True)
    _stroke(ax, _arc_pts(cx, cy + 11, 15, 0, 180, n=12), lw=2.0)
    _stroke(ax, _arc_pts(cx, cy + 11, 15, 180, 360, n=12), lw=2.0)
    _stroke(ax, _arc_pts(cx, cy + 2, 15, 180, 360, n=12), lw=1.2)
    _stroke(ax, _arc_pts(cx, cy - 9, 15, 180, 360, n=12), lw=2.0)


def _icon_gradcap(ax, cx, cy):
    _shape(ax, [(cx, cy + 12), (cx + 20, cy + 4), (cx, cy - 4), (cx - 20, cy + 4)], BG, lw=1.8)
    _stroke(ax, [(cx - 11, cy + 1), (cx - 11, cy - 8), (cx + 11, cy - 8), (cx + 11, cy + 1)], lw=1.8)
    _stroke(ax, [(cx + 19, cy + 4), (cx + 19, cy - 7)], lw=1.6, skip_ends=True)
    ax.add_patch(Circle((cx + 19, cy - 9), 1.8, facecolor=INK_G, edgecolor="none", zorder=4))


def _icon_magnifier(ax, cx, cy):
    _stroke(ax, _circle_pts(cx - 2.5, cy + 2.5, 10), lw=2.2, close=True)
    _stroke(ax, [(cx + 5, cy - 5), (cx + 16, cy - 16)], lw=3.2, skip_ends=True)


def _icon_plates(ax, cx, cy):
    for y in (9, 0, -9):
        _stroke(ax, _rrect_pts(cx - 16, cy + y - 4.5, 32, 9, 3.5), lw=1.8, close=True)


def _icon_cross(ax, cx, cy):
    _stroke(ax, [(cx - 12, cy - 12), (cx + 12, cy + 12)], lw=3.2, color=RED_X)
    _stroke(ax, [(cx - 12, cy + 12), (cx + 12, cy - 12)], lw=3.2, color=RED_X)


def _node(ax, x, y_top, w, icon_fn, title, sub, fc=FILL, ec=INK_G, edge_lw=2.0):
    """Box hugging its content; y_top is the top edge in canvas coords (y grows down).

    Returns (mpl_top, canvas_top, canvas_bottom, h)."""
    tpad, ip, tgap, sgap, bpad = 16, 36, 9, 9, 16
    h = tpad + ip + tgap + 18.5 * len(title) + (sgap + 15.5 * len(sub) if sub else 0) + bpad
    y = GIF_H - y_top - h  # mpl y-up bottom
    ax.add_patch(FancyBboxPatch((x, y), w, h,
                                boxstyle="round,pad=0,rounding_size=9",
                                facecolor=fc, edgecolor="none", zorder=2))
    _stroke(ax, _rrect_pts(x, y, w, h, 9), lw=edge_lw, color=ec, close=True)
    icon_fn(ax, x + w / 2, GIF_H - (y_top + tpad + ip / 2))
    _txt(ax, x + w / 2, y + h - tpad - ip - tgap, "\n".join(title), 10.8, bold=True, va="top", ls=1.22)
    if sub:
        _txt(ax, x + w / 2, y + bpad, "\n".join(sub), 8.8, va="bottom", ls=1.3, color=INK_G)
    return y + h, y_top, y_top + h, h


def draw_scene(seed, dash_off):
    """Complete diagram in every frame: ambient dash march + sealed per-frame
    wobble (seed f wraps each 10-frame cycle, so the loop is seamless)."""
    global _rng
    _rng = random.Random(seed)
    fig, ax = plt.subplots(figsize=(GIF_W / 100, GIF_H / 100), dpi=100)
    fig.patch.set_facecolor(BG)
    ax.set_xlim(0, GIF_W)
    ax.set_ylim(0, GIF_H)
    ax.set_position([0, 0, 1, 1])
    ax.axis("off")

    # Left sidebar banner
    ax.add_patch(FancyBboxPatch((14, 14), 198, GIF_H - 28,
                                boxstyle="round,pad=0,rounding_size=16",
                                facecolor=SIDE, edgecolor="none", zorder=2))
    _txt(ax, 14 + 99, GIF_H - 122, "Versieve", 24.0, bold=True)
    _txt(ax, 14 + 99, GIF_H - 165, "one graph,\nevery consumer", 11.5, ls=1.35)

    # Main pipeline, left to right
    NODE_W, GAP, X0, Y_TOP = 146, 44, 238, 96
    xs = [X0 + i * (NODE_W + GAP) for i in range(5)]
    centers = [x + NODE_W / 2 for x in xs]
    main = [
        (_icon_envelope, ["Estate", "documents"], ["email, SQL,", "transcripts,", "slides"]),
        (_icon_shield, ["Perception", "5 WASM kernels"], ["zero network", "egress, trapped"]),
        (_icon_lock, ["Vaulted", "values"], ["salted,", "placeholders,", "HMAC ids"]),
        (_icon_graph, ["Resolved", "entity graph"], ["per-sample", "entity lists"]),
        (_icon_db, ["Deterministic", "corpus"], ["byte-range", "provenance"]),
    ]
    fills = [FILL, FILL, YELLOW, SIDE, FILL]
    boxes = [_node(ax, xs[i], Y_TOP, NODE_W, icon, t, s, fc=fills[i])
             for i, (icon, t, s) in enumerate(main)]

    # Dashed connectors with step badges 1..4 (destination-first for the march)
    mid_y = GIF_H - Y_TOP - 105
    for i, n in enumerate([1, 2, 3, 4]):
        _dashed(ax, [(xs[i + 1] - 11, mid_y), (xs[i] + NODE_W + 5, mid_y)], dash_off)
        _arrow_head(ax, (xs[i + 1] - 5, mid_y), (1, 0))
        _badge(ax, (xs[i] + NODE_W + xs[i + 1]) / 2, mid_y + 18, n)

    # Vault branch: salted placeholders by default, readable identity only as an
    # explicit opt-in. Both modes feed the graph.
    _node(ax, xs[2], 320, NODE_W, _icon_plates,
          ["Readable", "opt-in"], ["explicit seam"], fc=SIDE)
    _dashed(ax, [(centers[2], GIF_H - 320), (centers[2], GIF_H - boxes[2][2] + 3)],
            dash_off, z=1.5)
    _arrow_head(ax, (centers[2], GIF_H - 320), (0, -1))
    _txt(ax, centers[2] + 40, GIF_H - 300, "OPT-IN", 9.3, bold=True, color=TEAL)
    _dashed(ax, [(xs[3] + NODE_W / 2, GIF_H - boxes[3][2] + 3),
                 (xs[3] + NODE_W / 2, GIF_H - 390),
                 (xs[2] + NODE_W + 4, GIF_H - 390)], dash_off, z=1.5)
    _arrow_head(ax, (xs[3] + NODE_W / 2, GIF_H - boxes[3][2] + 3), (0, 1))

    # Consumer fan: source drop, leftward bus, four drops (badges 5..8), then a
    # regenerate loop from eraseEntity back into the corpus.
    BUS_Y = GIF_H - 480
    # Source drop is extended past node 5's bottom border (that tail hides under
    # the box fill, which draws at higher zorder); the per-frame extension e
    # aligns the dash pattern's origin to the border so the visible first dash
    # is always flush instead of shimmering with the march phase.
    border_y = GIF_H - boxes[4][2]            # mpl y of node 5's bottom edge
    base_len = border_y - (BUS_Y - 5)         # visible path length, bus end -> border
    e = -((base_len + dash_off) % DASH_PERIOD) % DASH_PERIOD
    _dashed(ax, [(centers[4], BUS_Y - 5), (centers[4], border_y + 3 + e)],
            dash_off, z=1.5)
    cons_x = [244 + j * (NODE_W + 90) for j in range(4)]
    _dashed(ax, [(cons_x[0] + NODE_W / 2, BUS_Y), (centers[4], BUS_Y)], dash_off)
    cons = [
        (_icon_gradcap, ["SFT corpora"], [], GREEN, INK_G, 5),
        (_icon_magnifier, ["Graph-PPR", "retrieval"], [], FILL, INK_G, 6),
        (_icon_plates, ["CAG caches"], [], FILL, INK_G, 7),
        (_icon_cross, ["eraseEntity"], ["byte-verified", "removal"], PINK, PINK_EDGE, 8),
    ]
    cons_boxes = []
    for j, (icon, title, sub, fc, ec, n) in enumerate(cons):
        tc_x = cons_x[j] + NODE_W / 2
        _dashed(ax, [(tc_x, GIF_H - 560 - 8), (tc_x, BUS_Y)], dash_off)
        _arrow_head(ax, (tc_x, GIF_H - 560 - 3), (0, -1))
        _badge(ax, tc_x + 17, (BUS_Y + GIF_H - 560) / 2, n)
        cons_boxes.append(_node(ax, cons_x[j], 560, NODE_W, icon, title, sub, fc=fc, ec=ec))
    for x, s, col in [(275, "train", INK_G), (665, "ask", INK_G), (988, "erase", RED)]:
        _txt(ax, x, GIF_H - 515, s, 9.3, bold=True, color=col)

    # Erasure loop: removing one entity regenerates the corpus, byte-verified.
    b = cons_boxes[3]
    cy = (b[0] + (GIF_H - b[2])) / 2
    right = cons_x[3] + NODE_W
    tip = (1122, GIF_H - boxes[4][2])
    _dashed(ax, [tip, (1122, cy), (right + 4, cy)], dash_off, z=1.5)
    _arrow_head(ax, tip, (0, 1))
    _txt(ax, 1138, GIF_H - 400, "regenerate, byte-diff", 9.3, bold=True, color=RED,
         rotation=90)
    return fig


def build_gif():
    from PIL import Image

    frames = 10          # 10 x 30 ms = 300 ms cycle; dash period 16 px closes exactly
    dur = 30             # Pillow quantises GIF delays to centiseconds
    frames_dir = OUT_DIR / "_gif_frames"
    frames_dir.mkdir(exist_ok=True)
    paths = []
    for f in range(frames):
        fig = draw_scene(20251104 + f, DASH_PERIOD * f / frames)
        p = frames_dir / f"frame_{f}.png"
        fig.savefig(p, dpi=100)
        plt.close(fig)
        paths.append(p)
    ims = [Image.open(p).convert("RGB") for p in paths]
    pal = ims[0].quantize(colors=64)
    qims = [im.quantize(palette=pal, dither=Image.NONE) for im in ims]
    qims[0].save(
        DOCS_DIR / "versieve-architecture.gif",
        save_all=True, append_images=qims[1:], duration=[dur] * frames,
        loop=0, optimize=True, disposal=2,
    )
    shutil.rmtree(frames_dir)
    print(f"Wrote docs/versieve-architecture.gif "
          f"({(DOCS_DIR / 'versieve-architecture.gif').stat().st_size} B)")


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


if __name__ == "__main__":
    DOCS_DIR.mkdir(exist_ok=True)
    self_check()
    build_pdf_and_preview()
    build_gif()
