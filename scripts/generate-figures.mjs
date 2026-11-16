import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function requireNumber(val, label) {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    throw new Error(`MISSING_BENCHMARK_METRIC: ${label} must be a finite measured number`);
  }
  return val;
}

function generateFigures() {
  const benchPath = path.resolve('results/benchmarks.json');
  if (!fs.existsSync(benchPath)) {
    console.error('results/benchmarks.json not found. Run run-benchmarks.mjs first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(benchPath, 'utf8'));
  const { bornDigitalPipeline, ocrTiling } = data;

  const INK = '#0b0b0b', SUB = '#52514e', MUT = '#898781';
  const GRID = '#e1e0d9', AXIS = '#c3c2b7', SURF = '#fcfcfb';
  const BLUE = '#2a78d6', ORANGE = '#eb6834', GRAY = '#c3c2b7';
  const FONT = 'font-family="Segoe UI, sans-serif"';

  const W = 720;
  const H = 320;

  const txt = (x, y, s, { size = 11, fill = SUB, anchor = 'start', weight = 'normal' } = {}) =>
    `<text x="${+x.toFixed(1)}" y="${+y.toFixed(1)}" ${FONT} font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}">${s}</text>`;

  const vbar = (x, yTop, yBase, w, fill, r = 3) => {
    const h = yBase - yTop;
    if (h < r * 2) return `<rect x="${x}" y="${yTop}" width="${w}" height="${Math.max(h, 1)}" rx="2" fill="${fill}"/>`;
    return `<path d="M${x} ${yBase} L${x} ${yTop + r} Q${x} ${yTop} ${x + r} ${yTop} L${x + w - r} ${yTop} Q${x + w} ${yTop} ${x + w} ${yTop + r} L${x + w} ${yBase} Z" fill="${fill}"/>`;
  };

  const body = [];
  body.push(`<rect width="${W}" height="${H}" fill="${SURF}"/>`);
  body.push(txt(32, 28, 'VeriSieve Core Micro-Benchmarks (LTT False-Alarm, OCR Tiling CER, Training Latency)', { size: 12.5, weight: 'bold', fill: INK }));
  body.push(txt(32, 44, 'Evaluated strictly from live measurements recorded in results/benchmarks.json', { size: 10, fill: MUT }));

  // Panel A: FAR Before vs After LTT (%)
  {
    const x0 = 45, x1 = 235, yTop = 85, yBase = 240;
    body.push(txt((x0 + x1) / 2, yTop - 15, 'Panel A: FAR Before vs. After LTT (%)', { size: 10.5, weight: 'bold', fill: INK, anchor: 'middle' }));
    const alphas = ['0.05', '0.10', '0.20'];
    const maxPct = Math.max(
      30,
      ...alphas.map((a) => requireNumber(bornDigitalPipeline.fprBeforeLtt[a], `fprBeforeLtt[${a}]`) * 100),
      ...alphas.map((a) => requireNumber(bornDigitalPipeline.fprAfterLtt[a], `fprAfterLtt[${a}]`) * 100)
    );
    const axisMax = Math.ceil(maxPct / 10) * 10;

    for (let k = 0; k <= 3; k++) {
      const tick = (axisMax / 3) * k;
      const y = yBase - (tick / axisMax) * (yBase - yTop);
      body.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
      body.push(txt(x0 - 6, y + 3.5, `${Math.round(tick)}%`, { size: 8.5, fill: MUT, anchor: 'end' }));
    }
    body.push(`<line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);
    body.push(`<line x1="${x0}" y1="${yTop - 5}" x2="${x0}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);

    const band = (x1 - x0) / alphas.length, bw = 16;
    alphas.forEach((a, i) => {
      const cx = x0 + band * (i + 0.5);
      const before = requireNumber(bornDigitalPipeline.fprBeforeLtt[a], `fprBeforeLtt[${a}]`) * 100;
      const after = requireNumber(bornDigitalPipeline.fprAfterLtt[a], `fprAfterLtt[${a}]`) * 100;

      const yBefore = yBase - (before / axisMax) * (yBase - yTop);
      const yAfter = yBase - (after / axisMax) * (yBase - yTop);

      body.push(vbar(cx - bw - 1, yBefore, yBase, bw, ORANGE));
      body.push(vbar(cx + 1, yAfter, yBase, bw, BLUE));

      body.push(txt(cx - bw / 2 - 1, yBefore - 4, `${before.toFixed(1)}%`, { size: 8, fill: SUB, anchor: 'middle' }));
      body.push(txt(cx + bw / 2 + 1, yAfter - 4, `${after.toFixed(1)}%`, { size: 8, fill: SUB, anchor: 'middle' }));
      body.push(txt(cx, yBase + 14, `α=${a}`, { size: 8.5, fill: SUB, anchor: 'middle' }));
    });
  }

  // Panel B: Tiling Mode CER (%) on Degraded Scan
  {
    const x0 = 280, x1 = 470, yTop = 85, yBase = 240;
    body.push(txt((x0 + x1) / 2, yTop - 15, 'Panel B: Tiling Mode CER (%) on Degraded Scan', { size: 10.5, weight: 'bold', fill: INK, anchor: 'middle' }));

    for (const tick of [0, 25, 50, 75, 100]) {
      const y = yBase - (tick / 100) * (yBase - yTop);
      body.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
      body.push(txt(x0 - 6, y + 3.5, `${tick}%`, { size: 8.5, fill: MUT, anchor: 'end' }));
    }
    body.push(`<line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);
    body.push(`<line x1="${x0}" y1="${yTop - 5}" x2="${x0}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);

    const modes = [
      ['Untiled', requireNumber(ocrTiling.untiled_512.degraded.meanCerPct, 'untiled_512.degraded.meanCerPct'), ORANGE],
      ['1D Band', requireNumber(ocrTiling.horizontal_1d_band.degraded.meanCerPct, 'horizontal_1d_band.degraded.meanCerPct'), GRAY],
      ['2D Tile', requireNumber(ocrTiling.tile_2d.degraded.meanCerPct, 'tile_2d.degraded.meanCerPct'), BLUE],
    ];
    const band = (x1 - x0) / modes.length, bw = 28;
    modes.forEach(([name, val, fill], i) => {
      const cx = x0 + band * (i + 0.5), bx = cx - bw / 2;
      const by = yBase - (Math.min(100, val) / 100) * (yBase - yTop);
      body.push(vbar(bx, by, yBase, bw, fill));
      body.push(txt(cx, by - 5, `${val.toFixed(1)}%`, { size: 9, fill: SUB, anchor: 'middle' }));
      body.push(txt(cx, yBase + 14, name, { size: 8.5, fill: SUB, anchor: 'middle' }));
    });
  }

  // Panel C: Gatekeeper Training Latency across N (ms)
  {
    const x0 = 515, x1 = 690, yTop = 85, yBase = 240;
    body.push(txt((x0 + x1) / 2, yTop - 15, 'Panel C: Gatekeeper Train Latency (ms)', { size: 10.5, weight: 'bold', fill: INK, anchor: 'middle' }));

    const chunks = ['100', '500', '2000'];
    const latencies = chunks.map((n) => requireNumber(bornDigitalPipeline.trainLatencyMs[n], `trainLatencyMs[${n}]`));
    const maxMs = Math.max(30, Math.ceil(Math.max(...latencies) / 10) * 10);

    for (let k = 0; k <= 3; k++) {
      const tick = (maxMs / 3) * k;
      const y = yBase - (tick / maxMs) * (yBase - yTop);
      body.push(`<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`);
      body.push(txt(x0 - 6, y + 3.5, `${Math.round(tick)}ms`, { size: 8.5, fill: MUT, anchor: 'end' }));
    }
    body.push(`<line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);
    body.push(`<line x1="${x0}" y1="${yTop - 5}" x2="${x0}" y2="${yBase}" stroke="${AXIS}" stroke-width="1"/>`);

    const band = (x1 - x0) / chunks.length, bw = 26;
    chunks.forEach((n, i) => {
      const cx = x0 + band * (i + 0.5), bx = cx - bw / 2;
      const ms = latencies[i];
      const by = yBase - (Math.min(maxMs, ms) / maxMs) * (yBase - yTop);
      body.push(vbar(bx, by, yBase, bw, BLUE));
      body.push(txt(cx, by - 5, `${ms.toFixed(1)}ms`, { size: 8.5, fill: SUB, anchor: 'middle' }));
      body.push(txt(cx, yBase + 14, `N=${n}`, { size: 8.5, fill: SUB, anchor: 'middle' }));
    });
  }

  body.push(txt(32, 295, 'Computed 100% deterministically from results/benchmarks.json | Standardized MLE dataviz style (W = 720)', { size: 9, fill: MUT }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${body.join('')}</svg>`;

  const docsDir = path.resolve('docs');
  fs.mkdirSync(docsDir, { recursive: true });
  const svgPath = path.join(docsDir, 'matilda-portable-benchmarks.svg');

  const hash1 = crypto.createHash('sha256').update(svg).digest('hex');
  fs.writeFileSync(svgPath, svg, 'utf8');
  const readBack = fs.readFileSync(svgPath, 'utf8');
  const hash2 = crypto.createHash('sha256').update(readBack).digest('hex');

  if (hash1 !== hash2) {
    console.error('Error: SVG generation is not byte-identical!');
    process.exit(1);
  }
  console.log('Successfully generated docs/matilda-portable-benchmarks.svg (SHA-256:', hash1, ')');
}

generateFigures();
