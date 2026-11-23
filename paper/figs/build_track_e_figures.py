"""Generate publication-grade vector figures for Paper 2 (verisieve-multimodal-sanitization-benchmark.tex).
Reads all metrics dynamically from results/track-e-paper-benchmarks.json (zero hardcoded results).
"""
import json
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as patches
import numpy as np

OUT_DIR = Path(__file__).resolve().parent
DATA_PATH = OUT_DIR.parent.parent / "results" / "track-e-paper-benchmarks.json"

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
    "legend.fontsize": 7.2,
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


def build_fig_e0(data):
    """Architecture schematic of VeriSieve-MM zero-import WASM multimodal sanitization."""
    fig, ax = plt.subplots(figsize=(7.1, 2.55))
    fig.patch.set_facecolor("white")
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 36)
    ax.axis("off")

    wasm_kb = data["exp5_scaleSecurityAndCrossModalGraph"]["wasmBinaryBytes"] / 1024.0

    def draw_box(x, y, w, h, title, lines, fc, ec, title_color=INK, fontsize=6.5, title_size=6.9):
        box = patches.FancyBboxPatch(
            (x, y), w, h, boxstyle="round,pad=0.35,rounding_size=1.0",
            facecolor=fc, edgecolor=ec, linewidth=1.1, zorder=2
        )
        ax.add_patch(box)
        ax.text(x + w / 2, y + h - 1.8, title, ha="center", va="top",
                fontsize=title_size, fontweight="bold", color=title_color, zorder=3)
        if lines:
            body = "\n".join(lines)
            ax.text(x + w / 2, y + (h - 3.8) / 2, body, ha="center", va="center",
                    fontsize=fontsize, color=SUB, linespacing=1.32, zorder=3)

    # Outer local zero-egress boundary
    outer = patches.FancyBboxPatch(
        (0.8, 0.8), 98.4, 34.4, boxstyle="round,pad=0.3,rounding_size=1.4",
        facecolor="#FAFAFA", edgecolor=SLATE, linewidth=0.95, linestyle="--", zorder=0
    )
    ax.add_patch(outer)
    ax.text(2.2, 33.4, "100% Client-Side Zero-Egress Boundary  (Node.js CLI / MCP Server  &  Browser WebAssembly Sandbox)",
            fontsize=7.2, fontweight="bold", color=SLATE, ha="left", va="center")

    # Stage 1: Enterprise Unstructured Inputs
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
        SLATE_LIGHT, SLATE, title_color=INK, fontsize=6.0
    )

    # Stage 2: verisieve_media.wasm (0 imports)
    draw_box(
        23.8, 3.8, 27.2, 26.8, f"2. verisieve_media.wasm ({wasm_kb:.0f} KB)",
        [
            "Rust -> wasm32 (0 host imports)",
            "• Inflate + ZIP/TAR Bomb Guards",
            "• CFBF/OLE2 (.msg) Container",
            "• Unicode Anti-Evasion & Checksums",
            "• 30+ Secret Detectors + Entropy",
            "• Spoken ITN + Word-Span Align",
            "• WAV DSP + EXIF/MP4 Scrub + Blur",
        ],
        BLUE_LIGHT, BLUE, title_color=BLUE, fontsize=6.0, title_size=6.7
    )

    # Stage 3: Hybrid 3A + 3B
    draw_box(
        54.4, 17.6, 20.6, 13.0, "3A+3B. Hybrid PII",
        [
            "3A: WASM Checksums/Secrets",
            "3B: GLiNER-PII-Edge 45M",
            "    INT8 ONNX (Local CPU/GPU)",
            "Fail-closed if weights absent",
        ],
        TEAL_LIGHT, TEAL, title_color=TEAL, fontsize=5.9
    )

    # Stage 3b: Salted Pseudonym Vault
    draw_box(
        54.4, 3.8, 20.6, 11.4, "Salted Pseudonym Vault",
        [
            "HMAC-SHA256 Entity IDs",
            "Cross-Modal Consistency",
            "(Email = Slide = Call = Video)",
        ],
        CORAL_LIGHT, CORAL, title_color=CORAL, fontsize=5.9, title_size=6.6
    )

    # Stage 4: Cross-Modal Graph & Certified Output
    draw_box(
        78.4, 3.8, 19.2, 26.8, "4. Graph & Outputs",
        [
            "verisieve_graph.wasm",
            "(0 imports, Dual-CSR)",
            "• Cross-Modal Edges",
            "• GDPR Art. 17 Blast",
            "  Radius (<1 ms)",
            "• Redacted WAV / MP4",
            "• Signed JSONL + MCP",
        ],
        PURPLE_LIGHT, PURPLE, title_color=PURPLE, fontsize=6.0
    )

    # Arrows
    arrow_kw = dict(arrowstyle="-|>", color=INK, lw=1.15, mutation_scale=10)
    ax.annotate("", xy=(23.5, 17.2), xytext=(20.8, 17.2), arrowprops=arrow_kw)
    ax.annotate("", xy=(54.1, 23.8), xytext=(51.3, 21.5), arrowprops=arrow_kw)
    ax.annotate("", xy=(54.1, 9.6), xytext=(51.3, 12.5), arrowprops=arrow_kw)
    ax.annotate("", xy=(64.7, 15.5), xytext=(64.7, 17.3), arrowprops=dict(arrowstyle="<->", color=SUB, lw=0.95, mutation_scale=8))
    ax.annotate("", xy=(78.1, 21.5), xytext=(75.3, 23.5), arrowprops=arrow_kw)
    ax.annotate("", xy=(78.1, 11.5), xytext=(75.3, 9.6), arrowprops=arrow_kw)

    fig.tight_layout(pad=0.2)
    out = OUT_DIR / "fig_e0_multimodal_architecture.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e1(data):
    """Panel A: ai4privacy-500 Recall (Regex vs GLiNER vs Hybrid); Panel B: Blind PubMedQA FP/1k."""
    ai4 = data["exp1_piiAndEvasion"]["ai4privacy500"]
    pub = data["exp1_piiAndEvasion"]["blindPubmedqa250"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.1, 3.0), gridspec_kw={"width_ratios": [1.52, 1.0], "wspace": 0.28}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: ai4privacy-500 recall ----
    cats = ["Contact/\nCard/IPv4", "Targeted\n8 PII", "Bare\nNames", "All 26\nStruct.", "All 56\nTags"]
    keys = ["contactCardIpv4", "targeted8", "bareNames", "all26Structured", "all56Tags"]
    r_p1 = [ai4["paper1RegexLexicon"][k]["recallPct"] for k in keys]
    r_gl = [ai4["stage3bGlinerEdge45M"][k]["recallPct"] for k in keys]
    r_hyb_s = [ai4["hybridStructuredPlusGlinerEdge"][k]["recallPct"] for k in keys]
    r_hyb_f = [ai4["hybridFull3A3B"][k]["recallPct"] for k in keys]

    x = np.arange(len(cats))
    w = 0.20
    style_ax(ax1, "y")

    b1 = ax1.bar(x - 1.5 * w, r_p1, w, color=SLATE, label="Paper 1 Regex+Lexicon", zorder=3)
    b2 = ax1.bar(x - 0.5 * w, r_gl, w, color=CORAL, label="Stage 3B GLiNER-Edge 45M", zorder=3)
    b3 = ax1.bar(x + 0.5 * w, r_hyb_s, w, color=TEAL, label="Hybrid (3A Struct + 3B)", zorder=3)
    b4 = ax1.bar(x + 1.5 * w, r_hyb_f, w, color=BLUE, label="Hybrid Full (3A + 3B)", zorder=3)

    # Label best bar per category cleanly
    for i in range(len(cats)):
        best_val = max(r_hyb_s[i], r_hyb_f[i])
        best_x = x[i] + (0.5 * w if r_hyb_s[i] >= r_hyb_f[i] else 1.5 * w)
        ax1.text(best_x, best_val + 1.8, f"{best_val:.1f}%", ha="center", va="bottom",
                 fontsize=6.7, fontweight="bold", color=INK)

    ax1.set_xticks(x)
    ax1.set_xticklabels(cats)
    ax1.set_ylim(0, 128)
    ax1.set_yticks([0, 25, 50, 75, 100])
    ax1.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_ylabel("Recall on ai4privacy-500 (%)")
    ax1.set_title("A. PII Recall Across Detector Tiers", loc="left", pad=8)
    ax1.legend(loc="upper center", ncol=2, fontsize=6.3, handlelength=1.3, columnspacing=0.8)

    # ---- Panel B: Blind PubMedQA FP/1k ----
    style_ax(ax2, "y")
    labels = ["Naive\nTitle-Case\nRegex", "Paper 1\n334-Word\nLexicon", "GLiNER-Edge\n45M INT8\n(Stage 3B)"]
    vals = [pub["naiveRegex"]["hitsPer1k"], pub["paper1Lexicon"]["hitsPer1k"], pub["glinerEdge45M"]["hitsPer1k"]]
    docs_pct = [pub["naiveRegex"]["docsPct"], pub["paper1Lexicon"]["docsPct"], pub["glinerEdge45M"]["docsPct"]]
    colors = [CORAL, SLATE, TEAL]
    xb = np.arange(len(labels))
    bars = ax2.bar(xb, vals, width=0.52, color=colors, zorder=3)

    for bar, v, dp in zip(bars, vals, docs_pct):
        ax2.text(bar.get_x() + bar.get_width() / 2, v + 0.16, f"{v:.2f}/1k\n({dp:.1f}% docs)",
                 ha="center", va="bottom", fontsize=6.6, fontweight="bold", color=INK)

    red_naive = pub["glinerEdge45M"]["reductionVsNaive"]
    red_lex = pub["glinerEdge45M"]["reductionVsPaper1Lexicon"]
    ax2.annotate(
        f"{red_naive:.2f}x vs Regex\n({red_lex:.2f}x vs Lexicon)",
        xy=(2, vals[2] + 0.95), xytext=(1.35, 4.95),
        arrowprops=dict(arrowstyle="->", color=TEAL, lw=1.1, connectionstyle="arc3,rad=-0.18"),
        fontsize=6.8, fontweight="bold", color=TEAL, ha="center",
        bbox=dict(boxstyle="round,pad=0.25", fc=TEAL_LIGHT, ec=TEAL, lw=0.8),
    )

    ax2.set_xlim(-0.55, 2.55)
    ax2.set_xticks(xb)
    ax2.set_xticklabels(labels)
    ax2.set_ylim(0, 7.1)
    ax2.set_ylabel("False-Positive Person Hits / 1k Words")
    ax2.set_title("B. Blind PubMedQA (250 Abstracts)", loc="left", pad=8)

    fig.tight_layout(pad=0.35)
    out = OUT_DIR / "fig_e1_hybrid_pii_and_fp.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e2(data):
    """Panel A: Adversarial Unicode Evasion; Panel B: Spoken-ITN & Lowercase ASR Recall."""
    ev = data["exp1_piiAndEvasion"]["adversarialUnicodeEvasion"]
    itn = data["exp4_audioSpokenItnAndWaveform"]["spokenItn100"]
    low = data["exp1_piiAndEvasion"]["lowercaseSpokenNames100"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.1, 2.85), gridspec_kw={"width_ratios": [1.35, 1.0], "wspace": 0.28}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Unicode Evasion ----
    style_ax(ax1, "y")
    attacks = ["clean", "zwsp", "homoglyph", "fullwidth"]
    att_labels = ["Clean\nBaseline", "Zero-Width\n(U+200B)", "Cyrillic\nHomoglyph", "Full-Width\nDigits"]
    rx_vals = [ev[a]["regexRecallPct"] for a in attacks]
    ws_vals = [ev[a]["wasmRecallPct"] for a in attacks]

    x = np.arange(len(attacks))
    w = 0.34
    ax1.bar(x - w / 2, rx_vals, w, color=CORAL, label="Standard Regex (Paper 1)", zorder=3)
    ax1.bar(x + w / 2, ws_vals, w, color=BLUE, label="verisieve_media.wasm", zorder=3)

    for i in range(len(attacks)):
        off_l = -0.05 if i == 0 else 0.0
        off_r = 0.05 if i == 0 else 0.0
        ax1.text(x[i] - w / 2 + off_l, rx_vals[i] + 2.2, f"{rx_vals[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.5, fontweight="bold", color=CORAL if rx_vals[i] < 50 else SUB)
        ax1.text(x[i] + w / 2 + off_r, ws_vals[i] + 2.2, f"{ws_vals[i]:.1f}%", ha="center", va="bottom",
                 fontsize=6.5, fontweight="bold", color=BLUE)

    ax1.set_xticks(x)
    ax1.set_xticklabels(att_labels)
    ax1.set_ylim(0, 132)
    ax1.set_yticks([0, 25, 50, 75, 100])
    ax1.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax1.set_ylabel("PII Detection Recall (%)")
    ax1.set_title("A. Adversarial Unicode Evasion Stress Test", loc="left", pad=8)
    ax1.legend(loc="upper center", ncol=2, fontsize=6.4, handlelength=1.4)

    # ---- Panel B: Spoken ITN & Lowercase ASR ----
    style_ax(ax2, "y")
    cats = ["Spoken-Form\nEmails & Phones\n(n=100)", "Lowercase ASR\nPerson Names\n(n=100)"]
    raw_v = [itn["rawRegexRecallPct"], low["paper1TitleCaseRegexRecallPct"]]
    new_v = [itn["wasmSpokenItnRecallPct"], low["glinerEdge45MRecallPct"]]
    xb = np.arange(len(cats))
    wb = 0.32
    ax2.bar(xb - wb / 2, raw_v, wb, color=SLATE, label="Raw Text Regex (0.0%)", zorder=3)
    ax2.bar(xb + wb / 2, new_v, wb, color=TEAL, label="VeriSieve-MM (ITN / GLiNER)", zorder=3)

    for i in range(len(cats)):
        ax2.text(xb[i] - wb / 2, raw_v[i] + 2.2, f"{raw_v[i]:.1f}%", ha="center", va="bottom",
                 fontsize=7.0, fontweight="bold", color=SLATE)
        ax2.text(xb[i] + wb / 2, new_v[i] + 2.2, f"{new_v[i]:.1f}%", ha="center", va="bottom",
                 fontsize=7.0, fontweight="bold", color=TEAL)

    ax2.set_xticks(xb)
    ax2.set_xticklabels(cats)
    ax2.set_ylim(0, 132)
    ax2.set_yticks([0, 25, 50, 75, 100])
    ax2.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax2.set_ylabel("Spoken-Transcript Recall (%)")
    ax2.set_title("B. Spoken-Audio ITN & ASR Names", loc="left", pad=8)
    ax2.legend(loc="upper center", ncol=1, fontsize=6.4, handlelength=1.4)

    fig.tight_layout(pad=0.35)
    out = OUT_DIR / "fig_e2_evasion_and_spoken_itn.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def build_fig_e3(data):
    """Panel A: O(1) Streaming MP4 Atom Seek (1 MB -> 1 GB); Panel B: Cross-Modal GDPR Art. 17 Blast Radius."""
    mp4 = data["exp5_scaleSecurityAndCrossModalGraph"]["streamingMp4SeekScaling"]
    gr = data["exp5_scaleSecurityAndCrossModalGraph"]["crossModalGdprBlastRadius"]
    libri = data["exp4_audioSpokenItnAndWaveform"]["librispeech40"]
    arch = data["exp5_scaleSecurityAndCrossModalGraph"]["archiveDefense"]

    fig, (ax1, ax2) = plt.subplots(
        1, 2, figsize=(7.1, 2.85), gridspec_kw={"width_ratios": [1.05, 1.05], "wspace": 0.30}
    )
    fig.patch.set_facecolor("white")

    # ---- Panel A: Streaming MP4 O(1) seek ----
    style_ax(ax1, "y")
    sizes = [row["sizeMB"] for row in mp4]
    seeks = [row["medianSeekMs"] for row in mp4]
    ax1.plot(sizes, seeks, color=BLUE, linewidth=2.1, marker="o", markersize=6.0,
             markerfacecolor=BLUE, markeredgecolor="white", markeredgewidth=1.0,
             label="Streaming ISOBMFF Seek (O(1))", zorder=4)
    for s, ms in zip(sizes, seeks):
        ax1.annotate(f"{ms:.2f} ms", (s, ms), xytext=(0, 8), textcoords="offset points",
                     ha="center", va="bottom", fontsize=7.0, fontweight="bold", color=BLUE)

    ax1.set_xscale("log")
    ax1.set_xticks(sizes)
    ax1.set_xticklabels(["1 MB", "10 MB", "100 MB", "1,024 MB"])
    ax1.set_ylim(0, 1.45)
    ax1.set_xlabel("ISOBMFF MP4 Container Size (Log Scale)")
    ax1.set_ylabel("Median Metadata Audit Latency (ms)")
    ax1.set_title("A. Zero-RAM O(1) MP4 Seek Scaling", loc="left", pad=8)

    callout = (
        f"Also in verisieve_media.wasm:\n"
        f"• LibriSpeech 40 WAVs ({libri['totalAudioSeconds']}s): {libri['totalWasmRedactMs']} ms ({libri['realtimeSpeedupX']:,}x RT)\n"
        f"• 64 MB ZIP-bomb abort: {arch['bombAbortMs']} ms"
    )
    ax1.text(0.04, 0.94, callout, transform=ax1.transAxes, ha="left", va="top",
             fontsize=6.5, color=INK, linespacing=1.35,
             bbox=dict(boxstyle="round,pad=0.32", fc=BLUE_LIGHT, ec=BLUE_MID, lw=0.8))

    # ---- Panel B: Cross-Modal GDPR Art. 17 Blast Radius ----
    style_ax(ax2, "y")
    blocks = [row["blocks"] for row in gr]
    lat_ms = [row["blastRadiusMedianMs"] for row in gr]
    edges = [row["edges"] for row in gr]
    hits = [row["blastHits"] for row in gr]

    xb = np.arange(len(blocks))
    bars = ax2.bar(xb, lat_ms, width=0.48, color=[TEAL, BLUE_MID, BLUE], zorder=3)
    for i, (bar, ms, ed, h) in enumerate(zip(bars, lat_ms, edges, hits)):
        ax2.text(bar.get_x() + bar.get_width() / 2, ms + 0.035,
                 f"{ms:.3f} ms\n({ed:,} edges\n{h:,} hits)",
                 ha="center", va="bottom", fontsize=6.6, fontweight="bold", color=INK)

    ax2.set_xticks(xb)
    ax2.set_xticklabels([f"{b:,} blocks\n(5 modalities)" for b in blocks])
    ax2.set_ylim(0, max(lat_ms) * 1.42)
    ax2.set_xlabel("Multimodal Corpus Size (Email/Slide/Table/Audio/Video)")
    ax2.set_ylabel("GDPR Art. 17 Blast-Radius Query (ms)")
    ax2.set_title("B. Cross-Modal Erasure Latency (WASM)", loc="left", pad=8)

    fig.tight_layout(pad=0.35)
    out = OUT_DIR / "fig_e3_multimodal_scale_and_blast.pdf"
    fig.savefig(out, bbox_inches="tight")
    plt.close(fig)
    print(f"Saved {out.name}")


def main():
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    build_fig_e0(data)
    build_fig_e1(data)
    build_fig_e2(data)
    build_fig_e3(data)


if __name__ == "__main__":
    main()
