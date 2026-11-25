"""Unit tests for skills/versieve-local-train/scripts/versieve-train.py (Track C3).

Verifies on a realistic graph-grounded SFT fixture JSONL:
  1. Zero double-EOS sequences in formatted & packed token outputs
  2. Base-model pad_token == eos_token label masking never erases real EOS or trains on pads
  3. Mean packed sequence length is well above the 49.4-token collapse zone
  4. Zero raw PII survives into formatted text or training tensors
  5. Auto target-module detection covers LFM3, Qwen2.5, and Llama projection layers
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT_PATH = (
    Path(__file__).resolve().parents[1]
    / "skills"
    / "versieve-local-train"
    / "scripts"
    / "versieve-train.py"
)


def load_trainer_module():
    spec = importlib.util.spec_from_file_location("versieve_train", SCRIPT_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


class FakeBaseTokenizer:
    """Simulates a base causal LM tokenizer (like LFM3-1.7B-Base) where pad_token is None."""

    def __init__(self, with_unk: bool = False, with_chat_template: bool = False):
        self.eos_token = "<|endoftext|>"
        self.eos_token_id = 2
        self.pad_token = None
        self.pad_token_id = None
        self.unk_token = "<unk>" if with_unk else None
        self.unk_token_id = 0 if with_unk else None
        self.padding_side = "left"
        self.chat_template = "chatml" if with_chat_template else None
        self._vocab = {"<|endoftext|>": 2}
        if with_unk:
            self._vocab["<unk>"] = 0

    def get_vocab(self) -> dict[str, int]:
        return dict(self._vocab)

    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False):
        parts = []
        for m in messages:
            parts.append(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>")
        rendered = "\n".join(parts) + self.eos_token
        return rendered if not tokenize else self.encode(rendered)

    def encode(self, text: str, add_special_tokens: bool = False) -> list[int]:
        tokens: list[int] = []
        for piece in text.replace(self.eos_token, f" {self.eos_token} ").split():
            if piece == self.eos_token:
                tokens.append(self.eos_token_id)
            else:
                tokens.append(100 + (abs(hash(piece)) % 50000))
        if add_special_tokens:
            tokens.append(self.eos_token_id)
        return tokens


class FakeModel:
    def __init__(self, module_names: list[str]):
        self._names = module_names

    def named_modules(self):
        return [(name, object()) for name in self._names]


class TestVersieveTrainTrackC3(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mod = load_trainer_module()

    def _build_fixture_jsonl(self, tmp_dir: Path) -> Path:
        long_para_1 = (
            "[oaic.md > APP 1 Open and Transparent Management]\n"
            "An APP entity must implement practices, procedures, and systems to ensure compliance "
            "with the Australian Privacy Principles across all regulated divisions. "
            "Lead compliance officer <PII:PERSON_01> (<PII:EMAIL_01>) audits privacy notices "
            "published at https://www.oaic.gov.au/privacy/app-1 every quarter and records "
            "remediation timelines, board attestations, and data retention controls across "
            "every subsidiary handling personal or sensitive clinical records. " * 4
        )
        long_para_2 = (
            "[oaic.md > Small Business Operator Exemption]\n"
            "Under Section 6D of the Privacy Act, an operator with annual turnover of $3,000,000 "
            "or less is generally exempt unless it provides a health service, trades in personal "
            "information, or is related to a larger APP entity. <PII:PERSON_01> approved ruling "
            "X-904 documenting turnover thresholds and Part IIIC 30-day breach assessment duties. " * 4
        )
        rows = [
            {
                "id": "sft:passage:0",
                "mode": "packed_passage",
                "text": long_para_1 + "<|im_end|><|endoftext|>",  # Intentionally dirty trailing EOS
                "provenance_ids": ["prov:pas:0"],
            },
            {
                "id": "sft:passage:1",
                "mode": "packed_passage",
                "text": long_para_2 + "</s>",  # Intentionally dirty trailing EOS
                "provenance_ids": ["prov:pas:1"],
            },
            {
                "id": "sft:section:0",
                "mode": "section_instruction",
                "messages": [
                    {"role": "system", "content": "Grounded domain assistant."},
                    {
                        "role": "user",
                        "content": "What statutory turnover threshold applies under Section 6D?",
                    },
                    {"role": "assistant", "content": long_para_2},
                ],
                "provenance_ids": ["prov:pas:1"],
            },
        ]
        path = tmp_dir / "rtio-graph-sft.jsonl"
        path.write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")
        return path

    def test_zero_double_eos_and_packed_length_above_collapse_zone(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_path = self._build_fixture_jsonl(Path(tmp))
            raw_rows = self.mod.load_clean_jsonl(data_path)
            self.assertEqual(len(raw_rows), 3)

            # Base tokenizer without chat template (LFM3-1.7B-Base style)
            base_tok = FakeBaseTokenizer(with_unk=False, with_chat_template=False)
            pad_info = self.mod.configure_tokenizer_for_sft(base_tok)
            self.assertEqual(base_tok.padding_side, "right")
            self.assertTrue(pad_info["pad_equals_eos"])

            formatted = self.mod.format_training_rows(raw_rows, base_tok, strip_trailing_eos=True)
            self.assertEqual(len(formatted), 3)
            for row in formatted:
                self.assertFalse(row["text"].endswith("<|endoftext|>"))
                self.assertFalse(row["text"].endswith("<|im_end|>"))
                self.assertFalse(row["text"].endswith("</s>"))

            audit = self.mod.audit_formatted_dataset(
                formatted, base_tok, max_seq_length=1024, pack=True
            )
            self.assertEqual(audit["double_eos_count"], 0, "Must have ZERO double-EOS sequences")
            self.assertEqual(audit["raw_pii_hits"], 0, "Must have ZERO raw PII leaks in tensors")
            self.assertGreater(
                audit["mean_packed_tokens"],
                250.0,
                f"Mean packed length ({audit['mean_packed_tokens']}) must exceed 49.4-token collapse zone",
            )

            # Chat-template tokenizer must also have zero double-EOS
            chat_tok = FakeBaseTokenizer(with_unk=True, with_chat_template=True)
            chat_pad_info = self.mod.configure_tokenizer_for_sft(chat_tok)
            self.assertFalse(chat_pad_info["pad_equals_eos"])
            self.assertEqual(chat_tok.pad_token, "<unk>")
            chat_formatted = self.mod.format_training_rows(
                raw_rows, chat_tok, strip_trailing_eos=True
            )
            chat_audit = self.mod.audit_formatted_dataset(
                chat_formatted, chat_tok, max_seq_length=1024, pack=True
            )
            self.assertEqual(chat_audit["double_eos_count"], 0)
            self.assertEqual(chat_audit["raw_pii_hits"], 0)

    def test_mask_padding_labels_preserves_real_eos_when_pad_equals_eos(self):
        # Sequence: [101, 102, 2 (real EOS), 2 (pad), 2 (pad)]
        input_ids = [101, 102, 2, 2, 2]
        attention_mask = [1, 1, 1, 0, 0]
        labels = self.mod.mask_padding_labels(
            input_ids, attention_mask, pad_token_id=2, eos_token_id=2
        )
        self.assertEqual(labels, [101, 102, 2, -100, -100])

    def test_detect_target_modules_for_lfm3_qwen_llama(self):
        lfm3_model = FakeModel(
            [
                "model.layers.0.self_attn.q_proj",
                "model.layers.0.self_attn.k_proj",
                "model.layers.0.self_attn.v_proj",
                "model.layers.0.self_attn.out_proj",
                "model.layers.0.conv.in_proj",
                "model.layers.0.feed_forward.w1",
                "model.layers.0.feed_forward.w2",
                "model.layers.0.feed_forward.w3",
            ]
        )
        detected_lfm = self.mod.detect_target_modules(lfm3_model, "auto")
        for expected in ("q_proj", "k_proj", "v_proj", "out_proj", "in_proj", "w1", "w2", "w3"):
            self.assertIn(expected, detected_lfm)

        qwen_model = FakeModel(
            [
                "model.layers.0.self_attn.q_proj",
                "model.layers.0.self_attn.k_proj",
                "model.layers.0.self_attn.v_proj",
                "model.layers.0.self_attn.o_proj",
                "model.layers.0.mlp.gate_proj",
                "model.layers.0.mlp.up_proj",
                "model.layers.0.mlp.down_proj",
            ]
        )
        detected_qwen = self.mod.detect_target_modules(qwen_model, "auto")
        self.assertEqual(
            set(detected_qwen),
            {"q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"},
        )

    def test_raw_pii_canary_detection_catches_leaks(self):
        tok = FakeBaseTokenizer()
        dirty = [{"text": "Contact alice.mercer@clinic.org with SSN 123-45-6789 immediately."}]
        audit = self.mod.audit_formatted_dataset(dirty, tok, max_seq_length=512, pack=True)
        self.assertGreaterEqual(audit["raw_pii_hits"], 2)


if __name__ == "__main__":
    unittest.main()
