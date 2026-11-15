import { runCleanAndTokenizePipeline } from './clean-and-tokenize.js';
import { trainGatekeeper, calibrateGatekeeper, decideGatekeeper, verifyTrainingReceipt } from './gatekeeper.js';
import { AuditChain } from './clean-and-tokenize.js';

// ---------------------------------------------------------------------------
// 2. MCP Server for Matilda Code (JSON-RPC 2.0 over stdio + programmatic handler)
// ---------------------------------------------------------------------------
export function handleJsonRpcRequest(request) {
  try {
    const { id, method, params } = request;
    if (!method) {
      return { jsonrpc: '2.0', error: { code: -32600, message: 'Invalid Request: method missing' }, id: id || null };
    }

    let result = null;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'matilda-portable-mcp', version: '1.0.0' }
        };
        break;

      case 'notifications/initialized':
        return null; // Notification, no response required

      case 'tools/list':
        result = {
          tools: [
            {
              name: 'ingest_and_tokenize',
              description: 'Ingests born-digital text/HTML/email or OCR blocks, runs deterministic cleaning, dual PII masking, tokenization, and 520-dim feature extraction.',
              inputSchema: { type: 'object', properties: { input: { type: 'string' }, options: { type: 'object' } } }
            },
            {
              name: 'train_local_gatekeeper',
              description: 'Trains and LTT-calibrates a gatekeeper bundle from labeled chunks and returns crypto receipt.',
              inputSchema: { type: 'object', properties: { featureRows: { type: 'array' }, labels: { type: 'array' }, options: { type: 'object' } } }
            },
            {
              name: 'gatekeeper_decide',
              description: 'Runs calibrated gatekeeper inference on new chunks (KEEP_SAFE / DROP_OR_QUARANTINE / ABSTAIN_HUMAN_REVIEW).',
              inputSchema: { type: 'object', properties: { bundle: { type: 'object' }, featureRow: { type: 'array' } } }
            },
            {
              name: 'verify_provenance_chain',
              description: 'Verifies an Rtio-compatible AuditChain and training receipt.',
              inputSchema: { type: 'object', properties: { entries: { type: 'array' } } }
            }
          ]
        };
        break;

      case 'tools/call': {
        const toolName = params?.name;
        const args = params?.arguments || {};

        if (toolName === 'ingest_and_tokenize') {
          const res = runCleanAndTokenizePipeline(args.input, args.options || {});
          result = { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
        } else if (toolName === 'train_local_gatekeeper') {
          const fRows = args.featureRows.map(r => new Float32Array(r));
          const bundle = trainGatekeeper(fRows, args.labels, args.options || {});
          if (args.calibFeatureRows && args.calibLabels) {
            const cRows = args.calibFeatureRows.map(r => new Float32Array(r));
            calibrateGatekeeper(bundle, cRows, args.calibLabels, args.calibOptions || {});
          }
          result = { content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }] };
        } else if (toolName === 'gatekeeper_decide') {
          const fRow = new Float32Array(args.featureRow);
          const decision = decideGatekeeper(args.bundle, fRow);
          result = { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
        } else if (toolName === 'verify_provenance_chain') {
          const isValid = AuditChain.verifyChain(args.entries);
          result = { content: [{ type: 'text', text: JSON.stringify({ isValid }, null, 2) }] };
        } else {
          throw new Error(`Unknown tool: ${toolName}`);
        }
        break;
      }

      default:
        return { jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id };
    }

    return { jsonrpc: '2.0', result, id };
  } catch (err) {
    return { jsonrpc: '2.0', error: { code: -32603, message: err.message }, id: request?.id || null };
  }
}

// Stdio runner if executed directly
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('mcp-server.js')) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        const res = handleJsonRpcRequest(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }) + '\n');
      }
    }
  });
}
