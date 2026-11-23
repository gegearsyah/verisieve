"""Download public benchmark datasets & Apache-2.0 GLiNER-PII-Edge ONNX weights for Track E Paper 2.

Datasets fetched (all public, zero private files):
  1. knowledgator/gliner-pii-edge-v1.0 (Apache-2.0, 45M params, ONNX quint8 + fp16)
  2. Yale-LILY/aeslc (500 real public Enron corporate emails)
  3. bigcode/the-stack-smol (500 real public Python files for secret-scanner zero-FP testing)
  4. hf-internal-testing/librispeech_asr_dummy (40 real 16 kHz LibriSpeech utterances as PCM16 WAV)
"""

from __future__ import annotations

import json
import os
import struct
import wave
from pathlib import Path

from datasets import load_dataset
from huggingface_hub import hf_hub_download

OUT = Path("results/untrusted-benchmarks/track-e-public")
OUT.mkdir(parents=True, exist_ok=True)


def main() -> None:
    # 1. Apache-2.0 GLiNER-PII-Edge ONNX weights
    mdir = OUT / "models" / "gliner-pii-edge"
    mdir.mkdir(parents=True, exist_ok=True)
    for fn in [
        "gliner_config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "onnx/model_quint8.onnx",
    ]:
        p = hf_hub_download("knowledgator/gliner-pii-edge-v1.0", filename=fn, local_dir=str(mdir))
        print(f"DL_MODEL: {fn} ({os.path.getsize(p):,} bytes)")

    # 2. Enron Corporate Emails (Yale-LILY/aeslc, 500 emails)
    ds_enron = load_dataset("Yale-LILY/aeslc", split="test[:500]")
    enron_rows = [
        {"id": i, "subject": r["subject_line"], "body": r["email_body"]}
        for i, r in enumerate(ds_enron)
    ]
    (OUT / "enron-500.json").write_text(json.dumps(enron_rows), encoding="utf-8")
    print(f"DL_ENRON: {len(enron_rows)} emails")

    # 3. Public Developer Code Corpus (500 files for secret-scanner FP evaluation)
    try:
        ds_code = load_dataset("bigcode/the-stack-smol", data_dir="data/python", split="train[:500]")
        code_rows = [
            {"id": i, "path": r.get("path", f"file_{i}.py"), "content": r["content"][:8000]}
            for i, r in enumerate(ds_code)
        ]
    except Exception as exc:
        print(f"the-stack-smol fallback ({exc})")
        ds_code = load_dataset("google-research-datasets/mbpp", split="train[:374]")
        code_rows = [
            {"id": i, "path": f"task_{r['task_id']}.py", "content": r["code"]}
            for i, r in enumerate(ds_code)
        ]
    (OUT / "public-code-500.json").write_text(json.dumps(code_rows), encoding="utf-8")
    print(f"DL_CODE: {len(code_rows)} files")

    # 4. Real 16 kHz LibriSpeech Speech Audio (40 utterances)
    try:
        ds_audio = load_dataset("hf-internal-testing/librispeech_asr_dummy", "clean", split="validation[:40]")
        adir = OUT / "librispeech-wav"
        adir.mkdir(parents=True, exist_ok=True)
        meta = []
        for i, r in enumerate(ds_audio):
            arr = r["audio"]["array"]
            sr = int(r["audio"]["sampling_rate"])
            wav_path = adir / f"utt_{i:02d}.wav"
            with wave.open(str(wav_path), "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sr)
                pcm = bytearray()
                for s in arr:
                    v = max(-32768, min(32767, int(round(float(s) * 32767.0))))
                    pcm.extend(struct.pack("<h", v))
                wf.writeframes(pcm)
            meta.append(
                {
                    "id": i,
                    "file": wav_path.name,
                    "sr": sr,
                    "duration_s": round(len(arr) / sr, 3),
                    "text": r["text"],
                }
            )
        (OUT / "librispeech-meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
        print(f"DL_AUDIO: {len(meta)} utterances")
    except Exception as exc:
        print(f"AUDIO_ERR: {exc}")


if __name__ == "__main__":
    main()
