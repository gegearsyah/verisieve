"""Generate publication-grade 2-panel Track D results figure for Paper 3 (including Pillar 3 PT-LM LoRA)."""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

OUT_DIR = Path(__file__).resolve().parent
RES_PATH = OUT_DIR.parent.parent / "results" / "track-d-ptlm-ablation.json"

BLUE = "#1D4ED8"
TEAL = "#0F766E"
CORAL = "#D95F02"
CORAL_LIGHT = "#F09D65"
PURPLE = "#6D28D9"
SLATE = "#64748B"
INK = "#111827"
SUB = "#4B5563"
GRID = "#E5E7EB"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 8.2,
    "axes.titlesize": 9.1,
    "axes.titleweight": "bold",
    "axes.labelsize": 8.1,
    "axes.labelweight": "bold",
    "axes.edgecolor": "#9CA3AF",
    "axes.linewidth": 0.8,
    "xtick.labelsize": 7.6,
    "ytick.labelsize": 7.6,
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


def style_ax(ax):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis="y", color=GRID, linestyle="--", linewidth=0.7, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(length=3, width=0.8, color="#9CA3AF")


def build_fig2_track_d():
    data = json.loads(RES_PATH.read_text(encoding="utf-8"))["models"]
    keys = ["qwen05b", "qwen15b", "lfm3"]
    models = ["Qwen2.5\n0.5B-Inst", "Qwen2.5\n1.5B-Inst", "LFM3\n1.7B-Base"]
    x = np.arange(len(models))

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.3, 3.20), gridspec_kw={"width_ratios": [1.0, 1.18], "wspace": 0.28}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Carlini 20x Canary Exposure (Bits) ----
    style_ax(ax1)
    w = 0.20
    base_20x = [data[k]["canary_exposure"]["BASE"]["rep_20x_bits"] for k in keys]
    raw_20x = [data[k]["canary_exposure"]["T2_CHAT_RAW_LORA"]["rep_20x_bits"] for k in keys]
    safe_20x = [data[k]["canary_exposure"]["T2_CHAT_SAFE_LORA"]["rep_20x_bits"] for k in keys]
    ptlm_20x = [data[k]["canary_exposure"]["T2_CHAT_PTLM_LORA"]["rep_20x_bits"] for k in keys]

    b1 = ax1.bar(x - 1.5 * w, base_20x, width=w, color=SLATE, label="Base (No LoRA)", zorder=3)
    b2 = ax1.bar(x - 0.5 * w, raw_20x, width=w, color=CORAL, label="T2-Chat Raw LoRA", zorder=3)
    b3 = ax1.bar(x + 0.5 * w, safe_20x, width=w, color=TEAL, label="T2-Chat Safe LoRA", zorder=3)
    b4 = ax1.bar(x + 1.5 * w, ptlm_20x, width=w, color=PURPLE, label="T2-Chat PT-LM LoRA", zorder=3)

    for bars, col in ((b1, SUB), (b2, CORAL), (b3, TEAL), (b4, PURPLE)):
        for bar in bars:
            v = bar.get_height()
            ax1.text(
                bar.get_x() + bar.get_width() / 2, v + 0.16, f"{v:.2f}",
                ha="center", va="bottom", fontsize=5.9, fontweight="bold", color=col,
            )

    ax1.axhline(9.97, color="#94A3B8", linestyle=":", linewidth=1.0, zorder=1)
    ax1.text(2.42, 10.12, "Max 9.97 bits", ha="right", va="bottom", fontsize=6.6, color=SLATE, style="italic")

    ax1.set_xticks(x)
    ax1.set_xticklabels(models, fontsize=7.5)
    ax1.set_ylim(0, 12.8)
    ax1.set_yticks([0, 2, 4, 6, 8, 10])
    ax1.set_ylabel("20x Canary Exposure (Bits, Lower Better)")
    ax1.set_title("A. Weight Memorization (All 3 Models)", loc="left", pad=8)
    ax1.legend(loc="upper left", ncol=2, borderpad=0.32, columnspacing=0.8, handlelength=1.2)

    # ---- Panel B: Blinded qwen2.5:7b In-Scope Judge Score (40-Q In-Scope Held-Out %) ----
    style_ax(ax2)
    w2 = 0.17
    j_base = [data[k]["heldout_50q_summary"]["BASE_CLOSED_BOOK"]["judge_in_pct"] for k in keys]
    j_raw = [data[k]["heldout_50q_summary"]["T2_CHAT_RAW_LORA"]["judge_in_pct"] for k in keys]
    j_safe = [data[k]["heldout_50q_summary"]["T2_CHAT_SAFE_LORA"]["judge_in_pct"] for k in keys]
    j_ptlm = [data[k]["heldout_50q_summary"]["T2_CHAT_PTLM_LORA"]["judge_in_pct"] for k in keys]
    j_ppr = [data[k]["heldout_50q_summary"]["T0_BASE_PLUS_GRAPH_PPR"]["judge_in_pct"] for k in keys]

    p1 = ax2.bar(x - 2.0 * w2, j_base, width=w2, color=SLATE, label="Base", zorder=3)
    p2 = ax2.bar(x - 1.0 * w2, j_raw, width=w2, color=CORAL_LIGHT, label="T2-Chat Raw", zorder=3)
    p3 = ax2.bar(x, j_safe, width=w2, color=CORAL, label="T2-Chat Safe", zorder=3)
    p4 = ax2.bar(x + 1.0 * w2, j_ptlm, width=w2, color=PURPLE, label="T2-Chat PT-LM", zorder=3)
    p5 = ax2.bar(x + 2.0 * w2, j_ppr, width=w2, color=BLUE, label="T0 + Graph-PPR", zorder=3)

    for bars, col in ((p1, SUB), (p2, SUB), (p3, CORAL), (p4, PURPLE), (p5, BLUE)):
        for bar in bars:
            v = bar.get_height()
            ax2.text(
                bar.get_x() + bar.get_width() / 2, v + 1.3, f"{v:.1f}%",
                ha="center", va="bottom", fontsize=5.3, fontweight="bold", color=col,
            )

    ax2.annotate(
        "PT-LM: 0% <PII> echo (+93% vs Safe)\nwhile T0+Graph-PPR leads all",
        xy=(1 + 1.0 * w2, j_ptlm[1] + 5), xytext=(0.62, 81.0),
        ha="center", va="bottom", fontsize=6.2, fontweight="bold", color=PURPLE,
        bbox=dict(boxstyle="round,pad=0.22", fc="#EDE9FE", ec=PURPLE, lw=0.7),
        arrowprops=dict(arrowstyle="->", color=PURPLE, lw=0.9, connectionstyle="arc3,rad=-0.10"),
    )

    ax2.set_xticks(x)
    ax2.set_xticklabels(models, fontsize=7.5)
    ax2.set_ylim(0, 124)
    ax2.set_yticks([0, 20, 40, 60, 80, 100])
    ax2.set_yticklabels(["0%", "20%", "40%", "60%", "80%", "100%"])
    ax2.set_ylabel("In-Scope Blinded Judge (40-Q Held-Out)")
    ax2.set_title("B. In-Scope Utility: PT-LM & Graph-PPR", loc="left", pad=8)
    ax2.legend(loc="upper center", ncol=3, borderpad=0.30, columnspacing=0.8, handlelength=1.1)

    fig.subplots_adjust(left=0.075, right=0.985, top=0.87, bottom=0.17)
    fig.savefig(OUT_DIR / "fig2-track-d-results.pdf")
    plt.close(fig)
    print("Generated fig2-track-d-results.pdf")


if __name__ == "__main__":
    build_fig2_track_d()
