"""Weft theme-linking architecture GIF, same hand-drawn register as the paper set.

Post-T12 frontier track: estate -> pair compiler -> licence audit gate ->
teacher -> specialist encoder -> post-hoc identity probe battery -> conformal
abstain -> theme nodes, with the W4 ablation ladder and the honest side cards
(licence-dropped sources, fail-closed teacher, W5-W7 not shipped). Built from
build_k7_architecture's primitives the way build_readme_architectures does.
Seeded, reproducible.
"""
from pathlib import Path
import shutil

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

import build_k7_architecture as k7
import build_readme_architectures as r
from build_k7_architecture import (
    _node, _txt, _stroke, DASH_PERIOD,
    _icon_envelope, _icon_shield, _icon_lock, _icon_graph, _icon_db,
    _icon_gradcap, _icon_magnifier, _icon_plates,
    BG, FILL, SIDE, YELLOW, GREEN, INK_G,
)
from build_readme_architectures import _link_h, _vlink, _detail, BAD, OK

OUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUT_DIR.parent.parent / "docs"
NAME = "architecture-weft-theme-linking.gif"
FRAMES = 10
DUR_MS = 140

X0, NODE_W, STEP_X, Y_TOP = 40, 104, 138, 104
XS = [X0 + i * STEP_X for i in range(8)]
ROW_W = X0 + 7 * STEP_X + NODE_W            # right edge of the main row
DASHED = (4, 4)                             # static dashes for "not shipped"


def _canvas():
    fig, ax = plt.subplots(figsize=(k7.GIF_W / 100, k7.GIF_H / 100), dpi=100)
    fig.patch.set_facecolor(BG)
    ax.set_xlim(0, k7.GIF_W)
    ax.set_ylim(0, k7.GIF_H)
    ax.set_position([0, 0, 1, 1])
    ax.axis("off")
    return fig, ax


def _card(ax, x, y_top, title, body, rects, w=138, fc=FILL, lw=1.4, dashes=None):
    """Same card language as build_readme_architectures._detail, plus a check rect."""
    _detail(ax, x, y_top, title, body, w=w)
    h = 11 + 13.2 * len(title) + 4 + 12.5 * len(body) + 11
    if dashes:
        _stroke(ax, k7._rrect_pts(x, k7.GIF_H - y_top - h, w, h, 8),
                lw=lw, close=True, dashes=dashes)
    rects.append((x, y_top, w, h))


def draw(seed, dash_off):
    r._seed(seed)
    k7.GIF_H = 590
    fig, ax = _canvas()
    _txt(ax, 44, k7.GIF_H - 42, "Weft: theme linking, identity-blind",
         20.0, bold=True, ha="left")
    _txt(ax, 44, k7.GIF_H - 74, "post-T12 frontier, not one of the four papers",
         11.5, ha="left")

    row = [
        (_icon_envelope, ["Estate"], ["documents"], FILL),
        (_icon_plates, ["Pair", "compiler"], ["3 pair types"], FILL),
        (_icon_shield, ["Licence", "audit gate"], ["allow-list"], YELLOW),
        (_icon_gradcap, ["Teacher"], ["Mistral Medium", "live"], FILL),
        (_icon_db, ["Specialist", "encoder"], ["23.2M params"], FILL),
        (_icon_magnifier, ["Identity", "probes"], ["post-hoc only"], SIDE),
        (_icon_lock, ["Conformal", "abstain"], ["LTT fails closed"], FILL),
        (_icon_graph, ["Theme nodes"], ["links + spans"], GREEN),
    ]
    boxes = [_node(ax, XS[i], Y_TOP, NODE_W, *row[i][:3], fc=row[i][3])
             for i in range(8)]
    y = k7.GIF_H - 173                     # mpl y of the row's canvas centre 173
    for i in range(7):
        _link_h(ax, XS[i] + NODE_W, XS[i + 1], y, dash_off, i + 1)
    rects = [(XS[i], Y_TOP, NODE_W, boxes[i][3]) for i in range(8)]

    def card(x, y_top, title, body, w=138, **kw):
        _card(ax, x, y_top, title, body, rects, w=w, **kw)

    card(XS[1] - 9, 262, ["3 pair types:"],
         ["identity-masked pos;", "identity-matched,", "diff-theme neg;",
          "identity-disjoint", "same-theme pos"])
    card(XS[4] - 9, 262, ["all-MiniLM-L6-v2", "fine-tune"],
         ["23.2M params,", "Apache-2.0, research", "artifact"])
    card(XS[5] - 9, 262, ["post-hoc probes"],
         ["identity-blind,", "not identity-removed"])
    card(XS[6] - 9, 262, ["conformal LTT"],
         ["abstain when risk", "bound not met"])
    card(XS[7] - 8, 262, ["theme graph"],
         ["nodes + links +", "evidence spans"], w=134)

    # Side paths: licence-dropped and fail-closed teacher, straight drops
    # through the corridor between the detail cards.
    _vlink(ax, XS[2] + NODE_W / 2, boxes[2][2], 380, dash_off)
    card(297, 380, ["licence audit gate"], ["dropped sources", "emit zero pairs"],
         w=150)
    _vlink(ax, XS[3] + NODE_W / 2, boxes[3][2], 380, dash_off)
    card(455, 380, ["teacher: fail-closed"],
         ["49,070 live pairs", "47,070 train / 2,000 eval"], w=210)

    card(720, 380, ["W5-W7 NOT SHIPPED"],
         ["no quantized artifact,", "no seam integration or release packaging"],
         w=398, fc="#f6f7fa", dashes=DASHED, lw=1.6)

    # W4 ablation ladder strip.
    sx, sw, sh = X0, ROW_W - X0, 74
    yy = k7.GIF_H - 480 - sh
    ax.add_patch(FancyBboxPatch((sx, yy), sw, sh,
                                boxstyle="round,pad=0,rounding_size=8",
                                facecolor=SIDE, edgecolor="none", zorder=2))
    _stroke(ax, k7._rrect_pts(sx, yy, sw, sh, 8), lw=1.8, close=True)
    rects.append((sx, 480, sw, sh))
    _txt(ax, 64, k7.GIF_H - 506, "W4 ablation ladder", 10.6, bold=True, ha="left")
    _txt(ax, 64, k7.GIF_H - 524, "specialist theme-F1 (fixture)", 8.7, ha="left")
    _txt(ax, 64, k7.GIF_H - 542, "full-scale live 0.208, gate not met", 8.7,
         ha="left", color=BAD)
    chips = [
        ("bare", "0.392, baseline", INK_G),
        ("+adversary", "0.339, hurts", BAD),
        ("+set-conditioning", "0.428, only positive", OK),
        ("+triangle", "0.408", INK_G),
        ("+modality", "0.400", INK_G),
    ]
    for j, (label, value, vc) in enumerate(chips):
        cx = 300 + j * 164
        ax.add_patch(FancyBboxPatch((cx, k7.GIF_H - 490 - 54), 150, 54,
                                    boxstyle="round,pad=0,rounding_size=8",
                                    facecolor=BG, edgecolor="none", zorder=2.4))
        _stroke(ax, k7._rrect_pts(cx, k7.GIF_H - 490 - 54, 150, 54, 8),
                lw=1.5, close=True)
        rects.append((cx, 490, 150, 54))
        _txt(ax, cx + 75, k7.GIF_H - 507, label, 9.2, bold=True)
        _txt(ax, cx + 75, k7.GIF_H - 532, value, 8.8, color=vc)
    return fig, rects


def _check(fig, rects):
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    H = k7.GIF_H
    for t in fig.axes[0].texts:
        bb = t.get_window_extent(rend)
        assert bb.x0 >= 0 and bb.x1 <= k7.GIF_W, f"off canvas x: {t.get_text()!r}"
        assert bb.y0 >= 0 and bb.y1 <= H, f"off canvas y: {t.get_text()!r}"
        if t.get_fontsize() > 10.9:
            continue
        cx, cy = (bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2
        for (rx, ry_top, rw, rh) in rects:
            my0, my1 = H - (ry_top + rh), H - ry_top
            if rx < cx < rx + rw and my0 < cy < my1:
                assert bb.x0 > rx + 2 and bb.x1 < rx + rw - 2, \
                    f"text wider than box: {t.get_text()!r}"
                assert my0 + 2 < bb.y0 and bb.y1 < my1 - 2, \
                    f"text taller than box: {t.get_text()!r}"
                break


def build():
    from PIL import Image

    frames_dir = OUT_DIR / "_weft_frames"
    frames_dir.mkdir(exist_ok=True)
    paths = []
    for f in range(FRAMES):
        # Three dash periods per cycle: the 6.6 px/frame march reads as motion
        # while the border-flush dash alignment stays phase-stable.
        fig, rects = draw(20251127 + f, (3 * DASH_PERIOD) * f / FRAMES)
        _check(fig, rects)
        p = frames_dir / f"{NAME}_{f}.png"
        fig.savefig(p, dpi=100)
        plt.close(fig)
        paths.append(p)
    ims = [Image.open(p).convert("RGB") for p in paths]
    pal = ims[0].quantize(colors=64)
    qims = [im.quantize(palette=pal, dither=Image.NONE) for im in ims]
    dest = DOCS_DIR / NAME
    qims[0].save(dest, save_all=True, append_images=qims[1:],
                 duration=[DUR_MS] * FRAMES, loop=0, optimize=True, disposal=2)
    shutil.rmtree(frames_dir)
    print(f"Wrote docs/{NAME} ({dest.stat().st_size} B, {k7.GIF_W}x{k7.GIF_H})")


if __name__ == "__main__":
    build()
