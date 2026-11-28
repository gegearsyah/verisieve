import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { generateEstate } from '../scripts/gen-company-estate.mjs';
import { runCompanyBrainSlice, SEED } from '../scripts/run-company-brain-slice.mjs';
import { THEME_POLICY_VERSION } from '../src/weft-theme-linker.js';

// Stage 10 Company-Brain slice: P2 cross-department linking receipt, P3 zero-egress
// receipt, P4 training-ready JSONL export + browser connection graph JSON.
// GT lives only in fixtures/company-estate-manifest.json; the engine path sees only estate files.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'results/company-brain-slice.json');
const CORPUS_JSONL = path.join(ROOT, 'results/company-brain-slice-corpus.jsonl');
const GRAPH_JSON = path.join(ROOT, 'results/company-brain-slice-connection-graph.json');

// Wall-clock keys vary run to run by nature; every other number is deterministic.
const stripTimings = (node) => {
  if (Array.isArray(node)) return node.map(stripTimings);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (/WallclockMs$/.test(k)) out[k] = 0;
      else out[k] = stripTimings(v);
    }
    return out;
  }
  return node;
};

test('P2+P3+P4: artifact shape, honest P2 metrics, zero-egress receipt, export and graph receipts', async () => {
  generateEstate(); // estate files on disk for the runner
  const artifact = await runCompanyBrainSlice();
  fs.writeFileSync(OUT, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(CORPUS_JSONL, artifact.p4.export.jsonl);
  fs.writeFileSync(GRAPH_JSON, JSON.stringify(artifact.p4.connectionGraph.raw, null, 2));

  assert.equal(artifact.kind, 'company-brain-slice');
  assert.equal(artifact.stage, 10);
  assert.equal(artifact.seed, SEED);

  // P2: link metrics are finite probabilities with recovered cross-department links
  const p2 = artifact.p2;
  assert.ok(p2.linkMetric.gtLinks > 0, 'GT cross-department links must be counted');
  for (const key of ['precision', 'recall', 'f1']) {
    const v = p2.linkMetric[key];
    assert.equal(typeof v, 'number', `${key} must be a number`);
    assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `${key} must be in [0,1], got ${v}`);
  }
  assert.ok(p2.linkMetric.recoveredLinks >= 1, 'at least one GT cross-department link must be recovered');
  assert.ok(p2.entityResolution.gtEntitiesObserved >= 1, 'at least one GT entity must be observed in the engine output');
  // the IT <-> Business same-entity demonstration must be present and non-empty
  const itBusiness = p2.crossDepartmentExamples.find((e) => e.departmentPair.join('|') === 'business|it');
  assert.ok(itBusiness && itBusiness.links.length >= 1 && itBusiness.links[0].sharedEngineEntityIds.length >= 1,
    'IT and Business similar data must be shown resolving to the same salted entity');
  // graph seams were actually exercised
  assert.ok(p2.graphSeams.louvain.communityCount >= 1, 'louvain seam must run over the perception graph');
  assert.ok(p2.graphSeams.ppr.seededEntityCount >= 1, 'PPR seam must run over the perception graph');
  assert.ok(p2.graphSeams.srmpRing.anchorPoolSize >= 1, 'SR-MP ring anchor pool must be reported');

  // P3: zero-egress receipt
  const p3 = artifact.p3;
  assert.equal(p3.receipt.egressBytes, 0, 'egress bytes must be measured as zero');
  assert.deepEqual(p3.receipt.externalCalls, [], 'no external calls may occur');
  assert.ok(p3.receipt.networkSurfacesArmed.length >= 5, 'network traps must actually be armed during the run');
  for (const read of p3.receipt.fileReads.surfaces) {
    assert.match(read, /^(fixtures\/company-estate\/|fixtures\/company-estate-manifest\.json|vendor\/wasm\/)/,
      'only local estate, manifest and engine-kernel reads are allowed');
  }
  assert.ok(p3.receipt.fileReads.byteCount > 0, 'the read surface must be non-empty');
  assert.equal(p3.audioCapture.failClosed, true, 'the ASR seam must be recorded as fail-closed');

  // P4: training-ready JSONL export with per-sample certificates + connection graph JSON
  const p4 = artifact.p4;
  assert.ok(p4.export.sampleCount >= 1, 'the export must carry samples');
  const lines = fs.readFileSync(CORPUS_JSONL, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, p4.export.sampleCount, 'JSONL line count must match the export receipt');
  const certificatesById = new Map(p4.export.certificates.perSample.map((c) => [c.id, c]));
  for (const line of lines) {
    const s = JSON.parse(line);
    assert.ok(/^[0-9a-f]{64}$/.test(s.id), 'sample ids must be content digests');
    // byte-range provenance is a best-effort seam property: plain-byte surfaces (txt/csv/sql)
    // locate their exact source spans; derived-format blocks (eml/vtt/wav/pptx parsers
    // reflow text) fall back to the content-digest id without a range
    if (/\.(eml|vtt|wav|pptx)$/.test(s.source)) {
      assert.equal(s.sourceRange, null, `derived-format sample ${s.id} must be honest about its non-locatable range`);
    } else {
      assert.ok(Array.isArray(s.sourceRange) && s.sourceRange[0] < s.sourceRange[1], `sample ${s.id} must record its source byte-range`);
    }
    assert.ok(Array.isArray(s.entities), 'samples must record entity ids');
    assert.ok(Array.isArray(s.messages) && s.messages.length === 3, 'samples must be training-ready SFT messages');
    const cert = certificatesById.get(s.id);
    assert.ok(cert, `every exported sample must carry a per-sample certificate (${s.id})`);
    assert.equal(typeof cert.certifiedPass, 'boolean', 'per-sample certificates must carry certifiedPass');
    assert.ok(typeof cert.gate === 'string' && cert.gate.length > 0, 'per-sample certificates must carry their gate');
  }
  assert.ok(p4.export.certificates.perSample.length === p4.export.sampleCount, 'certificate count must equal sample count');
  assert.equal(typeof p4.export.jsonl, 'string');
  assert.match(p4.export.receipt.corpusSha256, /^[0-9a-f]{64}$/);

  const graph = JSON.parse(fs.readFileSync(GRAPH_JSON, 'utf8'));
  assert.ok(Array.isArray(graph.nodes) && graph.nodes.length > 0, 'connection graph must have nodes');
  assert.ok(Array.isArray(graph.edges) && graph.edges.length > 0, 'connection graph must have edges');
  assert.ok(graph.nodes.some((n) => n.type === 'entity'), 'connection graph must carry entity nodes');
  assert.ok(graph.nodes.some((n) => n.type === 'department'), 'connection graph must carry department nodes');
  assert.equal(p4.connectionGraph.nodeCount, graph.nodes.length);
  assert.equal(p4.connectionGraph.edgeCount, graph.edges.length);
});

test('Determinism: re-run is identical modulo wall-clock keys', async () => {
  const a = await runCompanyBrainSlice();
  const b = await runCompanyBrainSlice();
  assert.deepEqual(JSON.parse(JSON.stringify(stripTimings(a))), JSON.parse(JSON.stringify(stripTimings(b))),
    'the artifact must be deterministic modulo wall-clock keys');
  assert.equal(b.p4.export.jsonl, a.p4.export.jsonl, 'the exported JSONL must be byte-identical across runs');
  assert.deepEqual(JSON.parse(JSON.stringify(stripTimings(b.p4.connectionGraph.raw))), JSON.parse(JSON.stringify(stripTimings(a.p4.connectionGraph.raw))),
    'the connection graph JSON must be deterministic modulo wall-clock keys');
});

const sliceArtifactProbe = async () => {
  const artifactPath = path.join(ROOT, 'models/weft-specialist-quantized/weft-int4.onnx');
  if (!fs.existsSync(artifactPath)) return { ok: false, reason: `Weft pair-graph artifact absent at ${artifactPath}` };
  try {
    await import('onnxruntime-node');
  } catch (err) {
    return { ok: false, reason: `onnxruntime-node absent (${err.message})` };
  }
  return { ok: true, artifactSha256: crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex') };
};

test('Theme pass on the slice: themed graph nodes, member edges, channel counts, and the default shape stays theme-free', async (t) => {
  const probe = await sliceArtifactProbe();
  if (!probe.ok) return t.skip(`W6 real-artifact path not runnable on this box: ${probe.reason}`);
  generateEstate();
  const themed = await runCompanyBrainSlice({ theme: true });
  const plain = await runCompanyBrainSlice();

  assert.ok(themed.theme, 'the theme-on run reports the theme channel block');
  assert.ok(!('theme' in plain), 'the default run must not gain a theme block');
  assert.ok(!plain.p4.connectionGraph.raw.nodes.some((n) => n.type === 'theme'), 'the default connection graph carries no theme nodes');

  const theme = themed.theme;
  assert.equal(theme.themeNodeCount, theme.themeNodes.length, 'themeNodeCount matches the reported node array');
  assert.equal(theme.joinCount + theme.abstainCount, theme.themeLinkCount, 'every scored link landed as a join or an abstain');
  assert.equal(theme.policyVersion, THEME_POLICY_VERSION);
  assert.equal(theme.modelSha256, probe.artifactSha256, 'the theme block pins the artifact sha actually loaded');
  assert.ok(typeof theme.identityDisjointJoinCount === 'number' && typeof theme.disagreementCount === 'number');
  assert.ok(theme.themeNodeCount >= 1, 'the estate run agglomerates at least one theme node');

  const graph = JSON.parse(JSON.stringify(themed.p4.connectionGraph.raw));
  const themeGraphNodes = graph.nodes.filter((n) => n.type === 'theme');
  assert.equal(themeGraphNodes.length, theme.themeNodeCount, 'the graph carries one node per theme node');
  const fileNodeIds = new Set(graph.nodes.filter((n) => n.type === 'file').map((n) => n.id));
  const themeNodeById = new Map(theme.themeNodes.map((n) => [n.id, n]));
  for (const node of themeGraphNodes) {
    const carried = themeNodeById.get(node.id);
    assert.ok(carried, 'every graph theme node maps back to the reported theme nodes');
    assert.equal(node.label, carried.anchors[0] || carried.members[0], 'the graph label comes from the anchor');
    assert.equal(node.memberCount, carried.members.length, 'memberCount matches the member set');
    assert.ok(theme.themeNodes.some((n) => n.members.length >= 2), 'the estate theme nodes are honest about multi-member agglomerations');
  }
  const memberEdges = graph.edges.filter((e) => e.type === 'THEME_MEMBER');
  assert.ok(memberEdges.length >= 1, 'member edges connect member files to theme nodes');
  for (const edge of memberEdges) {
    assert.ok(fileNodeIds.has(edge.source), `THEME_MEMBER edge source ${edge.source} must be an existing file node`);
    assert.ok(themeGraphNodes.some((n) => n.id === edge.target), 'every THEME_MEMBER edge lands on a theme node');
  }
  assert.equal(themeGraphNodes.length, themed.p4.connectionGraph.raw.nodes.filter((n) => n.type === 'theme').length);
});

test('Theme determinism: the theme-on slice run is reproducible modulo wall-clock keys', async (t) => {
  const probe = await sliceArtifactProbe();
  if (!probe.ok) return t.skip(`W6 real-artifact path not runnable on this box: ${probe.reason}`);
  generateEstate();
  const a = await runCompanyBrainSlice({ theme: true });
  const b = await runCompanyBrainSlice({ theme: true });
  assert.deepEqual(JSON.parse(JSON.stringify(stripTimings(b.theme))), JSON.parse(JSON.stringify(stripTimings(a.theme))),
    'the theme block must be deterministic modulo wall-clock keys');
  assert.deepEqual(JSON.parse(JSON.stringify(stripTimings(b.p4.connectionGraph.raw))), JSON.parse(JSON.stringify(stripTimings(a.p4.connectionGraph.raw))),
    'the themed connection graph must be deterministic modulo wall-clock keys');
  assert.equal(b.p4.export.jsonl, a.p4.export.jsonl, 'the theme-carrying corpus JSONL is byte-identical across runs');
});
