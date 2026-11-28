"""Weft theme-linking architecture GIF, same hand-drawn register as the paper set.

Paper 5 shipped: estate -> pair compiler -> licence audit gate -> teacher ->
frozen specialist -> H2 identity probe -> certified LTT abstain -> theme nodes,
with the shipped int4/int8 artifacts, the ruled identity_disjoint gate and the
honest limits. Seeded, reproducible.
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
    _txt(ax, 44, k7.GIF_H - 42, "Weft: theme linking across sources",
         20.0, bold=True, ha="left")
    _txt(ax, 44, k7.GIF_H - 74,
         "paper 5: the ruled gate, a certified abstain path, "
         "identity as a measured property", 11.5, ha="left")

    row = [
        (_icon_envelope, ["Estate"], ["240 docs ·", "24 themes"], FILL),
        (_icon_plates, ["Pair", "compiler"], ["50k pairs ·", "6 voices"], FILL),
        (_icon_shield, ["Licence", "audit gate"], ["green-only"], YELLOW),
        (_icon_gradcap, ["Teacher"], ["live · fail-closed"], FILL),
        (_icon_db, ["Specialist", "encoder"], ["frozen MiniLM"], FILL),
        (_icon_magnifier, ["H2 probe", "battery"], ["measured only"], SIDE),
        (_icon_lock, ["LTT", "abstain"], ["fails closed"], FILL),
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

    card(XS[1] - 9, 262, ["pair types:"],
         ["identity-masked pos;", "participant-shared,",
          "diff-theme neg;", "identity-disjoint", "same-theme pos"])
    card(XS[4] - 21, 262, ["shipped artifacts"],
         ["int4 ONNX 20,458,033 B,", "F1 0.9572; int8 ref",
          "23,642,917 B, F1 0.9652;", "sha-256 pinned, fails closed"], w=150)
    card(XS[5] - 9, 262, ["identity is measured"],
         ["MLP 0.45 vs 0.10 chance,", "RBF-SVM at or below;",
          "no removal claim"])
    card(XS[6] - 9, 262, ["certified abstain"],
         ["threshold 0.5000, alpha 0.05;", "answers 16.1% of pairs,",
          "rest routes to review"], w=160)
    card(XS[7] + 13, 262, ["one theme link"],
         ["same talking point,", "different sources,",
          "one link + evidence spans"], w=134)

    # Side paths: licence-dropped and fail-closed teacher, straight drops
    # through the corridor between the detail cards.
    _vlink(ax, XS[2] + NODE_W / 2, boxes[2][2], 380, dash_off)
    card(297, 380, ["licence audit gate"], ["dropped sources", "emit zero pairs"],
         w=150)
    _vlink(ax, XS[3] + NODE_W / 2, boxes[3][2], 380, dash_off)
    card(455, 380, ["v4 corpus: fail-closed"],
         ["48,000 train / 2,000 eval", "pairs, 6 voices"], w=210)

    card(720, 380, ["the honest limits"],
         ["BM25 scores 1.0 on the gate bucket: it measures",
          "lexical overlap too; paraphrase-hard stratum pending",
          "(issue #59); claim audit: 40 traced claims, 40 passes"],
         w=398, fc="#f6f7fa", lw=1.6)

    # Ruled-gate strip: header lines stacked over the six comparison chips.
    sx, sw, sh = X0, ROW_W - X0, 100
    yy = k7.GIF_H - 480 - sh
    ax.add_patch(FancyBboxPatch((sx, yy), sw, sh,
                                boxstyle="round,pad=0,rounding_size=8",
                                facecolor=SIDE, edgecolor="none", zorder=2))
    _stroke(ax, k7._rrect_pts(sx, yy, sw, sh, 8), lw=1.8, close=True)
    rects.append((sx, 480, sw, sh))
    _txt(ax, 64, k7.GIF_H - 492, "The ruled gate: identity_disjoint pairwise F1",
         10.6, bold=True, ha="left")
    _txt(ax, 64, k7.GIF_H - 510,
         "founder ruling 2026-11-28: theme linking is the product case",
         8.7, ha="left")
    chips = [
        ("static baseline", "0.9973", INK_G),
        ("BERTopic-style", "1.0", INK_G),
        ("LLM judge", "0.6667", INK_G),
        ("BM25", "1.0, lexical", BAD),
        ("link head", "0.3617, rescoped", INK_G),
        ("pooled cosine", "0.9989, ruled", OK),
    ]
    for j, (label, value, vc) in enumerate(chips):
        cx = 250 + j * 144
        ax.add_patch(FancyBboxPatch((cx, k7.GIF_H - 520 - 54), 136, 54,
                                    boxstyle="round,pad=0,rounding_size=8",
                                    facecolor=BG, edgecolor="none", zorder=2.4))
        _stroke(ax, k7._rrect_pts(cx, k7.GIF_H - 520 - 54, 136, 54, 8),
                lw=1.5, close=True)
        rects.append((cx, 520, 136, 54))
        _txt(ax, cx + 68, k7.GIF_H - 535, label, 9.2, bold=True)
        _txt(ax, cx + 68, k7.GIF_H - 555, value, 8.8, color=vc)
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
