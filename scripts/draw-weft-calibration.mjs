import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// W7 (plan decision 8): CALIBRATION.svg for release/weft-specialist-v1.
// Hand-rolled SVG in the same style as scripts/generate-figures.mjs, reading
// the certified conformal numbers from the committed W5 ledger and failing
// closed if they do not match what the card records. The test-half counts
// (310 positives in a 2000-pair eval; 11 false merges in 161 answered) are
// recorded in docs/research-notes/2026-11-28-w5-quantized-export-results.md
// and carried here as verified constants.

const POSITIVES = 310;
const PAIRS = 2000;
const TEST_HALF_ANSWERED = 161;
const TEST_HALF_FALSE_MERGES = 11;
const ALPHAS_SHOWN = [0.05, 0.1];

const ledger = JSON.parse(fs.readFileSync(path.resolve('results/weft-export-latency.json'), 'utf8'));
const entry = ledger.entries
  .slice()
  .reverse()
  .find((e) => e.bitWidth === 4 && e.quality && e.quality.pairCount === PAIRS);
if (!entry || !entry.conformal) {
  console.error('no int4 conformal entry in results/weft-export-latency.json');
  process.exit(1);
}

const rows = ALPHAS_SHOWN.map((alpha) => {
  const row = entry.conformal.find((c) => Math.abs(c.alpha - alpha) < 1e-9);
  if (!row) {
    console.error(`no certified row for alpha ${alpha}`);
    process.exit(1);
  }
  if (!row.certified) {
    console.error(`alpha ${alpha} is not certified in the ledger`);
    process.exit(1);
  }
  return row;
});

const threshold = rows[0].threshold;
if (rows.some((r) => Math.abs(r.threshold - threshold) > 1e-9)) {
  console.error('alpha rows disagree on the certified threshold');
  process.exit(1);
}
const coverage = rows[0].coverage;
if (rows.some((r) => r.coverage !== coverage)) {
  console.error('alpha rows disagree on coverage');
  process.exit(1);
}
const testHalfRate = TEST_HALF_FALSE_MERGES / TEST_HALF_ANSWERED;
if (Math.abs(rows[0].falseMergeRate - testHalfRate) > 0.001) {
  console.error(`ledger falseMergeRate ${rows[0].falseMergeRate} does not match the test-half counts ${TEST_HALF_FALSE_MERGES}/${TEST_HALF_ANSWERED}`);
  process.exit(1);
}

const INK = '#0b0b0b', SUB = '#52514e', MUT = '#898781';
const GRID = '#e1e0d9', AXIS = '#c3c2b7', SURF = '#fcfcfb';
const BLUE = '#2a78d6', ORANGE = '#eb6834';
const FONT = 'font-family="Segoe UI, sans-serif"';

const W = 720;
const H = 300;

const txt = (x, y, s, { size = 11, fill = SUB, anchor = 'start', weight = 'normal' } = {}) =>
  `<text x="${+x.toFixed(1)}" y="${+y.toFixed(1)}" ${FONT} font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;

const body = [];
body.push(`<rect width="${W}" height="${H}" fill="${SURF}"/>`);
body.push(txt(32, 28, 'Weft specialist conformal calibration (shipped int4 artifact)', { size: 12.5, weight: 'bold', fill: INK }));
body.push(txt(32, 44, 'Certified bound vs. the wide-noise test-half point estimate; from results/weft-export-latency.json', { size: 10, fill: MUT }));

// Panel A: the certified threshold on the pair-score axis
{
  const x0 = 55, x1 = 335, y = 135;
  body.push(txt((x0 + x1) / 2, y - 30, 'Certified abstain threshold on the pair score', { size: 10.5, weight: 'bold', fill: INK, anchor: 'middle' }));
  body.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${AXIS}" stroke-width="1"/>`);
  for (const tick of [0, 0.25, 0.5, 0.75, 1]) {
    const x = x0 + tick * (x1 - x0);
    body.push(`<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y + 4}" stroke="${AXIS}" stroke-width="1"/>`);
    body.push(txt(x, y + 18, `${tick.toFixed(2)}`, { size: 8.5, fill: MUT, anchor: 'middle' }));
  }
  const xt = x0 + 0.5 * (x1 - x0);
  body.push(`<line x1="${xt}" y1="${y - 34}" x2="${xt}" y2="${y + 10}" stroke="${BLUE}" stroke-width="2"/>`);
  body.push(txt(xt, y - 44, `threshold ${threshold.toFixed(4)}`, { size: 9.5, fill: SUB, anchor: 'middle', weight: 'bold' }));
  body.push(txt(xt, y + 36, 'same threshold certified at alpha 0.05 and alpha 0.10', { size: 9, fill: MUT, anchor: 'middle' }));
  body.push(txt(xt, y + 52, 'the head is sharply bimodal at this boundary, so coverage stays thin', { size: 9, fill: MUT, anchor: 'middle' }));
}

// Panel B: coverage point and false-merge bound vs. test-half estimate
{
  const x0 = 425, x1 = 695, yTop = 85, yBase = 240;
  body.push(txt((x0 + x1) / 2, yTop - 15, 'Coverage and false-merge rates (%)', { size: 10.5, weight: 'bold', fill: INK, anchor: 'middle' }));
  for (const tick of [0, 5, 10, 15, 20]) {
    const yy = yBase - (tick / 20) * (yBase - yTop);
    body.push(`<line x1="${x0}" y1="${yy}" x2="${x1}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`);
    body.push(txt(x0 - 6, yy + 3.5, `${tick}%`, { size: 8.5, fill: MUT, anchor: 'end' }));
  }
  body.push(`<line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);
  body.push(`<line x1="${x0}" y1="${yTop - 5}" x2="${x0}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);

  const bars = [
    { label: 'answered', pct: coverage * 100, fill: BLUE, note: `(${POSITIVES} of ${PAIRS})` },
    { label: 'certified bound', pct: 0.05 * 100, fill: BLUE, note: `at most alpha (0.05)` },
    { label: 'test half', pct: testHalfRate * 100, fill: ORANGE, note: `${TEST_HALF_FALSE_MERGES}/${TEST_HALF_ANSWERED}, wide noise` },
  ];
  const band = (x1 - x0) / bars.length;
  const bw = 34;
  bars.forEach((b, i) => {
    const cx = x0 + band * (i + 0.5);
    const bx = cx - bw / 2;
    const yy = yBase - (b.pct / 20) * (yBase - yTop);
    body.push(`<rect x="${bx}" y="${yy}" width="${bw}" height="${Math.max(yBase - yy, 1)}" rx="2" fill="${b.fill}"/>`);
    body.push(txt(cx, yy - 5, `${b.pct.toFixed(1)}%`, { size: 8.5, fill: SUB, anchor: 'middle' }));
    body.push(txt(cx, yBase + 14, b.label, { size: 8.5, fill: SUB, anchor: 'middle' }));
    body.push(txt(cx, yBase + 28, b.note, { size: 8, fill: MUT, anchor: 'middle' }));
  });
  body.push(txt(x0, yTop + 8, `certificate: false-merge rate at most alpha, probability 0.95`, { size: 8, fill: SUB }));
  body.push(txt(x0, yTop + 22, `point estimate is wide noise; the certificate is the bound`, { size: 8, fill: SUB }));
}

body.push(txt(32, 284, `Measured: coverage ${coverage}, threshold ${threshold.toFixed(4)} at alpha 0.05 and 0.10 | the certificate is the bound, not the point (W5, ticket #45)`, { size: 9, fill: MUT }));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body.join('')}</svg>`;

const outPath = path.resolve('release/weft-specialist-v1/CALIBRATION.svg');
fs.writeFileSync(outPath, svg, 'utf8');
const readBack = fs.readFileSync(outPath, 'utf8');
const hash1 = crypto.createHash('sha256').update(svg).digest('hex');
const hash2 = crypto.createHash('sha256').update(readBack).digest('hex');
if (hash1 !== hash2) {
  console.error('SVG generation is not byte-identical on read-back');
  process.exit(1);
}
console.log(`generated ${outPath} (sha256 ${hash1.slice(0, 16)}...)`);
