import { runCleanAndTokenizePipeline, extractFeatureRow, scanRecordsForPII } from './clean-and-tokenize.js';
import {
  trainGatekeeper,
  calibrateGatekeeper,
  decideGatekeeper,
  trainMultiAxisGatekeeper,
  calibrateMultiAxisGatekeeper,
  decideMultiAxisGatekeeper,
  verifyTrainingReceipt,
} from './gatekeeper.js';
import { AuditChain } from './clean-and-tokenize.js';
import { inspectLocalOpenWeightPath } from './wasm-needle-dl.js';
import { ingestUrl, ingestLinkList, buildCorpusManifest } from './ingestor.js';

// Module-level cached gatekeeper bundles for stateful CLI / agent sessions
let lastTrainedBundle = null;
let lastMultiAxisBundle = null;

function extractUrlsList(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return Array.from(new Set(matches));
}

function buildPlanPayload(args = {}) {
  const modelIdOrPath = String(args.modelIdOrPath || args.modelPath || 'Qwen/Qwen2.5-0.5B-Instruct').trim();
  const backend = args.backend === 'mlx' ? 'mlx' : 'trl';
  const datasetFilename = String(args.datasetFilename || 'rtio-train.jsonl').trim();
  const outputDir = String(args.outputDir || './verisieve-lora-out').trim();
  const bridgePort = Number.isFinite(args.bridgePort) ? Number(args.bridgePort) : 8765;
  const epochs = Number.isFinite(args.epochs) ? Math.max(1, Number(args.epochs)) : 1;

  const inspection = inspectLocalOpenWeightPath(modelIdOrPath);
  const resolvedModel = inspection?.exists && inspection.modelName ? inspection.modelName : modelIdOrPath;
  const uvCommand =
    backend === 'mlx'
      ? `uvx --from mlx-lm mlx_lm.lora --model ${resolvedModel} --train --data . --iters 200 --adapter-path ${outputDir}`
      : `uv run skills/verisieve-local-train/scripts/verisieve-train.py --data ${datasetFilename} --model ${resolvedModel} --output ${outputDir} --epochs ${epochs} --bridge-port ${bridgePort}`;

  return {
    canFineTuneInWasm: false,
    executionScope: 'host_uv_native_training',
    backend,
    modelIdOrPath,
    datasetFilename,
    outputDir,
    uvCommand,
    bridgeUrl: `http://127.0.0.1:${bridgePort}/status`,
    skillPath: 'skills/verisieve-local-train/SKILL.md',
    inspection: inspection?.exists ? inspection : null,
  };
}

function buildDefaultCalibrationSet() {
  const cleanSamples = [
    'Patients with hip fracture frequently experience poor nutritional intake during acute hospitalization.',
    'Early postoperative mobilization is associated with improved survival and lower complication rates in elderly patients.',
    'Functional recovery after hip fracture is an important global health issue with rehabilitation outcomes.',
    'Multidisciplinary geriatric nutritional assessment significantly improves six-month survival.',
    'Postoperative mortality rate was significantly higher in malnourished patients (8.2% vs 2.1%).',
    'Rehabilitation protocol included physical therapy initiated on postoperative day one.',
    'Mean Barthel Index score improved from 45.2 at admission to 72.8 at discharge.',
    'Serum albumin concentration below 35 g/L was an independent predictor of adverse outcomes.',
    'Prospective randomized controlled trial evaluated high-protein oral nutritional supplements.',
    'Clinical study protocol approved by Institutional Review Board with informed consent.',
    'Systematic review demonstrated significant reduction in pressure injury incidence.',
    'Cognitive impairment assessed using Mini-Mental State Examination score below 24.'
  ];

  const noisyOrPiiSamples = [
    'CONFIDENTIAL FACSIMILE TRANSMISSION To: George Baroody Fax: (336) 335-7392 Phone: (336) 335-7363',
    'ATTORNEY GENERAL ADMINISTRATIVE OFFICE Fax: 614 -466 -5087 Columbus OH 43215',
    'PATIENT ADMISSION: Evelyn Vance, DOB: 03/12/1944, SSN: 232-00-9812, Dr. Sarah Jenkins',
    'Direct physician inquiry to miuky@ha.org.hk or telephone +852-3517-3668 Wong Tai Sin Hospital',
    'Credit card authorization: 4532-1189-9023-4412 Exp 09/28 CVV 882 billing record',
    'MA||FNT NAMF: EVFLyN VanCE admitted ... SENDER /PHONE NUMBER: June Flynn for Eric Brown',
    'GARBLED FAX HEADER ####### 00000000 %%%%%%% ????? OCR CONFIDENCE 0.12',
    'From: katie.sheehan@kcl.ac.uk To: recipient@hospital.org Subject: Urgent confidential patient file',
    'MEMORANDUM Dec 10 98 FROM: Betty D. Montgomery Attorney General TO: Department Chiefs',
    'Internal IP audit: 192.168.1.105 logged root access to /etc/shadow at 03:14:22',
    'Patient discharge summary: John Doe, 123 Fake St, Springfield, Tel: 555-0199',
    'UNREADABLE SCAN LINE: ~~~===~~~ 0xDEADBEEF 111000111 *** NO RECOGNIZED TEXT ***'
  ];

  const texts = [...cleanSamples, ...noisyOrPiiSamples];
  const labels = [
    ...new Array(cleanSamples.length).fill(1),    // 1 = Safe
    ...new Array(noisyOrPiiSamples.length).fill(0) // 0 = Drop / Quarantine
  ];

  const featureRows = texts.map(t => {
    const pii = scanRecordsForPII(t);
    return extractFeatureRow({ text: t, piiItems: pii });
  });

  return { texts, labels, featureRows };
}

function getOrAutoTrainBundle(customBundle = null, alpha = 0.05) {
  if (customBundle) return customBundle;
  if (lastTrainedBundle) return lastTrainedBundle;

  const dataset = buildDefaultCalibrationSet();
  const trainRows = dataset.featureRows.slice(0, 16);
  const trainLabels = dataset.labels.slice(0, 16);
  const calibRows = dataset.featureRows.slice(16);
  const calibLabels = dataset.labels.slice(16);

  const bundle = trainGatekeeper(trainRows, trainLabels, { epochs: 30, lr: 0.05 });
  calibrateGatekeeper(bundle, calibRows, calibLabels, { alpha });
  lastTrainedBundle = bundle;
  return bundle;
}

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
              description: 'Trains and LTT-calibrates a gatekeeper bundle from labeled chunks or texts, supports local open-weight modelPath auditing, and returns crypto receipt.',
              inputSchema: { type: 'object', properties: { featureRows: { type: 'array' }, labels: { type: 'array' }, texts: { type: 'array' }, modelPath: { type: 'string' }, options: { type: 'object' } } }
            },
            {
              name: 'gatekeeper_decide',
              description: 'Runs calibrated gatekeeper inference on new chunks or raw text (KEEP_SAFE / DROP_OR_QUARANTINE / ABSTAIN_HUMAN_REVIEW).',
              inputSchema: { type: 'object', properties: { bundle: { type: 'object' }, featureRow: { type: 'array' }, text: { type: 'string' }, texts: { type: 'array' } } }
            },
            {
              name: 'verify_provenance_chain',
              description: 'Verifies an Rtio-compatible AuditChain and training receipt.',
              inputSchema: { type: 'object', properties: { entries: { type: 'array' } } }
            },
            {
              name: 'train_multiaxis_gatekeeper',
              description: 'Trains a customer-labeled 3-axis local gatekeeper (safe, useful, topic) and calibrates thresholds.',
              inputSchema: {
                type: 'object',
                properties: {
                  samples: { type: 'array' },
                  featureRows: { type: 'array' },
                  labelsMap: { type: 'object' },
                  calibFeatureRows: { type: 'array' },
                  calibLabelsMap: { type: 'object' },
                  options: { type: 'object' }
                }
              }
            },
            {
              name: 'gatekeeper_decide_multiaxis',
              description: 'Runs calibrated 3-axis gatekeeper inference (Safe, Useful, Topic) on text or a 520-dim feature row.',
              inputSchema: {
                type: 'object',
                properties: {
                  bundle: { type: 'object' },
                  text: { type: 'string' },
                  featureRow: { type: 'array' }
                }
              }
            },
            {
              name: 'plan_local_open_weight_training',
              description: 'Inspects a local GGUF/SafeTensors path or HuggingFace ID and builds a zero-setup Astral uv TRL/MLX LoRA training command.',
              inputSchema: {
                type: 'object',
                properties: {
                  modelIdOrPath: { type: 'string' },
                  backend: { type: 'string', enum: ['trl', 'mlx'] },
                  datasetFilename: { type: 'string' },
                  outputDir: { type: 'string' },
                  bridgePort: { type: 'number' },
                  epochs: { type: 'number' }
                }
              }
            },
            {
              name: 'ingest_url_or_links',
              description: 'Captures inline HTML, link lists, or URLs and cleans them through verisieve_clean.wasm + PII redaction.',
              inputSchema: {
                type: 'object',
                properties: {
                  htmlOrLinks: { type: 'string' },
                  url: { type: 'string' },
                  urls: { type: 'array' },
                  options: { type: 'object' }
                }
              }
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
          let bundle = null;

          if (args.featureRows && args.labels) {
            // Backward-compatible featureRow mode
            const fRows = args.featureRows.map(r => new Float32Array(r));
            bundle = trainGatekeeper(fRows, args.labels, args.options || {});
            if (args.calibFeatureRows && args.calibLabels) {
              const cRows = args.calibFeatureRows.map(r => new Float32Array(r));
              calibrateGatekeeper(bundle, cRows, args.calibLabels, args.calibOptions || {});
            }
          } else if (args.texts && args.labels) {
            // Text-based training mode
            const fRows = args.texts.map(t => {
              const pii = scanRecordsForPII(t);
              return extractFeatureRow({ text: t, piiItems: pii });
            });
            const calibN = Math.max(2, Math.floor(fRows.length * 0.3));
            const trainFRows = fRows.slice(0, fRows.length - calibN);
            const trainLabels = args.labels.slice(0, fRows.length - calibN);
            const calibFRows = fRows.slice(fRows.length - calibN);
            const calibLabels = args.labels.slice(fRows.length - calibN);

            bundle = trainGatekeeper(trainFRows, trainLabels, args.options || {});
            calibrateGatekeeper(bundle, calibFRows, calibLabels, { alpha: args.alpha || 0.05, ...(args.calibOptions || {}) });
          } else {
            // Autonomous calibration mode (e.g. called by matilda-code-1.0)
            const alpha = args.alpha !== undefined ? args.alpha : 0.05;
            const dataset = buildDefaultCalibrationSet();
            const trainRows = dataset.featureRows.slice(0, 16);
            const trainLabels = dataset.labels.slice(0, 16);
            const calibRows = dataset.featureRows.slice(16);
            const calibLabels = dataset.labels.slice(16);

            bundle = trainGatekeeper(trainRows, trainLabels, args.options || { epochs: 30, lr: 0.05 });
            calibrateGatekeeper(bundle, calibRows, calibLabels, { alpha, ...(args.calibOptions || {}) });
          }

          if (bundle.calibration) {
            bundle.tau_keep = bundle.calibration.tauKeep;
            bundle.tau_drop = bundle.calibration.tauDrop;
          }

          if (args.modelPath) {
            bundle.localWeightAudit = inspectLocalOpenWeightPath(args.modelPath);
          }

          lastTrainedBundle = bundle;
          result = { content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }] };
        } else if (toolName === 'gatekeeper_decide') {
          const bundle = getOrAutoTrainBundle(args.bundle, args.alpha || 0.05);

          if (args.featureRow) {
            // Backward-compatible featureRow mode
            const fRow = new Float32Array(args.featureRow);
            const decision = decideGatekeeper(bundle, fRow);
            result = { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
          } else if (typeof args.text === 'string') {
            // Direct text decision mode
            const pii = scanRecordsForPII(args.text);
            const fRow = extractFeatureRow({ text: args.text, piiItems: pii });
            const decision = decideGatekeeper(bundle, fRow);
            decision.piiDetected = pii.length > 0;
            decision.piiItems = pii;
            result = { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
          } else if (Array.isArray(args.texts)) {
            // Batch texts decision mode
            const decisions = args.texts.map(t => {
              const pii = scanRecordsForPII(t);
              const fRow = extractFeatureRow({ text: t, piiItems: pii });
              const d = decideGatekeeper(bundle, fRow);
              d.piiDetected = pii.length > 0;
              d.piiItems = pii;
              d.textExcerpt = t.slice(0, 80);
              return d;
            });
            result = { content: [{ type: 'text', text: JSON.stringify({ decisions }, null, 2) }] };
          } else {
            throw new Error('gatekeeper_decide requires featureRow, text, or texts argument');
          }
        } else if (toolName === 'verify_provenance_chain') {
          const isValid = AuditChain.verifyChain(args.entries);
          result = { content: [{ type: 'text', text: JSON.stringify({ isValid }, null, 2) }] };
        } else if (toolName === 'train_multiaxis_gatekeeper') {
          let fRows;
          let labelsMap;
          if (Array.isArray(args.samples) && args.samples.length > 0) {
            fRows = args.samples.map((s) => extractFeatureRow({ text: s.text || '' }));
            labelsMap = {
              safe: args.samples.map((s) => (s.safe ? 1 : 0)),
              useful: args.samples.map((s) => (s.useful ? 1 : 0)),
              topic: args.samples.map((s) => (s.topic ? 1 : 0)),
            };
          } else if (Array.isArray(args.featureRows) && args.labelsMap) {
            fRows = args.featureRows.map((r) => new Float32Array(r));
            labelsMap = args.labelsMap;
          } else {
            throw new Error('train_multiaxis_gatekeeper requires samples[] or featureRows+labelsMap');
          }
          let trainFRows = fRows;
          let trainLabelsMap = labelsMap;
          let cRows;
          let cLabels;
          if (Array.isArray(args.calibFeatureRows) && args.calibLabelsMap) {
            cRows = args.calibFeatureRows.map((r) => new Float32Array(r));
            cLabels = args.calibLabelsMap;
          } else if (fRows.length >= 2) {
            trainFRows = [];
            cRows = [];
            trainLabelsMap = { safe: [], useful: [], topic: [] };
            cLabels = { safe: [], useful: [], topic: [] };
            for (let i = 0; i < fRows.length; i++) {
              const targetX = i % 2 === 0 ? trainFRows : cRows;
              const targetL = i % 2 === 0 ? trainLabelsMap : cLabels;
              targetX.push(fRows[i]);
              targetL.safe.push(labelsMap.safe[i]);
              targetL.useful.push(labelsMap.useful[i]);
              targetL.topic.push(labelsMap.topic[i]);
            }
          } else {
            throw new Error('LTT_IN_SAMPLE_CALIBRATION_FORBIDDEN: provide disjoint calibFeatureRows or >= 2 samples');
          }
          let multiBundle = trainMultiAxisGatekeeper(trainFRows, trainLabelsMap, args.options || {});
          multiBundle = calibrateMultiAxisGatekeeper(multiBundle, cRows, cLabels, args.options || {});
          lastMultiAxisBundle = multiBundle;
          result = { content: [{ type: 'text', text: JSON.stringify(multiBundle, null, 2) }] };
        } else if (toolName === 'gatekeeper_decide_multiaxis') {
          const multiBundle = args.bundle || lastMultiAxisBundle;
          if (!multiBundle) {
            throw new Error('No trained multi-axis bundle available; call train_multiaxis_gatekeeper first or pass bundle');
          }
          const fRow = args.featureRow
            ? new Float32Array(args.featureRow)
            : extractFeatureRow({ text: String(args.text || '') });
          const decision = decideMultiAxisGatekeeper(multiBundle, fRow);
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    axes: decision.decisions,
                    conjunctionAction: decision.conjunctionAction,
                    abstained: decision.abstained,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (toolName === 'plan_local_open_weight_training') {
          const plan = buildPlanPayload(args);
          result = { content: [{ type: 'text', text: JSON.stringify(plan, null, 2) }] };
        } else if (toolName === 'ingest_url_or_links') {
          if (typeof args.htmlOrLinks === 'string') {
            const hasHtml = /<[a-z][\s\S]*>/i.test(args.htmlOrLinks);
            const pipelineRes = runCleanAndTokenizePipeline(args.htmlOrLinks, {
              format: hasHtml ? 'html' : 'text',
              ...(args.options || {}),
            });
            result = { content: [{ type: 'text', text: JSON.stringify(pipelineRes, null, 2) }] };
          } else {
            throw new Error('URL network fetching requires handleJsonRpcRequestAsync');
          }
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

export async function handleJsonRpcRequestAsync(request) {
  if (
    request?.method === 'tools/call' &&
    request?.params?.name === 'ingest_url_or_links'
  ) {
    try {
      const args = request.params?.arguments || {};
      const opts = args.options || {};
      const explicitUrls = Array.isArray(args.urls)
        ? args.urls
        : typeof args.url === 'string'
          ? [args.url]
          : typeof args.htmlOrLinks === 'string' && !/<[a-z][\s\S]*>/i.test(args.htmlOrLinks)
            ? extractUrlsList(args.htmlOrLinks)
            : [];

      if (explicitUrls.length > 0) {
        const fetched =
          explicitUrls.length === 1
            ? [Object.assign({ url: explicitUrls[0], success: true }, await ingestUrl(explicitUrls[0], opts))]
            : await ingestLinkList(explicitUrls, opts);
        const combinedText = fetched
          .filter((item) => item.success && item.cleanText)
          .map((item) => item.cleanText)
          .join('\n\n');
        const pipelineRes = runCleanAndTokenizePipeline(combinedText, {
          format: 'text',
          ...opts,
        });
        const manifest = buildCorpusManifest(
          fetched.map((f) => ({
            url: f.url,
            rawBytes: f.rawBytes || 0,
            cleanText: f.cleanText || '',
          })),
          pipelineRes.tokenizedChunks || []
        );
        return {
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ ...pipelineRes, fetched, manifest }, null, 2),
              },
            ],
          },
          id: request.id ?? null,
        };
      }

      return handleJsonRpcRequest(request);
    } catch (err) {
      return {
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id: request?.id ?? null,
      };
    }
  }
  return handleJsonRpcRequest(request);
}

// Stdio runner if executed directly
if (typeof process !== 'undefined' && process.argv[1]?.endsWith('mcp-server.js')) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', async chunk => {
    buffer += chunk;
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const req = JSON.parse(line);
        const res = await handleJsonRpcRequestAsync(req);
        if (res) {
          process.stdout.write(JSON.stringify(res) + '\n');
        }
      } catch (e) {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null }) + '\n');
      }
    }
  });
}
