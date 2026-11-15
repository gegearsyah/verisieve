#!/usr/bin/env python3
"""
scripts/bench-numpy.py
Lightweight Python + NumPy baseline matching exact 1,207 x 520 float32 logistic dot product.
"""
import sys
import time
import json
import platform

t0 = time.perf_counter()
import numpy as np
t_imp = time.perf_counter()

n = int(sys.argv[1]) if len(sys.argv) > 1 else 1207
passes = int(sys.argv[2]) if len(sys.argv) > 2 else 200

X = np.fromfunction(lambda i, j: 0.01 * ((i + j) % 17), (n, 520), dtype=np.float32)
w = np.fromfunction(lambda j: 0.002 * ((j % 11) - 5), (520,), dtype=np.float32)

if passes > 1:
    _ = 1.0 / (1.0 + np.exp(-(0.05 + (X @ w))))

t_hot0 = time.perf_counter()
safe_count = 0
for _ in range(passes):
    z = 0.05 + (X @ w)
    p = 1.0 / (1.0 + np.exp(-z))
    safe_count = int(np.sum(p >= 0.72))
t_hot1 = time.perf_counter()

rss_mb = 0.0
try:
    import psutil
    rss_mb = round(psutil.Process().memory_info().rss / (1024 * 1024), 2)
except Exception:
    pass

print(json.dumps({
    "paradigm": "python_numpy",
    "pythonVersion": platform.python_version(),
    "numpyVersion": np.__version__,
    "importMs": round((t_imp - t0) * 1000, 2),
    "hotLoopMs": round(((t_hot1 - t_hot0) / passes) * 1000, 4),
    "peakRssMb": rss_mb,
    "safeCount": safe_count
}))
