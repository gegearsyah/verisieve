import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { executeJsSql, trainWasmSmallModel } from '../src/wasm-needle-dl.js';
import { auditVersieveSqlWasm, executeSqlWasm, executeSqlSubsetFallback } from '../src/sql-wasm.js';

function buildSqlTestTables() {
  const rows = [
    {
      source_mode: 'pdf_text',
      gatekeeper_action: 'KEEP_SAFE',
      pii_detected: false,
      pred_prob: 0.95,
      token_count: 14,
      masked_text: 'Coronagraph optical contrast reached 1e-9.',
      raw_excerpt: 'Coronagraph optical contrast reached 1e-9.',
    },
    {
      source_mode: 'pdf_text',
      gatekeeper_action: 'KEEP_SAFE',
      pii_detected: false,
      pred_prob: 0.85,
      token_count: 8,
      masked_text: 'Short telemetry log.',
      raw_excerpt: 'Short telemetry log.',
    },
    {
      source_mode: 'ocr_scan',
      gatekeeper_action: 'KEEP_SAFE',
      pii_detected: false,
      pred_prob: 0.91,
      token_count: 18,
      masked_text: 'Adaptive optics loop locked at 2kHz.',
      raw_excerpt: 'Adaptive optics loop locked at 2kHz.',
    },
    {
      source_mode: 'ocr_scan',
      gatekeeper_action: 'DROP_OR_QUARANTINE',
      pii_detected: true,
      pred_prob: 0.08,
      token_count: 20,
      masked_text: 'Contact <PII:EMAIL> phone <PII:PHONE>',
      raw_excerpt: 'Contact test.user@example.invalid phone (415) 555-0192',
    },
    {
      source_mode: 'ocr_scan',
      gatekeeper_action: 'ABSTAIN_HUMAN_REVIEW',
      pii_detected: true,
      pred_prob: 0.44,
      token_count: 12,
      masked_text: 'Header <PII:NAME_LIKELY>',
      raw_excerpt: 'Header Alice Tester',
    },
  ];
  return {
    raw_extracted_documents: rows,
    documents: rows,
    versieve_certified_tokens: rows.filter((r) => r.gatekeeper_action === 'KEEP_SAFE'),
    pmc_pdf_data: rows.filter((r) => r.source_mode === 'pdf_text'),
    funsd_ocr_data: rows.filter((r) => r.source_mode === 'ocr_scan'),
  };
}

test('T7: versieve_sql.wasm artifact verifies 0 imports, <500 KB, ABI v1, provenance, and CLI audit-wasm', async () => {
  const audit = await auditVersieveSqlWasm();
  assert.equal(audit.ok, true);
  assert.equal(audit.zeroEgressVerified, true);
  assert.equal(audit.importCount, 0);
  assert.equal(audit.abiVersion, 1);
  assert.ok(audit.byteLength > 1000 && audit.byteLength < 500_000, `Expected < 500 KB, got ${audit.byteLength}`);
  assert.ok(fs.existsSync(path.resolve('rust/versieve-sql/src/lib.rs')));
  assert.equal(audit.provenance?.sourceCrate, 'rust/versieve-sql');
  assert.equal(audit.provenance?.sourceSha256Verified, true);

  const cliOut = execFileSync(process.execPath, [path.resolve('bin/versieve.mjs'), 'audit-wasm'], { encoding: 'utf8' });
  const parsed = JSON.parse(cliOut);
  assert.equal(parsed.allVerified, true);
  assert.equal(parsed.binaries?.versieve_sql?.zeroEgressVerified, true);
});

test('T7: executeSqlWasm executes SELECT, compound WHERE, GROUP BY, aggregates, ORDER BY, LIMIT and avoids misleading DuckDB v1.5.5 label', () => {
  const tables = buildSqlTestTables();
  const sql =
    "SELECT source_mode, gatekeeper_action, count(*) AS count, round(avg(pred_prob), 4) AS avg_prob, sum(token_count) AS total_tokens FROM documents WHERE gatekeeper_action = 'KEEP_SAFE' AND token_count >= 10 GROUP BY source_mode, gatekeeper_action ORDER BY source_mode DESC LIMIT 5;";
  const res = executeSqlWasm(sql, { tables });
  assert.equal(res.ok, true);
  assert.doesNotMatch(res.engine, /DuckDB\s+v1\.5\.5/i);
  assert.match(res.engine, /WASM\s+SQL\s+Subset/i);
  assert.deepEqual(res.columns, ['source_mode', 'gatekeeper_action', 'count', 'avg_prob', 'total_tokens']);
  assert.deepEqual(res.rows, [
    ['pdf_text', 'KEEP_SAFE', 1, 0.95, 14],
    ['ocr_scan', 'KEEP_SAFE', 1, 0.91, 18],
  ]);

  const orRes = executeJsSql(
    "SELECT source_mode, token_count FROM documents WHERE gatekeeper_action = 'DROP_OR_QUARANTINE' OR (pii_detected = false AND pred_prob > 0.9) ORDER BY token_count DESC LIMIT 2;",
    'all',
    { tables }
  );
  assert.doesNotMatch(orRes.engine, /DuckDB\s+v1\.5\.5/i);
  assert.deepEqual(orRes.rows, [
    ['ocr_scan', 20],
    ['ocr_scan', 18],
  ]);

  const aggRes = executeSqlWasm(
    'SELECT count(*) AS total, min(pred_prob) AS min_p, max(pred_prob) AS max_p FROM versieve_certified_tokens;',
    { tables }
  );
  assert.deepEqual(aggRes.rows, [[3, 0.85, 0.95]]);

  const trainOut = trainWasmSmallModel(tables.raw_extracted_documents, { epochs: 5, exportArtifacts: false });
  assert.notEqual(trainOut.results.duckdb_audit.version, '1.5.5');
});

test('T7: WASM SQL executes INNER equi-JOIN on aliased instances of the loaded table (kernel-side join product)', () => {
  const tables = buildSqlTestTables();
  // documents: 4 pdf (KEEP_SAFE 0.95 tok14 / KEEP_SAFE 0.85 tok8), 3 ocr (0.91 tok18, 0.08 tok20, 0.44 tok12)
  const joinRes = executeSqlWasm(
    "SELECT a.source_mode AS mode, count(*) AS pair_count FROM documents a INNER JOIN documents b ON a.source_mode = b.source_mode AND a.token_count = b.token_count GROUP BY a.source_mode ORDER BY pair_count DESC;",
    { tables }
  );
  assert.equal(joinRes.ok, true);
  assert.deepEqual(joinRes.columns, ['mode', 'pair_count']);
  // Multi-key equi-join: identity pairs only -> pdf group 2 pairs, ocr group 3 pairs
  assert.deepEqual(joinRes.rows, [['ocr_scan', 3], ['pdf_text', 2]]);

  const joinRowsRes = executeSqlWasm(
    "SELECT a.source_mode AS a_mode, b.token_count AS b_tokens FROM documents a JOIN documents b ON a.source_mode = b.source_mode WHERE a.token_count = 14 GROUP BY a.source_mode, b.token_count ORDER BY b_tokens ASC;",
    { tables }
  );
  assert.deepEqual(joinRowsRes.columns, ['a_mode', 'b_tokens']);
  // Left row 0 (pdf, tok 14) joins right rows 0 (14) and 1 (8)
  assert.deepEqual(joinRowsRes.rows, [['pdf_text', 8], ['pdf_text', 14]]);

  // SELECT * inside a JOIN stays fail-closed (typed validation error, same with a second table)
  assert.throws(
    () => executeSqlWasm('SELECT * FROM documents JOIN pmc_pdf_data ON documents.source_mode = pmc_pdf_data.source_mode;', { tables }),
    /SQL_VALIDATION_ERROR/i
  );
});

test('T7: WASM SQL executes cross-table INNER equi-JOIN through the two-table host ABI', () => {
  const tables = buildSqlTestTables();
  // documents (5 rows: 2 pdf, 3 ocr) JOIN pmc_pdf_data (2 pdf rows) on the string key source_mode:
  // KEEP_SAFE left rows: pdf(0.95,14), pdf(0.85,8), ocr(0.91,18) -> pdf rows pair 2x2 = 4, ocr pairs 0
  const crossJoinRes = executeSqlWasm(
    "SELECT d.source_mode AS sm, count(*) AS pairs FROM documents d JOIN pmc_pdf_data p ON d.source_mode = p.source_mode WHERE d.gatekeeper_action = 'KEEP_SAFE' GROUP BY d.source_mode ORDER BY pairs DESC;",
    { tables }
  );
  assert.equal(crossJoinRes.ok, true);
  assert.deepEqual(crossJoinRes.columns, ['sm', 'pairs']);
  assert.deepEqual(crossJoinRes.rows, [['pdf_text', 4]]);

  // Equal-token multi-key join with right-side projection
  const crossRowsRes = executeSqlWasm(
    'SELECT d.token_count AS dt, p.token_count AS pt FROM documents d JOIN pmc_pdf_data p ON d.source_mode = p.source_mode AND d.token_count = p.token_count ORDER BY dt ASC;',
    { tables }
  );
  assert.deepEqual(crossRowsRes.columns, ['dt', 'pt']);
  assert.deepEqual(crossRowsRes.rows, [[8, 8], [14, 14]]);

  // Aggregation over the cross-table product with a right-side column in GROUP BY
  const crossAggRes = executeSqlWasm(
    'SELECT p.token_count AS pt, round(avg(d.pred_prob), 2) AS avg_prob FROM documents d JOIN pmc_pdf_data p ON d.source_mode = p.source_mode AND d.token_count = p.token_count GROUP BY p.token_count ORDER BY pt ASC;',
    { tables }
  );
  assert.deepEqual(crossAggRes.rows, [[8, 0.85], [14, 0.95]]);
});

test('T7: cross-table JOIN failures stay fail-closed through the two-table host ABI and the JS fallback keeps rejecting JOINs', () => {
  const tables = buildSqlTestTables();
  // Unknown JOIN table: host cannot encode a second table -> typed rejection
  assert.throws(
    () => executeSqlWasm('SELECT a.source_mode AS m FROM documents a JOIN nope_unknown b ON a.source_mode = b.source_mode;', { tables }),
    /UNKNOWN_SQL_TABLE/i
  );
  // Non-equi ON across two tables is rejected by the kernel
  assert.throws(
    () => executeSqlWasm('SELECT d.source_mode AS m FROM documents d JOIN pmc_pdf_data p ON d.token_count <= p.token_count;', { tables }),
    /UNSUPPORTED_SQL_JOIN/i
  );
  // SELECT * inside a cross-table JOIN is rejected
  assert.throws(
    () => executeSqlWasm('SELECT * FROM documents d JOIN pmc_pdf_data p ON d.source_mode = p.source_mode;', { tables }),
    /SQL_VALIDATION_ERROR/i
  );
  // Unqualified columns stay ambiguous across two tables
  assert.throws(
    () => executeSqlWasm('SELECT source_mode AS m FROM documents d JOIN pmc_pdf_data p ON d.source_mode = p.source_mode;', { tables }),
    /SQL_VALIDATION_ERROR/i
  );
  // The JS subset fallback keeps rejecting every JOIN (no two-table ABI there)
  assert.throws(
    () => executeSqlSubsetFallback('SELECT d.source_mode AS m FROM documents d JOIN pmc_pdf_data p ON d.source_mode = p.source_mode;', { tables }),
    /UNKNOWN_SQL_TABLE_QUALIFIER|UNSUPPORTED_SQL_SYNTAX|UNSUPPORTED_SQL_JOIN/i
  );
});

test('T7: strict SQL validator in WASM and JS subset fallback rejects unsupported syntax, multi-statement injection, and unknown columns', () => {
  const tables = buildSqlTestTables();
  const invalidQueries = [
    '',
    'DROP TABLE documents;',
    'SELECT * FROM documents; DROP TABLE documents;',
    'SELECT * FROM documents JOIN pmc_pdf_data ON documents.source_mode = pmc_pdf_data.source_mode;',
    'SELECT * FROM documents UNION SELECT * FROM pmc_pdf_data;',
    'SELECT source_mode, count(*) AS c FROM documents GROUP BY source_mode HAVING c > 1;',
    'WITH cte AS (SELECT * FROM documents) SELECT * FROM cte;',
    'SELECT * FROM unknown_table_xyz;',
    'SELECT missing_column FROM documents;',
    'SELECT source_mode, count(*) FROM documents;',
  ];

  for (const badSql of invalidQueries) {
    assert.throws(
      () => executeSqlWasm(badSql, { tables }),
      /SQL|UNSUPPORTED|UNKNOWN|SYNTAX|MULTI|EMPTY/i,
      `WASM SQL must throw explicitly on invalid/unsupported SQL: ${badSql}`
    );
    assert.throws(
      () => executeSqlSubsetFallback(badSql, { tables }),
      /SQL|UNSUPPORTED|UNKNOWN|SYNTAX|MULTI|EMPTY/i,
      `JS fallback must throw explicitly on invalid/unsupported SQL: ${badSql}`
    );
  }

  const paritySql =
    "SELECT source_mode, count(*) AS count FROM documents WHERE gatekeeper_action = 'KEEP_SAFE' GROUP BY source_mode ORDER BY source_mode ASC;";
  const wasmParity = executeSqlWasm(paritySql, { tables });
  const jsParity = executeSqlSubsetFallback(paritySql, { tables });
  assert.match(jsParity.engine, /JS\s+SQL\s+Subset/i);
  assert.doesNotMatch(jsParity.engine, /DuckDB/i);
  assert.deepEqual(jsParity.columns, wasmParity.columns);
  assert.deepEqual(jsParity.rows, wasmParity.rows);
});

test('T7: host Python DuckDB helper uses parameterized read_csv_auto(?) queries without path string interpolation', () => {
  const pyHelper = fs.readFileSync(path.resolve('scripts/duckdb-query.py'), 'utf8');
  const pyTrain = fs.readFileSync(path.resolve('scripts/train-open-model.py'), 'utf8');

  assert.match(pyHelper, /read_csv_auto\(\?\)/);
  assert.doesNotMatch(pyHelper, /read_csv_auto\(['"]\{/);
  assert.match(pyTrain, /read_csv_auto\(\?\)/);
  assert.doesNotMatch(pyTrain, /read_csv_auto\(['"]\{/);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "versieve-duckdb'test-"));
  try {
    const csvPath = path.join(tmpDir, 'pmc.csv');
    fs.writeFileSync(
      csvPath,
      'source_mode,gatekeeper_action,token_count,pred_prob\npdf_text,KEEP_SAFE,12,0.94\npdf_text,DROP_OR_QUARANTINE,8,0.12\n',
      'utf8'
    );
    const proc = spawnSync(
      'python',
      [path.resolve('scripts/duckdb-query.py')],
      {
        input: JSON.stringify({
          sql: "SELECT source_mode, count(*) AS n FROM pmc_pdf_data WHERE gatekeeper_action = 'KEEP_SAFE' GROUP BY source_mode;",
          pmcCsvPath: csvPath,
        }),
        encoding: 'utf8',
      }
    );
    if (proc.status === 0 && proc.stdout.trim()) {
      const out = JSON.parse(proc.stdout.trim());
      assert.equal(out.ok, true);
      assert.deepEqual(out.columns, ['source_mode', 'n']);
      assert.deepEqual(out.rows, [['pdf_text', 1]]);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
