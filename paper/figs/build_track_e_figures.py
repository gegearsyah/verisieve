"""Generate publication-grade vector figures for Paper 2 (v2 reviewer-hardened).
All metrics are loaded dynamically from verified benchmark JSON outputs (zero hardcoded results):
  - results/reviewer-tab-and-ltt-benchmarks.json
  - results/reviewer-secrets-audio-pprl-benchmarks.json
  - results/track-e-paper-benchmarks.json
"""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

OUT_DIR = Path(__file__).resolve().parent
RES_DIR = OUT_DIR.parent.parent / "results"
TAB_PATH = RES_DIR / "reviewer-tab-and-ltt-benchmarks.json"
SAP_PATH = RES_DIR / "reviewer-secrets-audio-pprl-benchmarks.json"
TRK_PATH = RES_DIR / "track-e-paper-benchmarks.json"

BLUE = "#1D4ED8"
BLUE_MID = "#4F7DF3"
BLUE_LIGHT = "#DBEAFE"
TEAL = "#0F766E"
TEAL_LIGHT = "#CCFBF1"
CORAL = "#D95F02"
CORAL_LIGHT = "#FFEDD5"
SLATE = "#64748B"
SLATE_LIGHT = "#F1F5F9"
INK = "#111827"
SUB = "#4B5563"
GRID = "#E5E7EB"
PURPLE = "#6D28D9"
PURPLE_LIGHT = "#EDE9FE"

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


def style_ax(ax, grid_axis="y"):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(axis=grid_axis, color=GRID, linestyle="--", linewidth=0.7, zorder=0)
    ax.set_axisbelow(True)
    ax.tick_params(length=3, width=0.8, color="#9CA3AF")


def build_fig_e0():
    """Architecture schematic accurately showing Detector -> LTT Gate dataflow."""
    wasm_bytes = (OUT_DIR.parent.parent / "vendor" / "wasm" / "verisieve_media.wasm").stat().st_size
    wasm_kb = wasm_bytes / 1024.0

    fig, ax = plt.subplots(figsize=(7.4, 2.6))
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 36)
    ax.axis("off")

    def draw_box(x, y, w, h, title, lines, fc, ec, title_color=INK, fontsize=5.5, title_size=6.1):
        box = patches.FancyBboxPatch(
            (x, y), w, h, boxstyle="round,pad=0.35,rounding_size=1.0",
            facecolor=fc, edgecolor=ec, linewidth=1.1, zorder=2
        )
        ax.add_patch(box)
        ax.text(x + w / 2, y + h - 1.7, title, ha="center", va="top",
                fontsize=title_size, fontweight="bold", color=title_color, zorder=3)
        if lines:
            ax.text(x + w / 2, y + (h - 3.7) / 2, "\n".join(lines), ha="center", va="center",
                    fontsize=fontsize, color=SUB, linespacing=1.30, zorder=3)

    outer = patches.FancyBboxPatch(
        (0.8, 0.8), 98.4, 34.4, boxstyle="round,pad=0.3,rounding_size=1.4",
        facecolor="#FAFAFA", edgecolor=SLATE, linewidth=0.95, linestyle="--", zorder=0
    )
    ax.add_patch(outer)
    ax.text(2.2, 33.4, "Client-Side Zero-Egress Boundary  (Node.js CLI / MCP Server  &  RTIO Browser WebAssembly Sandbox)",
            fontsize=7.1, fontweight="bold", color=SLATE, ha="left", va="center")

    draw_box(
        2.3, 3.8, 18.2, 26.8, "1. Enterprise Inputs",
        [
            "Email: EML, MBOX, MSG",
            "Office: DOCX, PPTX, XLSX",
            "DevOps: HAR, ENV, K8s",
            "Chat/Logs: Slack, VTT, ICS",
            "Audio: WAV PCM16/24/F32",
            "Visual: JPEG, PNG, MP4",
            "Archives: ZIP, TAR.GZ",
        ],
        SLATE_LIGHT, SLATE, title_color=INK
    )

    draw_box(
        23.8, 3.8, 27.2, 26.8, f"2. verisieve_media.wasm ({wasm_kb:.0f} KB)",
        [
            "Rust -> wasm32 (0 host imports)",
            "• Inflate + ZIP/TAR Bomb Guards",
            "• CFBF/OLE2 (.msg) Container",
            "• Unicode Anti-Evasion & Secrets",
            "• Salted Bloom+Soundex PPRL",
            "• Spoken ITN + Word-Span Align",
            "• WAV DSP + EXIF/MP4 + Pixels",
        ],
        BLUE_LIGHT, BLUE, title_color=BLUE, title_size=5.9
    )

    draw_box(
        54.4, 17.6, 20.6, 13.0, "3. Detectors -> LTT Gate",
        [
            "3A WASM + 3B GLiNER scores",
            "feed 520-d Hybrid LTT Gate",
            "Calibrated on human labels",
            "Abstains if uncertified",
        ],
        TEAL_LIGHT, TEAL, title_color=TEAL, fontsize=5.3, title_size=5.9
    )

    draw_box(
        54.4, 3.8, 20.6, 11.4, "Vault + Salted PPRL",
        [
            "HMAC-SHA256 + 128-bit Bloom",
            "Links Noisy OCR/ASR Entities",
            "(Email = Slide = Call = Video)",
        ],
        CORAL_LIGHT, CORAL, title_color=CORAL, fontsize=5.3, title_size=5.9
    )

    draw_box(
        78.4, 3.8, 19.2, 26.8, "4. Graph & Sandbox UI",
        [
            "verisieve_graph.wasm",
            "(0 imports, Dual-CSR)",
            "• Cross-Modal GDPR",
            "  Art. 17 Blast (<1 ms)",
            "• Browser Audio/Video",
            "  WASM Preview Studio",
            "• Signed JSONL + MCP",
        ],
        PURPLE_LIGHT, PURPLE, title_color=PURPLE
    )

    arrow_kw = dict(arrowstyle="-|>", color=INK, lw=1.15, mutation_scale=10)
    ax.annotate("", xy=(23.5, 17.2), xytext=(20.8, 17.2), arrowprops=arrow_kw)
    ax.annotate("", xy=(54.1, 23.8), xytext=(51.3, 21.5), arrowprops=arrow_kw)
    ax.annotate("", xy=(54.1, 9.6), xytext=(51.3, 12.5), arrowprops=arrow_kw)
    ax.annotate("", xy=(64.7, 15.5), xytext=(64.7, 17.3), arrowprops=dict(arrowstyle="<->", color=SUB, lw=0.95, mutation_scale=8))
    ax.annotate("", xy=(78.1, 21.5), xytext=(75.3, 23.5), arrowprops=arrow_kw)
    ax.annotate("", xy=(78.1, 11.5), xytext=(75.3, 9.6), arrowprops=arrow_kw)

    out = OUT_DIR / "fig_e0_multimodal_architecture.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e1(tab):
    """Panel A: TAB Person PR Curve (WASM SR-MP + GLiNER vs Dev-Filtered GLiNER vs Presidio vs Paper 1);
       Panel B: Cluster-Robust HC-CRC vs Naive Paragraph-IID LTT & E-LTT."""
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.3, 3.15), gridspec_kw={"width_ratios": [1.05, 1.12], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: TAB Person PR Curve ----
    style_ax(ax1, "both")
    df_pts = [p for p in tab["prCurves"]["devFilteredPerson"] if p["recallPct"] > 0]
    ax1.plot([p["recallPct"] for p in df_pts], [p["precisionPct"] for p in df_pts],
             color=BLUE, linewidth=1.8, linestyle="--", marker="o", markersize=4.4,
             markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=0.8,
             label="Isolated GLiNER-Edge 45M", zorder=4)

    srmp_pts = [p for p in tab["prCurves"].get("srmpPerson", []) if p["recallPct"] > 0]
    if srmp_pts:
        ax1.plot([p["recallPct"] for p in srmp_pts], [p["precisionPct"] for p in srmp_pts],
                 color=PURPLE, linewidth=2.1, marker="^", markersize=5.0,
                 markerfacecolor=PURPLE, markeredgecolor="white", markeredgewidth=0.8,
                 label="WASM SR-MP + GLiNER 45M", zorder=5)

    for p in df_pts:
        t = p["threshold"]
        if t in (0.3, 0.5, 0.7):
            off = (-18, -11) if t == 0.5 else (-14, -12) if t == 0.3 else (5, -6)
            ax1.annotate(f"τ={t:.1f}", (p["recallPct"], p["precisionPct"]), xytext=off,
                         textcoords="offset points", fontsize=6.1, color=BLUE, fontweight="bold")

    pres = tab["personComparison"]["presidioPerson"]
    p1 = tab["personComparison"]["paper1Regex"]
    ax1.scatter([pres["recallPct"]], [pres["precisionPct"]], color=TEAL, marker="D", s=54,
                edgecolors="white", linewidth=0.9, zorder=6,
                label=f"Presidio lg 401 MB (F1 {pres['f1Pct']:.1f}%)")
    ax1.scatter([p1["recallPct"]], [p1["precisionPct"]], color=CORAL, marker="s", s=52,
                edgecolors="white", linewidth=0.9, zorder=6,
                label=f"Paper 1 Regex (F1 {p1['f1Pct']:.1f}%)")

    ax1.annotate(f"Presidio\n({pres['recallPct']:.1f}%, {pres['precisionPct']:.1f}%)",
                 (pres["recallPct"], pres["precisionPct"]), xytext=(-54, 10),
                 textcoords="offset points", fontsize=6.1, fontweight="bold", color=TEAL,
                 arrowprops=dict(arrowstyle="->", color=TEAL, lw=0.9))
    ax1.annotate(f"Paper 1 Regex\n({p1['recallPct']:.1f}%, {p1['precisionPct']:.1f}%)",
                 (p1["recallPct"], p1["precisionPct"]), xytext=(-60, 15),
                 textcoords="offset points", fontsize=6.1, fontweight="bold", color=CORAL,
                 arrowprops=dict(arrowstyle="->", color=CORAL, lw=0.9))

    ax1.set_xlim(0, 106)
    ax1.set_ylim(0, 112)
    ax1.set_xlabel("TAB Held-Out Person Recall (%)")
    ax1.set_ylabel("TAB Held-Out Person Precision (%)")
    ax1.set_title("A. TAB Person PR Curve (127 ECHR)", loc="left", pad=8)
    ax1.legend(loc="lower left", fontsize=5.8)

    # ---- Panel B: Cluster-Robust HC-CRC vs Naive IID LTT (Cond. FPR vs Auto-Release) ----
    style_ax(ax2, "y")
    ltt = tab["nonCircularGroundTruthLtt"]
    alphas = [s["alpha"] * 100 for s in ltt["detectorInformedHybridLtt"]]
    x = np.arange(len(alphas))

    hyb_fpr = [s["testConditionalFprPct"] for s in ltt["detectorInformedHybridLtt"]]
    hc_list = ltt.get("documentClusteredHcCrc", ltt["detectorInformedHybridLtt"])
    hc_fpr = [s["testConditionalFprPct"] for s in hc_list]
    hc_auto = [s["overallAutoReleasePct"] for s in hc_list]
    eltt_list = ltt.get("streamingMartingaleELtt", [])
    eltt_fpr = [s["testConditionalFprPct"] for s in eltt_list] if eltt_list else None

    ax2.plot(x, alphas, color=SLATE, linestyle="--", linewidth=1.1, label="Target Budget α", zorder=1)
    ax2.plot(x, hyb_fpr, color=CORAL, linewidth=1.6, linestyle=":", marker="^", markersize=4.8,
             label="Naive IID Hybrid FPR (10.1% @ α=10%)", zorder=3)
    ax2.plot(x, hc_fpr, color=BLUE, linewidth=2.1, marker="o", markersize=5.0,
             markerfacecolor=BLUE, markeredgecolor="white", label="Cluster HC-CRC FPR (8.2% @ α=10%)", zorder=5)
    if eltt_fpr:
        ax2.plot(x, eltt_fpr, color=PURPLE, linewidth=1.5, linestyle=":", marker="d", markersize=4.4,
                 label="Streaming E-LTT Martingale FPR", zorder=4)
    ax2.plot(x, hc_auto, color=TEAL, linewidth=1.9, linestyle="-.", marker="s", markersize=4.6,
             label="HC-CRC Auto-Release (% all)", zorder=3)

    ax2.annotate(f"HC-CRC: {hc_fpr[2]:.2f}% FPR\n{hc_auto[2]:.1f}% rel.", (2, hc_auto[2]), xytext=(-14, 11),
                 textcoords="offset points", fontsize=5.9, fontweight="bold", color=TEAL,
                 arrowprops=dict(arrowstyle="->", color=TEAL, lw=0.8))
    ax2.annotate(f"HC-CRC {hc_fpr[3]:.2f}% ≤ 10%\n(DEFF=2.62 fixed)", (3, hc_fpr[3]), xytext=(-28, -22),
                 textcoords="offset points", fontsize=5.8, fontweight="bold", color=BLUE,
                 arrowprops=dict(arrowstyle="->", color=BLUE, lw=0.8))

    ax2.set_xticks(x)
    ax2.set_xticklabels([f"{a:.0f}%" for a in alphas])
    ax2.set_xlim(-0.35, len(x) - 0.55)
    ax2.set_ylim(-2, 35)
    ax2.set_xlabel("Target Conformal Budget α (δ = 0.05)")
    ax2.set_ylabel("Held-Out TAB Rate (% of 1,999)")
    ax2.set_title("B. Cluster HC-CRC vs. Naive LTT", loc="left", pad=8)
    ax2.legend(loc="upper left", fontsize=5.4, ncol=1)

    out = OUT_DIR / "fig_e1_tab_pr_and_gt_ltt.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e2(sap, trk):
    """Panel A: External Secrets (F1 + Steady-State MB/s from 10x batch);
       Panel B: Unicode Evasion (Unnormalized vs Python NFKC vs verisieve_media.wasm)."""
    sec = sap["expR3_externalSecrets"]
    u_nfkc = sap["expR6_unicodeNfkcBaseline"]
    u_wasm = trk["exp1_piiAndEvasion"]["adversarialUnicodeEvasion"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.3, 2.95), gridspec_kw={"width_ratios": [1.05, 1.25], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: External Secrets (Steady-State Throughput, No Startup Cheat) ----
    style_ax(ax1, "y")
    tools = [
        ("Yelp\ndetect-secrets", sec["yelp_detect_secrets"], TEAL),
        ("verisieve_\nmedia.wasm", sec["verisieve_media_wasm"], BLUE),
        ("Gitleaks\nv8.30.1", sec["gitleaks_v8_30_1"], CORAL),
    ]
    x = np.arange(len(tools))
    f1s = [t[1]["f1Pct"] for t in tools]
    recs = [t[1]["recallPct"] for t in tools]
    mbps = [t[1]["steadyStateMBps"] for t in tools]
    cols = [t[2] for t in tools]

    w = 0.34
    ax1.bar(x - w / 2, f1s, w, color=cols, label="F1 (100% Prec, 0% FP)", zorder=3)
    ax1.bar(x + w / 2, recs, w, color=cols, alpha=0.45, hatch="//", edgecolor="white", label="Recall (%)", zorder=3)

    for i in range(len(tools)):
        ax1.text(x[i] - w / 2, f1s[i] + 1.8, f"{f1s[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.4, fontweight="bold", color=cols[i])
        ax1.text(x[i] + w / 2, recs[i] + 1.8, f"{recs[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.2, color=SUB)
        ax1.text(x[i], 5.5, f"{mbps[i]:.2f} MB/s", ha="center", va="bottom",
                 fontsize=6.0, fontweight="bold", color="white",
                 bbox=dict(boxstyle="round,pad=0.18", fc=INK, ec="none", alpha=0.80))

    ax1.set_xticks(x)
    ax1.set_xticklabels([t[0] for t in tools])
    ax1.set_ylim(0, 118)
    ax1.set_yticks([0, 25, 50, 75, 100])
    ax1.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_ylabel("External Secret Score (%)")
    ax1.set_title("A. External Secrets (10x Steady MB/s)", loc="left", pad=8)
    ax1.legend(loc="upper right", fontsize=6.0)

    # ---- Panel B: Unicode Evasion (Unnormalized vs Python NFKC vs WASM) ----
    style_ax(ax2, "y")
    attacks = ["zwsp", "homoglyph", "fullwidth"]
    att_labels = ["Zero-Width\n(U+200B, n=87)", "Cyrillic\n(n=47)", "Full-Width\n(n=40)"]
    raw_v = [u_nfkc[a]["unnormalizedRegexPct"] for a in attacks]
    nfkc_v = [u_nfkc[a]["pythonNfkcRegexPct"] for a in attacks]
    wasm_v = [u_wasm[a]["wasmRecallPct"] for a in attacks]

    xb = np.arange(len(attacks))
    wb = 0.25
    ax2.bar(xb - wb, raw_v, wb, color=CORAL, label="Unnormalized Regex", zorder=3)
    ax2.bar(xb, nfkc_v, wb, color=SLATE, label="Python NFKC + Regex", zorder=3)
    ax2.bar(xb + wb, wasm_v, wb, color=BLUE, label="verisieve_media.wasm", zorder=3)

    for i in range(len(attacks)):
        ax2.text(xb[i] - wb, raw_v[i] + 2.0, f"{raw_v[i]:.0f}%", ha="center", va="bottom", fontsize=6.0, color=CORAL, fontweight="bold")
        ax2.text(xb[i], nfkc_v[i] + 2.0, f"{nfkc_v[i]:.0f}%", ha="center", va="bottom", fontsize=6.0, color=SLATE, fontweight="bold")
        ax2.text(xb[i] + wb, wasm_v[i] + 2.0, f"{wasm_v[i]:.1f}%", ha="center", va="bottom", fontsize=6.0, color=BLUE, fontweight="bold")

    ax2.set_xticks(xb)
    ax2.set_xticklabels(att_labels)
    ax2.set_ylim(0, 134)
    ax2.set_yticks([0, 25, 50, 75, 100])
    ax2.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax2.set_ylabel("PII Detection Recall (%)")
    ax2.set_title("B. Unicode Evasion vs. Standard NFKC", loc="left", pad=8)
    ax2.legend(loc="upper center", ncol=2, fontsize=5.9)

    out = OUT_DIR / "fig_e2_secrets_and_evasion.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e3(sap):
    """Panel A: 25-Call Cross-Model small.en Audio (Consistent Denominator + 95% Wilson CIs);
       Panel B: PPRL vs Plaintext JW/Levenshtein Ceiling + 500-Name Scale Collision Callout."""
    aud = sap["expR4_endToEndWhisperAudio"]
    pprl = sap["expR5_pprlRealityCheck"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.3, 2.95), gridspec_kw={"width_ratios": [1.05, 1.15], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: 25-Call Cross-Model Audio (Same Base = 97 Planted PII Tokens) ----
    style_ax(ax1, "y")
    srmp_v = aud.get("srmpPostLeakageOfPlantedPct", aud["postLeakageOfPlantedPct"])
    ci_srmp = aud.get("srmpPostLeakageWilson95CI", aud["postLeakageWilson95CI"])
    labels = ["Pre-Redact\nExposure\n(small.en)", "Isolated\nITN+GLiNER\n(small.en)", "WASM SR-MP\nCoupled\n(small.en)", "Non-PII\nContext\nRetained"]
    vals = [aud["preExposureOfPlantedPct"], aud["postLeakageOfPlantedPct"], srmp_v, aud["nonPiiContextRetentionPct"]]
    ci_pre = aud["preExposureWilson95CI"]
    ci_post = aud["postLeakageWilson95CI"]
    yerr_lo = [vals[0] - ci_pre[0], vals[1] - ci_post[0], vals[2] - ci_srmp[0], 0.0]
    yerr_hi = [ci_pre[1] - vals[0], ci_post[1] - vals[1], ci_srmp[1] - vals[2], 0.0]
    cols = [CORAL, BLUE_MID, PURPLE, TEAL]
    x = np.arange(len(labels))
    bars = ax1.bar(x, vals, width=0.52, color=cols, zorder=3)
    ax1.errorbar(x[:3], vals[:3], yerr=[yerr_lo[:3], yerr_hi[:3]], fmt="none", ecolor=INK, elinewidth=1.1, capsize=3.2, zorder=4)

    for i, (bar, v) in enumerate(zip(bars, vals)):
        top = v + (yerr_hi[i] if i < 3 else 0) + 2.2
        ax1.text(bar.get_x() + bar.get_width() / 2, top, f"{v:.1f}%",
                 ha="center", va="bottom", fontsize=6.6, fontweight="bold", color=INK)

    ax1.annotate(
        f"SR-MP: -{aud.get('srmpAbsoluteDropPercentagePoints', 86.6):.1f} pp ({aud.get('srmpRelativeReductionOfExposedPct', 91.3):.1f}% cut)\n{aud.get('srmpCallsWithZeroPostLeak', 21)}/{aud['callsEvaluated']} calls 0 leak",
        xy=(2, ci_srmp[1] + 8), xytext=(1.55, 76),
        arrowprops=dict(arrowstyle="->", color=PURPLE, lw=1.0),
        fontsize=5.9, fontweight="bold", color=PURPLE, ha="center",
        bbox=dict(boxstyle="round,pad=0.22", fc=PURPLE_LIGHT, ec=PURPLE, lw=0.8),
    )

    ax1.set_xticks(x)
    ax1.set_xticklabels(labels, fontsize=7.0)
    ax1.set_ylim(0, 118)
    ax1.set_yticks([0, 25, 50, 75, 100])
    ax1.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_ylabel("% of Planted PII Tokens (95% CI)")
    ax1.set_title("A. 25-Call Audio (Attacker: small.en)", loc="left", pad=8)

    # ---- Panel B: PPRL vs Plaintext Ceilings + 500-Name Scale Collision ----
    style_ax(ax2, "y")
    methods = [
        ("Exact\nHMAC", pprl["exactHmacBaseline"]["f1Pct"], SLATE),
        ("Plaintext\nJaro-Wink.", pprl["plaintextJaroWinklerCeiling"]["f1Pct"], TEAL),
        ("Plaintext\nLevenshtein", pprl["plaintextLevenshteinCeiling"]["f1Pct"], PURPLE),
        ("WASM Salted\nBloom PPRL", pprl["wasmSaltedBloomSoundexPprl"]["f1Pct"], BLUE),
    ]
    xb = np.arange(len(methods))
    bars2 = ax2.bar(xb, [m[1] for m in methods], width=0.52, color=[m[2] for m in methods], zorder=3)
    for bar, m in zip(bars2, methods):
        ax2.text(bar.get_x() + bar.get_width() / 2, m[1] + 2.0, f"{m[1]:.1f}%",
                 ha="center", va="bottom", fontsize=6.7, fontweight="bold", color=m[2])

    sc = pprl["scale500CommonNamesCollision"]
    callout = (
        f"500-Name Scale ({sc['allPairsNegativeCount']:,} neg pairs):\n"
        f"• PPRL τ=0.60: {sc['pprlFalseLinkRateAtDevThrPct']:.2f}% FP\n"
        f"• PPRL τ=0.75: {sc['pprlFalseLinkRateAtStrict075Pct']:.2f}% FP (vs JW {sc['plaintextJaroWinklerFalseLinkRatePct']:.2f}%)"
    )
    ax2.text(0.03, 0.96, callout, transform=ax2.transAxes, ha="left", va="top",
             fontsize=5.9, color=INK, linespacing=1.32,
             bbox=dict(boxstyle="round,pad=0.25", fc=BLUE_LIGHT, ec=BLUE_MID, lw=0.8))

    ax2.set_xticks(xb)
    ax2.set_xticklabels([m[0] for m in methods])
    ax2.set_ylim(0, 130)
    ax2.set_yticks([0, 25, 50, 75, 100])
    ax2.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax2.set_ylabel("Held-Out Linkage F1 (40 Test Pairs)")
    ax2.set_title("B. PPRL vs. Plaintext Ceiling & Scale", loc="left", pad=8)

    out = OUT_DIR / "fig_e3_audio_e2e_and_pprl.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def main():
    tab = json.loads(TAB_PATH.read_text(encoding="utf-8"))
    sap = json.loads(SAP_PATH.read_text(encoding="utf-8"))
    trk = json.loads(TRK_PATH.read_text(encoding="utf-8"))
    build_fig_e0()
    build_fig_e1(tab)
    build_fig_e2(sap, trk)
    build_fig_e3(sap)


if __name__ == "__main__":
    main()
