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
import { ingestUrl, ingestLinkList, stripHtmlBoilerplate, buildCorpusManifest } from './ingestor.js';
import { PortableDocumentGraph, SaltedPseudonymVault } from './graph-wasm.js';
import { parseEnterpriseBuffer } from './enterprise-parsers.js';
import { redactEnterpriseText, scanEnterprisePiiAndSecrets } from './secret-scanner.js';
import { redactAudioCall } from './audio-redactor.js';
import { scrubBinaryMediaMetadata } from './video-redactor.js';

function sanitizePiiItems(piiItems = [], includeRawPii = false) {
  if (includeRawPii) return piiItems;
  return piiItems.map((item) => ({
    category: item.category || item.type || 'pii',
    start: item.start,
    end: item.end,
    redacted: true,
  }));
}

function splitMultiAxisHoldout(fRows, labelsMap, calRatio = 0.5) {
  const posIdx = [];
  const negIdx = [];
  for (let i = 0; i < fRows.length; i++) {
    if (Number(labelsMap.safe?.[i]) === 1) posIdx.push(i);
    else negIdx.push(i);
  }
  const partition = (indices) => {
    if (indices.length < 2) return { train: indices, cal: [] };
    let nCal = Math.round(indices.length * calRatio);
    nCal = Math.max(1, Math.min(indices.length - 1, nCal));
    return { train: indices.slice(0, indices.length - nCal), cal: indices.slice(indices.length - nCal) };
  };
  let pos = partition(posIdx);
  let neg = partition(negIdx);
  let trainIdx = [...pos.train, ...neg.train];
  let calIdx = [...pos.cal, ...neg.cal];
  if (calIdx.length === 0 && fRows.length >= 2) {
    const half = Math.max(1, Math.floor(fRows.length / 2));
    trainIdx = Array.from({ length: half }, (_, i) => i);
    calIdx = Array.from({ length: fRows.length - half }, (_, i) => i + half);
  }
  const pick = (indices) => ({
    rows: indices.map((i) => fRows[i]),
    labels: {
      safe: indices.map((i) => labelsMap.safe[i]),
      useful: indices.map((i) => labelsMap.useful[i]),
      topic: indices.map((i) => labelsMap.topic[i]),
    },
  });
  return { train: pick(trainIdx), cal: pick(calIdx) };
}

// Module-level cached gatekeeper bundles and active Dual-CSR graph for stateful CLI / agent sessions
let lastTrainedBundle = null;
let lastMultiAxisBundle = null;
let activeDocumentGraph = null;

function extractUrlsList(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/https?:\/\/[^\s"'<>]+/gi) || [];
  return Array.from(new Set(matches));
}

function buildPlanPayload(args = {}) {
  const modelIdOrPath = String(args.modelIdOrPath || args.modelPath || 'Qwen/Qwen2.5-0.5B-Instruct').trim();
  const backend = args.backend === 'mlx' ? 'mlx' : 'trl';
  const datasetFilename = String(args.datasetFilename || 'rtio-train.jsonl').trim();
  const outputDir = String(args.outputDir || './versieve-lora-out').trim();
  const bridgePort = Number.isFinite(args.bridgePort) ? Number(args.bridgePort) : 8765;
  const epochs = Number.isFinite(args.epochs) ? Math.max(1, Number(args.epochs)) : 1;

  const inspection = inspectLocalOpenWeightPath(modelIdOrPath);
  const resolvedModel = inspection?.exists && inspection.modelName ? inspection.modelName : modelIdOrPath;
  const uvCommand =
    backend === 'mlx'
      ? `uvx --from mlx-lm mlx_lm.lora --model ${resolvedModel} --train --data . --iters 200 --adapter-path ${outputDir}`
      : `uv run skills/versieve-local-train/scripts/versieve-train.py --data ${datasetFilename} --model ${resolvedModel} --output ${outputDir} --epochs ${epochs} --bridge-port ${bridgePort}`;

  return {
    canFineTuneInWasm: false,
    executionScope: 'host_uv_native_training',
    backend,
    modelIdOrPath,
    datasetFilename,
    outputDir,
    uvCommand,
    bridgeUrl: `http://127.0.0.1:${bridgePort}/status`,
    skillPath: 'skills/versieve-local-train/SKILL.md',
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
              description: 'Captures inline HTML, link lists, or URLs and cleans them through versieve_clean.wasm + PII redaction.',
              inputSchema: {
                type: 'object',
                properties: {
                  htmlOrLinks: { type: 'string' },
                  url: { type: 'string' },
                  urls: { type: 'array' },
                  options: { type: 'object' }
                }
              }
            },
            {
              name: 'index_document_graph',
              description: 'Builds a strictly redacted Document Knowledge Graph (DOCUMENT/SECTION/PASSAGE/ENTITY/ARTIFACT) in versieve_graph.wasm Dual-CSR with salted pseudonyms.',
              inputSchema: {
                type: 'object',
                properties: {
                  documents: { type: 'array' },
                  artifacts: { type: 'array' },
                  workspaceSalt: { type: 'string' }
                }
              }
            },
            {
              name: 'blast_radius',
              description: 'Runs bidirectional k-hop PII Blast Radius / W3C PROV-O taint traversal over versieve_graph.wasm.',
              inputSchema: {
                type: 'object',
                properties: {
                  seedIds: { type: 'array' },
                  direction: { type: 'string', enum: ['in', 'out', 'both'] },
                  maxHops: { type: 'number' },
                  edgeTypes: { type: 'array' }
                }
              }
            },
            {
              name: 'ppr_retrieve',
              description: 'Runs HippoRAG-2 Personalized PageRank over versieve_graph.wasm to retrieve multi-hop redacted passages.',
              inputSchema: {
                type: 'object',
                properties: {
                  query: { type: 'string' },
                  topK: { type: 'number' },
                  alpha: { type: 'number' },
                  iterations: { type: 'number' },
                  passageResetScale: { type: 'number' }
                }
              }
            },
            {
              name: 'trace_path',
              description: 'Finds shortest path between two graph nodes in versieve_graph.wasm (BFS or weighted Dijkstra).',
              inputSchema: {
                type: 'object',
                properties: {
                  srcId: { type: 'string' },
                  dstId: { type: 'string' },
                  direction: { type: 'string', enum: ['out', 'in', 'both'] },
                  maxHops: { type: 'number' },
                  weighted: { type: 'boolean' }
                }
              }
            },
            {
              name: 'get_document_tree',
              description: 'Returns PageIndex-style strictly redacted hierarchical Table of Contents (TOC) trees for indexed documents.',
              inputSchema: {
                type: 'object',
                properties: {
                  docId: { type: 'string' }
                }
              }
            },
            {
              name: 'read_section_nodes',
              description: 'Reads strictly redacted passages under selected PageIndex TOC section nodeIds.',
              inputSchema: {
                type: 'object',
                properties: {
                  sectionNodeIds: { type: 'array' },
                  includeDescendants: { type: 'boolean' }
                }
              }
            },
            {
              name: 'ingest_enterprise_bundle',
              description: 'Auto-routes enterprise multimodal files (.eml, .mbox, .msg, .pptx, .xlsx, .odt/.ods/.odp, .epub, .vtt, .srt, .ics, .vcf, Slack/Jira JSON, .ipynb, .har, .env, K8s YAML, .zip, .tar.gz), redacts PII & secrets with shared workspace-salted pseudonyms, and indexes them into versieve_graph.wasm for cross-modal GDPR Art. 17 blast_radius.',
              inputSchema: {
                type: 'object',
                properties: {
                  files: { type: 'array' },
                  workspaceSalt: { type: 'string' },
                  artifacts: { type: 'array' }
                }
              }
            },
            {
              name: 'scan_enterprise_secrets',
              description: 'Runs zero-import versieve_media.wasm Unicode anti-evasion, international checksum PII (IBAN, AU TFN/Medicare/ABN, UK NHS/NINO, Aadhaar, Luhn), and 30+ enterprise secret detectors (JWT, PEM, AWS/OpenAI/Anthropic/GitHub/Stripe/Slack/DB URIs) returning privacy-safe redacted tokens.',
              inputSchema: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  workspaceSalt: { type: 'string' }
                }
              }
            },
            {
              name: 'redact_audio_call',
              description: 'Runs WASM Spoken ITN, unified Stage 3A PII/secret detection, and sample-accurate WAV waveform redaction (silence/beep/pink_noise) + RIFF metadata scrubbing.',
              inputSchema: {
                type: 'object',
                properties: {
                  source: { type: 'string' },
                  wavBase64: { type: 'string' },
                  wordTimestamps: { type: 'array' },
                  mode: { type: 'string', enum: ['silence', 'beep', 'pink_noise'] },
                  padMs: { type: 'number' },
                  workspaceSalt: { type: 'string' }
                }
              }
            },
            {
              name: 'audit_forensic_leaks',
              description: 'Audits and scrubs binary EXIF/XMP/IPTC/PNG/ISOBMFF MP4 metadata or hidden Office/Email forensic sub-streams via versieve_media.wasm.',
              inputSchema: {
                type: 'object',
                properties: {
                  source: { type: 'string' },
                  contentBase64: { type: 'string' }
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

          bundle.certified = Boolean(bundle.calibration?.certified);
          bundle.gatekeeperStatus = bundle.certified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED';
          lastTrainedBundle = bundle;
          result = { content: [{ type: 'text', text: JSON.stringify(bundle, null, 2) }] };
        } else if (toolName === 'gatekeeper_decide') {
          const bundle = getOrAutoTrainBundle(args.bundle, args.alpha || 0.05);
          const includeRawExcerpt = args.includeRawExcerpt === true || args.options?.includeRawExcerpt === true;
          const includeRawPii = args.includeRawPii === true || args.options?.includeRawPii === true;
          const certified = Boolean(bundle.calibration?.certified);
          const gatekeeperStatus = certified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED';

          if (args.featureRow) {
            // Backward-compatible featureRow mode
            const fRow = new Float32Array(args.featureRow);
            const decision = decideGatekeeper(bundle, fRow);
            decision.certified = certified;
            decision.gatekeeperStatus = gatekeeperStatus;
            result = { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
          } else if (typeof args.text === 'string') {
            // Direct text decision mode
            const pii = scanRecordsForPII(args.text);
            const fRow = extractFeatureRow({ text: args.text, piiItems: pii });
            const decision = decideGatekeeper(bundle, fRow);
            decision.piiDetected = pii.length > 0;
            decision.piiCount = pii.length;
            decision.piiItems = sanitizePiiItems(pii, includeRawPii);
            decision.certified = certified;
            decision.gatekeeperStatus = gatekeeperStatus;
            if (includeRawExcerpt) {
              decision.textExcerpt = args.text.slice(0, 80);
            }
            result = { content: [{ type: 'text', text: JSON.stringify(decision, null, 2) }] };
          } else if (Array.isArray(args.texts)) {
            // Batch texts decision mode
            const decisions = args.texts.map(t => {
              const pii = scanRecordsForPII(t);
              const fRow = extractFeatureRow({ text: t, piiItems: pii });
              const d = decideGatekeeper(bundle, fRow);
              d.piiDetected = pii.length > 0;
              d.piiCount = pii.length;
              d.piiItems = sanitizePiiItems(pii, includeRawPii);
              d.certified = certified;
              d.gatekeeperStatus = gatekeeperStatus;
              if (includeRawExcerpt) {
                d.textExcerpt = t.slice(0, 80);
              }
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
            fRows = args.samples.map((s) => {
              const txt = String(s.text || '');
              const pii = scanRecordsForPII(txt);
              return extractFeatureRow({ text: txt, piiItems: pii });
            });
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
          if (Array.isArray(args.calibSamples) && args.calibSamples.length > 0) {
            cRows = args.calibSamples.map((s) => {
              const txt = String(s.text || '');
              const pii = scanRecordsForPII(txt);
              return extractFeatureRow({ text: txt, piiItems: pii });
            });
            cLabels = {
              safe: args.calibSamples.map((s) => (s.safe ? 1 : 0)),
              useful: args.calibSamples.map((s) => (s.useful ? 1 : 0)),
              topic: args.calibSamples.map((s) => (s.topic ? 1 : 0)),
            };
          } else if (Array.isArray(args.calibFeatureRows) && args.calibLabelsMap) {
            cRows = args.calibFeatureRows.map((r) => new Float32Array(r));
            cLabels = args.calibLabelsMap;
          } else if (fRows.length >= 2) {
            const split = splitMultiAxisHoldout(fRows, labelsMap, args.options?.calRatio ?? 0.5);
            trainFRows = split.train.rows;
            trainLabelsMap = split.train.labels;
            cRows = split.cal.rows;
            cLabels = split.cal.labels;
          } else {
            throw new Error('LTT_IN_SAMPLE_CALIBRATION_FORBIDDEN: provide disjoint calibFeatureRows or >= 2 samples');
          }
          let multiBundle = trainMultiAxisGatekeeper(trainFRows, trainLabelsMap, args.options || {});
          multiBundle = calibrateMultiAxisGatekeeper(multiBundle, cRows, cLabels, args.options || {});
          const multiCertified = Boolean(
            multiBundle.models?.safe?.calibration?.certified &&
            multiBundle.models?.useful?.calibration?.certified &&
            multiBundle.models?.topic?.calibration?.certified
          );
          multiBundle.certified = multiCertified;
          multiBundle.gatekeeperStatus = multiCertified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED';
          lastMultiAxisBundle = multiBundle;
          result = { content: [{ type: 'text', text: JSON.stringify(multiBundle, null, 2) }] };
        } else if (toolName === 'gatekeeper_decide_multiaxis') {
          const multiBundle = args.bundle || lastMultiAxisBundle;
          if (!multiBundle) {
            throw new Error('No trained multi-axis bundle available; call train_multiaxis_gatekeeper first or pass bundle');
          }
          const rawText = typeof args.text === 'string' ? args.text : '';
          const pii = rawText ? scanRecordsForPII(rawText) : [];
          const fRow = args.featureRow
            ? new Float32Array(args.featureRow)
            : extractFeatureRow({ text: rawText, piiItems: pii });
          const decision = decideMultiAxisGatekeeper(multiBundle, fRow);
          const multiCertified = Boolean(
            multiBundle.models?.safe?.calibration?.certified &&
            multiBundle.models?.useful?.calibration?.certified &&
            multiBundle.models?.topic?.calibration?.certified
          );
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    axes: decision.decisions,
                    conjunctionAction: decision.conjunctionAction,
                    abstained: decision.abstained,
                    certified: multiCertified,
                    gatekeeperStatus: multiCertified ? 'CERTIFIED' : 'FAIL_CLOSED_UNVERIFIED',
                    piiDetected: pii.length > 0,
                    piiCount: pii.length,
                    piiItems: sanitizePiiItems(pii, args.includeRawPii === true),
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
            const stripped = hasHtml ? stripHtmlBoilerplate(args.htmlOrLinks) : null;
            const cleanInput = stripped ? stripped.cleanText : args.htmlOrLinks;
            const pipelineRes = runCleanAndTokenizePipeline(cleanInput, {
              format: 'text',
              ...(args.options || {}),
            });
            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      cleanText: cleanInput,
                      ...(stripped ? { title: stripped.title, links: stripped.links } : {}),
                      ...pipelineRes,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else {
            throw new Error('URL network fetching requires handleJsonRpcRequestAsync');
          }
        } else if (toolName === 'index_document_graph') {
          const docs = Array.isArray(args.documents) ? args.documents : [];
          const artifacts = Array.isArray(args.artifacts) ? args.artifacts : [];
          activeDocumentGraph = new PortableDocumentGraph({ workspaceSalt: args.workspaceSalt });
          const summary = activeDocumentGraph.indexDocuments(docs, artifacts);
          result = { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }] };
        } else if (toolName === 'blast_radius') {
          if (!activeDocumentGraph) throw new Error('No document graph indexed yet. Call index_document_graph first.');
          const hits = activeDocumentGraph.blastRadius(args.seedIds || [], {
            direction: args.direction || 'in',
            maxHops: args.maxHops ?? 3,
            edgeTypes: args.edgeTypes,
          });
          result = { content: [{ type: 'text', text: JSON.stringify({ hits }, null, 2) }] };
        } else if (toolName === 'ppr_retrieve') {
          if (!activeDocumentGraph) throw new Error('No document graph indexed yet. Call index_document_graph first.');
          const out = activeDocumentGraph.pprRetrieve(String(args.query || ''), {
            topK: args.topK ?? 6,
            alpha: args.alpha ?? 0.85,
            iterations: args.iterations ?? 15,
            passageResetScale: args.passageResetScale ?? 0.05,
          });
          result = { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] };
        } else if (toolName === 'trace_path') {
          if (!activeDocumentGraph) throw new Error('No document graph indexed yet. Call index_document_graph first.');
          const traced = activeDocumentGraph.tracePath(String(args.srcId || ''), String(args.dstId || ''), {
            direction: args.direction || 'both',
            maxHops: args.maxHops ?? 6,
            weighted: Boolean(args.weighted),
          });
          result = { content: [{ type: 'text', text: JSON.stringify({ path: traced }, null, 2) }] };
        } else if (toolName === 'get_document_tree') {
          if (!activeDocumentGraph) throw new Error('No document graph indexed yet. Call index_document_graph first.');
          const trees = activeDocumentGraph.getDocumentTree(args.docId);
          result = { content: [{ type: 'text', text: JSON.stringify({ trees }, null, 2) }] };
        } else if (toolName === 'read_section_nodes') {
          if (!activeDocumentGraph) throw new Error('No document graph indexed yet. Call index_document_graph first.');
          const passages = activeDocumentGraph.readSectionNodes(args.sectionNodeIds || [], {
            includeDescendants: args.includeDescendants !== false,
          });
          result = { content: [{ type: 'text', text: JSON.stringify({ passages }, null, 2) }] };
        } else if (toolName === 'scan_enterprise_secrets') {
          const text = String(args.text || '');
          const scan = scanEnterprisePiiAndSecrets(text);
          const red = redactEnterpriseText(text, { workspaceSalt: args.workspaceSalt });
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    maskedText: red.maskedText,
                    secretCount: red.secretCount,
                    piiCount: red.piiCount,
                    evasionCharsStripped: scan.evasionCharsStripped,
                    homoglyphsFolded: scan.homoglyphsFolded,
                    entities: red.entities.map((e) => ({
                      type: e.type,
                      category: e.category,
                      token: e.token,
                      entityId: e.entityId,
                      start: e.start,
                      end: e.end,
                      confidence: e.confidence,
                      evasionNormalized: e.evasionNormalized,
                    })),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (toolName === 'ingest_enterprise_bundle') {
          const files = Array.isArray(args.files) ? args.files : [];
          const salt = args.workspaceSalt || 'versieve-enterprise-v1';
          const vault = new SaltedPseudonymVault(salt);
          const graphDocs = [];
          const forensicFindings = [];

          for (const f of files) {
            const name = String(f.source || f.name || 'file.txt');
            const buf =
              typeof f.contentBase64 === 'string'
                ? Buffer.from(f.contentBase64, 'base64')
                : Buffer.from(String(f.text || f.content || ''), 'utf8');
            const parsed = parseEnterpriseBuffer(name, buf, { usersMap: f.usersMap });
            forensicFindings.push(...(parsed.forensicFindings || []));
            const redactedBlocks = parsed.blocks.map((blk) => {
              const red = redactEnterpriseText(blk.text, { vault });
              return {
                ...blk,
                text: red.maskedText,
                preRedacted: true,
                entityIds: Array.from(new Set(red.entities.map((e) => e.entityId))),
              };
            });
            graphDocs.push({
              source: name,
              modality: parsed.modality,
              blocks: redactedBlocks,
            });
          }

          activeDocumentGraph = new PortableDocumentGraph({ workspaceSalt: salt });
          activeDocumentGraph.vault = vault;
          const summary = activeDocumentGraph.indexDocuments(
            graphDocs,
            Array.isArray(args.artifacts) ? args.artifacts : []
          );
          result = {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ...summary,
                    forensicFindings,
                    entities: vault.exportRedactedEntities(),
                  },
                  null,
                  2
                ),
              },
            ],
          };
        } else if (toolName === 'audit_forensic_leaks') {
          const src = String(args.source || 'media.bin');
          const buf = Buffer.from(String(args.contentBase64 || ''), 'base64');
          const lower = src.toLowerCase();
          if (/\.(jpe?g|png|mp4|mov)$/i.test(lower)) {
            const scrubbed = scrubBinaryMediaMetadata(buf);
            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      source: src,
                      ...scrubbed.meta,
                      cleanBase64Length: scrubbed.cleanBytes.byteLength,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
          } else {
            const parsed = parseEnterpriseBuffer(src, buf);
            result = {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      source: src,
                      modality: parsed.modality,
                      blockCount: parsed.blocks.length,
                      forensicFindings: parsed.forensicFindings,
                    },
                    null,
                    2
                  ),
                },
              ],
            };
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
    request?.params?.name === 'redact_audio_call'
  ) {
    try {
      const args = request.params?.arguments || {};
      const wavBuf = Buffer.from(String(args.wavBase64 || ''), 'base64');
      const out = await redactAudioCall(String(args.source || 'call.wav'), wavBuf, {
        wordTimestamps: Array.isArray(args.wordTimestamps) ? args.wordTimestamps : undefined,
        mode: args.mode || 'beep',
        padMs: args.padMs ?? 40,
        workspaceSalt: args.workspaceSalt,
      });
      return {
        jsonrpc: '2.0',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  source: out.source,
                  provider: out.provider,
                  redactedTranscript: out.redactedTranscript,
                  redactedVtt: out.redactedVtt,
                  redactedWavSha256: out.redactedWavSha256,
                  redactedWavBase64: Buffer.from(out.redactedWavBytes).toString('base64'),
                  spokenTransformsCount: out.spokenTransformsCount,
                  redactionLog: out.redactionLog,
                  audioMeta: out.audioMeta,
                },
                null,
                2
              ),
            },
          ],
        },
        id: request.id ?? null,
      };
    } catch (err) {
      return {
        jsonrpc: '2.0',
        error: { code: -32603, message: err.message },
        id: request?.id ?? null,
      };
    }
  }

  if (
    request?.method === 'tools/call' &&
    request?.params?.name === 'ingest_url_or_links'
  ) {
    try {
      const args = request.params?.arguments || {};
      const { allowPrivateNetworkForTest: _stripPrivate, ...safeOpts } = args.options || {};
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
            ? [Object.assign({ url: explicitUrls[0], success: true }, await ingestUrl(explicitUrls[0], safeOpts))]
            : await ingestLinkList(explicitUrls, safeOpts);
        const combinedText = fetched
          .filter((item) => item.success && item.cleanText)
          .map((item) => item.cleanText)
          .join('\n\n');
        const pipelineRes = runCleanAndTokenizePipeline(combinedText, {
          format: 'text',
          ...safeOpts,
        });
        const manifest = buildCorpusManifest(
          fetched.map((f) => ({
            sourceId: f.url,
            sourceType: f.sourceType || 'url',
            rawBytes: f.rawBytes || 0,
            boilerplateStrippedBytes: f.boilerplateStrippedBytes || 0,
            lines: f.lines || [],
            sha256: f.sha256 || '',
          }))
        );
        return {
          jsonrpc: '2.0',
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ cleanText: combinedText, ...pipelineRes, fetched, manifest }, null, 2),
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
