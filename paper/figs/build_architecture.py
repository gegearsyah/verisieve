"""Generate publication-grade vector architecture diagram for Paper 1 (Redaction & Gatekeeping Pipeline)."""
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch

OUT_DIR = Path(__file__).resolve().parent

BLUE = "#1D4ED8"
BLUE_BG = "#EFF6FF"
BLUE_BORDER = "#93C5FD"
TEAL = "#0F766E"
TEAL_BG = "#F0FDFA"
TEAL_BORDER = "#5EEAD4"
CORAL = "#C2410C"
CORAL_BG = "#FFF7ED"
CORAL_BORDER = "#FDBA74"
SLATE = "#475569"
SLATE_BG = "#F8FAFC"
SLATE_BORDER = "#CBD5E1"
RED = "#B91C1C"
RED_BG = "#FEF2F2"
RED_BORDER = "#FCA5A5"
INK = "#0F172A"
SUB = "#334155"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "pdf.fonttype": 42,
    "ps.fonttype": 42,
})


def draw_box(ax, x, y, w, h, title, lines, fc, ec, title_color, title_size=7.2, body_size=6.2, lw=1.1):
    patch = FancyBboxPatch(
        (x, y), w, h,
        boxstyle="round,pad=0.04,rounding_size=0.14",
        facecolor=fc, edgecolor=ec, linewidth=lw, zorder=3,
    )
    ax.add_patch(patch)
    ax.text(
        x + w / 2, y + h - 0.14, title,
        ha="center", va="top", fontsize=title_size, fontweight="bold",
        color=title_color, zorder=4,
    )
    # Subtle divider under title
    ax.plot([x + 0.14, x + w - 0.14], [y + h - 0.42, y + h - 0.42], color=ec, linewidth=0.6, alpha=0.7, zorder=4)
    body = "\n".join(lines)
    ax.text(
        x + w / 2, y + (h - 0.44) / 2 + 0.01, body,
        ha="center", va="center", fontsize=body_size, color=SUB,
        linespacing=1.30, zorder=4,
    )


def draw_arrow(ax, x1, y1, x2, y2, color="#475569", lw=1.3, rad=0.0, ls="-"):
    arr = FancyArrowPatch(
        (x1, y1), (x2, y2),
        arrowstyle="-|>", mutation_scale=10,
        color=color, linewidth=lw, linestyle=ls,
        connectionstyle=f"arc3,rad={rad}", zorder=5,
    )
    ax.add_patch(arr)


def build_redaction_architecture():
    fig, ax = plt.subplots(figsize=(7.4, 3.75))
    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    ax.set_xlim(0, 11.2)
    ax.set_ylim(0, 5.55)
    ax.axis("off")

    # Outer Zero-Egress Boundary Container
    outer = FancyBboxPatch(
        (0.10, 0.12), 11.00, 5.30,
        boxstyle="round,pad=0.03,rounding_size=0.18",
        facecolor="#FFFFFF", edgecolor="#94A3B8", linewidth=1.0, linestyle="--", zorder=1,
    )
    ax.add_patch(outer)
    ax.text(
        0.30, 5.23,
        "ZERO-EGRESS LOCAL SANDBOX  (Browser / Node.js CLI / MCP Server / C99 Core — No Cloud API Calls)",
        ha="left", va="center", fontsize=7.0, fontweight="bold", color=SLATE, zorder=2,
    )

    # ---- Top Row: 4 Sequential Processing Stages ----
    y_top, h_top = 2.60, 2.38

    draw_box(
        ax, 0.30, y_top, 2.15, h_top,
        "1. Raw Ingestion",
        [
            "PDF (CMap / TJ kerning)",
            "OOXML (.docx) & CSV",
            "HTML (SSRF-guarded)",
            "Scanned Forms",
            "(2D 32px overlap tiles)",
            "Tier-0 Breadcrumbs",
        ],
        fc=SLATE_BG, ec=SLATE_BORDER, title_color=INK,
    )

    draw_box(
        ax, 2.88, y_top, 2.18, h_top,
        "2. Clean & Dedup",
        [
            "versieve_clean.wasm",
            "(14.6 KB, 0 imports)",
            "Boilerplate stripping",
            "3-Layer Deduplication:",
            "SHA-256 + 64-lane MinHash",
            "Token-window chunking",
        ],
        fc=BLUE_BG, ec=BLUE_BORDER, title_color=BLUE,
    )

    draw_box(
        ax, 5.49, y_top, 2.32, h_top,
        "3. PII Redaction",
        [
            "Format-Validated Regex",
            "(Luhn/IIN cards, email,",
            "phone, SSN, IPv4)",
            "334-Word Exclusion Lexicon",
            "(protects legal/clinical terms)",
            "SaltedPseudonymVault",
        ],
        fc=TEAL_BG, ec=TEAL_BORDER, title_color=TEAL,
    )

    draw_box(
        ax, 8.24, y_top, 2.66, h_top,
        "4. Conformal Gatekeeper",
        [
            "520-dim Feature Vector",
            "(n-grams + structural slots)",
            "L2 Logistic Scorer f(X)",
            "Learn-Then-Test (LTT):",
            "BinomCDF(k; n, α) ≤ δ",
            "Fail-closed (τ → 1.0 if n low)",
        ],
        fc=BLUE_BG, ec=BLUE, title_color=BLUE, lw=1.35,
    )

    # Clean horizontal arrows between top stages
    draw_arrow(ax, 2.50, 3.79, 2.83, 3.79, color=SLATE)
    draw_arrow(ax, 5.11, 3.79, 5.44, 3.79, color=BLUE)
    draw_arrow(ax, 7.86, 3.79, 8.19, 3.79, color=TEAL)

    # ---- Bottom Row: Local Vault (Left) + 3-Way Gate Outputs (Right) ----
    y_bot, h_bot = 0.34, 1.56

    draw_box(
        ax, 0.30, y_bot, 3.45, h_bot,
        "Local Secret Vault & Audit",
        [
            "Workspace salt → deterministic <PII:TYPE_ID>",
            "Raw PII mapping stays strictly in local RAM",
            "Tamper-evident SHA-256 AuditChain receipts",
        ],
        fc="#F1F5F9", ec=SLATE_BORDER, title_color=INK, title_size=7.0, body_size=6.1,
    )

    draw_box(
        ax, 4.10, y_bot, 2.28, h_bot,
        "KEEP_SAFE",
        [
            "f(X) ≥ τ_keep  (Certified)",
            "Redacted Graph-SFT (.jsonl)",
            "Triples + versieve_graph.wasm",
        ],
        fc=TEAL_BG, ec=TEAL, title_color=TEAL, title_size=7.0, body_size=6.0, lw=1.25,
    )

    draw_box(
        ax, 6.62, y_bot, 2.02, h_bot,
        "ABSTAIN (Review)",
        [
            "τ_drop < f(X) < τ_keep",
            "Local Human Review Queue",
            "(fail-closed safety net)",
        ],
        fc=CORAL_BG, ec=CORAL_BORDER, title_color=CORAL, title_size=7.0, body_size=6.0,
    )

    draw_box(
        ax, 8.88, y_bot, 2.02, h_bot,
        "DROP / QUARANTINE",
        [
            "f(X) ≤ τ_drop",
            "Isolated locally;",
            "never exported downstream",
        ],
        fc=RED_BG, ec=RED_BORDER, title_color=RED, title_size=6.8, body_size=6.0,
    )

    # Clean non-crossing arrows from top row to bottom row
    # Dashed vault arrow cleanly enters top of Local Vault without touching KEEP_SAFE
    draw_arrow(ax, 6.10, 2.55, 2.75, 1.95, color=TEAL, ls="--", lw=1.1, rad=0.06)
    ax.text(
        4.12, 2.31, "salted pseudonym lookup",
        fontsize=6.1, color=TEAL, ha="center", va="center", style="italic",
        bbox=dict(boxstyle="round,pad=0.14", fc="white", ec="none", alpha=0.92), zorder=6,
    )

    # Three gatekeeper routing arrows cleanly fanning from Stage 4 bottom
    draw_arrow(ax, 8.75, 2.55, 5.45, 1.95, color=TEAL, lw=1.35)
    draw_arrow(ax, 9.55, 2.55, 7.65, 1.95, color=CORAL, lw=1.25)
    draw_arrow(ax, 10.20, 2.55, 9.90, 1.95, color=RED, lw=1.25)

    fig.subplots_adjust(left=0.005, right=0.995, top=0.995, bottom=0.005)
    fig.savefig(OUT_DIR / "fig0-redaction-architecture.pdf")
    fig.savefig(OUT_DIR / "_preview_fig0.png", dpi=200)
    plt.close(fig)
    print("Regenerated clean fig0-redaction-architecture.pdf")


if __name__ == "__main__":
    build_redaction_architecture()
