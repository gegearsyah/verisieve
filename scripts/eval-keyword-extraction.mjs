#!/usr/bin/env node
/**
 * Keyword-scoped extraction benchmark over the synthetic company estate.
 *
 * For every manifest entity (`values[0]` used as the user-typed keyword), runs
 * `perceiveMulti` with `keywords: [value]` and scores the extracted file set against
 * the manifest's entity -> files ground truth (scorer-side only, never fed to the engine).
 *
 * Misses are decomposed so a literal keyword's known limit is visible, not hidden:
 *   filterBug      - a perceived block in that file contains the keyword but the file was not extracted
 *   ingestGap      - the raw file contains the keyword but no perceived block does (parser/attachment gap)
 *   otherValueOnly - file only carries the entity's other literal forms (email/phone/alias)
 *   spokenOnly     - file carries only spoken/homophone forms; no literal keyword can recover it
 *
 * Writes results/keyword-extraction-benchmark.json. Deterministic apart from wallclockMs.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { perceiveMulti } from '../src/perceive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ESTATE_DIR = path.join(ROOT, 'fixtures/company-estate');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures/company-estate-manifest.json'), 'utf8'));
const OUT_PATH = path.join(ROOT, 'results/keyword-extraction-benchmark.json');
const WORKSPACE_SALT = 'versieve-amnesiac-v1';

const files = MANIFEST.files.filter((f) => !f.path.endsWith('.wav'));
const rawByPath = new Map(
  files.map((f) => [f.path, fs.readFileSync(path.join(ESTATE_DIR, f.path), 'utf8').toLowerCase()])
);
const inputs = files.map((f) => ({
  name: f.path,
  bytes: fs.readFileSync(path.join(ESTATE_DIR, f.path)),
}));

const contains = (p, value) => rawByPath.get(p)?.includes(String(value).toLowerCase()) ?? false;

const parsedBlockText = new Map();
async function blocksContain(p, value) {
  if (!parsedBlockText.has(p)) {
    const res = await perceiveMulti([{ name: p, bytes: fs.readFileSync(path.join(ESTATE_DIR, p)) }], {
      workspaceSalt: WORKSPACE_SALT,
    });
    parsedBlockText.set(p, res.blocks.map((b) => String(b.originalText).toLowerCase()).join('\n'));
  }
  return parsedBlockText.get(p).includes(String(value).toLowerCase());
}

const runs = [];
let sumTp = 0;
let sumExtracted = 0;
let sumExpected = 0;
let graphMismatches = 0;
const missTotals = { filterBug: 0, ingestGap: 0, otherValueOnly: 0, spokenOnly: 0 };

for (const entity of MANIFEST.entities) {
  const keyword = String(entity.values[0]);
  const expected = new Set(entity.files);
  const t0 = process.hrtime.bigint();
  const res = await perceiveMulti(inputs, {
    keywords: [keyword],
    workspaceSalt: WORKSPACE_SALT,
  });
  const wallclockMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const extracted = new Set(res.blocks.map((b) => b.source));
  const tp = [...expected].filter((p) => extracted.has(p)).length;
  const missed = [...expected].filter((p) => !extracted.has(p));
  const missBreakdown = { filterBug: 0, ingestGap: 0, otherValueOnly: 0, spokenOnly: 0 };
  for (const p of missed) {
    if (!contains(p, keyword)) {
      if (entity.values.slice(1).some((v) => contains(p, v))) missBreakdown.otherValueOnly++;
      else missBreakdown.spokenOnly++;
    } else if (await blocksContain(p, keyword)) missBreakdown.filterBug++;
    else missBreakdown.ingestGap++;
  }
  if (res.graph.documents.length !== extracted.size) graphMismatches++;

  sumTp += tp;
  sumExtracted += extracted.size;
  sumExpected += expected.size;
  for (const k of Object.keys(missTotals)) missTotals[k] += missBreakdown[k];

  runs.push({
    entityId: entity.id,
    keyword,
    expectedFiles: expected.size,
    extractedFiles: extracted.size,
    truePositives: tp,
    precision: extracted.size ? Number((tp / extracted.size).toFixed(4)) : 0,
    recall: expected.size ? Number((tp / expected.size).toFixed(4)) : 0,
    missBreakdown,
    graphDocCount: res.graph.documents.length,
    wallclockMs: Number(wallclockMs.toFixed(2)),
  });
}

const microPrecision = sumExtracted ? sumTp / sumExtracted : 0;
const microRecall = sumExpected ? sumTp / sumExpected : 0;
const f1 = microPrecision + microRecall ? (2 * microPrecision * microRecall) / (microPrecision + microRecall) : 0;

const report = {
  kind: 'keyword-extraction-benchmark',
  antiCircularityNote:
    'Ground truth is manifest entity -> files, read only by this scorer. The engine path never sees the manifest.',
  workspaceSaltSha256: crypto.createHash('sha256').update(WORKSPACE_SALT).digest('hex'),
  estateFiles: files.length,
  entitiesScored: runs.length,
  micro: {
    precision: Number(microPrecision.toFixed(4)),
    recall: Number(microRecall.toFixed(4)),
    f1: Number(f1.toFixed(4)),
    truePositives: sumTp,
    extractedFiles: sumExtracted,
    expectedFiles: sumExpected,
  },
  missDecomposition: {
    ...missTotals,
    note:
      'filterBug must stay 0; ingestGap is a parser/attachment coverage limit; otherValueOnly and spokenOnly are keyword-choice limits.',
  },
  graphDocCountMismatches: graphMismatches,
  runs,
};

fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
fs.writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `keyword extraction: P=${report.micro.precision} R=${report.micro.recall} F1=${report.micro.f1} ` +
    `over ${runs.length} entities; misses: filterBug=${missTotals.filterBug} ` +
    `ingestGap=${missTotals.ingestGap} otherValueOnly=${missTotals.otherValueOnly} ` +
    `spokenOnly=${missTotals.spokenOnly}`
);
console.log(`wrote ${OUT_PATH}`);
