"""README hero animation: the whole product, end to end.

One horizontal pipeline: estate -> perceiveMulti() -> ingest + four moats ->
every output -> the model's three lanes (train, ask, cache), with a visible
eraseEntity return loop under the last stages. A pale halo sweeps one stage
per beat so the eye reads the flow instead of a grid.

Same hand-drawn register and dash-march loop as the per-paper figures, built
from build_k7_architecture's primitives. Seeded, reproducible.
"""
from pathlib import Path
import math
import random

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Polygon

import build_k7_architecture as k7
from build_k7_architecture import (
    _dashed, _badge, _arrow_head, _txt, _icon_plates,
    _icon_envelope, _icon_shield, _icon_gradcap, _icon_magnifier,
    BG, FILL, SIDE, YELLOW, GREEN, INK_G, DASH_PERIOD,
)

OUT_DIR = Path(__file__).resolve().parent
DOCS_DIR = OUT_DIR.parent.parent / "docs"
NAME = "end-to-end-pipeline.gif"

GIF_H = 460
FRAMES = 10
DUR_MS = 120
COLORS = 32
GLOW = "#f7efd4"
RED = "#b91c1c"

TITLE_X, TITLE_Y = 44, 46
CARD_W, CARD_H, GAP, CARD_TOP = 188, 200, 38, 110
XS = [40 + i * (CARD_W + GAP) for i in range(5)]
FLOW_Y = CARD_TOP + CARD_H / 2


def _seed(seed):
    k7._rng = random.Random(seed)


def _canvas():
    k7.GIF_H = GIF_H
    fig, ax = plt.subplots(figsize=(k7.GIF_W / 100, GIF_H / 100), dpi=100)
    fig.patch.set_facecolor(BG)
    ax.set_xlim(0, k7.GIF_W)
    ax.set_ylim(0, GIF_H)
    ax.set_position([0, 0, 1, 1])
    ax.axis("off")
    return fig, ax


def _title_block(ax):
    _txt(ax, TITLE_X, GIF_H - TITLE_Y, "Versieve", 27.0, bold=True, ha="left")
    _txt(ax, TITLE_X, GIF_H - TITLE_Y - 32,
         "documents in, one model out", 13.0, ha="left")


def _card(ax, x, icon, title):
    y = GIF_H - CARD_TOP - CARD_H
    ax.add_patch(FancyBboxPatch((x, y), CARD_W, CARD_H,
                                boxstyle="round,pad=0,rounding_size=10",
                                facecolor=FILL, edgecolor="none", zorder=2))
    k7._stroke(ax, k7._rrect_pts(x, y, CARD_W, CARD_H, 10), lw=2.0, close=True)
    icon(ax, x + CARD_W / 2, GIF_H - (CARD_TOP + 34))
    _txt(ax, x + CARD_W / 2, GIF_H - (CARD_TOP + 68), title, 10.8, bold=True, va="top")


def _rows(ax, x, rows, step=19):
    """Text lines and coloured pills, top-down inside a card."""
    y = CARD_TOP + 96
    for row in rows:
        if isinstance(row, str):
            _txt(ax, x + 12, GIF_H - (y + step / 2), row, 8.7, ha="left")
        else:
            label, fc, ec = row
            py = GIF_H - (y + step - 2)
            ax.add_patch(FancyBboxPatch((x + 16, py), CARD_W - 32, step - 3,
                                        boxstyle="round,pad=0,rounding_size=6",
                                        facecolor=fc, edgecolor="none", zorder=2.5))
            k7._stroke(ax, k7._rrect_pts(x + 16, py, CARD_W - 32, step - 3, 6),
                       lw=1.4, color=ec or INK_G, close=True)
            _txt(ax, x + CARD_W / 2, py + (step - 3) / 2, label, 8.8, bold=True)
        y += step


def _loop_line(ax, pts):
    """Solid red return path: no dash phase, so the corners stay joined."""
    xs, ys = zip(*k7._rough(pts, amp=0.8))
    ax.plot(xs, ys, color=RED, lw=1.9, solid_capstyle="round",
            solid_joinstyle="round", zorder=1.4)


def _loop_head(ax, tip, direction, size=10.0, width=7.5):
    dx, dy = direction
    L = math.hypot(dx, dy)
    dx, dy = dx / L, dy / L
    bx, by = tip[0] - dx * size, tip[1] - dy * size
    px, py = -dy * width / 2, dx * width / 2
    ax.add_patch(Polygon([tip, (bx + px, by + py), (bx - px, by - py)],
                         closed=True, facecolor=RED, edgecolor="none", zorder=5))


def _link(ax, x_from, x_to, dash_off, n):
    y = GIF_H - FLOW_Y
    _dashed(ax, [(x_to - 4, y), (x_from + 4, y)], dash_off, z=1.5)
    _arrow_head(ax, (x_to - 4, y), (1, 0))
    _badge(ax, (x_from + x_to) / 2, y, n)


def draw(seed, dash_off, frame=0):
    _seed(seed)
    fig, ax = _canvas()
    _title_block(ax)

    # Pale halo on the current stage: one stage per beat, cycling.
    active = (frame * len(XS)) // FRAMES
    ax.add_patch(FancyBboxPatch((XS[active] - 6, GIF_H - CARD_TOP - CARD_H - 6),
                                CARD_W + 12, CARD_H + 12,
                                boxstyle="round,pad=0,rounding_size=13",
                                facecolor=GLOW, edgecolor="none", zorder=1.5))

    # 1. Estate: the twelve file types named in the README
    _card(ax, XS[0], _icon_envelope, "Estate")
    _rows(ax, XS[0], ["PDF · DOCX · PPTX · XLSX",
                      "EML · MSG · WAV · MP4",
                      "PNG · CSV · SQL · VTT"])

    # 2. One call
    _card(ax, XS[1], _icon_magnifier, "perceiveMulti()")
    _rows(ax, XS[1], ["one call, any mix",
                      "5 zero-import WASM kernels",
                      "pluggable NER · 27 forensics",
                      "one salted vault · one graph",
                      "0 B network egress"])

    # 3. Ingest, then the four moats as pills inside one stage
    _card(ax, XS[2], _icon_shield, "Ingest + moats")
    _rows(ax, XS[2], [
        "PDF · Office · AV · text",
        ("P1 · redact · LTT", FILL, None),
        ("P2 · SR-MP · HC-CRC", YELLOW, None),
        ("P3 · IB-PT-LM · LoRA", GREEN, None),
        ("P4 · graph · erase", SIDE, None),
    ])

    # 4. Every output
    _card(ax, XS[3], _icon_plates, "Every output")
    _rows(ax, XS[3], ["markdown · chunks · graph",
                      "sftJsonl · ptlmSftJsonl",
                      "Doc-QA · 6 SFT exporters",
                      "shadowAudit · Merkle receipt",
                      "certificates · timeline"])

    # 5. Into the model, three lanes
    _card(ax, XS[4], _icon_gradcap, "Into the model")
    _rows(ax, XS[4], [
        ("train · LoRA SFT", GREEN, None),
        ("ask · RAG · PPR", FILL, None),
        ("cache · CAG · KV", FILL, None),
        "same estate, three lanes",
    ])

    for i in range(4):
        _link(ax, XS[i] + CARD_W, XS[i + 1], dash_off, i + 1)

    # Erasure loop: one continuous red return path into the moat stage.
    out_x = XS[3] + CARD_W / 2
    proc_x = XS[2] + CARD_W / 2
    drop_to = GIF_H - (CARD_TOP + CARD_H)
    loop_mpl = GIF_H - 390
    _loop_line(ax, [(proc_x, drop_to), (proc_x, loop_mpl),
                    (out_x, loop_mpl), (out_x, drop_to)])
    _loop_head(ax, (proc_x, drop_to), (0, 1))
    _txt(ax, (proc_x + out_x) / 2, GIF_H - 376,
         "eraseEntity · regenerate", 9.2, bold=True, color=RED)
    return fig


def _check(fig):
    fig.canvas.draw()
    rend = fig.canvas.get_renderer()
    for t in fig.axes[0].texts:
        bb = t.get_window_extent(rend)
        assert bb.x0 >= 0 and bb.x1 <= k7.GIF_W, f"text off canvas: {t.get_text()!r}"
        assert bb.y0 >= 0 and bb.y1 <= GIF_H, f"text off canvas: {t.get_text()!r}"
        cx = (bb.x0 + bb.x1) / 2
        in_band = GIF_H - CARD_TOP - CARD_H < t.get_position()[1] < GIF_H - CARD_TOP
        for x in (XS if in_band else ()):
            if x < cx < x + CARD_W:
                assert bb.x0 > x + 3 and bb.x1 < x + CARD_W - 3, \
                    (f"text wider than card: {t.get_text()[:30]!r} "
                     f"{bb.x0:.0f}..{bb.x1:.0f} vs {x}..{x + CARD_W}")
                break


def build():
    from PIL import Image
    import shutil

    frames_dir = OUT_DIR / "_e2e_frames"
    frames_dir.mkdir(exist_ok=True)
    paths = []
    for f in range(FRAMES):
        # Fixed seed: the ink stays still, only the dashes and halo move.
        fig = draw(20301125, DASH_PERIOD * f / FRAMES, f)
        _check(fig)
        p = frames_dir / f"frame_{f}.png"
        fig.savefig(p, dpi=100)
        plt.close(fig)
        paths.append(p)
    ims = [Image.open(p).convert("RGB") for p in paths]
    pal = ims[0].quantize(colors=COLORS)
    qims = [im.quantize(palette=pal, dither=Image.NONE) for im in ims]
    dest = DOCS_DIR / NAME
    qims[0].save(dest, save_all=True, append_images=qims[1:],
                 duration=[DUR_MS] * FRAMES, loop=0, optimize=True, disposal=2)
    shutil.rmtree(frames_dir)
    print(f"Wrote docs/{NAME} ({dest.stat().st_size} B, "
          f"{qims[0].size[0]}x{qims[0].size[1]}, {DUR_MS}ms)")


if __name__ == "__main__":
    DOCS_DIR.mkdir(exist_ok=True)
    build()
