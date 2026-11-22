import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_GRAPH_WASM_PATH,
  loadGraphWasmSync,
} from '../src/graph-wasm.js';
import { handleJsonRpcRequest } from '../src/mcp-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RTIO_GRAPH_WASM = path.resolve(__dirname, '../../Rtio/frontend/public/wasm/verisieve_graph.wasm');

test('Track B2 Portable: vendor verisieve_graph.wasm matches Rtio byte-for-byte, has 0 imports, and round-trips .csr snapshot', () => {
  assert.ok(fs.existsSync(DEFAULT_GRAPH_WASM_PATH), 'Expected vendor/wasm/verisieve_graph.wasm');
  const vendorBytes = fs.readFileSync(DEFAULT_GRAPH_WASM_PATH);
  if (fs.existsSync(RTIO_GRAPH_WASM)) {
    const rtioBytes = fs.readFileSync(RTIO_GRAPH_WASM);
    assert.deepEqual(vendorBytes, rtioBytes, 'vendor verisieve_graph.wasm must match Rtio byte-for-byte');
  }

  const mod = new WebAssembly.Module(vendorBytes);
  assert.equal(WebAssembly.Module.imports(mod).length, 0, 'verisieve_graph.wasm must have zero external host imports');

  const engine = loadGraphWasmSync();
  assert.equal(engine.abiVersion, 1);
  const built = engine.buildFromEdges(
    4,
    Uint32Array.from([0, 1, 2]),
    Uint32Array.from([1, 2, 3]),
    Uint16Array.from([0, 1, 5]),
    Float32Array.from([1.0, 1.0, 1.0])
  );
  assert.equal(built, 3);

  const snap = engine.serializeSnapshot();
  const engine2 = loadGraphWasmSync();
  assert.equal(engine2.loadSnapshot(snap), true);
  assert.equal(engine2.nodeCount(), 4);
  assert.equal(engine2.edgeCount(), 3);
});

test('Track B2 Portable MCP: index_document_graph, blast_radius, ppr_retrieve, trace_path, get_document_tree, read_section_nodes', () => {
  const indexRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 101,
    params: {
      name: 'index_document_graph',
      arguments: {
        workspaceSalt: 'portable-mcp-test-salt',
        documents: [
          {
            source: 'oaic-mini.md',
            pageNo: 4,
            text: [
              '# APP Entity',
              'Lead reviewer Dr. Alice Mercer (alice.mercer@clinic.org) manages Project Falcon compliance audits.',
              '## Small Business Operator',
              'Dr. Alice Mercer signed off on statutory threshold code X-904 confirming businesses with $3,000,000 or less annual turnover are generally exempt.',
            ].join('\n'),
          },
          {
            source: 'facilities.md',
            pageNo: 1,
            text: '# Cafeteria Schedule\nLunch service opens at noon in building B.',
          },
        ],
        artifacts: [
          { artifactId: 'tainted_lora_shard', kind: 'sft_jsonl', sourceRowIndices: [0, 1] },
          { artifactId: 'clean_lora_shard', kind: 'sft_jsonl', sourceRowIndices: [2] },
        ],
      },
    },
  });

  const idxData = JSON.parse(indexRes.result.content[0].text);
  assert.equal(idxData.wasmBackend, 'verisieve_graph.wasm');
  assert.ok(idxData.nodeCount >= 8);
  assert.ok(!JSON.stringify(idxData).includes('Alice Mercer'), 'Zero raw PII in graph index summary');
  assert.ok(!JSON.stringify(idxData).includes('alice.mercer@clinic.org'));

  const personEnt = idxData.entities.find((e) => e.pii_kind === 'PERSON');
  assert.ok(personEnt, 'Expected salted PERSON entity');

  // 1. blast_radius
  const blastRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 102,
    params: {
      name: 'blast_radius',
      arguments: {
        seedIds: [personEnt.entity_id],
        direction: 'in',
        maxHops: 3,
        edgeTypes: ['MENTIONS', 'DERIVED_FROM'],
      },
    },
  });
  const blastData = JSON.parse(blastRes.result.content[0].text);
  const hitIds = blastData.hits.map((h) => h.nodeId);
  assert.ok(hitIds.includes('art:sft_jsonl:tainted_lora_shard'), `Expected tainted shard in blast_radius: ${JSON.stringify(hitIds)}`);
  assert.ok(!hitIds.includes('art:sft_jsonl:clean_lora_shard'), 'Clean shard must not be in blast_radius');

  // 2. ppr_retrieve (2-hop entity bridging via verisieve_graph.wasm)
  const pprRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 103,
    params: {
      name: 'ppr_retrieve',
      arguments: {
        query: 'What statutory threshold code did the Project Falcon compliance reviewer sign off on?',
        topK: 3,
      },
    },
  });
  const pprData = JSON.parse(pprRes.result.content[0].text);
  const top2Texts = pprData.rankedPassages.slice(0, 2).map((p) => p.textRedacted);
  assert.ok(
    top2Texts.some((t) => t.includes('X-904') && t.includes('$3,000,000')),
    `Expected ppr_retrieve Top-2 to surface X-904/$3,000,000, got: ${JSON.stringify(top2Texts)}`
  );
  assert.ok(!JSON.stringify(pprData).includes('Alice Mercer'));

  // 3. trace_path
  const pas0Id = pprData.rankedPassages[0].nodeId;
  const pas1Id = pprData.rankedPassages[1].nodeId;
  const traceRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 104,
    params: {
      name: 'trace_path',
      arguments: { srcId: pas0Id, dstId: pas1Id, direction: 'both', maxHops: 4 },
    },
  });
  const traceData = JSON.parse(traceRes.result.content[0].text);
  assert.ok(Array.isArray(traceData.path) && traceData.path.length >= 2);
  assert.equal(traceData.path[0], pas0Id);
  assert.equal(traceData.path[traceData.path.length - 1], pas1Id);

  // 4. get_document_tree & read_section_nodes (PageIndex-style redacted TOC navigation)
  const treeRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 105,
    params: { name: 'get_document_tree', arguments: {} },
  });
  const treeData = JSON.parse(treeRes.result.content[0].text);
  const oaicDoc = treeData.trees.find((t) => t.source === 'oaic-mini.md');
  assert.ok(oaicDoc && oaicDoc.nodes.length === 1);
  assert.equal(oaicDoc.nodes[0].title, 'APP Entity');
  assert.equal(oaicDoc.nodes[0].children[0].title, 'Small Business Operator');

  const secRes = handleJsonRpcRequest({
    jsonrpc: '2.0',
    method: 'tools/call',
    id: 106,
    params: {
      name: 'read_section_nodes',
      arguments: { sectionNodeIds: [oaicDoc.nodes[0].nodeId], includeDescendants: true },
    },
  });
  const secData = JSON.parse(secRes.result.content[0].text);
  assert.ok(secData.passages.some((p) => p.textRedacted.includes('$3,000,000')));
  assert.ok(!JSON.stringify(secData).includes('Alice Mercer'));
});
