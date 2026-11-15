import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

function generateFigures() {
  const benchPath = path.resolve('results/benchmarks.json');
  if (!fs.existsSync(benchPath)) {
    console.error('results/benchmarks.json not found. Run run-benchmarks.mjs first.');
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(benchPath, 'utf-8'));
  const { bornDigitalPipeline, ocrTiling } = data;

  const INK = '#1e2430';
  const SUB = '#4a5568';
  const MUT = '#718096';
  const GRID = '#e2e8f0';
  const PRIMARY = '#1d4ed8';
  const ACCENT = '#047857';
  const WARN = '#b45309';
  const DANGER = '#b91c1c';

  const keys = ['0.05', '0.10', '0.20'];

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="320" viewBox="0 0 760 320" style="background-color: #fcfcfa; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <style>
    .title { font-size: 13px; font-weight: 600; fill: ${INK}; }
    .subtitle { font-size: 10px; fill: ${SUB}; }
    .axis { font-size: 9px; fill: ${MUT}; }
    .label { font-size: 9px; font-weight: 500; fill: ${INK}; }
  </style>

  <rect width="760" height="320" fill="#fcfcfa" rx="6"/>

  <!-- Panel A: Client Gatekeeper False-Alarm Rate (%) -->
  <g transform="translate(48, 20)">
    <text x="0" y="0" class="title">Panel A: Gatekeeper False-Alarm Rate (%)</text>
    <text x="0" y="14" class="subtitle">Before vs. After LTT Calibration</text>
    
    <line x1="0" y1="180" x2="190" y2="180" stroke="${GRID}" stroke-width="1"/>
    <line x1="0" y1="130" x2="190" y2="130" stroke="${GRID}" stroke-dasharray="2,2" stroke-width="1"/>
    <line x1="0" y1="80" x2="190" y2="80" stroke="${GRID}" stroke-dasharray="2,2" stroke-width="1"/>
    <line x1="0" y1="30" x2="190" y2="30" stroke="${GRID}" stroke-dasharray="2,2" stroke-width="1"/>

    <text x="195" y="33" class="axis">α=0.05</text>
    <text x="195" y="93" class="axis">α=0.10</text>
    <text x="195" y="153" class="axis">α=0.20</text>

    <!-- Alpha 0.05 -->
    <rect x="20" y="${180 - bornDigitalPipeline.fprBeforeLtt['0.05'] * 500}" width="16" height="${bornDigitalPipeline.fprBeforeLtt['0.05'] * 500}" fill="${DANGER}" opacity="0.8" rx="2"/>
    <rect x="40" y="${180 - bornDigitalPipeline.fprAfterLtt['0.05'] * 500}" width="16" height="${bornDigitalPipeline.fprAfterLtt['0.05'] * 500}" fill="${ACCENT}" rx="2"/>
    <text x="30" y="195" class="axis" text-anchor="middle">0.05</text>

    <!-- Alpha 0.10 -->
    <rect x="85" y="${180 - bornDigitalPipeline.fprBeforeLtt['0.10'] * 500}" width="16" height="${bornDigitalPipeline.fprBeforeLtt['0.10'] * 500}" fill="${DANGER}" opacity="0.8" rx="2"/>
    <rect x="105" y="${180 - bornDigitalPipeline.fprAfterLtt['0.10'] * 500}" width="16" height="${bornDigitalPipeline.fprAfterLtt['0.10'] * 500}" fill="${ACCENT}" rx="2"/>
    <text x="95" y="195" class="axis" text-anchor="middle">0.10</text>

    <!-- Alpha 0.20 -->
    <rect x="150" y="${180 - bornDigitalPipeline.fprBeforeLtt['0.20'] * 500}" width="16" height="${bornDigitalPipeline.fprBeforeLtt['0.20'] * 500}" fill="${DANGER}" opacity="0.8" rx="2"/>
    <rect x="170" y="${180 - bornDigitalPipeline.fprAfterLtt['0.20'] * 500}" width="16" height="${bornDigitalPipeline.fprAfterLtt['0.20'] * 500}" fill="${ACCENT}" rx="2"/>
    <text x="160" y="195" class="axis" text-anchor="middle">0.20</text>
  </g>

  <!-- Panel B: Tiling Mode: CER (%) & Recall -->
  <g transform="translate(296, 20)">
    <text x="0" y="0" class="title">Panel B: Tiling Mode: CER (%) &amp; Recall</text>
    <text x="0" y="14" class="subtitle">Scan-Degraded Multi-Font Comparison</text>

    <line x1="0" y1="180" x2="200" y2="180" stroke="${GRID}" stroke-width="1"/>
    
    <!-- Untiled -->
    <rect x="15" y="${Math.max(25, 180 - ocrTiling.untiled_512.degraded.meanCerPct * 1.8)}" width="36" height="${Math.min(155, ocrTiling.untiled_512.degraded.meanCerPct * 1.8)}" fill="${WARN}" opacity="0.9" rx="3"/>
    <text x="33" y="${Math.max(18, 175 - ocrTiling.untiled_512.degraded.meanCerPct * 1.8)}" class="axis" text-anchor="middle">${ocrTiling.untiled_512.degraded.meanCerPct}%</text>
    <text x="33" y="195" class="label" text-anchor="middle">Untiled</text>
    <text x="33" y="207" class="axis" text-anchor="middle">${ocrTiling.untiled_512.numPasses || ocrTiling.untiled_512.clean.numPasses} Pass</text>

    <!-- 1D Band -->
    <rect x="82" y="${Math.max(25, 180 - ocrTiling.horizontal_1d_band.degraded.meanCerPct * 1.8)}" width="36" height="${Math.min(155, ocrTiling.horizontal_1d_band.degraded.meanCerPct * 1.8)}" fill="${PRIMARY}" opacity="0.9" rx="3"/>
    <text x="100" y="${Math.max(18, 175 - ocrTiling.horizontal_1d_band.degraded.meanCerPct * 1.8)}" class="axis" text-anchor="middle">${ocrTiling.horizontal_1d_band.degraded.meanCerPct}%</text>
    <text x="100" y="195" class="label" text-anchor="middle">1D Band</text>
    <text x="100" y="207" class="axis" text-anchor="middle">${ocrTiling.horizontal_1d_band.numPasses || ocrTiling.horizontal_1d_band.clean.numPasses} Passes</text>

    <!-- 2D Tile -->
    <rect x="149" y="${Math.max(25, 180 - ocrTiling.tile_2d.degraded.meanCerPct * 1.8)}" width="36" height="${Math.min(155, ocrTiling.tile_2d.degraded.meanCerPct * 1.8)}" fill="${ACCENT}" opacity="0.9" rx="3"/>
    <text x="167" y="${Math.max(18, 175 - ocrTiling.tile_2d.degraded.meanCerPct * 1.8)}" class="axis" text-anchor="middle">${ocrTiling.tile_2d.degraded.meanCerPct}%</text>
    <text x="167" y="195" class="label" text-anchor="middle">2D Tile</text>
    <text x="167" y="207" class="axis" text-anchor="middle">${ocrTiling.tile_2d.numPasses || ocrTiling.tile_2d.clean.numPasses} Passes</text>
  </g>

  <!-- Panel C: Client-Side Training Latency (ms) -->
  <g transform="translate(544, 20)">
    <text x="0" y="0" class="title">Panel C: Training Latency (ms)</text>
    <text x="0" y="14" class="subtitle">Across Chunk Counts (N)</text>

    <line x1="0" y1="180" x2="170" y2="180" stroke="${GRID}" stroke-width="1"/>
    <line x1="0" y1="60" x2="170" y2="60" stroke="${DANGER}" stroke-dasharray="3,3" stroke-width="1"/>
    <text x="175" y="63" class="axis" fill="${DANGER}">Budget</text>

    <!-- N=100 -->
    <rect x="15" y="${Math.max(20, 180 - bornDigitalPipeline.trainLatencyMs['100'] * 1.0)}" width="30" height="${Math.min(160, bornDigitalPipeline.trainLatencyMs['100'] * 1.0)}" fill="${PRIMARY}" rx="2"/>
    <text x="30" y="${Math.max(12, 175 - bornDigitalPipeline.trainLatencyMs['100'] * 1.0)}" class="axis" text-anchor="middle">${bornDigitalPipeline.trainLatencyMs['100']}ms</text>
    <text x="30" y="195" class="label" text-anchor="middle">100</text>

    <!-- N=500 -->
    <rect x="70" y="${Math.max(20, 180 - bornDigitalPipeline.trainLatencyMs['500'] * 1.0)}" width="30" height="${Math.min(160, bornDigitalPipeline.trainLatencyMs['500'] * 1.0)}" fill="${PRIMARY}" rx="2"/>
    <text x="85" y="${Math.max(12, 175 - bornDigitalPipeline.trainLatencyMs['500'] * 1.0)}" class="axis" text-anchor="middle">${bornDigitalPipeline.trainLatencyMs['500']}ms</text>
    <text x="85" y="195" class="label" text-anchor="middle">500</text>

    <!-- N=2000 -->
    <rect x="125" y="${Math.max(20, 180 - bornDigitalPipeline.trainLatencyMs['2000'] * 1.0)}" width="30" height="${Math.min(160, bornDigitalPipeline.trainLatencyMs['2000'] * 1.0)}" fill="${PRIMARY}" rx="2"/>
    <text x="140" y="${Math.max(12, 175 - bornDigitalPipeline.trainLatencyMs['2000'] * 1.0)}" class="axis" text-anchor="middle">${bornDigitalPipeline.trainLatencyMs['2000']}ms</text>
    <text x="140" y="195" class="label" text-anchor="middle">2000</text>
  </g>

  <text x="48" y="295" class="subtitle">Notes: Computed directly from results/benchmarks.json. All coordinates derived dynamically from execution measurements.</text>
</svg>`;

  const docsDir = path.resolve('docs');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const svgPath = path.join(docsDir, 'matilda-portable-benchmarks.svg');

  const hash1 = crypto.createHash('sha256').update(svg).digest('hex');
  fs.writeFileSync(svgPath, svg, 'utf-8');
  const readBack = fs.readFileSync(svgPath, 'utf-8');
  const hash2 = crypto.createHash('sha256').update(readBack).digest('hex');

  if (hash1 !== hash2) {
    console.error('Error: SVG generation is not byte-identical!');
    process.exit(1);
  }

  console.log('Successfully generated docs/matilda-portable-benchmarks.svg (SHA-256:', hash1, ');');
}

generateFigures();
