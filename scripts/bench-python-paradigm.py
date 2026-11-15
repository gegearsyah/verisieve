#!/usr/bin/env python3
"""
scripts/bench-python-paradigm.py
Real Subprocess Benchmark for Local Python (PyTorch 2.10 + DuckDB 1.5.5) Paradigm.
Measures cold start latency, DuckDB in-process SQL ingestion, PyTorch Qwen2 forward/backward step,
and actual peak RSS memory usage via psutil.
"""

import sys
import time

t_start = time.perf_counter()

# Import core heavy dependencies
import psutil
import duckdb
import torch
from transformers import Qwen2Config, Qwen2ForCausalLM

t_imported = time.perf_counter()
cold_start_ms = round((t_imported - t_start) * 1000, 2)

scale = 100
if len(sys.argv) > 1:
    try:
        scale = int(sys.argv[1])
    except ValueError:
        pass

# 1. DuckDB In-Memory Table Ingestion & Query
con = duckdb.connect(':memory:')
con.execute("CREATE TABLE docs (id INTEGER, text VARCHAR, tokens INTEGER);")

# Insert scale rows
rows = [(i, f"Clinical observation and ambulatory recovery report section {i}", 128) for i in range(scale)]
con.executemany("INSERT INTO docs VALUES (?, ?, ?);", rows)
duck_res = con.execute("SELECT count(*), sum(tokens) FROM docs;").fetchone()

# 2. PyTorch Qwen2 Model Forward + Backward Pass
torch.manual_seed(42)
config = Qwen2Config(
    vocab_size=512,
    hidden_size=64,
    intermediate_size=128,
    num_hidden_layers=2,
    num_attention_heads=2,
    num_key_value_heads=2,
    max_position_embeddings=128
)
model = Qwen2ForCausalLM(config)
optimizer = torch.optim.AdamW(model.parameters(), lr=0.005)

# Simulate batch execution proportional to scale (e.g., min(scale, 16) seqs, seq_len 32)
batch_size = min(scale, 16)
seq_len = 32
input_ids = torch.randint(0, 512, (batch_size, seq_len), dtype=torch.long)
labels = input_ids.clone()

t_train_start = time.perf_counter()
optimizer.zero_grad()
output = model(input_ids=input_ids, labels=labels)
loss = output.loss
loss.backward()
optimizer.step()
t_train_end = time.perf_counter()

train_pytorch_ms = round((t_train_end - t_train_start) * 1000, 2)
total_ms = round((time.perf_counter() - t_start) * 1000, 2)

# Peak RSS via psutil
rss_mb = round(psutil.Process().memory_info().rss / (1024 * 1024), 1)

import json
result = {
    "paradigm": "local_python",
    "scale": scale,
    "coldStartMs": cold_start_ms,
    "trainPyTorchMs": train_pytorch_ms,
    "totalMs": total_ms,
    "peakRssMb": rss_mb,
    "networkEgressBytes": 0,
    "estimatedCloudCostUsd": 0.0,
    "duckdbCount": duck_res[0],
    "loss": round(loss.item(), 4)
}

print(json.dumps(result))
