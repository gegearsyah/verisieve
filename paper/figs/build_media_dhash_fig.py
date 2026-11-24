"""Figure: dHash keyframe-triage pruning-rate curve (Stage 8, IB-AMP remediation).

All points are loaded from results/media-dhash-triage.json (measured on deterministic
synthetic fixtures, seeded LCG — see the artifact's fixtureKind field). Mirrors the
build_track_e_figures.py conventions.

Palette validated with the dataviz skill validator (single categorical hue #1D4ED8 PASS;
#6B7280 is the recessive reference curve: identity carried by dashed linestyle + marker +
legend, not hue).
"""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

OUT_DIR = Path(__file__).resolve().parent
PATH = OUT_DIR / ".." / ".." / "results" / "media-dhash-triage.json"

BLUE = "#1D4ED8"
GRAY = "#6B7280"  # recessive baseline reference curve; identity via linestyle + marker + legend
INK = "#111827"
SUB = "#4B5563"
GRID = "#E5E7EB"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 8.3,
    "axes.titlesize": 9.1,
    "axes.titleweight": "bold",
    "axes.labelsize": 8.2,
    "axes.labelweight": "bold",
    "axes.edgecolor": "#9CA3AF",
    "axes.linewidth": 0.8,
    "xtick.labelsize": 7.7,
    "ytick.labelsize": 7.7,
    "xtick.color": SUB,
    "ytick.color": SUB,
    "text.color": INK,
    "legend.fontsize": 6.6,
    "legend.frameon": True,
    "legend.facecolor": "white",
    "legend.edgecolor": "#D1D5DB",
    "legend.framealpha": 0.96,
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})


def build():
    data = json.loads(PATH.read_text(encoding="utf-8"))
    curve = data["pruningCurve"]
    budgets = [p["budget"] for p in curve]
    rates = [p["meanPruningRate"] * 100 for p in curve]

    sup = data["suppressionUnconstrained"]
    sup_mean_rate = sum(s["pruningRate"] for s in sup) / len(sup) * 100
    hs = data["hashSeparation"]

    fig, ax = plt.subplots(figsize=(3.9, 2.8))
    fig.patch.set_facecolor("white")
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=GRID, linestyle="--", linewidth=0.7, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(length=3, width=0.8, color="#9CA3AF")

    # Recessive suppression-only reference (unconstrained budget), identity via
    # dotted linestyle + open marker + legend, not hue.
    ax.axhline(sup_mean_rate, color=GRAY, linestyle=":", linewidth=1.4, zorder=3,
               label=f"Suppression only, unconstrained budget ({sup_mean_rate:.1f}%)")

    ax.plot(budgets, rates, color=BLUE, linewidth=1.9, marker="o", markersize=4.2,
            markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=0.8, zorder=5,
            label="Measured mean pruning rate (budget k, per sequence)")

    # Selective direct label: suppression-only reference value at its line end
    ax.annotate(f"{sup_mean_rate:.1f}%", (budgets[-1], sup_mean_rate),
                xytext=(3, -7), textcoords="offset points", fontsize=5.9,
                color=SUB, fontweight="bold")

    ax.text(0.99, 0.55,
            (f"Synthetic seeded-LCG fixtures (6×64 frames), not real video.\n"
             f"Intra-slide Hamming mean {hs['intraSlideMeanHamming']:.1f} vs "
             f"cross-slide min {hs['crossSlideMinHamming']} (τ={hs['separateAtHamming']} bits)."),
            transform=ax.transAxes, fontsize=5.4, color=SUB, ha="right", va="bottom", linespacing=1.35)

    ax.set_xlabel("Keyframe budget k (of 64 frames per sequence)")
    ax.set_ylabel("Pruned Frames (%)")
    ax.set_ylim(0, 100)
    ax.set_yticks([0, 25, 50, 75, 100])
    ax.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax.set_title("dHash Keyframe Triage Pruning Rate", loc="left", pad=8)
    ax.legend(loc="lower left", fontsize=5.6, handlelength=2.4, bbox_to_anchor=(0.0, 0.02))

    out = OUT_DIR / "fig_e4_media_dhash_pruning.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


if __name__ == "__main__":
    build()
