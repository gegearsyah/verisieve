"""Generate publication-grade vector figures for Paper 2 (verisieve-multimodal-sanitization-benchmark.tex).
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

# Colorblind-safe academic palette matching Paper 1
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
    "font.size": 8.4,
    "axes.titlesize": 9.3,
    "axes.titleweight": "bold",
    "axes.labelsize": 8.3,
    "axes.labelweight": "bold",
    "axes.edgecolor": "#9CA3AF",
    "axes.linewidth": 0.8,
    "xtick.labelsize": 7.8,
    "ytick.labelsize": 7.8,
    "xtick.color": SUB,
    "ytick.color": SUB,
    "text.color": INK,
    "legend.fontsize": 7.0,
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
    """Architecture schematic of VeriSieve-MM zero-import WASM multimodal sanitization."""
    wasm_bytes = (OUT_DIR.parent.parent / "vendor" / "wasm" / "verisieve_media.wasm").stat().st_size
    wasm_kb = wasm_bytes / 1024.0

    fig, ax = plt.subplots(figsize=(7.4, 2.6))
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 36)
    ax.axis("off")

    def draw_box(x, y, w, h, title, lines, fc, ec, title_color=INK, fontsize=5.5, title_size=6.2):
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
    ax.text(2.2, 33.4, "100% Client-Side Zero-Egress Boundary  (Node.js CLI / MCP Server  &  Browser WebAssembly Sandbox)",
            fontsize=7.2, fontweight="bold", color=SLATE, ha="left", va="center")

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
        BLUE_LIGHT, BLUE, title_color=BLUE, title_size=6.0
    )

    draw_box(
        54.4, 17.6, 20.6, 13.0, "3. Hybrid + LTT Gate",
        [
            "3A: WASM Checksums/Secrets",
            "3B: GLiNER-Edge 45M (Opt-in)",
            "LTT Conformal Gatekeeper",
            "Fail-closed if uncertified",
        ],
        TEAL_LIGHT, TEAL, title_color=TEAL, fontsize=5.4
    )

    draw_box(
        54.4, 3.8, 20.6, 11.4, "Vault + Salted PPRL",
        [
            "HMAC-SHA256 + 128-bit Bloom",
            "Links Noisy OCR/ASR Entities",
            "(Email = Slide = Call = Video)",
        ],
        CORAL_LIGHT, CORAL, title_color=CORAL, fontsize=5.4, title_size=6.0
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
    """Panel A: Single-dataset PR Curve on TAB ECHR (PERSON); Panel B: Non-Circular Ground-Truth LTT on TAB."""
    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.2, 3.1), gridspec_kw={"width_ratios": [1.08, 1.05], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Single-dataset PR Curve on TAB (127 ECHR rulings, PERSON) ----
    style_ax(ax1, "both")
    gl_pts = [p for p in tab["prCurves"]["vanillaGlinerPerson"] if p["recallPct"] > 0]
    gl_r = [p["recallPct"] for p in gl_pts]
    gl_p = [p["precisionPct"] for p in gl_pts]
    gl_t = [p["threshold"] for p in gl_pts]

    ax1.plot(gl_r, gl_p, color=BLUE, linewidth=2.0, marker="o", markersize=5.0,
             markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=0.8,
             label="GLiNER-Edge 45M INT8 (PR sweep)", zorder=4)

    for r, p, t in zip(gl_r, gl_p, gl_t):
        if t in (0.3, 0.5, 0.6, 0.7):
            off = (-16, 7) if t == 0.5 else (6, -10) if t == 0.6 else (-14, -12) if t == 0.3 else (6, -6)
            ax1.annotate(f"τ={t:.1f}", (r, p), xytext=off, textcoords="offset points",
                         fontsize=6.4, color=BLUE, fontweight="bold")

    pres = tab["personEntityComparison"]["microsoftPresidio"]
    p1 = tab["personEntityComparison"]["paper1RegexLexicon"]
    ax1.scatter([pres["recallPct"]], [pres["precisionPct"]], color=TEAL, marker="D", s=54,
                edgecolors="white", linewidth=0.9, zorder=5,
                label=f"Presidio en_core_web_lg 401 MB (F1 {pres['f1Pct']:.1f}%)")
    ax1.scatter([p1["recallPct"]], [p1["precisionPct"]], color=CORAL, marker="s", s=52,
                edgecolors="white", linewidth=0.9, zorder=5,
                label=f"Paper 1 Regex+Lexicon (F1 {p1['f1Pct']:.1f}%)")

    ax1.annotate(f"Presidio\n({pres['recallPct']:.1f}%, {pres['precisionPct']:.1f}%)",
                 (pres["recallPct"], pres["precisionPct"]), xytext=(-54, 10),
                 textcoords="offset points", fontsize=6.4, fontweight="bold", color=TEAL,
                 arrowprops=dict(arrowstyle="->", color=TEAL, lw=0.9))
    ax1.annotate(f"Paper 1 Regex\n({p1['recallPct']:.1f}%, {p1['precisionPct']:.1f}%)",
                 (p1["recallPct"], p1["precisionPct"]), xytext=(-62, 16),
                 textcoords="offset points", fontsize=6.4, fontweight="bold", color=CORAL,
                 arrowprops=dict(arrowstyle="->", color=CORAL, lw=0.9))

    ax1.set_xlim(0, 106)
    ax1.set_ylim(0, 112)
    ax1.set_xlabel("TAB Held-Out Person Recall (%)")
    ax1.set_ylabel("TAB Held-Out Person Precision (%)")
    ax1.set_title("A. TAB Person PR Curve (127 ECHR)", loc="left", pad=8)
    ax1.legend(loc="lower left", fontsize=6.2)

    # ---- Panel B: Non-Circular Ground-Truth LTT on TAB (1,999 held-out paragraphs) ----
    style_ax(ax2, "y")
    sweep = tab["nonCircularGroundTruthLtt"]["sweep"]
    alphas = [s["alpha"] * 100 for s in sweep]
    fprs = [s["testConditionalFprPct"] for s in sweep]
    yields = [s["testSafeYieldPct"] for s in sweep]
    x = np.arange(len(alphas))

    ax2.plot(x, alphas, color=SLATE, linestyle="--", linewidth=1.2, label="Target Risk Budget (α)", zorder=2)
    ax2.plot(x, fprs, color=BLUE, linewidth=2.1, marker="o", markersize=5.5,
             markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=0.9,
             label="Held-Out Cond. FPR (≤ α)", zorder=4)
    ax2.plot(x, yields, color=TEAL, linewidth=1.9, linestyle="-.", marker="s", markersize=5.0,
             markerfacecolor=TEAL, markeredgecolor="white", markeredgewidth=0.9,
             label="Held-Out Safe Yield (%)", zorder=3)

    for i, (f, yld) in enumerate(zip(fprs, yields)):
        if i in (0, 2, 3, 4):
            ax2.annotate(f"{f:.1f}%", (i, f), xytext=(0, -13 if i > 0 else 6), textcoords="offset points",
                         ha="center", fontsize=6.5, fontweight="bold", color=BLUE)
            ax2.annotate(f"{yld:.1f}%", (i, yld), xytext=(0, 7), textcoords="offset points",
                         ha="center", fontsize=6.5, fontweight="bold", color=TEAL)

    ax2.set_xticks(x)
    ax2.set_xticklabels([f"{a:.0f}%" for a in alphas])
    ax2.set_xlim(-0.35, len(x) - 0.55)
    ax2.set_ylim(-4, 58)
    ax2.set_xlabel("Target Conformal Risk Budget α (δ = 0.05)")
    ax2.set_ylabel("Held-Out TAB Rate (%)")
    ax2.set_title("B. Non-Circular Ground-Truth LTT (TAB)", loc="left", pad=8)
    ax2.legend(loc="upper left", fontsize=6.3)

    out = OUT_DIR / "fig_e1_tab_pr_and_gt_ltt.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e2(sap, trk):
    """Panel A: External Secret Scanning (detect-secrets vs WASM vs Gitleaks); Panel B: Unicode Evasion."""
    sec = sap["expR3_externalSecrets"]
    ev = trk["exp1_piiAndEvasion"]["adversarialUnicodeEvasion"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.2, 2.9), gridspec_kw={"width_ratios": [1.12, 1.15], "wspace": 0.34}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: External Secret Scanning (F1 + Latency callout) ----
    style_ax(ax1, "y")
    tools = [
        ("Yelp\ndetect-secrets", sec["yelp_detect_secrets"], TEAL),
        ("verisieve_\nmedia.wasm", sec["verisieve_media_wasm"], BLUE),
        ("Gitleaks\nv8.30.1", sec["gitleaks_v8_30_1"], CORAL),
    ]
    x = np.arange(len(tools))
    f1s = [t[1]["f1Pct"] for t in tools]
    recs = [t[1]["recallPct"] for t in tools]
    ms = [t[1]["elapsedMs"] for t in tools]
    cols = [t[2] for t in tools]

    w = 0.34
    ax1.bar(x - w / 2, f1s, w, color=cols, label="F1 Score (100% Prec, 0% FP)", zorder=3)
    ax1.bar(x + w / 2, recs, w, color=cols, alpha=0.45, hatch="//", edgecolor="white", label="Recall (%)", zorder=3)

    for i in range(len(tools)):
        ax1.text(x[i] - w / 2, f1s[i] + 1.8, f"{f1s[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.5, fontweight="bold", color=cols[i])
        ax1.text(x[i] + w / 2, recs[i] + 1.8, f"{recs[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.3, color=SUB)
        ax1.text(x[i], 6.0, f"{ms[i]:.0f} ms", ha="center", va="bottom",
                 fontsize=6.4, fontweight="bold", color="white",
                 bbox=dict(boxstyle="round,pad=0.18", fc=INK, ec="none", alpha=0.78))

    ax1.set_xticks(x)
    ax1.set_xticklabels([t[0] for t in tools])
    ax1.set_ylim(0, 114)
    ax1.set_yticks([0, 25, 50, 75, 100])
    ax1.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_ylabel("External Secret Corpus Score (%)")
    ax1.set_title("A. External Secrets (520 Files)", loc="left", pad=8)
    ax1.legend(loc="upper right", fontsize=6.2)

    # ---- Panel B: Adversarial Unicode Evasion ----
    style_ax(ax2, "y")
    attacks = ["clean", "zwsp", "homoglyph", "fullwidth"]
    att_labels = ["Clean\nBaseline", "Zero-Width\n(U+200B)", "Cyrillic\nHomoglyph", "Full-Width\nDigits"]
    rx_vals = [ev[a]["regexRecallPct"] for a in attacks]
    ws_vals = [ev[a]["wasmRecallPct"] for a in attacks]

    xb = np.arange(len(attacks))
    wb = 0.34
    ax2.bar(xb - wb / 2, rx_vals, wb, color=CORAL, label="Unnormalized Regex", zorder=3)
    ax2.bar(xb + wb / 2, ws_vals, wb, color=BLUE, label="verisieve_media.wasm", zorder=3)

    for i in range(len(attacks)):
        off_l = -0.05 if i == 0 else 0.0
        off_r = 0.05 if i == 0 else 0.0
        ax2.text(xb[i] - wb / 2 + off_l, rx_vals[i] + 2.2, f"{rx_vals[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.4, fontweight="bold", color=CORAL if rx_vals[i] < 50 else SUB)
        ax2.text(xb[i] + wb / 2 + off_r, ws_vals[i] + 2.2, f"{ws_vals[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.4, fontweight="bold", color=BLUE)

    ax2.set_xticks(xb)
    ax2.set_xticklabels(att_labels)
    ax2.set_ylim(0, 128)
    ax2.set_yticks([0, 25, 50, 75, 100])
    ax2.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax2.set_ylabel("PII Detection Recall (%)")
    ax2.set_title("B. Adversarial Unicode Evasion", loc="left", pad=8)
    ax2.legend(loc="upper center", ncol=2, fontsize=6.3)

    out = OUT_DIR / "fig_e2_secrets_and_evasion.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e3(sap):
    """Panel A: End-to-End Whisper Audio PII Redaction; Panel B: Noisy Cross-Modal PPRL Linkage."""
    aud = sap["expR4_endToEndWhisperAudio"]
    pprl = sap["expR5_noisyCrossModalPprl"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.1, 2.85), gridspec_kw={"width_ratios": [1.05, 1.05], "wspace": 0.30}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Real End-to-End Whisper Audio Redaction ----
    style_ax(ax1, "y")
    labels = ["Pre-Redaction\nWhisper PII\nExposure", "Post-Redaction\nWhisper PII\nLeakage", "Non-PII Speech\nContext\nRetained"]
    vals = [aud["preRedactionAsrExposurePct"], aud["postRedactionAsrLeakagePct"], aud["nonPiiContextRetentionPct"]]
    cols = [CORAL, BLUE, TEAL]
    x = np.arange(len(labels))
    bars = ax1.bar(x, vals, width=0.50, color=cols, zorder=3)

    for bar, v in zip(bars, vals):
        ax1.text(bar.get_x() + bar.get_width() / 2, v + 2.2, f"{v:.1f}%",
                 ha="center", va="bottom", fontsize=7.2, fontweight="bold", color=INK)

    ax1.annotate(
        f"-{aud['asrPiiLeakageReductionPct']:.1f}% ASR leak\n({aud['callsWithZeroPostRedactionLeak']}/{aud['callsEvaluated']} calls 0 leak)",
        xy=(1, vals[1] + 9), xytext=(0.95, 72),
        arrowprops=dict(arrowstyle="->", color=BLUE, lw=1.1),
        fontsize=6.6, fontweight="bold", color=BLUE, ha="center",
        bbox=dict(boxstyle="round,pad=0.25", fc=BLUE_LIGHT, ec=BLUE_MID, lw=0.8),
    )

    ax1.set_xticks(x)
    ax1.set_xticklabels(labels)
    ax1.set_ylim(0, 118)
    ax1.set_yticks([0, 25, 50, 75, 100])
    ax1.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_ylabel("ASR-Verified Rate (%)")
    ax1.set_title("A. End-to-End Whisper Audio Redaction", loc="left", pad=8)

    # ---- Panel B: Noisy Cross-Modal GDPR Linkage (Exact HMAC vs Salted PPRL) ----
    style_ax(ax2, "y")
    cats = ["OCR Noise\n(15 pairs)", "ASR Phonetic\n(15 pairs)", "Hard Negatives\nFalse-Link (30)"]
    hm = pprl["exactHmacBaseline"]
    pp = pprl["saltedBloomSoundexPprl"]
    hm_v = [hm["ocrRecallPct"], hm["asrRecallPct"], hm["falseLinkRatePct"]]
    pp_v = [pp["ocrRecallPct"], pp["asrRecallPct"], pp["falseLinkRatePct"]]

    xb = np.arange(len(cats))
    wb = 0.34
    ax2.bar(xb - wb / 2, hm_v, wb, color=SLATE, label="Exact HMAC-SHA256 Only", zorder=3)
    ax2.bar(xb + wb / 2, pp_v, wb, color=TEAL, label="WASM Salted Bloom+Soundex PPRL", zorder=3)

    for i in range(len(cats)):
        ax2.text(xb[i] - wb / 2, hm_v[i] + 2.2, f"{hm_v[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.8, fontweight="bold", color=SLATE)
        ax2.text(xb[i] + wb / 2, pp_v[i] + 2.2, f"{pp_v[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.8, fontweight="bold", color=TEAL)

    ax2.set_xticks(xb)
    ax2.set_xticklabels(cats)
    ax2.set_ylim(0, 128)
    ax2.set_yticks([0, 25, 50, 75, 100])
    ax2.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax2.set_ylabel("Cross-Modal Linkage Rate (%)")
    ax2.set_title("B. Noisy Cross-Modal GDPR Erasure (PPRL)", loc="left", pad=8)
    ax2.legend(loc="upper center", ncol=1, fontsize=6.4)

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
