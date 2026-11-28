"""Weft theme-linking architecture GIF: a five-stage row over five detail cards,
three side cards beneath, and the full-width ruled-gate chip strip. Seeded.
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
    _icon_envelope, _icon_lock, _icon_graph, _icon_db, _icon_plates,
    BG, FILL, SIDE, GREEN, INK_G,
)
from build_readme_architectures import _link_h, _vlink, _detail, BAD, OK

OUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUT_DIR.parent.parent / "docs"
NAME = "architecture-weft-theme-linking.gif"
FRAMES = 10
DUR_MS = 140

CENTERS = [220, 460, 700, 940, 1180]        # main-row node centres
NODE_W = 150
Y_ROW, Y_DETAIL, Y_SIDE = 130, 309, 420     # card tops, canvas coords
CARD_W = 220                                # leaves a 20 px gap between cards


def _canvas():
    fig, ax = plt.subplots(figsize=(k7.GIF_W / 100, k7.GIF_H / 100), dpi=100)
    fig.patch.set_facecolor(BG)
    ax.set_xlim(0, k7.GIF_W)
    ax.set_ylim(0, k7.GIF_H)
    ax.set_position([0, 0, 1, 1])
    ax.axis("off")
    return fig, ax


def _card(ax, x, y_top, title, body, rects, w=CARD_W, fc=FILL, lw=1.4, dashes=None):
    """Same card language as build_readme_architectures._detail, plus a check
    rect; returns the card's canvas bottom."""
    _detail(ax, x, y_top, title, body, w=w, fc=fc)
    h = 11 + 13.2 * len(title) + 4 + 12.5 * len(body) + 11
    if dashes:
        _stroke(ax, k7._rrect_pts(x, k7.GIF_H - y_top - h, w, h, 8),
                lw=lw, close=True, dashes=dashes)
    rects.append((x, y_top, w, h))
    return y_top + h


def draw(seed, dash_off):
    r._seed(seed)
    k7.GIF_W, k7.GIF_H = 1400, 780
    fig, ax = _canvas()
    _txt(ax, 52, k7.GIF_H - 44, "Weft: theme linking across sources",
         24.0, bold=True, ha="left")
    _txt(ax, 52, k7.GIF_H - 82,
         "paper 5: the ruled gate, a certified abstain path, "
         "identity as a measured property", 12.0, ha="left")

    # Two lines per title and sub keeps all five nodes equal height; the blank
    # title line pads the one-word stage.
    row = [
        (_icon_envelope, ["Estate", ""], ["240 docs ·", "24 themes"], FILL),
        (_icon_plates, ["Pair", "compiler"], ["50k pairs ·", "6 voices"], FILL),
        (_icon_db, ["Weft", "specialist"], ["frozen MiniLM ·", "int8 heads"], FILL),
        (_icon_lock, ["Certified", "abstain"], ["LTT ·", "fails closed"], FILL),
        (_icon_graph, ["Theme", "nodes"], ["links +", "evidence spans"], GREEN),
    ]
    boxes = [_node(ax, c - NODE_W / 2, Y_ROW, NODE_W, *row[i][:3], fc=row[i][3])
             for i, c in enumerate(CENTERS)]
    # boxes[i][1] is the canvas top, so top + h/2 is the row's centre.
    y = k7.GIF_H - (boxes[2][1] + boxes[2][3] / 2)
    for i in range(len(CENTERS) - 1):
        _link_h(ax, CENTERS[i] + NODE_W / 2, CENTERS[i + 1] - NODE_W / 2,
                y, dash_off, i + 1)
    rects = [(c - NODE_W / 2, Y_ROW, NODE_W, boxes[i][3])
             for i, c in enumerate(CENTERS)]

    details = [
        (["synthetic-theme estate"],
         ["8 departments · 5 modalities", "seeded ASR/OCR noise on ~35%",
          "sha-256 pinned estate"]),
        (["green-only licence gate"],
         ["dropped sources emit zero pairs", "teacher live · fail-closed",
          "48,000 train / 2,000 eval pairs"]),
        (["shipped artifacts"],
         ["int4 ONNX 20,458,033 B · F1 0.9572",
          "int8 ref 23,642,917 B · F1 0.9652", "sha-256 pinned · fails closed"]),
        (["certified abstain"],
         ["threshold 0.5000 at alpha 0.05", "answers 16.1% of pairs",
          "the rest routes to review"]),
        (["one theme link"],
         ["same talking point, different sources",
          "links + evidence spans both sides",
          "deterministic per policy version"]),
    ]
    det_bottom = Y_DETAIL
    for c, (title, body) in zip(CENTERS, details):
        det_bottom = _card(ax, c - CARD_W / 2, Y_DETAIL, title, body, rects)

    sides = [
        (2, ["H2 probe: identity is measured"],
         ["MLP 0.45 vs 0.10 chance on int4", "RBF-SVM at or below chance",
          "no removal claim"]),
        (3, ["claim audit"],
         ["40 traced claims · 40 passes", "content-addressed runIds",
          "append-only ledgers"]),
        (4, ["the honest limits"],
         ["BM25 scores 1.0 on the gate bucket:",
          "lexical overlap, not just theme",
          "paraphrase-hard stratum pending #59"]),
    ]
    for col, title, body in sides:
        _vlink(ax, CENTERS[col], det_bottom, Y_SIDE, dash_off)
        _card(ax, CENTERS[col] - CARD_W / 2, Y_SIDE, title, body, rects)

    # Ruled-gate strip: header lines over the six comparison chips.
    sx, sy, sw, sh = 60, 590, 1280, 140
    yy = k7.GIF_H - sy - sh
    ax.add_patch(FancyBboxPatch((sx, yy), sw, sh,
                                boxstyle="round,pad=0,rounding_size=10",
                                facecolor=SIDE, edgecolor="none", zorder=2))
    _stroke(ax, k7._rrect_pts(sx, yy, sw, sh, 10), lw=1.8, close=True)
    rects.append((sx, sy, sw, sh))
    _txt(ax, 84, k7.GIF_H - sy - 24,
         "The ruled gate: identity_disjoint pairwise F1", 11.0, bold=True,
         ha="left")
    _txt(ax, 84, k7.GIF_H - sy - 44,
         "founder ruling 2026-11-28: theme linking is the product case",
         9.5, ha="left")
    chips = [
        ("static baseline", "0.9973", INK_G, BG),
        ("BERTopic-style", "1.0", INK_G, BG),
        ("LLM judge", "0.6667", INK_G, BG),
        ("BM25", "1.0 · lexical", BAD, BG),
        ("link head", "0.3617 · rescoped", INK_G, BG),
        ("pooled cosine", "0.9989 · ruled", OK, GREEN),
    ]
    ctop = sy + sh - 18 - 62
    for j, (label, value, vc, fc) in enumerate(chips):
        cx = 105 + j * 202
        cy = k7.GIF_H - ctop - 62
        ax.add_patch(FancyBboxPatch((cx, cy), 180, 62,
                                    boxstyle="round,pad=0,rounding_size=9",
                                    facecolor=fc, edgecolor="none", zorder=2.4))
        _stroke(ax, k7._rrect_pts(cx, cy, 180, 62, 9), lw=1.5, close=True)
        rects.append((cx, ctop, 180, 62))
        _txt(ax, cx + 90, cy + 40, label, 10.0, bold=True)
        _txt(ax, cx + 90, cy + 20, value, 9.0, color=vc)
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
