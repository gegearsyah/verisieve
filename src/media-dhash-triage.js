/**
 * dHash keyframe triage — lazy-greedy keyframe selection over 64-bit perceptual hashes
 * (Stage 8, IB-AMP remediation).
 *
 * Objective: f(S) = number of frames covered by S, where a frame is covered iff its dHash
 * is within `coverageHamming` Hamming bits of some selected keyframe's dHash. Coverage
 * functions are monotone submodular, so Minoux lazy-greedy under a cardinality budget
 * (with near-duplicate suppression via the threshold) honors a >= (1 - 1/e)/2 guarantee
 * on coverage relative to the optimal k-selection. The full (1 - 1/e) approximation is
 * NOT claimed here — that requires Sviridenko-style partial enumeration, unimplemented.
 *
 * `pruned` = frames not selected as keyframes (the triage decision); `covered` records
 * which selected keyframe represents each frame (-1 = uncovered, e.g. budget exhausted).
 */
/** Number of differing bits between two 64-bit (BigInt) hashes. */
export function hamming64(a, b) {
  let x = BigInt.asUintN(64, a) ^ BigInt.asUintN(64, b);
  let count = 0;
  while (x !== 0n) {
    x &= x - 1n;
    count++;
  }
  return count;
}

export const APPROXIMATION_GUARANTEE = '(1 - 1/e)/2';

/**
 * Minoux lazy-greedy maximizer. `hashes` is an array of BigInt 64-bit dHashes.
 * Returns { keyframes, prunedCount, prunedIndices, pruningRate, covered, evaluations }.
 *
 * Lazy step: the priority queue holds a stale upper bound on each candidate's future
 * marginal gain (its gain on a submoment earlier in the run is an upper bound on its
 * marginal now, by submodularity). Popping the top only re-evaluates true gains until
 * the popped bound confirms it is still the max, so most candidates never get
 * re-evaluated in a round.
 */
export function selectKeyframesLazyGreedy(hashes, options = {}) {
  const coverageHamming = Math.max(0, Math.round(options.coverageHamming ?? 8));
  const budget = Math.max(1, Math.round(options.budget ?? hashes.length));
  const n = hashes.length;

  if (n === 0) {
    return {
      keyframes: [], prunedCount: 0, prunedIndices: [], pruningRate: 0, covered: [], evaluations: 0,
    };
  }

  const covered = new Array(n).fill(-1); // -1 = not yet represented by a selection
  const inSelected = new Array(n).fill(false);
  const keyframes = [];
  let evaluations = 0;

  const gain = (candidate, refresh) => {
    evaluations++;
    let g = 0;
    for (let i = 0; i < n; i++) {
      if (covered[i] < 0 && (i === candidate || hamming64(hashes[candidate], hashes[i]) <= coverageHamming)) {
        g++;
        if (!refresh.includes(i)) refresh.push(i); // frames this pick would newly cover
      }
    }
    return g;
  };

  // Max-heap of [bound, candidate] with exact-gain re-evaluation at pop time.
  const pq = new MaxHeap(n);
  // Seed bounds: marginal gain is bounded by the uncovered frame count, <= n.
  for (let j = 0; j < n; j++) {
    pq.push(j, n);
  }

  while (keyframes.length < budget && !pq.isEmpty()) {
    const [cand] = pq.popTop();
    if (inSelected[cand]) continue;
    const wouldCover = [];
    const g = gain(cand, wouldCover);
    if (g <= 0) {
      continue; // permanently unhelpful (submodularity: future gains cannot rise)
    }
    // Confirm the popped candidate still dominates: exact gain must be >= the best
    // remaining stale bound; otherwise push back and re-check the new leader.
    if (!pq.isEmpty() && pq.topGain() > g) {
      pq.push(cand, g);
      continue;
    }
    inSelected[cand] = true;
    keyframes.push(cand);
    for (const i of wouldCover) covered[i] = cand;
  }

  const prunedIndices = [];
  for (let i = 0; i < n; i++) {
    if (!inSelected[i]) prunedIndices.push(i);
  }
  return {
    keyframes,
    prunedCount: prunedIndices.length,
    prunedIndices,
    pruningRate: n > 0 ? prunedIndices.length / n : 0,
    covered,
    evaluations,
  };
}

/** Binary max-heap over (gain, id) pairs. */
class MaxHeap {
  constructor(capacity) {
    this.keys = new Float64Array(Math.max(1, capacity));
    this.ids = new Int32Array(Math.max(1, capacity));
    this.size = 0;
  }

  isEmpty() {
    return this.size === 0;
  }

  topGain() {
    return this.size > 0 ? this.keys[0] : Number.NEGATIVE_INFINITY;
  }

  push(id, gain) {
    if (this.size >= this.keys.length) {
      // grow (rare: elements re-pushed after stale-bound recheck)
      const nk = new Float64Array(this.keys.length * 2);
      nk.set(this.keys);
      this.keys = nk;
      const ni = new Int32Array(this.ids.length * 2);
      ni.set(this.ids);
      this.ids = ni;
    }
    let i = this.size++;
    this.keys[i] = gain;
    this.ids[i] = id;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] >= this.keys[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  popTop() {
    if (this.size === 0) return null;
    const id = this.ids[0];
    const gain = this.keys[0];
    this.size--;
    if (this.size > 0) {
      this.keys[0] = this.keys[this.size];
      this.ids[0] = this.ids[this.size];
      let i = 0;
      const half = this.size >> 1;
      while (i < half) {
        let child = i * 2 + 1;
        if (child + 1 < this.size && this.keys[child + 1] > this.keys[child]) child++;
        if (this.keys[i] >= this.keys[child]) break;
        this.swap(i, child);
        i = child;
      }
    }
    return [id, gain];
  }

  swap(a, b) {
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
    const ti = this.ids[a];
    this.ids[a] = this.ids[b];
    this.ids[b] = ti;
  }
}
