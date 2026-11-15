import test from 'node:test';
import assert from 'node:assert';
import { handleJsonRpcRequest } from '../src/mcp-server.js';
import { AuditChain } from '../src/clean-and-tokenize.js';

test('MCP Server initialize and tools/list', () => {
  const initReq = { jsonrpc: '2.0', method: 'initialize', id: 1 };
  const initRes = handleJsonRpcRequest(initReq);
  assert.strictEqual(initRes.id, 1);
  assert.ok(initRes.result.serverInfo);

  const listReq = { jsonrpc: '2.0', method: 'tools/list', id: 2 };
  const listRes = handleJsonRpcRequest(listReq);
  assert.strictEqual(listRes.id, 2);
  assert.strictEqual(listRes.result.tools.length, 4);
});

test('MCP Server tool call: ingest_and_tokenize', () => {
  const req = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'ingest_and_tokenize',
      arguments: { input: 'Hello MCP World from test@example.com' }
    },
    id: 3
  };
  const res = handleJsonRpcRequest(req);
  assert.strictEqual(res.id, 3);
  assert.ok(res.result.content);
  const data = JSON.parse(res.result.content[0].text);
  assert.ok(data.blocks.length > 0);
});

test('MCP Server tool call: train_local_gatekeeper and gatekeeper_decide', () => {
  const fRow = Array.from(new Float32Array(520).fill(0.5));
  const trainReq = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'train_local_gatekeeper',
      arguments: {
        featureRows: [fRow],
        labels: [1],
        calibFeatureRows: [fRow],
        calibLabels: [1]
      }
    },
    id: 4
  };
  const trainRes = handleJsonRpcRequest(trainReq);
  assert.strictEqual(trainRes.id, 4);
  const bundle = JSON.parse(trainRes.result.content[0].text);
  assert.ok(bundle.weights);

  const decideReq = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'gatekeeper_decide',
      arguments: {
        bundle,
        featureRow: fRow
      }
    },
    id: 5
  };
  const decideRes = handleJsonRpcRequest(decideReq);
  assert.strictEqual(decideRes.id, 5);
  const decision = JSON.parse(decideRes.result.content[0].text);
  assert.ok(decision.action);
});

test('MCP Server tool call: verify_provenance_chain (valid and tampered)', () => {
  const audit = new AuditChain();
  audit.log('ACTION_1', { status: 'ok' });
  audit.log('ACTION_2', { status: 'ready' });
  const validEntries = audit.entries;

  const validReq = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'verify_provenance_chain',
      arguments: { entries: validEntries }
    },
    id: 6
  };
  const validRes = handleJsonRpcRequest(validReq);
  const validResult = JSON.parse(validRes.result.content[0].text);
  assert.strictEqual(validResult.isValid, true);

  // Tampered chain
  const tamperedEntries = JSON.parse(JSON.stringify(validEntries));
  tamperedEntries[0].action = 'MALICIOUS_TAMPER';

  const tamperedReq = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'verify_provenance_chain',
      arguments: { entries: tamperedEntries }
    },
    id: 7
  };
  const tamperedRes = handleJsonRpcRequest(tamperedReq);
  const tamperedResult = JSON.parse(tamperedRes.result.content[0].text);
  assert.strictEqual(tamperedResult.isValid, false);
});
