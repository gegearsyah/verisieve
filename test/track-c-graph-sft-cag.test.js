import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

import {
  extractStructuredPdfBlocks,
  parseDelimitedRows,
  formatDelimitedTableBlocks,
  extractDocxStructured,
  extractMarkdownStructured,
} from '../src/structure-extractor.js';
import { PortableDocumentGraph } from '../src/graph-wasm.js';
import {
  buildGraphGroundedSft,
  serializeGraphSftJsonl,
  serializeTriplesJsonl,
  stripTrailingSpecialEos,
} from '../src/graph-sft-builder.js';
import {
  buildCagDossier,
  registerCagArtifactInGraph,
  checkCagEviction,
  LlamaServerCagClient,
  OllamaCagClient,
} from '../src/cag-dossier.js';
import { ingestFromUrlOrPath, exportTrainingArtifacts } from '../src/pdf-image-pipeline.js';

function makeMinimalZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const rawBuf = Buffer.from(content, 'utf8');
    const compBuf = zlib.deflateRawSync(rawBuf);

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0, 6);
    lfh.writeUInt16LE(8, 8);
    lfh.writeUInt32LE(compBuf.length, 18);
    lfh.writeUInt32LE(rawBuf.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);

    localParts.push(lfh, nameBuf, compBuf);

    const cdh = Buffer.alloc(46);
    cdh.writeUInt32LE(0x02014b50, 0);
    cdh.writeUInt16LE(20, 4);
    cdh.writeUInt16LE(20, 6);
    cdh.writeUInt16LE(0, 8);
    cdh.writeUInt16LE(8, 10);
    cdh.writeUInt32LE(compBuf.length, 20);
    cdh.writeUInt32LE(rawBuf.length, 24);
    cdh.writeUInt16LE(nameBuf.length, 28);
    cdh.writeUInt16LE(0, 30);
    cdh.writeUInt16LE(0, 32);
    cdh.writeUInt32LE(offset, 42);

    centralParts.push(cdh, nameBuf);
    offset += lfh.length + nameBuf.length + compBuf.length;
  }

  const cdBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

test('Task C1: Tier-0 structure extractor preserves PDF headings/breadcrumbs, CSV headers, DOCX tables/footnotes, and Markdown GFM tables', () => {
  // 1. PDF heading + running header removal + page numbers
  const lineRecords = [
    { pageIndex: 0, text: 'OAIC Compliance Guide', fontSizePx: 9, fontStyle: 'sans_serif' },
    { pageIndex: 0, text: 'Chapter 1: APP Entities', fontSizePx: 18, fontStyle: 'bold_stamp' },
    { pageIndex: 0, text: 'An APP entity must manage personal information in an open and transparent way.', fontSizePx: 11, fontStyle: 'sans_serif' },
    { pageIndex: 1, text: 'OAIC Compliance Guide', fontSizePx: 9, fontStyle: 'sans_serif' },
    { pageIndex: 1, text: 'Small Business Operator Threshold', fontSizePx: 14, fontStyle: 'bold_stamp' },
    { pageIndex: 1, text: 'A small business operator has an annual turnover of $3,000,000 or less for the financial year.', fontSizePx: 11, fontStyle: 'sans_serif' },
    { pageIndex: 2, text: 'OAIC Compliance Guide', fontSizePx: 9, fontStyle: 'sans_serif' },
    { pageIndex: 2, text: 'Exceptions apply to health service providers regardless of turnover.', fontSizePx: 11, fontStyle: 'sans_serif' },
  ];
  const pdfOut = extractStructuredPdfBlocks('oaic-app.pdf', lineRecords);
  assert.equal(pdfOut.tree.length, 1);
  assert.equal(pdfOut.tree[0].title, 'Chapter 1: APP Entities');
  assert.equal(pdfOut.tree[0].children[0].title, 'Small Business Operator Threshold');
  assert.ok(pdfOut.blocks.every((b) => !b.text.includes('OAIC Compliance Guide')), 'Running header across >=3 pages must be stripped');
  const thresholdBlock = pdfOut.blocks.find((b) => b.text.includes('$3,000,000'));
  assert.ok(thresholdBlock);
  assert.equal(thresholdBlock.breadcrumb, 'Chapter 1: APP Entities > Small Business Operator Threshold');
  assert.equal(thresholdBlock.pageStart, 2);
  assert.equal(thresholdBlock.pageEnd, 3);

  // 2. CSV row-0 column header preservation
  const csvRows = parseDelimitedRows('Principle,Max Penalty,Applies To\nAPP 1,$3,000,000,All APP entities\nAPP 11,$50,000,Security of personal information');
  // Note quoted commas
  const quotedRows = parseDelimitedRows('Principle,Max Penalty,Applies To\nAPP 1,"$3,000,000",All APP entities\nAPP 11,"$50,000,000",Security of personal information');
  const csvOut = formatDelimitedTableBlocks('penalties.csv', quotedRows);
  assert.equal(csvRows.length, 3);
  assert.equal(csvOut.blocks.length, 2);
  assert.equal(csvOut.blocks[0].structRole, 'TABLE_ROW');
  assert.equal(csvOut.blocks[0].text, 'Principle: APP 1 | Max Penalty: $3,000,000 | Applies To: All APP entities');
  assert.equal(csvOut.blocks[1].text, 'Principle: APP 11 | Max Penalty: $50,000,000 | Applies To: Security of personal information');

  // 3. DOCX headings + table header binding + footnotes
  const docXml =
    '<w:document><w:body>' +
    '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Data Retention Policy</w:t></w:r></w:p>' +
    '<w:p><w:r><w:t>Retention windows depend on record classification.</w:t></w:r></w:p>' +
    '<w:tbl>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Category</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Retention</w:t></w:r></w:p></w:tc></w:tr>' +
    '<w:tr><w:tc><w:p><w:r><w:t>Audit Logs</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>7 years</w:t></w:r></w:p></w:tc></w:tr>' +
    '</w:tbl>' +
    '</w:body></w:document>';
  const fnXml =
    '<w:footnotes><w:footnote w:id="1"><w:p><w:r><w:t>See Statutory Instrument 2026-44 for archival extensions.</w:t></w:r></w:p></w:footnote></w:footnotes>';
  const docxBuf = makeMinimalZip([
    { name: 'word/document.xml', content: docXml },
    { name: 'word/footnotes.xml', content: fnXml },
  ]);
  const docxOut = extractDocxStructured('retention.docx', docxBuf);
  assert.equal(docxOut.tree.length, 1);
  assert.equal(docxOut.tree[0].title, 'Data Retention Policy');
  assert.ok(docxOut.blocks.some((b) => b.structRole === 'TABLE_ROW' && b.text === 'Category: Audit Logs | Retention: 7 years' && b.breadcrumb === 'Data Retention Policy'));
  assert.ok(docxOut.blocks.some((b) => b.structRole === 'FOOTNOTE' && b.text.includes('Statutory Instrument 2026-44')));

  // 4. Markdown headings + GFM table
  const mdText = [
    '# Privacy Policy',
    'Overview of statutory requirements.',
    '## Threshold Schedule',
    '| Metric | Threshold | Notes |',
    '| --- | --- | --- |',
    '| Annual Turnover | $3,000,000 | Small business exemption |',
    '| Breach Notification | 30 days | Assessment deadline |',
  ].join('\n');
  const mdOut = extractMarkdownStructured('policy.md', mdText);
  assert.equal(mdOut.tree[0].title, 'Privacy Policy');
  assert.equal(mdOut.tree[0].children[0].title, 'Threshold Schedule');
  const tableBlocks = mdOut.blocks.filter((b) => b.structRole === 'TABLE_ROW');
  assert.equal(tableBlocks.length, 2);
  assert.equal(tableBlocks[0].text, 'Metric: Annual Turnover | Threshold: $3,000,000 | Notes: Small business exemption');
  assert.equal(tableBlocks[0].breadcrumb, 'Privacy Policy > Threshold Schedule');
});

test('Task C1: ingestFromUrlOrPath fixes toxic URL/PII auto-drop, wires versieve_clean.wasm chunking, and preserves salted pseudonyms + breadcrumbs', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-c1-'));
  try {
    const mdPath = path.join(tmpDir, 'compliance-corpus.md');
    const docText = [
      '# APP 1 Open and Transparent Management',
      'Lead compliance officer Dr. Alice Mercer (alice.mercer@clinic.org) oversees APP 1 reviews under https://www.oaic.gov.au/privacy/australian-privacy-principles/app-1 and verifies annual privacy policies.',
      'Dr. Alice Mercer also audits external disclosures for Bob Chen (bob.chen@clinic.org) referencing https://www.oaic.gov.au/privacy/notifiable-data-breaches in quarterly governance filings.',
      '## Small Business Operator Rules',
      'Under Section 6D of the Privacy Act, an operator with annual turnover of $3,000,000 or less is generally exempt unless it provides a health service or trades in personal information.',
      'Dr. Alice Mercer signed off on exemption ruling X-904 confirming the $3,000,000 statutory threshold applies to affiliated clinical subsidiaries.',
      'Copyright Notice Reproduction Prohibited All Rights Reserved Page 14',
      'CONFIDENTIAL PATIENT INTAKE SSN 123-45-6789 TEL +1-415-555-4043',
    ].join('\n\n');
    fs.writeFileSync(mdPath, docText, 'utf8');

    const res = await ingestFromUrlOrPath(mdPath, {
      chunkMode: 'token_window',
      chunkTokens: 256,
      chunkOverlap: 24,
      pseudonymize: true,
      workspaceSalt: 'track-c1-test-salt',
      outDir: path.join(tmpDir, 'out'),
    });

    // Must not drop URL-bearing or cleanly redacted prose rows!
    const urlRow = res.rows.find((r) => r.masked_text.includes('https://www.oaic.gov.au/'));
    assert.ok(urlRow, 'URL-bearing statutory row must be preserved');
    assert.equal(urlRow.label, 1, 'Statutory paragraph with URL and cleanly redacted PII must have label = 1 (not dropped)');
    assert.equal(urlRow.breadcrumb, 'APP 1 Open and Transparent Management');
    assert.ok(urlRow.section_id && urlRow.section_id.startsWith('sec:'));

    // Cross-passage salted pseudonym consistency (Dr. Alice Mercer gets SAME <PII:PERSON_01> across sections)
    const section2Row = res.rows.find((r) => r.masked_text.includes('X-904') && r.masked_text.includes('$3,000,000'));
    assert.ok(section2Row, 'Second section row must exist');
    assert.equal(section2Row.breadcrumb, 'APP 1 Open and Transparent Management > Small Business Operator Rules');
    assert.equal(section2Row.label, 1, 'Redacted prose in section 2 must have label = 1');

    const sharedEntityIds = (urlRow.entity_ids || []).filter((id) => (section2Row.entity_ids || []).includes(id));
    assert.ok(sharedEntityIds.length >= 1, 'Dr. Alice Mercer must share the exact same salted entity_id across both sections');

    const tokenMatch1 = urlRow.masked_text.match(/<PII:PERSON_\d+>/);
    const tokenMatch2 = section2Row.masked_text.match(/<PII:PERSON_\d+>/);
    assert.ok(tokenMatch1 && tokenMatch2 && tokenMatch1[0] === tokenMatch2[0], 'Repeated person across passages must map to identical salted display token');

    // Genuine boilerplate must still get label = 0
    const boilerplateRows = res.rows.filter((r) => r.label === 0);
    assert.ok(boilerplateRows.length >= 2, `Expected >= 2 boilerplate rows with label = 0, got ${boilerplateRows.length}`);
    assert.ok(boilerplateRows.some((r) => /All Rights|14/i.test(r.masked_text)), 'Genuine copyright boilerplate must receive label = 0');

    // Zero raw PII leakage anywhere in rows or exports
    const allMasked = res.rows.map((r) => r.masked_text).join('\n');
    for (const raw of ['Alice Mercer', 'alice.mercer@clinic.org', 'Bob Chen', 'bob.chen@clinic.org', '123-45-6789']) {
      assert.ok(!allMasked.includes(raw), `Raw PII leaked in masked_text: ${raw}`);
      assert.ok(!res.csv.includes(raw), `Raw PII leaked in CSV: ${raw}`);
      assert.ok(!res.json.includes(raw), `Raw PII leaked in JSON: ${raw}`);
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Task C2: Graph-Grounded SFT Builder emits packed passages, diverse section prompts, table records, multi-hop chains, and triples.jsonl with zero double-EOS and zero raw PII', () => {
  const graph = new PortableDocumentGraph({ workspaceSalt: 'track-c2-salt' });
  graph.indexDocuments([
    {
      source: 'oaic-privacy-act.md',
      pageNo: 1,
      text: [
        '# APP 1 Open and Transparent Management',
        'An APP entity must take reasonable steps to implement practices, procedures, and systems that ensure compliance with the Australian Privacy Principles. Lead compliance counsel Dr. Alice Mercer (alice.mercer@clinic.org) oversees annual policy audits and registers governance findings under https://www.oaic.gov.au/privacy/app-1 for every regulated subsidiary.',
        'All privacy policies must state the kinds of personal information collected, how that information is held, the purposes of collection, and how individuals can access or correct records without unreasonable delay.',
        '## Small Business Operator Exemption',
        'Under section 6D of the Privacy Act, a small business operator has an annual turnover of $3,000,000 or less for the previous financial year. However, health service providers and entities trading in personal information remain bound by the Australian Privacy Principles regardless of turnover.',
        'Dr. Alice Mercer signed statutory threshold ruling X-904 clarifying how affiliated telehealth clinics measure consolidated annual revenue against the $3,000,000 statutory threshold and audit breach notification timelines.',
        '## Statutory Penalty Schedule',
        [
          '| Provision | Threshold | Maximum Civil Penalty |',
          '| --- | --- | --- |',
          '| Section 6D Exemption | $3,000,000 turnover | Exempt unless health service |',
          '| Section 13G Serious Interference | Repeated or systemic breach | $50,000,000 or 30% adjusted turnover |',
          '| Part IIIC NDB Assessment | 30 calendar days | Mandatory OAIC notification |',
        ].join('\n'),
      ].join('\n\n'),
    },
  ]);

  const built = buildGraphGroundedSft(graph, {
    minTokens: 40,
    maxTokens: 1536,
    includePackedPassages: true,
    includeSectionInstructions: true,
    includeTableRecords: true,
    includeMultiHopChains: true,
  });

  const { sftRecords, triples, stats } = built;
  assert.ok(sftRecords.length >= 4, `Expected >= 4 graph-grounded SFT records, got ${sftRecords.length}`);

  // Must include packed_passage, section_instruction, table_grounded, and multihop_graph_walk
  const modes = new Set(sftRecords.map((r) => r.mode));
  assert.ok(modes.has('packed_passage'), 'Must emit packed_passage continual-pretraining records');
  assert.ok(modes.has('section_instruction'), 'Must emit diverse section_instruction records');
  assert.ok(modes.has('table_grounded'), 'Must emit table_grounded records with column headers');
  assert.ok(modes.has('multihop_graph_walk'), 'Must emit multihop_graph_walk Q&A chains');

  // Verify NO constant prompt collapse
  const userPrompts = sftRecords
    .filter((r) => Array.isArray(r.messages))
    .map((r) => r.messages.find((m) => m.role === 'user')?.content)
    .filter(Boolean);
  assert.ok(new Set(userPrompts).size >= 3, `Expected >= 3 distinct user prompts, got ${new Set(userPrompts).size}`);
  assert.ok(userPrompts.every((p) => p !== 'Summarize verified segment.' && p !== 'Extract verified domain knowledge from document segment.'));

  // Verify table-header-bound record preserves column headers and $50,000,000 metric
  const tableRec = sftRecords.find((r) => r.mode === 'table_grounded');
  assert.ok(tableRec);
  const tableText = tableRec.text || tableRec.messages.map((m) => m.content).join('\n');
  assert.ok(
    tableText.includes('Provision: Section 13G') &&
    tableText.includes('Maximum Civil Penalty: $50,000,000'),
    `Expected table headers + $50,000,000 preserved, got: ${tableText}`
  );

  // Verify multi-hop graph walk connects Dr. Alice Mercer's pseudonym across APP 1 and Small Business Operator Exemption
  const hopRec = sftRecords.find((r) => r.mode === 'multihop_graph_walk');
  assert.ok(hopRec);
  assert.ok(Array.isArray(hopRec.hop_path) && hopRec.hop_path.length >= 3, 'Multi-hop record must carry hop_path');
  assert.ok(Array.isArray(hopRec.provenance_ids) && hopRec.provenance_ids.length >= 2, 'Multi-hop record must cite >=2 provenance_ids');
  const hopBody = hopRec.messages.map((m) => m.content).join('\n');
  assert.ok(/<PII:PERSON_\d+>/.test(hopBody), 'Multi-hop chain must reference salted pseudonym');

  // Single clean EOS invariant: NO hardcoded <|im_end|>, <|endoftext|>, </s>, or <|eot_id|>
  const sftJsonl = serializeGraphSftJsonl(sftRecords);
  assert.ok(!sftJsonl.includes('<|im_end|>'), 'rtio-graph-sft.jsonl must not bake hardcoded <|im_end|>');
  assert.ok(!sftJsonl.includes('<|endoftext|>'), 'rtio-graph-sft.jsonl must not bake hardcoded <|endoftext|>');
  assert.ok(!sftJsonl.includes('</s>'), 'rtio-graph-sft.jsonl must not bake hardcoded </s>');
  assert.equal(stripTrailingSpecialEos('Hello world<|im_end|><|endoftext|></s>'), 'Hello world');

  // Future-compatible triples.jsonl (AtlasKV / KBLaM)
  assert.ok(triples.length >= 4, `Expected >= 4 triples, got ${triples.length}`);
  const triplesJsonl = serializeTriplesJsonl(triples);
  for (const line of triplesJsonl.trim().split('\n')) {
    const t = JSON.parse(line);
    assert.ok(typeof t.subject === 'string' && t.subject.length > 0);
    assert.ok(typeof t.predicate === 'string' && t.predicate.length > 0);
    assert.ok(typeof t.object === 'string' && t.object.length > 0);
    assert.ok(typeof t.provenance_id === 'string' && t.provenance_id.length > 0);
  }

  // Zero raw PII in both artifacts
  for (const raw of ['Alice Mercer', 'alice.mercer@clinic.org']) {
    assert.ok(!sftJsonl.includes(raw), `Raw PII leaked in rtio-graph-sft.jsonl: ${raw}`);
    assert.ok(!triplesJsonl.includes(raw), `Raw PII leaked in triples.jsonl: ${raw}`);
  }
  assert.equal(stats.trailingEosArtifacts, 0);

  // Verify exportTrainingArtifacts writes rtio-graph-sft.jsonl and triples.jsonl alongside legacy outputs
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-c2-out-'));
  try {
    const rows = [
      {
        line_index: 0,
        source_file: 'oaic.md',
        breadcrumb: 'APP 1 > Overview',
        section_id: 'sec:0',
        struct_role: 'SECTION_BODY',
        masked_text: 'An APP entity must publish an open and transparent privacy policy audited by <PII:PERSON_01>.',
        gatekeeper_action: 'KEEP_SAFE',
      },
      {
        line_index: 1,
        source_file: 'oaic.md',
        breadcrumb: 'APP 1 > Small Business',
        section_id: 'sec:1',
        struct_role: 'SECTION_BODY',
        masked_text: '<PII:PERSON_01> verified the $3,000,000 turnover threshold under ruling X-904.',
        gatekeeper_action: 'KEEP_SAFE',
      },
    ];
    const art = exportTrainingArtifacts(rows, tmpOut, { workspaceSalt: 'track-c2-export' });
    assert.ok(fs.existsSync(path.join(tmpOut, 'rtio-graph-sft.jsonl')));
    assert.ok(fs.existsSync(path.join(tmpOut, 'triples.jsonl')));
    assert.ok(fs.existsSync(path.join(tmpOut, 'train-qwen-llama-sft.jsonl')));
    assert.ok(fs.existsSync(path.join(tmpOut, 'train-tokens.bin')));
    assert.ok(art.graphSftRecords.length >= 1);
    assert.ok(art.triples.length >= 1);
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
});

test('Task C4: Native CAG dossier serialization, token budget capping, GDPR Art. 17 blast-radius eviction, and llama-server + Ollama KV clients', async () => {
  const graph = new PortableDocumentGraph({ workspaceSalt: 'track-c4-salt' });
  const idxInfo = graph.indexDocuments([
    {
      source: 'oaic-mini.md',
      pageNo: 1,
      text: [
        '# APP Governance',
        'Lead reviewer Dr. Alice Mercer (alice.mercer@clinic.org) manages Project Falcon audits.',
        '## Small Business Threshold',
        'Dr. Alice Mercer approved ruling X-904 confirming the $3,000,000 annual turnover threshold.',
      ].join('\n\n'),
    },
    {
      source: 'facilities.md',
      pageNo: 1,
      text: [
        '# Building Operations',
        'Cafeteria manager Carlos Diaz (carlos@facilities.invalid) sets lunch service hours from 12:00 to 14:00.',
      ].join('\n\n'),
    },
  ]);

  // 1. Full dossier in deterministic TOC order
  const manifest = buildCagDossier(graph, { maxTokens: 32768 });
  assert.equal(manifest.truncated, false);
  assert.equal(manifest.dossierSha256.length, 64);
  assert.ok(manifest.slotFilename.startsWith('cag-slot-'));
  assert.ok(manifest.dossierText.includes('# Document: oaic-mini.md'));
  assert.ok(manifest.dossierText.includes('## APP Governance'));
  assert.ok(manifest.dossierText.includes('$3,000,000'));
  assert.ok(!manifest.dossierText.includes('Alice Mercer'), 'Zero raw PII in CAG dossier');
  assert.ok(!manifest.dossierText.includes('alice.mercer@clinic.org'));
  assert.ok(manifest.taintEntityIds.length >= 2);

  // 2. Tight token budget cleanly truncates at passage boundary without splitting <PII:...> tags
  const capped = buildCagDossier(graph, { maxTokens: 45 });
  assert.equal(capped.truncated, true);
  assert.ok(capped.estimatedTokens <= 45 || capped.includedPassageIds.length === 1);
  assert.ok(capped.omittedPassageIds.length >= 1);
  assert.ok(!/<PII:[A-Z0-9_]*$/.test(capped.dossierText), 'Must never split a <PII:...> token at truncation boundary');

  // 3. GDPR Art. 17 revocation via versieve_graph.wasm blastRadius
  const aliceEnt = idxInfo.entities.find((e) => e.pii_kind === 'PERSON');
  assert.ok(aliceEnt);
  const reg = registerCagArtifactInGraph(graph, manifest);
  assert.ok(reg.artifactNodeId.startsWith('art:cag_kv_slot:'));

  const evictionHit = checkCagEviction(graph, manifest, [aliceEnt.entity_id]);
  assert.equal(evictionHit.mustEvict, true);
  assert.ok(evictionHit.matchedEntities.includes(aliceEnt.entity_id));
  assert.equal(evictionHit.slotFilename, manifest.slotFilename);

  const evictionMiss = checkCagEviction(graph, manifest, ['ent:person:0000000000000000']);
  assert.equal(evictionMiss.mustEvict, false);

  // 4. Mock loopback llama-server (--slot-save-path) + Ollama (keep_alive) HTTP integration
  const llamaCalls = [];
  const llamaServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      llamaCalls.push({ method: req.method, url: req.url, body: parsed });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.startsWith('/slots/')) {
        res.end(JSON.stringify({ id_slot: 0, filename: parsed.filename || null, n_saved: 128, n_restored: 128, ok: true }));
      } else {
        const isWarm = parsed.n_predict === 0 || parsed.n_predict === 1;
        res.end(JSON.stringify({
          content: isWarm ? '' : 'Ruling X-904 confirms the $3,000,000 turnover threshold.',
          timings: isWarm
            ? { prompt_n: 120, prompt_ms: 42.5, cache_n: 0, predicted_n: 0 }
            : { prompt_n: 14, prompt_ms: 3.1, cache_n: 120, predicted_n: 16 },
        }));
      }
    });
  });

  const ollamaCalls = [];
  const ollamaServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {};
      ollamaCalls.push({ method: req.method, url: req.url, body: parsed });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (parsed.keep_alive === 0) {
        res.end(JSON.stringify({ done: true, done_reason: 'unload' }));
      } else {
        const isWarm = parsed.options?.num_predict === 1;
        res.end(JSON.stringify({
          response: isWarm ? '.' : 'Ruling X-904 sets the threshold at $3,000,000.',
          prompt_eval_count: isWarm ? 128 : 12,
          prompt_eval_duration: isWarm ? 45_000_000 : 3_000_000,
          eval_count: isWarm ? 1 : 14,
          total_duration: isWarm ? 50_000_000 : 18_000_000,
          done: true,
        }));
      }
    });
  });

  await new Promise((r) => llamaServer.listen(0, '127.0.0.1', r));
  await new Promise((r) => ollamaServer.listen(0, '127.0.0.1', r));

  try {
    const llamaPort = llamaServer.address().port;
    const llamaClient = new LlamaServerCagClient(`http://127.0.0.1:${llamaPort}`);
    const warmLlama = await llamaClient.warmDossier(manifest, { slotId: 0 });
    assert.equal(warmLlama.saved, true);
    assert.equal(warmLlama.promptEvalTokens, 120);

    const qLlama = await llamaClient.queryWithDossier(manifest, 'What is the turnover threshold under X-904?', { slotId: 0 });
    assert.ok(qLlama.answer.includes('$3,000,000'));
    assert.equal(qLlama.cacheHitTokens, 120);
    assert.equal(qLlama.cacheHit, true);

    await llamaClient.eraseSlot(0);
    assert.ok(llamaCalls.some((c) => c.url === '/slots/0?action=save'));
    assert.ok(llamaCalls.some((c) => c.url === '/slots/0?action=erase'));

    const ollamaPort = ollamaServer.address().port;
    const ollamaClient = new OllamaCagClient(`http://127.0.0.1:${ollamaPort}`);
    const warmOllama = await ollamaClient.warmDossier(manifest, { model: 'qwen2.5:1.5b', keepAlive: '30m' });
    assert.equal(warmOllama.promptEvalCount, 128);

    const qOllama = await ollamaClient.queryWithDossier(manifest, 'What is the turnover threshold under X-904?', {
      model: 'qwen2.5:1.5b',
      keepAlive: '30m',
      baselineColdPromptTokens: warmOllama.promptEvalCount,
    });
    assert.ok(qOllama.answer.includes('$3,000,000'));
    assert.equal(qOllama.promptEvalCount, 12);
    assert.equal(qOllama.cacheHit, true);

    await ollamaClient.evictModel('qwen2.5:1.5b');
    assert.ok(ollamaCalls.some((c) => c.body.keep_alive === 0));
  } finally {
    await new Promise((r) => llamaServer.close(r));
    await new Promise((r) => ollamaServer.close(r));
  }
});
