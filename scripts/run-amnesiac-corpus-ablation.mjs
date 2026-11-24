#!/usr/bin/env node
/**
 * Stage 10 CPU-side Amnesiac Corpus ablation runner.
 *
 * Builds the Amnesiac Corpus over the generated multi-department company estate
 * (scripts/gen-company-estate.mjs), then for deletion fractions 1% / 5% / 20% of
 * corpus-indexed entities (deterministic seeded selection):
 *   (a) measures the byte-diff of the regenerated corpus vs the erased entities'
 *       spans (exact byte counts, diff-verified per eraseEntity receipts);
 *   (d) reports the per-sample gatekeeper certificate pass rate vs injected PII;
 *   and measures CPU-side regeneration wall-clock per fraction.
 *
 * The GPU-dependent metrics — (b) adapter retrain vs full retrain wall-clock,
 * SISA head-to-head, (c) Carlini canary exposure pre/post retrain — are NOT run
 * here (a live GPU job owns the machine); their fields are emitted with status
 * "pending-gpu" for a later run to backfill.
 *
 * Output: results/amnesiac-corpus-ablation.json (all keys except *WallclockMs are
 * deterministic; re-running the fixture generator + this script reproduces them).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildAmnesiacCorpus, eraseEntity, AMNESIAC_ENGINE_VERSION } from '../src/amnesiac-corpus.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/company-estate');
const MANIFEST_PATH = path.join(ROOT, 'fixtures/company-estate-manifest.json');
const OUT_PATH = path.join(ROOT, 'results/amnesiac-corpus-ablation.json');
export const SEED = 20261124;
const FRACTIONS = [0.01, 0.05, 0.20];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function estateInputs() {
  const files = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')).files;
  return files.map((f) => {
    const buf = fs.readFileSync(path.join(ESTATE_DIR, f.path));
    // WAV/deck surfaces go in as bytes; every other surface as text
    if (f.modality === 'audio' || f.modality === 'deck') return { name: f.path, bytes: buf };
    return { name: f.path, text: buf.toString('utf8') };
  });
}

// Word timeline for the audio seam: this CPU box has no local ASR weights, so the
// caption track's word timings are supplied the way a meeting recorder would —
// estate capture data, read from the estate file itself, never the GT manifest.
function captionWordTimestamps(inputs) {
  const vtt = inputs.find((i) => i.name.endsWith('.vtt'));
  if (!vtt) return [];
  const words = [];
  const cueRx = /(\d{2}):(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}):(\d{2}):(\d{2})\.(\d{3})/;
  const lines = vtt.text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = cueRx.exec(lines[i]);
    if (!m) continue;
    const toMs = (h, mi, s, ms) => Number(h) * 3600000 + Number(mi) * 60000 + Number(s) * 1000 + Number(ms);
    const startMs = toMs(m[1], m[2], m[3], m[4]);
    const endMs = toMs(m[5], m[6], m[7], m[8]);
    const text = (lines[i + 1] || '').replace(/<[^>]+>/g, ' ').trim();
    const tokens = text.split(/\s+/).filter(Boolean);
    tokens.forEach((word, w) => {
      const ws = startMs + Math.round(((endMs - startMs) * w) / tokens.length);
      const we = startMs + Math.round(((endMs - startMs) * (w + 1)) / tokens.length);
      words.push({ word, startMs: ws, endMs: we });
    });
  }
  return words;
}

export async function runAblation() {
  const t0 = performance.now();
  const inputs = estateInputs();
  const wordTimestamps = captionWordTimestamps(inputs);
  const corpus = await buildAmnesiacCorpus(inputs, null, { wordTimestamps });
  const buildWallclockMs = performance.now() - t0;

  const rebuilt = await buildAmnesiacCorpus(inputs, null, { wordTimestamps });
  if (rebuilt.jsonl !== corpus.jsonl) {
    throw new Error('ablation aborted: corpus rebuild is not byte-identical — determinism receipt violated, refusing to publish ablation numbers');
  }

  // Deterministic entity selection: sorted corpus-indexed ids, seeded Fisher-Yates,
  // disjoint slices per fraction (1% then next 5% then next 20% of the estate).
  const sortedIds = corpus.entityIndex.map((e) => e.entityId).sort();
  const shuffled = [...sortedIds];
  const rnd = mulberry32(SEED);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let cursor = 0;
  const fractions = {};
  for (const frac of FRACTIONS) {
    const count = Math.min(Math.max(1, Math.round(sortedIds.length * frac)), shuffled.length - cursor);
    fractions[String(frac)] = { fraction: frac, entityIds: shuffled.slice(cursor, cursor + count) };
    cursor += count;
  }

  const tokenOf = new Map();
  for (const e of corpus.entityIndex) tokenOf.set(e.entityId, e.token);

  for (const [key, spec] of Object.entries(fractions)) {
    let state = structuredClone(corpus); // fresh clone: fractions erase from the ORIGINAL corpus
    const tBefore = state.jsonl.length;
    let tStart = performance.now();
    let measuredDeltaBytes = 0;
    let removedSpanBytes = 0;
    let expectedShrinkBytes = 0; // positive: token spans + per-sample entity-list id entries
    const changedSampleIds = [];
    const perEntity = [];
    for (const entityId of spec.entityIds) {
      const before = state;
      const after = eraseEntity(before, entityId);
      const perBefore = new Map(before.samples.map((s) => [s.id, s]));
      // the erased entity's footprint in the corpus bytes: token spans in content + its
      // id entries in the per-sample entity lists — nothing else may differ
      let entityShrink = after.diffReceipt.removedSpanBytes;
      for (const ch of after.diffReceipt.perSample) {
        const b = perBefore.get(ch.id);
        const a = after.samples.find((s) => s.id === ch.id);
        entityShrink += JSON.stringify(b.entities).length - JSON.stringify(a.entities).length;
      }
      removedSpanBytes += after.diffReceipt.removedSpanBytes;
      expectedShrinkBytes += entityShrink;
      measuredDeltaBytes = after.jsonl.length - tBefore;
      changedSampleIds.push(...after.diffReceipt.changedSampleIds);
      perEntity.push({
        entityId,
        removedSpanBytes: after.diffReceipt.removedSpanBytes,
        entityListDeltaBytes: entityShrink - after.diffReceipt.removedSpanBytes,
        diffReceiptSha256: after.diffReceipt.diffReceiptSha256,
      });
      state = after;
    }
    fractions[key] = {
      ...spec,
      selectedEntityCount: spec.entityIds.length,
      indexedEntityCount: sortedIds.length,
      byteDiff: {
        bytesBefore: tBefore,
        bytesAfter: state.jsonl.length,
        removedSpanBytes,
        measuredDeltaBytes,
        expectedShrinkBytes,
        exact: measuredDeltaBytes === -expectedShrinkBytes,
        changedSampleCount: new Set(changedSampleIds).size,
        unchangedSampleCount: corpus.samples.length - new Set(changedSampleIds).size,
        corpusSha256Before: corpus.receipt.corpusSha256,
        corpusSha256After: state.receipt.corpusSha256,
        diffVerified: state.diffReceipt.diffVerified,
      },
      certificatePassRateBefore: corpus.certificates.passRate,
      certificatePassRateAfter: state.certificates.passRate,
      perErasedEntity: perEntity,
      regenerationWallclockMs: performance.now() - tStart,
    };
  }

  // honest certificate audit of the ORIGINAL corpus, scored against the manifest GT counts
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const injected = {};
  for (const e of manifest.entities) injected[e.class] = (injected[e.class] || 0) + 1;
  // GT canonical ids (person:/org:/project:) and engine salted ids (ent:<class>:<hash>) live in
  // different id spaces — a person is 3 engine entities (name/email/phone), and org ids and
  // project codenames have no engine class at all. Coverage is therefore reported by class:
  // engine classes observed in certificates.classes vs the GT classes the estate injects.
  const engineClasses = Object.keys(corpus.certificates.classes).sort();
  // a GT person carries name + email + phone values, which the engine indexes as three classes
  const personValueEngineClasses = ['EMAIL', 'PERSON', 'PHONE'].filter((c) => engineClasses.includes(c));
  const gtClasssWithEngineClass = personValueEngineClasses.length ? ['person'] : [];
  const gtClassesWithoutEngineClass = Object.keys(injected).filter((c) => !gtClasssWithEngineClass.includes(c));

  return {
    kind: 'amnesiac-corpus-ablation',
    stage: 10,
    seed: SEED,
    engine: AMNESIAC_ENGINE_VERSION,
    anti_circularity_note:
      'Ground truth (entity list + per-file char spans) lives only in fixtures/company-estate-manifest.json, produced by scripts/gen-company-estate.mjs. The engine path receives only the estate files — the manifest is read here solely to score engine coverage and injected-PII counts, never in the corpus seam.',
    zero_egress_note:
      'The corpus build and erasure path performs no network I/O (src/amnesiac-corpus.js imports no network modules); this run is CPU-side only.',
    pending_gpu_note:
      'Adapter-retrain wall-clock vs full retrain, SISA head-to-head, and Carlini canary exposure pre/post retrain require the GPU recipe and are NOT executed here (a live GPU job owns the machine); the fields below stay "pending-gpu" until a later run backfills them.',
    estate: {
      dir: 'fixtures/company-estate',
      fileCount: manifest.files.length,
      departments: manifest.departments,
      modalities: manifest.modalities,
      estateBytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
      groundTruthEntityCount: manifest.entities.length,
      corpusIndexedEntityCount: sortedIds.length,
      coverageNote:
        'GT entities are canonical (a person = name + email + phone as one GT entity); the corpus indexes each distinct detected value as its own salted engine entity. Org ids and project codenames have no engine class and are estate GT only, estate-wide by construction.',
      injectedEntityClassesWithEngineCoverage: gtClasssWithEngineClass,
      engineClassesObservingInjectedPersonValues: personValueEngineClasses,
      injectedEntityClassesWithoutEngineClass: gtClassesWithoutEngineClass,
    },
    corpus: {
      receipt: corpus.receipt,
      sampleCount: corpus.samples.length,
      audioCapture: {
        wordTimestampsSource: 'meetings/weekly-sync.vtt (estate caption track)',
        provider: 'supplied_word_timestamps (no local ASR weights on this CPU box)',
        wordCount: wordTimestamps.length,
      },
      buildWallclockMs,
    },
    certificates: {
      statedConfidence: corpus.certificates.statedConfidence,
      calibrationMethod: corpus.certificates.calibrationMethod,
      passRate: corpus.certificates.passRate,
      certifiedPassRateLowerBound: corpus.certificates.certifiedPassRateLowerBound,
      quarantinedSampleCount: corpus.certificates.quarantinedSampleIds.length,
      classes: corpus.certificates.classes,
      injectedEntityCountByClass: injected,
    },
    fractions,
    gpuDependent: {
      adapterRetrainWallclockVsFullRetrain: {
        status: 'pending-gpu',
        recipe: corpus.trainingRecipe,
        note: 'Deterministic seeded LoRA retrain over the regenerated corpus vs full retrain; owned by the PT-LM GPU recipe, not this CPU-side run.',
      },
      sisaHeadToHead: {
        status: 'pending-gpu',
        note: 'Head-to-head comparison against SISA sharding; requires the GPU harness.',
      },
      carliniCanaryExposurePrePostRetrain: {
        status: 'pending-gpu',
        target: 'exposure at or below chance after the erased-entity retrain',
        note: 'Carlini-style canary insertion and exposure measurement requires trained model states.',
      },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const artifact = await runAblation();
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(artifact, null, 2));
  console.log(JSON.stringify({
    out: 'results/amnesiac-corpus-ablation.json',
    corpusIndexedEntities: artifact.estate.corpusIndexedEntityCount,
    groundTruthEntities: artifact.estate.groundTruthEntityCount,
    fractions: Object.fromEntries(Object.entries(artifact.fractions).map(([k, f]) => [k, {
      entities: f.selectedEntityCount,
      removedSpanBytes: f.byteDiff.removedSpanBytes,
      measuredDeltaBytes: f.byteDiff.measuredDeltaBytes,
      exact: f.byteDiff.exact,
      passRateBefore: f.certificatePassRateBefore,
      passRateAfter: f.certificatePassRateAfter,
    }])),
  }));
}
