#!/usr/bin/env node
/**
 * scripts/fetch-public-benchmarks.mjs
 * 
 * Fetches real public benchmark datasets from Hugging Face Datasets Server:
 * 1. nielsr/funsd (199 forms: 149 train + 50 test) -> results/untrusted-benchmarks/funsd-full.json
 * 2. ai4privacy/pii-masking-200k (500 records) -> results/untrusted-benchmarks/ai4privacy-500.json
 * 3. qiaojin/PubMedQA (500 records) -> results/untrusted-benchmarks/pubmedqa-500.json
 * 
 * Verifies existence of 8 Born-Digital PMC clinical PDFs in Health-Research references.
 * Total: 1,207 real public benchmark documents.
 */

import fs from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('results/untrusted-benchmarks');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function fetchHfRows(dataset, config, split, offset, length) {
  const url = new URL('https://datasets-server.huggingface.co/rows');
  url.searchParams.set('dataset', dataset);
  if (config) url.searchParams.set('config', config);
  url.searchParams.set('split', split);
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('length', String(length));

  console.log(`   Fetching ${dataset} (${split}, offset=${offset}, length=${length})...`);
  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': 'VeriSieve-Benchmark/1.0.0 (Research Benchmark Ingestion)'
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF Datasets Server error ${res.status} ${res.statusText}: ${text}`);
  }

  const json = await res.json();
  if (!json.rows || !Array.isArray(json.rows)) {
    throw new Error(`Unexpected response structure: ${JSON.stringify(json).slice(0, 200)}`);
  }
  return json.rows.map(r => r.row);
}

// 1. Fetch FUNSD (all 199 forms: 149 train + 50 test)
async function fetchFunsd() {
  const targetPath = path.join(OUT_DIR, 'funsd-full.json');
  console.log('\n[1/3] Fetching nielsr/funsd (199 ICDAR-2019 forms)...');
  
  const train1 = await fetchHfRows('nielsr/funsd', 'default', 'train', 0, 100);
  const train2 = await fetchHfRows('nielsr/funsd', 'default', 'train', 100, 50);
  const test0 = await fetchHfRows('nielsr/funsd', 'default', 'test', 0, 50);

  const allFunsd = [...train1, ...train2, ...test0];
  console.log(`   -> Total FUNSD forms retrieved: ${allFunsd.length} (expected 199)`);
  
  let totalWords = 0;
  for (const f of allFunsd) {
    if (Array.isArray(f.words)) totalWords += f.words.length;
  }
  console.log(`   -> Total OCR word boxes: ${totalWords.toLocaleString()}`);

  fs.writeFileSync(targetPath, JSON.stringify(allFunsd, null, 2), 'utf8');
  console.log(`   -> Saved to ${targetPath} (${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB)`);
  return allFunsd.length;
}

// 2. Fetch ai4privacy/pii-masking-200k (500 records)
async function fetchAi4Privacy() {
  const targetPath = path.join(OUT_DIR, 'ai4privacy-500.json');
  console.log('\n[2/3] Fetching ai4privacy/pii-masking-200k (500 records)...');

  const allRecords = [];
  for (let offset = 0; offset <= 400; offset += 100) {
    const rows = await fetchHfRows('ai4privacy/pii-masking-200k', 'default', 'train', offset, 100);
    allRecords.push(...rows);
  }

  console.log(`   -> Total ai4privacy records retrieved: ${allRecords.length} (expected 500)`);
  fs.writeFileSync(targetPath, JSON.stringify(allRecords, null, 2), 'utf8');
  console.log(`   -> Saved to ${targetPath} (${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB)`);
  return allRecords.length;
}

// 3. Fetch qiaojin/PubMedQA (500 records)
async function fetchPubMedQA() {
  const targetPath = path.join(OUT_DIR, 'pubmedqa-500.json');
  console.log('\n[3/3] Fetching qiaojin/PubMedQA (500 records, pqa_labeled)...');

  const allRecords = [];
  for (let offset = 0; offset <= 400; offset += 100) {
    const rows = await fetchHfRows('qiaojin/PubMedQA', 'pqa_labeled', 'train', offset, 100);
    allRecords.push(...rows);
  }

  console.log(`   -> Total PubMedQA records retrieved: ${allRecords.length} (expected 500)`);
  fs.writeFileSync(targetPath, JSON.stringify(allRecords, null, 2), 'utf8');
  console.log(`   -> Saved to ${targetPath} (${(fs.statSync(targetPath).size / 1024).toFixed(1)} KB)`);
  return allRecords.length;
}

// 4. Verify PMC Clinical PDFs
function verifyPmcPdfs() {
  console.log('\n[4/4] Verifying 8 Full-Text Born-Digital PMC Clinical PDFs...');
  const PMC_PDFS = [
    'miu_2017_PMC5773420.pdf',
    'goubar_2021_PMC7611209.pdf',
    'ikram_2022_PMC9948448.pdf',
    'record_PMC4595218.pdf',
    'ma_2022_PMC8984086.pdf',
    'narula_2020_PMC7667224.pdf',
    'norman_2021_PMC8399049.pdf',
    'multilevel_logistic_PMC5575471.pdf'
  ];

  const candidateDirs = [
    'C:/Users/GEYE ARDIANSYAH/Downloads/Innovation Hub/Health-Research/references/papers',
    '../Health-Research/references/papers'
  ];

  let foundCount = 0;
  for (const pdf of PMC_PDFS) {
    let resolved = null;
    for (const d of candidateDirs) {
      const p = path.resolve(d, pdf);
      if (fs.existsSync(p)) {
        resolved = p;
        break;
      }
    }
    if (resolved) {
      foundCount++;
      const sz = (fs.statSync(resolved).size / 1024).toFixed(1);
      console.log(`   - ${pdf}: FOUND (${sz} KB) at ${resolved}`);
    } else {
      console.warn(`   - ${pdf}: NOT FOUND`);
    }
  }

  console.log(`   -> Total PMC PDFs verified: ${foundCount} / ${PMC_PDFS.length}`);
  return foundCount;
}

async function main() {
  console.log('========================================================================');
  console.log('   VERISIEVE PUBLIC BENCHMARK DATASET INGESTION                         ');
  console.log('   Target: 1,207 Real Public Documents (199 FUNSD + 500 ai4privacy +     ');
  console.log('           500 PubMedQA + 8 PMC Clinical PDFs)                          ');
  console.log('========================================================================');

  const funsdCount = await fetchFunsd();
  const ai4Count = await fetchAi4Privacy();
  const pubmedCount = await fetchPubMedQA();
  const pmcCount = verifyPmcPdfs();

  const total = funsdCount + ai4Count + pubmedCount + pmcCount;
  console.log('\n========================================================================');
  console.log(`   INGESTION COMPLETE: ${total} Real Public Documents Ready`);
  console.log(`   - ICDAR-2019 FUNSD Scanned Forms:    ${funsdCount}`);
  console.log(`   - ai4privacy-200k Ground-Truth PII:   ${ai4Count}`);
  console.log(`   - PubMedQA Labeled Biomedical QA:     ${pubmedCount}`);
  console.log(`   - Born-Digital Full-Text PMC PDFs:    ${pmcCount}`);
  console.log('========================================================================\n');
}

main().catch(err => {
  console.error('Fatal fetch error:', err);
  process.exit(1);
});
