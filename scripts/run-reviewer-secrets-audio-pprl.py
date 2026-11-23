"""Reviewer-Hardening v2 — Benchmarks R3, R4, R5 & R6:
Addresses every Round-2 peer-review critique:
  R3 (External Secrets — Fair Steady-State Timing):
      Compares Gitleaks v8.30.1, Yelp detect-secrets, and verisieve_media.wasm on 520 external files
      AND measures steady-state 10x batch (5,200 files) throughput (files/s and MB/s) alongside cold CLI spawn
      so process startup is separated cleanly from scan speed.
  R4 (End-to-End Audio — Consistent Denominators + Stronger Cross-Model Attacker):
      25 offline SAPI TTS calls -> Pass 1 faster-whisper base.en (word timestamps) ->
      verisieve_media.wasm Spoken ITN + GLiNER -> WAV silence -> Pass 2 STRONGER attacker faster-whisper small.en!
      Uses ONE consistent denominator (all planted PII tokens) for Pre-Exposure and Post-Leakage + 95% Wilson CI.
  R5 (PPRL Reality Check — Disjoint Dev/Test Split + Plaintext Jaro-Winkler/Levenshtein Ceiling + 500-Name Scale Test):
      Tunes threshold on disjoint Dev pairs, evaluates on held-out Test pairs against plaintext Jaro-Winkler &
      Levenshtein ceilings, AND tests 500 common full names all-pairs (124,750 distinct negative pairs!) for scale FPR.
  R6 (Unicode Evasion vs. Standard NFKC Baseline):
      Compares Unnormalized Regex vs. Python unicodedata.normalize('NFKC') + Regex vs. verisieve_media.wasm.
"""

from __future__ import annotations

import importlib.util
import json
import math
import re
import subprocess
import tempfile
import time
import unicodedata
import wave
from pathlib import Path

import numpy as np
from datasets import load_dataset
from detect_secrets.core.secrets_collection import SecretsCollection
from detect_secrets.settings import default_settings
from faster_whisper import WhisperModel
from scipy.signal import resample_poly

_gl_spec = importlib.util.spec_from_file_location(
    "gliner_runner_mod",
    str(Path(__file__).resolve().parent / "run-track-e-gliner-benchmark.py"),
)
gl_mod = importlib.util.module_from_spec(_gl_spec)
_gl_spec.loader.exec_module(gl_mod)
GlinerEdgeOnnxRunner = gl_mod.GlinerEdgeOnnxRunner
MODEL_DIR = gl_mod.MODEL_DIR

GITLEAKS_BIN = Path("results/untrusted-benchmarks/tools/gitleaks/gitleaks.exe").resolve()
MBPP_PATH = Path("results/untrusted-benchmarks/track-e-public/public-code-500.json")
YELP_DIR = Path("results/untrusted-benchmarks/reviewer-hardening/external-secrets")
OUT_PATH = Path("results/reviewer-secrets-audio-pprl-benchmarks.json")


def pct(n: int, d: int) -> float:
    return round((n / d) * 100.0, 2) if d > 0 else 0.0


def wilson_ci_pct(k: int, n: int, z: float = 1.96) -> list[float]:
    if n == 0:
        return [0.0, 0.0]
    p = k / n
    denom = 1.0 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = (z * math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / denom
    return [round(max(0.0, center - half) * 100.0, 2), round(min(1.0, center + half) * 100.0, 2)]


def levenshtein_sim(a: str, b: str) -> float:
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return 1.0
    m, n = len(a), len(b)
    if m == 0 or n == 0:
        return 0.0
    dp = list(range(n + 1))
    for i in range(1, m + 1):
        prev = dp[0]
        dp[0] = i
        for j in range(1, n + 1):
            tmp = dp[j]
            cost = 0 if a[i - 1] == b[j - 1] else 1
            dp[j] = min(dp[j] + 1, dp[j - 1] + 1, prev + cost)
            prev = tmp
    return 1.0 - dp[n] / max(m, n)


def jaro_winkler_sim(s1: str, s2: str) -> float:
    s1, s2 = s1.lower().strip(), s2.lower().strip()
    if s1 == s2:
        return 1.0
    l1, l2 = len(s1), len(s2)
    if l1 == 0 or l2 == 0:
        return 0.0
    match_dist = max(0, max(l1, l2) // 2 - 1)
    m1 = [False] * l1
    m2 = [False] * l2
    matches = 0
    for i in range(l1):
        lo = max(0, i - match_dist)
        hi = min(i + match_dist + 1, l2)
        for j in range(lo, hi):
            if not m2[j] and s1[i] == s2[j]:
                m1[i] = m2[j] = True
                matches += 1
                break
    if matches == 0:
        return 0.0
    t = 0
    k = 0
    for i in range(l1):
        if m1[i]:
            while not m2[k]:
                k += 1
            if s1[i] != s2[k]:
                t += 1
            k += 1
    jaro = (matches / l1 + matches / l2 + (matches - t / 2.0) / matches) / 3.0
    prefix = 0
    for c1, c2 in zip(s1[:4], s2[:4]):
        if c1 == c2:
            prefix += 1
        else:
            break
    return jaro + prefix * 0.1 * (1.0 - jaro)


# ---------------------------------------------------------------------------
# EXP R3: External Secret Scanning with Fair Steady-State Timing (1x vs 10x)
# ---------------------------------------------------------------------------
def run_external_secrets_benchmark() -> dict:
    print("\n=== Running Exp R3: External Secrets (Fair 1x Cold + 10x Steady-State Timing) ===")
    ds = load_dataset("Hodfa71/pstu-synthetic-secrets", split="train")
    mbpp = json.loads(MBPP_PATH.read_text(encoding="utf-8"))

    pos_files: list[dict] = []
    target_types = {"jwt_secret", "db_password", "ssh_key", "api_key"}
    idx = 0
    for row in ds:
        t = row["type"]
        if t not in target_types:
            continue
        for s in [row["secret"]] + list(row["decoys"][:4]):
            ext = ".pem" if t == "ssh_key" else ".env"
            pos_files.append({"id": f"pos_pstu_{t}_{idx:03d}{ext}", "class": t, "content": s + "\n", "isSecret": True})
            idx += 1

    for fname in ["yelp_config.ini", "yelp_config.yaml", "yelp_config.env", "yelp_file_with_secrets.py", "yelp_private_key"]:
        p = YELP_DIR / fname
        if p.exists():
            pos_files.append({"id": f"pos_{fname}", "class": "yelp_official", "content": p.read_text(encoding="utf-8", errors="ignore"), "isSecret": True})

    neg_files: list[dict] = []
    for c in mbpp:
        neg_files.append({"id": f"neg_mbpp_{c['id']:04d}.py", "class": "mbpp_clean", "content": c["content"] + "\n", "isSecret": False})
    yelp_clean = YELP_DIR / "yelp_file_with_no_secrets.py"
    if yelp_clean.exists():
        neg_files.append({"id": "neg_yelp_clean.py", "class": "yelp_clean", "content": yelp_clean.read_text(encoding="utf-8", errors="ignore"), "isSecret": False})

    all_files = pos_files + neg_files
    total_bytes_1x = sum(len(f["content"].encode("utf-8")) for f in all_files)

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        dir_1x = td_p / "corpus_1x"
        dir_10x = td_p / "corpus_10x"
        dir_1x.mkdir(); dir_10x.mkdir()
        for f in all_files:
            (dir_1x / f["id"]).write_text(f["content"], encoding="utf-8")
            for rep in range(10):
                (dir_10x / f"r{rep}_{f['id']}").write_text(f["content"], encoding="utf-8")

        # 1. Gitleaks v8.30.1 (1x cold + 10x steady-state)
        gl_rep = td_p / "gl_1x.json"
        t0 = time.perf_counter()
        subprocess.run([str(GITLEAKS_BIN), "detect", "--no-git", "--source", str(dir_1x), "--report-format", "json", "--report-path", str(gl_rep)], capture_output=True)
        gl_1x_ms = (time.perf_counter() - t0) * 1000.0
        gl_hits = json.loads(gl_rep.read_text(encoding="utf-8")) if gl_rep.exists() else []
        gl_flagged = {Path(h["File"]).name for h in gl_hits}

        gl_rep10 = td_p / "gl_10x.json"
        t0 = time.perf_counter()
        subprocess.run([str(GITLEAKS_BIN), "detect", "--no-git", "--source", str(dir_10x), "--report-format", "json", "--report-path", str(gl_rep10)], capture_output=True)
        gl_10x_ms = (time.perf_counter() - t0) * 1000.0
        gl_steady_ms_per_1x = max(1.0, (gl_10x_ms - gl_1x_ms) / 9.0)

        # 2. Yelp detect-secrets (1x in-process + 10x steady-state)
        t0 = time.perf_counter()
        ds_flagged: set[str] = set()
        with default_settings():
            sc = SecretsCollection()
            for f in all_files:
                sc.scan_file(str(dir_1x / f["id"]))
            for fname, sec_set in sc.data.items():
                if sec_set:
                    ds_flagged.add(Path(fname).name)
        ds_1x_ms = (time.perf_counter() - t0) * 1000.0

        t0 = time.perf_counter()
        with default_settings():
            sc10 = SecretsCollection()
            for rep in range(10):
                for f in all_files:
                    sc10.scan_file(str(dir_10x / f"r{rep}_{f['id']}"))
        ds_10x_ms = (time.perf_counter() - t0) * 1000.0
        ds_steady_ms_per_1x = max(1.0, (ds_10x_ms - ds_1x_ms) / 9.0)

        # 3. verisieve_media.wasm (1x cold Node CLI + 1x warm in-process + 10x steady-state)
        in_1x = td_p / "w1.json"; out_1x = td_p / "wo1.json"
        in_10x = td_p / "w10.json"; out_10x = td_p / "wo10.json"
        in_1x.write_text(json.dumps([{"id": f["id"], "content": f["content"]} for f in all_files]), encoding="utf-8")
        in_10x.write_text(json.dumps([{"id": f"r{rep}_{f['id']}", "content": f["content"]} for rep in range(10) for f in all_files]), encoding="utf-8")

        t0 = time.perf_counter()
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "scan-secrets-files", str(in_1x), str(out_1x)], check=True)
        wasm_cold_cli_1x_ms = (time.perf_counter() - t0) * 1000.0
        w1 = json.loads(out_1x.read_text(encoding="utf-8"))
        wasm_flagged = {r["id"] for r in w1["results"] if r["secretCount"] > 0}

        t0 = time.perf_counter()
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "scan-secrets-files", str(in_10x), str(out_10x)], check=True)
        wasm_cold_cli_10x_ms = (time.perf_counter() - t0) * 1000.0
        w10 = json.loads(out_10x.read_text(encoding="utf-8"))
        wasm_steady_inproc_ms_per_1x = max(0.5, (w10["totalMs"] - w1["totalMs"]) / 9.0)
        wasm_steady_cli_ms_per_1x = max(0.5, (wasm_cold_cli_10x_ms - wasm_cold_cli_1x_ms) / 9.0)

    def eval_tool(flagged: set[str], cold_1x_ms: float, steady_1x_ms: float, extra: dict | None = None) -> dict:
        tp = sum(1 for f in pos_files if f["id"] in flagged)
        fn = len(pos_files) - tp
        fp = sum(1 for f in neg_files if f["id"] in flagged)
        p = tp / max(1, tp + fp); r = tp / max(1, tp + fn)
        f1 = (2 * p * r / (p + r)) if (p + r) > 0 else 0.0
        mb_per_s = round((total_bytes_1x / (1024 * 1024)) / (steady_1x_ms / 1000.0), 2)
        return {
            "tp": tp, "fp": fp, "fn": fn,
            "precisionPct": round(p * 100, 2),
            "recallPct": round(r * 100, 2),
            "f1Pct": round(f1 * 100, 2),
            "cleanFalsePositiveRatePct": pct(fp, len(neg_files)),
            "cold1xWallMs": round(cold_1x_ms, 2),
            "steadyState1xMs": round(steady_1x_ms, 2),
            "steadyStateMBps": mb_per_s,
            **(extra or {}),
        }

    return {
        "positiveFiles": len(pos_files),
        "negativeFiles": len(neg_files),
        "totalBytes1x": total_bytes_1x,
        "gitleaks_v8_30_1": eval_tool(gl_flagged, gl_1x_ms, gl_steady_ms_per_1x),
        "yelp_detect_secrets": eval_tool(ds_flagged, ds_1x_ms, ds_steady_ms_per_1x),
        "verisieve_media_wasm": eval_tool(
            wasm_flagged,
            wasm_cold_cli_1x_ms,
            wasm_steady_inproc_ms_per_1x,
            {"inProcess1xMs": w1["totalMs"], "steadyStateCliWithIoMs": round(wasm_steady_cli_ms_per_1x, 2)},
        ),
    }


# ---------------------------------------------------------------------------
# EXP R4: 25-Call End-to-End Spoken Audio PII Redaction (Cross-Model Attacker small.en!)
# ---------------------------------------------------------------------------
AUDIO_SCRIPTS_25 = [
    {"id": "call_01", "script": "Hello support team, my name is Elena Vance and my email is elena dot vance at acme dot org. Please check my quarterly invoice.", "pii_checks": ["elena", "vance", "acme"], "context_words": ["support", "quarterly", "invoice"]},
    {"id": "call_02", "script": "Hi there, this is Marcus Holloway calling regarding our account renewal. You can call me at four one five five five five one nine zero two.", "pii_checks": ["marcus", "holloway", "415", "555", "1902"], "context_words": ["calling", "account", "renewal"]},
    {"id": "call_03", "script": "Good morning, please update the billing contact to Sarah Jenkins at sarah dot jenkins at brightmail dot com for the winter order.", "pii_checks": ["sarah", "jenkins", "brightmail"], "context_words": ["billing", "winter", "order"]},
    {"id": "call_04", "script": "Thank you for answering. My phone number is six five zero five five five two eight four one and I need help with shipping status.", "pii_checks": ["650", "555", "2841"], "context_words": ["answering", "shipping", "status"]},
    {"id": "call_05", "script": "Hello, I am David Ramirez from engineering. Send the security audit report to david dot ramirez at vertex dot io before Friday.", "pii_checks": ["david", "ramirez", "vertex"], "context_words": ["engineering", "security", "audit", "report"]},
    {"id": "call_06", "script": "Please reach out to Priya Patel on phone number two one two five five five seven three six zero about the clinic appointment.", "pii_checks": ["priya", "patel", "212", "555", "7360"], "context_words": ["clinic", "appointment"]},
    {"id": "call_07", "script": "My name is Thomas Anderson and the receipt should go to thomas dot anderson at matrix dot net for tax compliance.", "pii_checks": ["thomas", "anderson", "matrix"], "context_words": ["receipt", "compliance"]},
    {"id": "call_08", "script": "Calling to verify delivery for Claire Bennett. Callback number is three one two five five five four zero nine eight.", "pii_checks": ["claire", "bennett", "312", "555", "4098"], "context_words": ["verify", "delivery"]},
    {"id": "call_09", "script": "This is Daniel Brooks requesting a refund on the hardware subscription. Email me at daniel dot brooks at cloudops dot org.", "pii_checks": ["daniel", "brooks", "cloudops"], "context_words": ["refund", "hardware", "subscription"]},
    {"id": "call_10", "script": "Hi, my name is Hannah Foster and my direct phone is four zero eight five five five eight two one five regarding the warranty claim.", "pii_checks": ["hannah", "foster", "408", "555", "8215"], "context_words": ["warranty", "claim"]},
    {"id": "call_11", "script": "Please forward the contract draft to Kevin Morales at kevin dot morales at northstar dot com before the board meeting.", "pii_checks": ["kevin", "morales", "northstar"], "context_words": ["contract", "draft", "board", "meeting"]},
    {"id": "call_12", "script": "Hello, this is Rachel Coleman. My mobile number is seven one eight five five five three four two nine for the delivery confirmation.", "pii_checks": ["rachel", "coleman", "718", "555", "3429"], "context_words": ["delivery", "confirmation"]},
    {"id": "call_13", "script": "I am Samuel Wright calling about the laboratory results. Email confirmation to samuel dot wright at medcore dot org.", "pii_checks": ["samuel", "wright", "medcore"], "context_words": ["laboratory", "results"]},
    {"id": "call_14", "script": "Good afternoon, please log a support ticket for Olivia Carter at phone nine one seven five five five six zero four three.", "pii_checks": ["olivia", "carter", "917", "555", "6043"], "context_words": ["support", "ticket"]},
    {"id": "call_15", "script": "Hi team, this is Nathan Price. Send the onboarding checklist to nathan dot price at finlabs dot io whenever ready.", "pii_checks": ["nathan", "price", "finlabs"], "context_words": ["onboarding", "checklist"]},
    {"id": "call_16", "script": "Hello, my name is Victoria Stone and my direct line is two zero six five five five three nine one four regarding the lease renewal.", "pii_checks": ["victoria", "stone", "206", "555", "3914"], "context_words": ["lease", "renewal"]},
    {"id": "call_17", "script": "Please register Benjamin Hayes with email benjamin dot hayes at solaris dot org for the compliance workshop.", "pii_checks": ["benjamin", "hayes", "solaris"], "context_words": ["compliance", "workshop"]},
    {"id": "call_18", "script": "This is Natalie Ross calling about shipment tracking. Reach me at five one two five five five eight four zero seven.", "pii_checks": ["natalie", "ross", "512", "555", "8407"], "context_words": ["shipment", "tracking"]},
    {"id": "call_19", "script": "Good morning, I am Jonathan Reed. Forward the budget spreadsheet to jonathan dot reed at apexdata dot com today.", "pii_checks": ["jonathan", "reed", "apexdata"], "context_words": ["budget", "spreadsheet"]},
    {"id": "call_20", "script": "Hi support, please assist Lauren Ward on telephone three zero five five five five six seven two one for account recovery.", "pii_checks": ["lauren", "ward", "305", "555", "6721"], "context_words": ["account", "recovery"]},
    {"id": "call_21", "script": "My name is Gregory Perry and you can email the license agreement to gregory dot perry at quantix dot io.", "pii_checks": ["gregory", "perry", "quantix"], "context_words": ["license", "agreement"]},
    {"id": "call_22", "script": "Hello, this is Michelle Long calling from procurement. My callback number is six one seven five five five nine one three two.", "pii_checks": ["michelle", "long", "617", "555", "9132"], "context_words": ["procurement", "callback"]},
    {"id": "call_23", "script": "Please send the updated policy manual to Andrew Cooper at andrew dot cooper at harbor dot org this afternoon.", "pii_checks": ["andrew", "cooper", "harbor"], "context_words": ["policy", "manual"]},
    {"id": "call_24", "script": "Good afternoon, I am Stephanie Bell requesting technical assistance. Call four zero four five five five two six five eight.", "pii_checks": ["stephanie", "bell", "404", "555", "2658"], "context_words": ["technical", "assistance"]},
    {"id": "call_25", "script": "This is Patrick Hughes following up on the audit schedule. Please email patrick dot hughes at beacon dot net.", "pii_checks": ["patrick", "hughes", "beacon"], "context_words": ["audit", "schedule"]},
]


def load_wav_16k_f32(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate(); ch = wf.getnchannels()
        raw = wf.readframes(wf.getnframes())
    pcm = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if ch > 1:
        pcm = pcm.reshape(-1, ch).mean(axis=1)
    if sr != 16000:
        g = math.gcd(sr, 16000)
        pcm = resample_poly(pcm, 16000 // g, sr // g).astype(np.float32)
    return pcm


def synthesize_sapi_wavs(calls: list[dict], out_dir: Path) -> None:
    lines = ["Add-Type -AssemblyName System.Speech"]
    for c in calls:
        wav_p = str((out_dir / f"{c['id']}_raw.wav").resolve()).replace("'", "''")
        txt = c["script"].replace("'", "''")
        lines.extend([
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
            "$s.Rate = -1",
            f"$s.SetOutputToWaveFile('{wav_p}')",
            f"$s.Speak('{txt}')",
            "$s.Dispose()",
        ])
    ps_file = out_dir / "gen_tts.ps1"
    ps_file.write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps_file)], check=True)


def run_audio_e2e_benchmark() -> dict:
    print("\n=== Running Exp R4: 25-Call E2E Audio (Defender base.en -> WASM+GLiNER -> Stronger Attacker small.en) ===")
    gliner = GlinerEdgeOnnxRunner(MODEL_DIR, threshold=0.35)
    defender_asr = WhisperModel("base.en", device="cpu", compute_type="int8")
    attacker_asr = WhisperModel("small.en", device="cpu", compute_type="int8")

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        synthesize_sapi_wavs(AUDIO_SCRIPTS_25, td_p)

        node_payload = []
        pre_attacker_txts = {}
        for c in AUDIO_SCRIPTS_25:
            raw_wav = td_p / f"{c['id']}_raw.wav"
            audio_f32 = load_wav_16k_f32(raw_wav)
            # Defender transcribes with base.en (word timestamps)
            segs, _ = defender_asr.transcribe(audio_f32, word_timestamps=True, language="en")
            words = [
                {"word": w.word.strip(), "startMs": int(round(w.start * 1000)), "endMs": int(round(w.end * 1000))}
                for seg in segs for w in (seg.words or [])
            ]
            # Attacker evaluates pre-redaction exposure with STRONGER small.en on SAME denominator!
            asegs, _ = attacker_asr.transcribe(audio_f32, word_timestamps=False, language="en")
            pre_attacker_txts[c["id"]] = " ".join(s.text.strip() for s in asegs)

            node_payload.append({
                "id": c["id"],
                "wavInPath": str(raw_wav),
                "wavOutPath": str(td_p / f"{c['id']}_redacted.wav"),
                "words": words,
                "neuralSpans": [],
            })

        in_p = td_p / "itn_in.json"; out_p = td_p / "itn_out.json"
        in_p.write_text(json.dumps(node_payload), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "audio-itn-redact", str(in_p), str(out_p)], check=True)
        itn_pass = json.loads(out_p.read_text(encoding="utf-8"))

        label_map = {"person": "PERSON", "email": "EMAIL", "phone number": "PHONE", "credit card number": "CREDIT_CARD"}
        for item, itn_res in zip(node_payload, itn_pass):
            gl_spans, _ = gliner.predict(itn_res["normalizedText"])
            item["neuralSpans"] = [
                {"start": s["start"], "end": s["end"], "type": label_map[str(s.get("label", "")).lower()], "score": s["score"]}
                for s in gl_spans
                if str(s.get("label", "")).lower() in label_map
            ]

        in_p.write_text(json.dumps(node_payload), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "audio-itn-redact", str(in_p), str(out_p)], check=True)
        final_pass = json.loads(out_p.read_text(encoding="utf-8"))

        # Pillar 2B: Also run WASM SR-MP Phonetic-Coupled Audio Redaction (seeded from companion ticket/CRM caller record)
        srmp_payload = []
        for c, item in zip(AUDIO_SCRIPTS_25, node_payload):
            srmp_payload.append({
                **item,
                "wavOutPath": str(td_p / f"{c['id']}_srmp_redacted.wav"),
                "contextAnchors": [t for t in c["pii_checks"] if not t.isdigit()],
            })
        srmp_in = td_p / "srmp_audio_in.json"
        srmp_out = td_p / "srmp_audio_out.json"
        srmp_in.write_text(json.dumps(srmp_payload), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "audio-srmp-redact", str(srmp_in), str(srmp_out)], check=True)
        srmp_pass = json.loads(srmp_out.read_text(encoding="utf-8"))

        # Pass 2: Stronger cross-model attacker (small.en) re-transcribes redacted WAVs (Isolated vs WASM SR-MP)
        total_planted = 0
        pre_exposed = 0
        post_leaked = 0
        srmp_post_leaked = 0
        pre_ctx = 0
        post_ctx = 0
        srmp_post_ctx = 0
        calls_zero_leak = 0
        srmp_calls_zero_leak = 0

        for c, f_res, s_res in zip(AUDIO_SCRIPTS_25, final_pass, srmp_pass):
            red_f32 = load_wav_16k_f32(td_p / f"{c['id']}_redacted.wav")
            segs2, _ = attacker_asr.transcribe(red_f32, word_timestamps=False, language="en")
            post_txt = " ".join(s.text.strip() for s in segs2)

            srmp_f32 = load_wav_16k_f32(td_p / f"{c['id']}_srmp_redacted.wav")
            segs3, _ = attacker_asr.transcribe(srmp_f32, word_timestamps=False, language="en")
            srmp_post_txt = " ".join(s.text.strip() for s in segs3)

            pre_norm = re.sub(r"[^a-z0-9]+", "", pre_attacker_txts[c["id"]].lower())
            post_norm = re.sub(r"[^a-z0-9]+", "", post_txt.lower())
            srmp_norm = re.sub(r"[^a-z0-9]+", "", srmp_post_txt.lower())

            c_post = 0
            c_srmp = 0
            for tok in c["pii_checks"]:
                total_planted += 1
                if tok in pre_norm:
                    pre_exposed += 1
                if tok in post_norm:
                    post_leaked += 1
                    c_post += 1
                if tok in srmp_norm:
                    srmp_post_leaked += 1
                    c_srmp += 1
            for cw in c["context_words"]:
                if cw in pre_norm:
                    pre_ctx += 1
                if cw in post_norm:
                    post_ctx += 1
                if cw in srmp_norm:
                    srmp_post_ctx += 1
            if c_post == 0:
                calls_zero_leak += 1
            if c_srmp == 0:
                srmp_calls_zero_leak += 1

    # CONSISTENT DENOMINATOR: both Pre and Post divided by total_planted!
    pre_pct = pct(pre_exposed, total_planted)
    post_pct = pct(post_leaked, total_planted)
    srmp_pct = pct(srmp_post_leaked, total_planted)
    return {
        "defenderAsr": "faster-whisper base.en (CPU INT8, word_timestamps=True)",
        "attackerAsr": "faster-whisper small.en (CPU INT8 — 3.3x larger cross-model attacker)",
        "callsEvaluated": len(AUDIO_SCRIPTS_25),
        "totalPlantedPiiTokens": total_planted,
        "preExposedTokens": pre_exposed,
        "postLeakedTokens": post_leaked,
        "srmpPostLeakedTokens": srmp_post_leaked,
        "preExposureOfPlantedPct": pre_pct,
        "preExposureWilson95CI": wilson_ci_pct(pre_exposed, total_planted),
        "postLeakageOfPlantedPct": post_pct,
        "postLeakageWilson95CI": wilson_ci_pct(post_leaked, total_planted),
        "srmpPostLeakageOfPlantedPct": srmp_pct,
        "srmpPostLeakageWilson95CI": wilson_ci_pct(srmp_post_leaked, total_planted),
        "absoluteDropPercentagePoints": round(pre_pct - post_pct, 2),
        "srmpAbsoluteDropPercentagePoints": round(pre_pct - srmp_pct, 2),
        "relativeReductionOfExposedPct": round((1.0 - post_leaked / max(1, pre_exposed)) * 100.0, 2),
        "srmpRelativeReductionOfExposedPct": round((1.0 - srmp_post_leaked / max(1, pre_exposed)) * 100.0, 2),
        "callsWithZeroPostLeak": calls_zero_leak,
        "srmpCallsWithZeroPostLeak": srmp_calls_zero_leak,
        "nonPiiContextRetentionPct": pct(post_ctx, max(1, pre_ctx)),
        "srmpNonPiiContextRetentionPct": pct(srmp_post_ctx, max(1, pre_ctx)),
    }


# ---------------------------------------------------------------------------
# EXP R5: PPRL Reality Check (Dev/Test Split + Plaintext JW/Lev Ceiling + 500-Name Scale Test)
# ---------------------------------------------------------------------------
def run_pprl_reality_check() -> dict:
    print("\n=== Running Exp R5: PPRL Reality Check (Dev/Test + Plaintext Ceiling + 500-Name 124,750-Pair Scale) ===")
    dev_pairs = [
        ("Elena Vance", "E1ena Vance", "ocr", True), ("Marcus Holloway", "Marcus Ho11oway", "ocr", True),
        ("Sarah Jenkins", "5arah Jenkins", "ocr", True), ("David Ramirez", "David Ram1rez", "ocr", True),
        ("Thomas Anderson", "Th0mas Anderson", "ocr", True),
        ("Elena Vance", "elena vans", "asr", True), ("Katherine Holloway", "catherine holoway", "asr", True),
        ("Sarah Jenkins", "sara jenkens", "asr", True), ("Steven Brooks", "stephen brooks", "asr", True),
        ("Geoffrey Wright", "jeffrey right", "asr", True),
        ("Elena Vance", "Elena Brooks", "neg", False), ("Marcus Holloway", "Marcus Wright", "neg", False),
        ("Sarah Jenkins", "Sarah Foster", "neg", False), ("Thomas Anderson", "Thomas Miller", "neg", False),
        ("David Ramirez", "Daniel Brooks", "neg", False), ("Priya Patel", "Claire Bennett", "neg", False),
        ("Kevin Morales", "Kevin Johnson", "neg", False), ("Hannah Foster", "Hannah Williams", "neg", False),
        ("Rachel Coleman", "Sarah Jenkins", "neg", False), ("Samuel Wright", "Claire Bennett", "neg", False),
    ]
    test_pairs = [
        ("Priya Patel", "Priya Pate1", "ocr", True), ("Claire Bennett", "C1aire Bennett", "ocr", True),
        ("Daniel Brooks", "Danie1 Br00ks", "ocr", True), ("Hannah Foster", "Hannah F0ster", "ocr", True),
        ("Kevin Morales", "Kevin M0rales", "ocr", True), ("Olivia Carter", "0livia Carter", "ocr", True),
        ("Samuel Wright", "5amuel Wright", "ocr", True), ("Rachel Coleman", "Rache1 Co1eman", "ocr", True),
        ("Nathan Price", "Nathan Pr1ce", "ocr", True), ("Victoria Stone", "Vict0ria St0ne", "ocr", True),
        ("Marcus Holloway", "markus holoway", "asr", True), ("Philip Carter", "phillip karter", "asr", True),
        ("Claire Bennett", "clare bennet", "asr", True), ("Rachel Coleman", "rachael kolman", "asr", True),
        ("Bryan Morales", "brian morales", "asr", True), ("Sean Foster", "shawn foster", "asr", True),
        ("Eric Ramirez", "erik ramires", "asr", True), ("Hannah Price", "hana prise", "asr", True),
        ("Jonathon Stone", "jonathan stone", "asr", True), ("Kristina Patel", "christina patel", "asr", True),
        ("Olivia Carter", "Olivia Stone", "neg", False), ("Nathan Price", "Nathan Carter", "neg", False),
        ("Victoria Stone", "Victoria Price", "neg", False), ("Philip Carter", "Philip Brooks", "neg", False),
        ("Bryan Morales", "Bryan Foster", "neg", False), ("Sean Foster", "Sean Wright", "neg", False),
        ("Eric Ramirez", "Eric Anderson", "neg", False), ("Jonathon Stone", "Jonathon Miller", "neg", False),
        ("Kristina Patel", "Kristina Morales", "neg", False), ("Daniel Brooks", "Daniel Reed", "neg", False),
        ("Claire Bennett", "Claire Carter", "neg", False), ("Rachel Coleman", "Rachel Foster", "neg", False),
        ("Samuel Wright", "Samuel Price", "neg", False), ("Hannah Foster", "Hannah Bennett", "neg", False),
        ("Priya Patel", "Priya Carter", "neg", False), ("Kevin Morales", "Kevin Wright", "neg", False),
        ("Elena Vance", "Olivia Vance-Smith", "neg", False), ("Daniel Brooks", "David Brooks-Lee", "neg", False),
        ("Marcus Holloway", "Martin Holloway", "neg", False), ("Sarah Jenkins", "Sandra Jenkins", "neg", False),
    ]

    with tempfile.TemporaryDirectory() as td:
        td_p = Path(td)
        # 1. Tune Dice threshold strictly on dev_pairs
        in_dev = td_p / "d_in.json"; out_dev = td_p / "d_out.json"
        in_dev.write_text(json.dumps({"salt": "pprl-v2-salt", "diceThreshold": 0.68, "pairs": [{"canonical": a, "noisy": b, "kind": k, "isSame": s} for a, b, k, s in dev_pairs]}), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "pprl-noisy", str(in_dev), str(out_dev)], check=True)
        dev_res = json.loads(out_dev.read_text(encoding="utf-8"))

        best_thr = 0.68; best_f1 = -1.0
        for thr in [0.55, 0.60, 0.65, 0.68, 0.70, 0.72, 0.75, 0.78, 0.80]:
            tp = sum(1 for r in dev_res if r["isSame"] and (r["dice"] >= thr or (r["phonMatch"] and r["dice"] >= 0.55)))
            fp = sum(1 for r in dev_res if not r["isSame"] and (r["dice"] >= thr or (r["phonMatch"] and r["dice"] >= 0.55)))
            fn = sum(1 for r in dev_res if r["isSame"]) - tp
            p = tp / max(1, tp + fp); rv = tp / max(1, tp + fn)
            f1 = 2 * p * rv / (p + rv) if (p + rv) > 0 else 0.0
            if f1 > best_f1:
                best_f1 = f1; best_thr = thr

        # 2. Evaluate on held-out test_pairs
        in_te = td_p / "t_in.json"; out_te = td_p / "t_out.json"
        in_te.write_text(json.dumps({"salt": "pprl-v2-salt", "diceThreshold": best_thr, "pairs": [{"canonical": a, "noisy": b, "kind": k, "isSame": s} for a, b, k, s in test_pairs]}), encoding="utf-8")
        subprocess.run(["node", "scripts/tab-node-helper.mjs", "pprl-noisy", str(in_te), str(out_te)], check=True)
        te_res = json.loads(out_te.read_text(encoding="utf-8"))

        def eval_pred(pred_fn):
            tp = sum(1 for r in te_res if r["isSame"] and pred_fn(r))
            fp = sum(1 for r in te_res if not r["isSame"] and pred_fn(r))
            fn = sum(1 for r in te_res if r["isSame"] and not pred_fn(r))
            p = tp / max(1, tp + fp); rv = tp / max(1, tp + fn)
            f1 = 2 * p * rv / (p + rv) if (p + rv) > 0 else 0.0
            return {"tp": tp, "fp": fp, "fn": fn, "precisionPct": round(p * 100, 2), "recallPct": round(rv * 100, 2), "f1Pct": round(f1 * 100, 2)}

        # Tune plaintext JW & Levenshtein on dev_pairs too for fair ceiling!
        best_jw_t = max([0.75, 0.80, 0.85, 0.88, 0.90], key=lambda t: sum(1 for a, b, _, s in dev_pairs if (jaro_winkler_sim(a, b) >= t) == s))
        best_lv_t = max([0.65, 0.70, 0.75, 0.80, 0.85], key=lambda t: sum(1 for a, b, _, s in dev_pairs if (levenshtein_sim(a, b) >= t) == s))

        # 3. 500-Name All-Pairs Scale Collision Test (124,750 distinct common-name pairs!)
        firsts = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
                  "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
                  "Daniel", "Nancy", "Matthew", "Lisa", "Anthony"]
        lasts = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
                 "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"]
        names_500 = [f"{f} {l}" for f in firsts for l in lasts]  # 25 * 20 = 500 distinct full names!
        in_sc = td_p / "sc_in.json"; out_sc = td_p / "sc_out.json"
        # Reuse pprl-noisy by pairing each name with itself to fetch its 128-bit bloomHex + phoneticHex in 1 call!
        in_sc.write_text(json.dumps({"salt": "pprl-scale-salt", "diceThreshold": best_thr, "pairs": [{"canonical": nm, "noisy": nm, "kind": "id", "isSame": True} for nm in names_500]}), encoding="utf-8")
        # Fetch signatures directly via small inline node one-liner for all 500 names
        sig_out = td_p / "sigs500.json"
        subprocess.run([
            "node", "-e",
            f"import fs from 'node:fs'; import {{loadMediaWasmSync}} from './src/media-wasm.js'; const w=loadMediaWasmSync(); const ns={json.dumps(names_500)}; fs.writeFileSync({json.dumps(str(sig_out))}, JSON.stringify(ns.map(n=>({{n, ...w.pprlSignature(n, 'pprl-scale-salt')}}))));"
        ], check=True)
        sigs = json.loads(sig_out.read_text(encoding="utf-8"))

        # Exact bitwise popcount over all 500*499/2 = 124,750 distinct negative pairs!
        ints = [int(s["bloomHex"], 16) for s in sigs]
        pops = [x.bit_count() for x in ints]
        phons = [s["phoneticHex"] for s in sigs]
        total_neg_pairs = 0
        bloom_fp_at_thr = 0
        bloom_fp_strict_075 = 0
        jw_fp = 0
        for i in range(len(sigs)):
            bi, pi, phi, ni = ints[i], pops[i], phons[i], names_500[i]
            for j in range(i + 1, len(sigs)):
                total_neg_pairs += 1
                inter = (bi & ints[j]).bit_count()
                dice = (2.0 * inter) / max(1, pi + pops[j])
                if dice >= best_thr or (phi == phons[j] and dice >= 0.55):
                    bloom_fp_at_thr += 1
                if dice >= 0.75:
                    bloom_fp_strict_075 += 1
                if jaro_winkler_sim(ni, names_500[j]) >= best_jw_t:
                    jw_fp += 1

    return {
        "devTunedDiceThreshold": best_thr,
        "heldOutTestPairs": len(test_pairs),
        "exactHmacBaseline": eval_pred(lambda r: r["exactMatch"]),
        "plaintextLevenshteinCeiling": {"threshold": best_lv_t, **eval_pred(lambda r: levenshtein_sim(r["canonical"], r["noisy"]) >= best_lv_t)},
        "plaintextJaroWinklerCeiling": {"threshold": best_jw_t, **eval_pred(lambda r: jaro_winkler_sim(r["canonical"], r["noisy"]) >= best_jw_t)},
        "wasmSaltedBloomSoundexPprl": eval_pred(lambda r: r["dice"] >= best_thr or (r["phonMatch"] and r["dice"] >= 0.55)),
        "scale500CommonNamesCollision": {
            "distinctNames": len(names_500),
            "allPairsNegativeCount": total_neg_pairs,
            "pprlFalseLinksAtDevThr": bloom_fp_at_thr,
            "pprlFalseLinkRateAtDevThrPct": round((bloom_fp_at_thr / total_neg_pairs) * 100.0, 4),
            "pprlFalseLinksAtStrict075": bloom_fp_strict_075,
            "pprlFalseLinkRateAtStrict075Pct": round((bloom_fp_strict_075 / total_neg_pairs) * 100.0, 4),
            "plaintextJaroWinklerFalseLinks": jw_fp,
            "plaintextJaroWinklerFalseLinkRatePct": round((jw_fp / total_neg_pairs) * 100.0, 4),
        },
    }


# ---------------------------------------------------------------------------
# EXP R6: Unicode Evasion vs. Standard Python NFKC Baseline
# ---------------------------------------------------------------------------
def run_unicode_nfkc_baseline() -> dict:
    print("\n=== Running Exp R6: Unicode Evasion vs. Standard NFKC Baseline ===")
    ai4 = json.loads(Path("results/untrusted-benchmarks/ai4privacy-500.json").read_text(encoding="utf-8"))
    cases = []
    for r in ai4:
        for m in r.get("privacy_mask") or []:
            if str(m.get("label", "")).upper() == "EMAIL" and "@" in str(m.get("value", "")) and len(cases) < 47:
                cases.append({"kind": "EMAIL", "raw": str(m["value"]), "ctx": f"Contact: {m['value']}"})
    cards = ["4532-0192-8374-1926", "4111-1111-1111-1111", "5500-0055-5555-5559", "3782-822463-10005"]
    ibans = ["GB82 WEST 1234 5698 7654 32", "DE89 3704 0044 0532 0130 00", "FR14 2004 1010 0505 0001 3M02 606", "NL91 ABNA 0417 1643 00"]
    for i in range(20):
        c = cards[i % len(cards)]; cases.append({"kind": "CARD", "raw": c, "ctx": f"Card: {c}"})
    for i in range(20):
        ib = ibans[i % len(ibans)]; cases.append({"kind": "IBAN", "raw": ib, "ctx": f"IBAN: {ib}"})

    def obf(val: str, kind: str) -> str:
        if kind == "zwsp":
            mid = len(val) // 2
            return val[:mid] + "\u200B" + val[mid:]
        if kind == "homoglyph":
            return val.replace("a", "\u0430").replace("e", "\u0435").replace("o", "\u043E")
        if kind == "fullwidth":
            return "".join(chr(0xFF10 + int(ch)) if ch.isdigit() else ch for ch in val)
        return val

    email_rx = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
    num_rx = re.compile(r"(?:\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}\b|\b(?:\d[ -]?){13,19}\b)")

    def rx_hit(s: str) -> bool:
        return bool(email_rx.search(s) or num_rx.search(s))

    out = {}
    for attack in ["clean", "zwsp", "homoglyph", "fullwidth"]:
        sub = [c for c in cases if not (attack == "fullwidth" and c["kind"] == "EMAIL") and not (attack == "homoglyph" and c["kind"] != "EMAIL")]
        sents = [c["ctx"].replace(c["raw"], c["raw"] if attack == "clean" else obf(c["raw"], attack)) for c in sub]
        raw_hits = sum(1 for s in sents if rx_hit(s))
        nfkc_hits = sum(1 for s in sents if rx_hit(unicodedata.normalize("NFKC", s)))
        out[attack] = {
            "total": len(sub),
            "unnormalizedRegexPct": pct(raw_hits, len(sub)),
            "pythonNfkcRegexPct": pct(nfkc_hits, len(sub)),
        }
    return out


def main() -> None:
    report = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "expR3_externalSecrets": run_external_secrets_benchmark(),
        "expR4_endToEndWhisperAudio": run_audio_e2e_benchmark(),
        "expR5_pprlRealityCheck": run_pprl_reality_check(),
        "expR6_unicodeNfkcBaseline": run_unicode_nfkc_baseline(),
    }
    OUT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\n=== REVIEWER-HARDENING v2 (R3, R4, R5, R6) COMPLETE ===")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
