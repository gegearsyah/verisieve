"""Generate publication-grade vector figures for versieve-extraction-redaction-benchmark.tex."""
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

OUT_DIR = Path(__file__).resolve().parent

# Colorblind-safe academic palette
BLUE = "#1D4ED8"
BLUE_MID = "#4F7DF3"
TEAL = "#0F766E"
CORAL = "#D95F02"
CORAL_LIGHT = "#F09D65"
SLATE = "#64748B"
INK = "#111827"
SUB = "#4B5563"
GRID = "#E5E7EB"
CERT_BG = "#EFF6FF"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 8.5,
    "axes.titlesize": 9.4,
    "axes.titleweight": "bold",
    "axes.labelsize": 8.4,
    "axes.labelweight": "bold",
    "axes.edgecolor": "#9CA3AF",
    "axes.linewidth": 0.8,
    "xtick.labelsize": 7.9,
    "ytick.labelsize": 7.9,
    "xtick.color": SUB,
    "ytick.color": SUB,
    "text.color": INK,
    "legend.fontsize": 7.4,
    "legend.frameon": True,
    "legend.facecolor": "white",
    "legend.edgecolor": "#D1D5DB",
    "legend.framealpha": 0.96,
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})


def style_ax(ax, grid_axis="y"):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis=grid_axis, color=GRID, linestyle="--", linewidth=0.7, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(length=3, width=0.8, color="#9CA3AF")


def build_fig1():
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.0, 3.05), gridspec_kw={"width_ratios": [1.14, 1.0], "wspace": 0.31}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Monotonic LTT Sweep ----
    alphas = ["0.01", "0.02", "0.05", "0.10", "0.20"]
    x = np.arange(len(alphas))
    cond_fpr = [0.00, 0.98, 3.41, 4.88, 14.63]
    joint_risk = [0.00, 0.67, 2.34, 3.34, 10.03]

    style_ax(ax1, "y")
    ax1.axhline(4.39, color=CORAL, linestyle="--", linewidth=1.2, zorder=1)
    ax1.text(
        -0.28, 5.25, r"Uncalibrated $\tau=0.50$ (4.39%)",
        color=CORAL, fontsize=7.2, fontweight="bold", ha="left", va="bottom",
        bbox=dict(boxstyle="round,pad=0.18", fc="white", ec="none", alpha=0.9),
    )

    ax1.plot(
        x, cond_fpr, color=BLUE, linewidth=2.0, marker="o", markersize=5.8,
        markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=1.0,
        label="Conditional FPR", zorder=4,
    )
    ax1.plot(
        x, joint_risk, color=TEAL, linewidth=1.7, linestyle="-.", marker="s", markersize=4.8,
        markerfacecolor=TEAL, markeredgecolor="white", markeredgewidth=0.9,
        label=r"Joint Risk $\Pr(\mathrm{keep} \wedge Y{=}1)$", zorder=3,
    )

    # Zero-collision direct labels
    label_specs = [
        (0, 0.00, "0.0%", (2, 7), "center", "bottom"),
        (1, 0.98, "0.98%", (0, 7), "center", "bottom"),
        (2, 3.41, "3.41%", (-16, 4), "right", "bottom"),
        (3, 4.88, "4.88%", (-6, 8), "center", "bottom"),
        (4, 14.63, "14.63%", (-14, 6), "center", "bottom"),
    ]
    for xi, yi, txt, xyoff, ha, va in label_specs:
        ax1.annotate(
            txt, (xi, yi), xytext=xyoff, textcoords="offset points",
            ha=ha, va=va, fontsize=7.1, fontweight="bold", color=BLUE,
            bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.85),
        )
    ax1.annotate(
        "10.03%", (x[-1], joint_risk[-1]), xytext=(-6, -15),
        textcoords="offset points", ha="right", va="top",
        fontsize=7.1, fontweight="bold", color=TEAL,
        bbox=dict(boxstyle="round,pad=0.14", fc="white", ec="none", alpha=0.92),
    )

    ax1.set_xticks(x)
    ax1.set_xticklabels(alphas)
    ax1.set_xlim(-0.38, 4.45)
    ax1.set_ylim(-0.6, 17.8)
    ax1.set_yticks([0, 4, 8, 12, 16])
    ax1.set_yticklabels(["0%", "4%", "8%", "12%", "16%"])
    ax1.set_xlabel(r"Target Conformal Risk Budget ($\alpha$)")
    ax1.set_ylabel("Held-Out Error Rate (%)")
    ax1.set_title("A. Held-Out Risk vs. LTT Budget", loc="left", pad=8)
    ax1.legend(loc="upper left", borderpad=0.45, handlelength=2.1)

    # ---- Panel B: Finite-Sample Resolution Floor at alpha = 0.01 ----
    style_ax(ax2, "y")
    ax2.axhspan(0.0, 0.05, color=CERT_BG, zorder=0)
    ax2.axhline(0.05, color=CORAL, linestyle="--", linewidth=1.25, zorder=2)

    labels = ["Joint ($k=0$)\n$n=301$", "Cond. ($k=0$)\n$n_{\\mathrm{uns}}=206$", "Joint ($k=1$)\n$n=301$"]
    vals = [0.0486, 0.1261, 0.1962]
    colors = [BLUE, CORAL, CORAL_LIGHT]
    statuses = ["Valid", "Fail-Closed", "Rejected"]

    bx = np.arange(len(labels))
    bars = ax2.bar(bx, vals, width=0.46, color=colors, edgecolor="none", zorder=3)
    for bar, val, status, col in zip(bars, vals, statuses, [BLUE, CORAL, SUB]):
        ax2.text(
            bar.get_x() + bar.get_width() / 2, val + 0.006,
            f"{val:.4f}\n({status})", ha="center", va="bottom",
            fontsize=7.0, fontweight="bold", color=col, linespacing=1.12,
        )

    # Clean non-overlapping delta threshold pill strictly inside plot area
    ax2.annotate(
        r"$\delta = 0.05$ limit",
        xy=(0.48, 0.052), xytext=(0.18, 0.165),
        ha="center", va="bottom", fontsize=7.1, fontweight="bold", color=CORAL,
        bbox=dict(boxstyle="round,pad=0.22", fc="#FFF7ED", ec=CORAL, lw=0.7),
        arrowprops=dict(arrowstyle="->", color=CORAL, lw=0.9, connectionstyle="arc3,rad=0.15"),
    )

    ax2.set_xticks(bx)
    ax2.set_xticklabels(labels, fontsize=7.4)
    ax2.set_xlim(-0.55, 2.55)
    ax2.set_ylim(0.0, 0.245)
    ax2.set_yticks([0.00, 0.05, 0.10, 0.15, 0.20])
    ax2.set_xlabel(r"Calibration Regime at $\alpha = 0.01$")
    ax2.set_ylabel(r"$\mathrm{BinomCDF}(k;\, n,\, 0.01)$")
    ax2.set_title("B. Finite-Sample Floor ($n_{\\mathrm{uns}} \\geq 299$)", loc="left", pad=8)

    fig.subplots_adjust(left=0.085, right=0.985, top=0.87, bottom=0.20)
    fig.savefig(OUT_DIR / "fig1-ltt-calibration.pdf")
    fig.savefig(OUT_DIR / "_preview_fig1.png", dpi=200)
    plt.close(fig)


def build_fig2():
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.0, 3.05), gridspec_kw={"width_ratios": [1.08, 1.0], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Horizontal bar chart for Span Recall Ceiling ----
    style_ax(ax1, "x")
    cats = [
        "All 26 Tags",
        "Bare Names",
        "Targeted 8",
        "Contact / Card\n/ IPv4",
    ]
    recalls = [31.0, 49.6, 62.8, 78.6]
    counts = ["180/580", "118/238", "159/253", "110/140"]
    bar_colors = [SLATE, CORAL, BLUE_MID, BLUE]

    y = np.arange(len(cats))
    bars = ax1.barh(y, recalls, height=0.54, color=bar_colors, edgecolor="none", zorder=3)
    for bar, r, cnt, col in zip(bars, recalls, counts, [SUB, CORAL, BLUE, BLUE]):
        ax1.text(
            r + 2.2, bar.get_y() + bar.get_height() / 2,
            f"{r:.1f}% ({cnt})", va="center", ha="left",
            fontsize=7.3, fontweight="bold", color=col,
        )

    ax1.set_yticks(y)
    ax1.set_yticklabels(cats, fontsize=7.8, color=INK)
    ax1.set_xlim(0, 116)
    ax1.set_xticks([0, 25, 50, 75, 100])
    ax1.set_xticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_xlabel("Validated Regex Recall (%)")
    ax1.set_title("A. PII Span Recall Ceiling (ai4privacy)", loc="left", pad=8)

    # ---- Panel B: Grouped Bar Chart for False-Positive Reduction ----
    style_ax(ax2, "y")
    groups = ["PubMedQA\nTrain (n=250)", "PubMedQA\nBlind (n=250)", "Tech Lookalikes\n(n=5)"]
    naive_fp = [44.4, 45.2, 80.0]
    lex_fp = [22.8, 26.0, 20.0]

    x = np.arange(len(groups))
    w = 0.34
    b1 = ax2.bar(x - w / 2, naive_fp, width=w, color=CORAL, label="Naive Title-Case Regex", zorder=3)
    b2 = ax2.bar(x + w / 2, lex_fp, width=w, color=BLUE, label="Versieve 334-Word Lexicon", zorder=3)

    for bar, v in zip(b1, naive_fp):
        ax2.text(
            bar.get_x() + bar.get_width() / 2, v + 2.2, f"{v:.1f}%",
            ha="center", va="bottom", fontsize=7.0, fontweight="bold", color=CORAL,
        )
    for bar, v in zip(b2, lex_fp):
        ax2.text(
            bar.get_x() + bar.get_width() / 2, v + 2.2, f"{v:.1f}%",
            ha="center", va="bottom", fontsize=7.0, fontweight="bold", color=BLUE,
        )

    # Callout cleanly in open left-center whitespace
    ax2.annotate(
        r"2.72$\times$ fewer hits/1k",
        xy=(1 + w / 2, 36.5), xytext=(0.55, 67),
        ha="center", va="bottom", fontsize=7.0, fontweight="bold", color=TEAL,
        bbox=dict(boxstyle="round,pad=0.22", fc="#F0FDFA", ec=TEAL, lw=0.7),
        arrowprops=dict(arrowstyle="->", color=TEAL, lw=0.9, connectionstyle="arc3,rad=-0.12"),
    )

    ax2.set_xticks(x)
    ax2.set_xticklabels(groups, fontsize=7.3)
    ax2.set_ylim(0, 122)
    ax2.set_yticks([0, 25, 50, 75, 100])
    ax2.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax2.set_ylabel("Docs / Lines Flagged (%)")
    ax2.set_title("B. False-Positive Suppression", loc="left", pad=8)
    ax2.legend(loc="upper left", borderpad=0.38, frameon=True)

    fig.subplots_adjust(left=0.145, right=0.985, top=0.87, bottom=0.19)
    fig.savefig(OUT_DIR / "fig2-pii-disambiguation.pdf")
    fig.savefig(OUT_DIR / "_preview_fig2.png", dpi=200)
    plt.close(fig)


def build_fig3():
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.0, 3.05), gridspec_kw={"width_ratios": [1.08, 1.0], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Horizontal Log-Scale Process Startup ----
    style_ax(ax1, "x")
    subs = [
        "PyTorch +\nDuckDB",
        "Python +\nNumPy",
        "Node.js +\nWASM",
        "C99 Header",
    ]
    ms = [12917.0, 388.79, 106.22, 14.12]
    rss_labels = ["12.9 s (432 MB)", "389 ms (31.5 MB)", "106 ms (56.0 MB)", "14.1 ms (6.1 MB)"]
    cols = [CORAL, SLATE, TEAL, BLUE]

    y = np.arange(len(subs))
    bars = ax1.barh(y, ms, height=0.54, color=cols, edgecolor="none", zorder=3)
    ax1.set_xscale("log")
    ax1.set_xlim(5.0, 380000.0)
    ax1.set_xticks([10, 100, 1000, 10000])
    ax1.set_xticklabels(["10 ms", "100 ms", "1 s", "10 s"])
    ax1.xaxis.set_minor_locator(ticker.NullLocator())

    for bar, val, lbl, col in zip(bars, ms, rss_labels, [CORAL, SUB, TEAL, BLUE]):
        ax1.text(
            val * 1.28, bar.get_y() + bar.get_height() / 2,
            lbl, va="center", ha="left", fontsize=7.1, fontweight="bold", color=col,
        )

    ax1.set_yticks(y)
    ax1.set_yticklabels(subs, fontsize=7.6, color=INK)
    ax1.set_xlabel("Median OS Startup Latency (log scale; Peak RSS)")
    ax1.set_title("A. Process Startup Overhead ($N=7$)", loc="left", pad=8)

    # ---- Panel B: Held-Out Loss Scaling Curve ----
    style_ax(ax2, "y")
    n_labels = ["100", "300", "607"]
    x = np.arange(len(n_labels))
    gate_bce = [0.2577, 0.2244, 0.1890]
    gate_acc = ["92%", "93%", "94%"]
    vera_bce = [0.9432, 0.6698, 0.6141]

    ax2.axhline(0.7833, color=CORAL, linestyle="--", linewidth=1.2, zorder=1)
    ax2.text(
        2.28, 0.808, "Naive regex (0.783)",
        color=CORAL, fontsize=7.1, fontweight="bold", ha="right", va="bottom",
    )

    ax2.plot(
        x, vera_bce, color=TEAL, linewidth=1.8, linestyle="-.", marker="s", markersize=5.2,
        markerfacecolor=TEAL, markeredgecolor="white", markeredgewidth=0.9,
        label="WASM VeRA BCE", zorder=3,
    )
    ax2.plot(
        x, gate_bce, color=BLUE, linewidth=2.1, marker="o", markersize=5.8,
        markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=1.0,
        label="520-d Gate BCE", zorder=4,
    )

    # Clean non-overlapping value labels
    ax2.annotate("0.943", (x[0], vera_bce[0]), xytext=(12, 3), textcoords="offset points",
                 ha="left", va="bottom", fontsize=7.1, fontweight="bold", color=TEAL)
    ax2.annotate("0.670", (x[1], vera_bce[1]), xytext=(4, 7), textcoords="offset points",
                 ha="left", va="bottom", fontsize=7.1, fontweight="bold", color=TEAL)
    ax2.annotate("0.614", (x[2], vera_bce[2]), xytext=(0, 7), textcoords="offset points",
                 ha="center", va="bottom", fontsize=7.1, fontweight="bold", color=TEAL)

    for xi, yi, acc in zip(x, gate_bce, gate_acc):
        ax2.annotate(
            f"{yi:.3f} ({acc})", (xi, yi), xytext=(0, -14), textcoords="offset points",
            ha="center", va="top", fontsize=7.0, fontweight="bold", color=BLUE,
        )

    ax2.set_xticks(x)
    ax2.set_xticklabels([f"$N={s}$" for s in n_labels], fontsize=7.8)
    ax2.set_xlim(-0.38, 2.38)
    ax2.set_ylim(0.0, 1.10)
    ax2.set_yticks([0.00, 0.25, 0.50, 0.75, 1.00])
    ax2.set_xlabel(r"Training Shard Size ($n_{\mathrm{test}}=299$)")
    ax2.set_ylabel("Held-Out BCE Loss (Lower Better)")
    ax2.set_title("B. Held-Out Scaling Ablation", loc="left", pad=8)
    ax2.legend(loc="center left", bbox_to_anchor=(0.01, 0.48), borderpad=0.38)

    fig.subplots_adjust(left=0.135, right=0.985, top=0.87, bottom=0.19)
    fig.savefig(OUT_DIR / "fig3-substrate-and-scaling.pdf")
    fig.savefig(OUT_DIR / "_preview_fig3.png", dpi=200)
    plt.close(fig)


if __name__ == "__main__":
    build_fig1()
    build_fig2()
    build_fig3()
    print("Regenerated polished fig1, fig2, fig3 PDFs + PNG previews.")
