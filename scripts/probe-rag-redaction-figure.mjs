// Graphs for docs/2026-11-16-rag-redaction-verdict.md.
// Reads the probe JSON. Asserts every bar. Writes one SVG.
//   node scripts/probe-rag-redaction-figure.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rag = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'rag-retrieval-probe.json'), 'utf8'));
const vera = JSON.parse(fs.readFileSync(path.join(ROOT, 'results', 'local-vera-probe.json'), 'utf8'));

const INK = '#0b0b0b', SUB = '#52514e', MUT = '#898781';
const GRID = '#e1e0d9', AXIS = '#c3c2b7', SURF = '#fcfcfb';
const BLUE = '#2a78d6', ORANGE = '#eb6834', GRAY = '#c3c2b7';
const FONT = 'font-family="Segoe UI, sans-serif"';
const assert = (c, m) => { if (!c) { console.error('FAIL ' + m); process.exit(1); } };

assert(rag.rankers.cosine.recallAt5.hits === 75 && rag.rankers.cosine.recallAt5.pct === 60, 'cosine recall@5');
assert(rag.rankers.lexical.recallAt5.hits === 123 && rag.rankers.lexical.recallAt5.pct === 98.4, 'lexical recall@5');
assert(rag.rankers.hybrid_055_045.recallAt5.hits === 120 && rag.rankers.hybrid_055_045.recallAt5.pct === 96, 'hybrid recall@5');
assert(vera.rerank.blendGoldInTop6.hits === 121 && vera.rerank.blendGoldInTop6.pct === 96.8, 'blend top6');
assert(vera.rerank.shortlist30.headGoldInTop6.hits === 39 && vera.rerank.shortlist30.headGoldInTop6.pct === 31.2, 'head top6');
const t = vera.redaction.test250;
assert(t.contact.regexRecall.pct === 83.6 && t.contact.headRecall.pct === 83.6, 'contact recall');
assert(t.bareNames.regexRecall.pct === 47.1 && t.bareNames.headRecall.pct === 35.3, 'bare recall');
assert(t.structured26.regexRecall.pct === 30.7 && t.structured26.headRecall.pct === 30.7, 'tag recall');

const W = 720, H = 460;
const txt = (x, y, s, { size = 11, fill = SUB, anchor = 'start', weight = 'normal' } = {}) =>
  `<text x="${+x.toFixed(1)}" y="${+y.toFixed(1)}" ${FONT} font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;
const vbar = (x, yTop, yBase, w, fill, r = 3) => {
  const h = yBase - yTop;
  if (h < r * 2) return `<rect x="${+x.toFixed(1)}" y="${+yTop.toFixed(1)}" width="${w}" height="${Math.max(h, 1).toFixed(1)}" rx="2" fill="${fill}"/>`;
  return `<path d="M${x} ${yBase} L${x} ${yTop + r} Q${x} ${yTop} ${x + r} ${yTop} L${x + w - r} ${yTop} Q${x + w} ${yTop} ${x + w} ${yTop + r} L${x + w} ${yBase} Z" fill="${fill}"/>`;
};

const plot = (x0, x1, yTop, yBase, bars) => {
  const body = [];
  const Y = (v) => yBase - (v / 100) * (yBase - yTop);
  for (const tick of [0, 25, 50, 75, 100]) {
    const y = Y(tick);
    body.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
    body.push(txt(x0 - 8, y + 3.5, `${tick}`, { size: 9, fill: MUT, anchor: 'end' }));
  }
  body.push(`<line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);
  body.push(`<line x1="${x0}" y1="${yTop}" x2="${x0}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);
  const band = (x1 - x0) / bars.length;
  bars.forEach((bar, i) => {
    const bw = bar.w ?? 22;
    const cx = x0 + band * (i + 0.5);
    const x = cx - bw / 2;
    const y = Y(bar.v);
    body.push(vbar(x, y, yBase, bw, bar.fill));
    body.push(txt(cx + (bar.labelDx || 0), y - 6, String(bar.v), { size: 9, fill: SUB, anchor: 'middle' }));
    if (bar.name) body.push(txt(cx, yBase + 14, bar.name, { size: 9, fill: SUB, anchor: 'middle' }));
  });
  return body;
};

const body = [];
body.push(`<rect width="${W}" height="${H}" fill="${SURF}"/>`);
body.push(txt(32, 24, 'Sandbox ranker and the local VeRA heads', { size: 13, weight: 'bold', fill: INK }));
body.push(txt(32, 40, 'Recall at 5 on 125 questions. Then gold-in-top-6, and span recall on the test 250.', { size: 10, fill: MUT }));

body.push(txt(360, 64, 'A. Recall at 5 (%)', { size: 11, weight: 'bold', fill: INK, anchor: 'middle' }));
body.push(...plot(48, 690, 80, 200, [
  { name: 'Cosine', v: rag.rankers.cosine.recallAt5.pct, fill: GRAY, w: 28 },
  { name: 'Lexical', v: rag.rankers.lexical.recallAt5.pct, fill: ORANGE, w: 28 },
  { name: 'Hybrid', v: rag.rankers.hybrid_055_045.recallAt5.pct, fill: BLUE, w: 28 }
]));

body.push(txt(188, 250, 'B. Gold in the top 6 (%)', { size: 11, weight: 'bold', fill: INK, anchor: 'middle' }));
body.push(txt(188, 264, 'VeRA reorders the blend top 30, then keeps 6', { size: 9, fill: MUT, anchor: 'middle' }));
body.push(...plot(48, 330, 280, 400, [
  { name: 'Blend', v: vera.rerank.blendGoldInTop6.pct, fill: BLUE, w: 28 },
  { name: 'VeRA', v: vera.rerank.shortlist30.headGoldInTop6.pct, fill: ORANGE, w: 28 }
]));

body.push(txt(530, 250, 'C. Span recall on the test 250 (%)', { size: 11, weight: 'bold', fill: INK, anchor: 'middle' }));
body.push(txt(530, 264, 'Gray is the regex. Orange is the VeRA head.', { size: 9, fill: MUT, anchor: 'middle' }));
body.push(...plot(400, 690, 280, 400, [
  { v: t.contact.regexRecall.pct, fill: GRAY, w: 16, labelDx: -11 },
  { v: t.contact.headRecall.pct, fill: ORANGE, w: 16, labelDx: 11 },
  { v: t.bareNames.regexRecall.pct, fill: GRAY, w: 16 },
  { v: t.bareNames.headRecall.pct, fill: ORANGE, w: 16 },
  { v: t.structured26.regexRecall.pct, fill: GRAY, w: 16, labelDx: -11 },
  { v: t.structured26.headRecall.pct, fill: ORANGE, w: 16, labelDx: 11 }
]));
const tagBand = (690 - 400) / 6;
for (const [k, name] of [[0, 'Contact'], [1, 'Names'], [2, '26 tags']]) {
  body.push(txt(400 + tagBand * (2 * k + 1), 414, name, { size: 9, fill: SUB, anchor: 'middle' }));
}

const out = path.join(ROOT, 'docs', '2026-11-16-rag-redaction.svg');
fs.writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body.join('')}</svg>\n`);
