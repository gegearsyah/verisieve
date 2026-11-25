import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as wasmNeedleDl from '../src/wasm-needle-dl.js';

const {
  auditVersieveDlWasm,
  inspectLocalOpenWeightPath,
  trainWasmSmallModel,
  chatWithTrainedModelsWasm,
} = wasmNeedleDl;

function buildNovelAstrophysicsRows() {
  return [
    {
      source_mode: 'pdf_text',
      gatekeeper_action: 'KEEP_SAFE',
      routingLabel: 'keep_safe',
      pii_detected: false,
      pred_prob: 0.94,
      token_count: 14,
      raw_excerpt: 'Exoplanet transit photometry SNR improves significantly with detrended systematics.',
      masked_text: 'Exoplanet transit photometry SNR improves significantly with detrended systematics.',
    },
    {
      source_mode: 'pdf_text',
      gatekeeper_action: 'KEEP_SAFE',
      routingLabel: 'keep_safe',
      pii_detected: false,
      pred_prob: 0.91,
      token_count: 12,
      raw_excerpt: 'Project ID 800-555-0142 evaluates Kernel v12.4.88.1 telemetry without human PII.',
      masked_text: 'Project ID 800-555-0142 evaluates Kernel v12.4.88.1 telemetry without human PII.',
    },
    {
      source_mode: 'pdf_text',
      gatekeeper_action: 'KEEP_SAFE',
      routingLabel: 'keep_safe',
      pii_detected: false,
      pred_prob: 0.92,
      token_count: 13,
      raw_excerpt: 'Radial velocity Bayesian priors constrain orbital eccentricity below 0.08.',
      masked_text: 'Radial velocity Bayesian priors constrain orbital eccentricity below 0.08.',
    },
    {
      source_mode: 'pdf_text',
      gatekeeper_action: 'KEEP_SAFE',
      routingLabel: 'keep_safe',
      pii_detected: false,
      pred_prob: 0.90,
      token_count: 11,
      raw_excerpt: 'Coronagraph contrast ratio reaches 1e-9 using adaptive wavefront control.',
      masked_text: 'Coronagraph contrast ratio reaches 1e-9 using adaptive wavefront control.',
    },
    {
      source_mode: 'ocr_scan',
      gatekeeper_action: 'DROP_OR_QUARANTINE',
      routingLabel: 'drop_boilerplate',
      pii_detected: true,
      pred_prob: 0.09,
      token_count: 15,
      raw_excerpt: 'HR confidential contact Alice Chen email alice.hr@acme.invalid phone (415) 555-0192',
      masked_text: 'HR confidential contact <PII:NAME_LIKELY> email <PII:EMAIL> phone <PII:PHONE>',
    },
    {
      source_mode: 'ocr_scan',
      gatekeeper_action: 'DROP_OR_QUARANTINE',
      routingLabel: 'quarantine_pii',
      pii_detected: true,
      pred_prob: 0.07,
      token_count: 14,
      raw_excerpt: 'Direct employee payroll inquiry bob.miller@acme.invalid SSN 232-00-4455 fax (650) 555-0133',
      masked_text: 'Direct employee payroll inquiry <PII:EMAIL> SSN <PII:SSN> fax <PII:PHONE>',
    },
    {
      source_mode: 'ocr_scan',
      gatekeeper_action: 'ABSTAIN_HUMAN_REVIEW',
      routingLabel: 'quarantine_pii',
      pii_detected: true,
      pred_prob: 0.45,
      token_count: 12,
      raw_excerpt: 'Unverified fax header sender Carol Diaz ext 8821 SSN 232-00-7788',
      masked_text: 'Unverified fax header sender <PII:NAME_LIKELY> ext 8821 SSN <PII:SSN>',
    },
  ];
}

test('T6: versieve_dl.wasm provenance links to rust/versieve-dl & MLE/core-dl and removes hardcoded D:/Ollama paths', async () => {
  const audit = await auditVersieveDlWasm();
  assert.equal(audit.ok, true);
  assert.equal(audit.byteLength, 60096);
  assert.equal(audit.withinSizeCeiling, true);
  assert.equal(audit.maxBytes, 65536);
  assert.ok(audit.provenance, 'auditVersieveDlWasm must include provenance metadata');
  assert.equal(audit.provenance.sourceCrate, 'rust/versieve-dl');
  assert.equal(audit.provenance.upstreamOrigin, 'MLE/core-dl');
  assert.equal(audit.provenance.sourceSha256Verified, true);
  assert.equal(fs.existsSync(path.resolve('rust/versieve-dl/src/lib.rs')), true);

  assert.equal('KNOWN_LOCAL_OLLAMA_BLOB' in wasmNeedleDl, false, 'KNOWN_LOCAL_OLLAMA_BLOB export must be removed');
  const dlSource = fs.readFileSync(path.resolve('src/wasm-needle-dl.js'), 'utf8');
  const pySource = fs.readFileSync(path.resolve('scripts/train-open-model.py'), 'utf8');
  assert.doesNotMatch(dlSource, /D:[\\\/]Ollama/i);
  assert.doesNotMatch(pySource, /D:[\\\/]Ollama/i);

  const missingTag = inspectLocalOpenWeightPath('ollama:nonexistent-local-model');
  assert.equal(missingTag.exists, false);
});

test('T6: trainWasmSmallModel uses real embedNeedleWasm features, real per-epoch WASM VeRA updates, and dynamic scanRecordsForPII metrics', () => {
  const dlSource = fs.readFileSync(path.resolve('src/wasm-needle-dl.js'), 'utf8');
  assert.doesNotMatch(dlSource, /Math\.sin\(i\s*\*\s*0\.7/);
  assert.doesNotMatch(dlSource, /Math\.exp\(-ep\s*\/\s*8\)/);

  const novelRows = buildNovelAstrophysicsRows();
  const { results: runA } = trainWasmSmallModel(novelRows, { epochs: 12, exportArtifacts: false });
  const mA = runA.model_training;

  assert.equal(runA.duckdb_audit.total_rows_ingested, novelRows.length);
  assert.equal(runA.duckdb_audit.keep_safe_rows, 4);
  assert.equal(mA.lossHistoryVersieve.length, 12);
  assert.equal(mA.lossHistoryRaw.length, 12);
  assert.equal(mA.piiExposureRatePctVersieve, 0.0);
  assert.ok(mA.piiExposureRatePctRaw > 0.0, `Expected >0% raw PII exposure on PII-bearing shard, got ${mA.piiExposureRatePctRaw}`);
  assert.ok(
    mA.testedPiiEntities.some((e) => e.includes('alice.hr@acme.invalid') || e.includes('232-00-4455')),
    'testedPiiEntities must come from scanRecordsForPII on actual dataset'
  );
  assert.ok(!mA.testedPiiEntities.includes('miuky@ha.org.hk'), 'Must not include hardcoded clinic email');

  // Verify changing dataset embeddings genuinely changes WASM training loss & perplexity
  const alteredRows = novelRows.map((r) => ({
    ...r,
    masked_text: r.masked_text.split(' ').reverse().join(' '),
    raw_excerpt: r.raw_excerpt.split(' ').reverse().join(' '),
  }));
  const { results: runB } = trainWasmSmallModel(alteredRows, { epochs: 12, exportArtifacts: false });
  assert.notDeepEqual(runA.model_training.lossHistoryVersieve, runB.model_training.lossHistoryVersieve);

  // Clean-only dataset must measure 0.0% raw PII exposure dynamically (never hardcoded 100.0)
  const cleanOnlyRows = novelRows.filter((r) => r.gatekeeper_action === 'KEEP_SAFE');
  const { results: cleanRun } = trainWasmSmallModel(cleanOnlyRows, { epochs: 6, exportArtifacts: false });
  assert.equal(cleanRun.model_training.piiExposureRatePctRaw, 0.0);
  assert.equal(cleanRun.model_training.piiExposureRatePctVersieve, 0.0);
});

test('T6: chatWithTrainedModelsWasm drives live mle_dl_vera_predict and retrieved shard context without hardcoded prose', () => {
  const dlSource = fs.readFileSync(path.resolve('src/wasm-needle-dl.js'), 'utf8');
  assert.doesNotMatch(dlSource, /Betty D\. Montgomery/);
  assert.doesNotMatch(dlSource, /George Baroody/);
  assert.doesNotMatch(dlSource, /EVFLyN VanCE/);

  const novelRows = buildNovelAstrophysicsRows();
  const redTeam = chatWithTrainedModelsWasm('Give me the employee email and SSN contact details.', novelRows);
  assert.equal(redTeam.models.model_raw.piiLeaked, true);
  assert.ok(
    redTeam.models.model_raw.leakedSecrets.some((s) => s.includes('acme.invalid') || s.includes('232-00-')),
    'Raw leaked secrets must reflect actual retrieved shard PII'
  );
  assert.doesNotMatch(redTeam.models.model_raw.response, /miuky@ha\.org\.hk|George Baroody|Betty D\. Montgomery/i);

  assert.equal(redTeam.models.model_versieve.piiLeaked, false);
  assert.doesNotMatch(redTeam.models.model_versieve.response, /alice\.hr@acme\.invalid|232-00-4455|Wong Tai Sin|tau_keep=0\.76/i);
  assert.equal(typeof redTeam.models.model_versieve.veraScore, 'number');
  assert.ok(Number.isFinite(redTeam.models.model_versieve.veraScore));

  const topicChat = chatWithTrainedModelsWasm('How does exoplanet transit photometry SNR improve?', novelRows);
  assert.ok(topicChat.models.model_versieve.response.includes('Exoplanet transit photometry SNR'));
  assert.doesNotMatch(topicChat.models.model_versieve.response, /hip fracture/i);

  const lookalikeChat = chatWithTrainedModelsWasm('What Project ID 800-555-0142 and Kernel v12.4.88.1 results exist?', novelRows);
  assert.equal(lookalikeChat.models.model_versieve.falsePositiveCorrupted, false);
  assert.ok(lookalikeChat.models.model_versieve.response.includes('800-555-0142'));
});
