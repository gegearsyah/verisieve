#!/usr/bin/env node
import fs from 'node:fs';
import { runCleanAndTokenizePipeline } from '../src/clean-and-tokenize.js';
import { auditCactusWasmArtifact } from '../src/ocr-engine.js';

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === 'selftest') {
  console.log('Matilda Portable CLI v1.0.0');
  console.log('Running selftest pipeline...');
  const sample = 'Invoice #12345 from alice@example.com total $500.00. Phone +61 412 345 678.';
  const res = runCleanAndTokenizePipeline(sample, { format: 'text' });
  console.log('Ingest & Tokenize OK:', res.blocks.length, 'blocks,', res.tokenizedChunks.length, 'chunks.');
  console.log('Node Hash:', res.nodeHash);
  console.log('Selftest passed successfully!');
  process.exit(0);
}

if (command === 'audit-wasm') {
  try {
    const report = auditCactusWasmArtifact();
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    console.error('Error auditing WASM artifact:', err.message);
    process.exit(1);
  }
} else if (command === 'ingest') {
  const filePath = args[1];
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('Error: Please provide a valid file path.');
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  const result = runCleanAndTokenizePipeline(content, { format: 'text' });
  console.log(JSON.stringify(result, null, 2));
} else if (command === 'train') {
  console.log('Train subcommand requires synthetic feature rows or dataset file.');
} else if (command === 'decide') {
  console.log('Decide subcommand requires model bundle and feature vector.');
} else {
  console.error(`Unknown command: ${command}`);
  console.log('Available subcommands: ingest, train, decide, selftest, audit-wasm');
  process.exit(1);
}
