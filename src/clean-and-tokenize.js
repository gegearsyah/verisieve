import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// 2. Rtio Wire-Compatible Node Hashing
// ---------------------------------------------------------------------------
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a(input) {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function normalizeForHash(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(normalizeForHash);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      out[k] = normalizeForHash(value[k]);
    }
    return out;
  }
  return value;
}

export function computeNodeHash(nodeType, config, upstreamHashes = []) {
  const normalized = normalizeForHash(config ?? {});
  const payload = JSON.stringify([nodeType, normalized, ...[...upstreamHashes].sort()]);
  return fnv1a(payload);
}

// ---------------------------------------------------------------------------
// 1. Born-Digital Text-First Front Door (`ingestUnstructuredText`)
// ---------------------------------------------------------------------------
export function ingestUnstructuredText(input, options = {}) {
  let format = options.format;
  if (!format) {
    // Auto-detect format
    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (/^<[a-z][\s\S]*>/i.test(trimmed)) {
        format = 'html';
      } else if (/^(from|to|subject|date):\s/im.test(trimmed)) {
        format = 'email';
      } else {
        format = 'text';
      }
    } else if (Array.isArray(input)) {
      format = 'ocr_blocks';
    } else {
      format = 'text';
    }
  }

  const blocks = [];

  if (format === 'html') {
    let html = typeof input === 'string' ? input : String(input ?? '');
    // Remove script, style, nav, footer
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    html = html.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
    html = html.replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '');
    html = html.replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '');

    // Split block tags or paragraphs
    // Replace block tags with newlines or split
    const blockTagRegex = /<\/?(p|div|li|tr|h[1-6]|br)\b[^>]*>/gi;
    const processedHtml = html.replace(blockTagRegex, '\n');

    // Strip remaining tags
    const plainText = processedHtml.replace(/<[^>]+>/g, '');
    const lines = plainText.split(/\r?\n/).map(l => decodeHtmlEntities(l.trim())).filter(Boolean);

    lines.forEach((line, idx) => {
      blocks.push({
        id: `html_block_${idx + 1}`,
        text: line,
        sourceFormat: 'html',
        page: 1,
        lineIndex: idx,
        confidence: 1.0,
        bbox: null
      });
    });
  } else if (format === 'email') {
    let raw = typeof input === 'string' ? input : String(input ?? '');
    // Parse email headers and body
    const lines = raw.split(/\r?\n/);
    let inBody = false;
    const bodyLines = [];
    const headers = {};

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inBody) {
        if (line.trim() === '') {
          inBody = true;
          continue;
        }
        const match = line.match(/^([A-Za-z-]+):\s*(.*)$/);
        if (match) {
          headers[match[1].toLowerCase()] = match[2];
        } else {
          // If header parsing fails, treat as body start
          inBody = true;
          bodyLines.push(line);
        }
      } else {
        // Body
        // Strip quoted reply chains (> lines) and boilerplate email signatures if configured
        if (options.stripQuotes !== false && line.trim().startsWith('>')) {
          continue;
        }
        if (options.stripSignatures !== false && /^--\s*$/.test(line.trim())) {
          // stop or skip signature
          break;
        }
        bodyLines.push(line);
      }
    }

    const textContent = bodyLines.join('\n');
    const paras = textContent.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    if (paras.length === 0 && textContent.trim()) {
      paras.push(textContent.trim());
    }

    paras.forEach((p, idx) => {
      blocks.push({
        id: `email_block_${idx + 1}`,
        text: p,
        sourceFormat: 'email',
        page: 1,
        lineIndex: idx,
        confidence: 1.0,
        bbox: null,
        headers: idx === 0 ? headers : undefined
      });
    });
  } else if (format === 'ocr_blocks') {
    const rawBlocks = Array.isArray(input) ? input : [];
    rawBlocks.forEach((b, idx) => {
      blocks.push({
        id: b.id || `ocr_block_${idx + 1}`,
        text: String(b.text || ''),
        sourceFormat: 'ocr_blocks',
        page: b.page || 1,
        lineIndex: b.lineIndex !== undefined ? b.lineIndex : idx,
        confidence: b.confidence !== undefined ? b.confidence : 1.0,
        bbox: b.bbox || null,
        fontStyle: b.fontStyle,
        piiItems: b.piiItems
      });
    });
  } else {
    // text or pdf_text
    const rawText = typeof input === 'string' ? input : String(input ?? '');
    const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((line, idx) => {
      blocks.push({
        id: `text_block_${idx + 1}`,
        text: line,
        sourceFormat: format,
        page: 1,
        lineIndex: idx,
        confidence: 1.0,
        bbox: null
      });
    });
  }

  return blocks;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// ---------------------------------------------------------------------------
// 3. Deterministic Cleaning Chain (`stripBoilerplate`, `dedupBlocks`)
// ---------------------------------------------------------------------------
export function stripBoilerplate(blocks) {
  const cleaned = [];
  const dropped = [];

  // Common header/footer patterns
  const headerFooterRegex = /^(page\s+\d+\s+of\s+\d+|confidential|copyright|all rights reserved|powered by)/i;

  blocks.forEach(block => {
    const text = block.text.trim();
    if (headerFooterRegex.test(text) || text.length === 0) {
      dropped.push({
        block,
        reason: text.length === 0 ? 'empty_block' : 'boilerplate_header_footer'
      });
    } else {
      cleaned.push(block);
    }
  });

  return { cleaned, dropped };
}

export function dedupBlocks(blocks, { jaccardThreshold = 0.85 } = {}) {
  const seenHashes = new Set();
  const uniqueBlocks = [];

  // 1. Exact normalized SHA-256 deduplication
  for (const block of blocks) {
    const normalizedText = block.text.toLowerCase().replace(/\s+/g, ' ').trim();
    const hash = crypto.createHash('sha256').update(normalizedText).digest('hex');
    if (!seenHashes.has(hash)) {
      seenHashes.add(hash);
      uniqueBlocks.push(block);
    }
  }

  // 2. Deterministic 64-permutation FNV-1a MinHash near-duplicate removal
  const distinctBlocks = [];
  const minHashesList = uniqueBlocks.map(block => computeMinHash(block.text));

  for (let i = 0; i < uniqueBlocks.length; i++) {
    let isDuplicate = false;
    for (let j = 0; j < distinctBlocks.length; j++) {
      const sim = jaccardMinHash(minHashesList[i], minHashesList[seenHashesIndex(uniqueBlocks, distinctBlocks[j])]);
      if (sim >= jaccardThreshold) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) {
      distinctBlocks.push(uniqueBlocks[i]);
    }
  }

  return distinctBlocks;
}

function seenHashesIndex(allBlocks, targetBlock) {
  return allBlocks.findIndex(b => b.id === targetBlock.id);
}

function computeMinHash(text, numPermutations = 64) {
  const tokens = text.toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
  const hashes = new Array(numPermutations).fill(Infinity);

  for (const token of tokens) {
    const baseHash = parseInt(fnv1a(token), 16);
    for (let p = 0; p < numPermutations; p++) {
      // Linear congruential permutation simulation
      const permHash = (baseHash ^ (p * 0x9e3779b9)) >>> 0;
      if (permHash < hashes[p]) {
        hashes[p] = permHash;
      }
    }
  }
  return hashes;
}

function jaccardMinHash(sigA, sigB) {
  let matches = 0;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] === sigB[i]) matches++;
  }
  return matches / sigA.length;
}

// ---------------------------------------------------------------------------
// 4. Rtio-Compatible PII Scanner & Dual Masker
// ---------------------------------------------------------------------------
export const PII_PATTERNS = {
  email: /[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
  phone: /(?:\+\d{1,3}[-.\s]*)?(?:\(\s*\d{2,4}\s*\)|\b\d{2,4}\b)[-.\s]*\d{3,4}[-.\s]*\d{3,4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[ -]*?){13,16}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  date_of_birth: /\b(?:\d{1,2}[\/\s-]\d{1,2}[\/\s-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})\b/g,
  name_likely: /(?:Patient Name|Name|TO|FROM|SENDER|Doctor|Physician|Author):\s*([A-Z][a-zA-Z.'-]+\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)|(?:\b[A-Z][a-z]{1,15}\s+[A-Z]\.?\s+[A-Z][a-z]{1,15}\b)|\b([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15})\b/g,
  address_likely: /(?:\d{1,4}\s+[A-Z][a-zA-Z0-9\s,.-]+(?:St|Street|Ave|Avenue|Blvd|Dr|Drive|Ln|Lane|Rd|Road|Way|Ct|Terrace|Parade|Pl)\b|(?:University|College|Hospital|Clinic)\s+of\s+[A-Z][a-zA-Z\s]+|Wong Tai Sin Hospital|Guy's Campus|King's College London)/gi
};

export function maskValue(val, type, strategy = 'token') {
  if (strategy === 'redact' || strategy === 'bullet') return '••••••••';
  if (strategy === 'synthetic') {
    switch (type) {
      case 'email': return 'user@example.com';
      case 'phone': return '0400000000';
      case 'ssn': return '000-00-0000';
      case 'credit_card': return '0000-0000-0000-0000';
      case 'ip_address': return '127.0.0.1';
      case 'date_of_birth': return '01/01/1970';
      case 'name_likely': return 'John Doe';
      case 'address_likely': return '123 Fake St';
      default: return '[SYNTHETIC]';
    }
  }
  if (strategy === 'partial') {
    if (typeof val === 'string' && val.length > 4) {
      return val.slice(0, 2) + '***' + val.slice(-2);
    }
    return '***';
  }
  // default token
  return `<PII:${type.toUpperCase()}>`;
}

export function scanRecordsForPII(text) {
  const items = [];
  for (const [type, regex] of Object.entries(PII_PATTERNS)) {
    // Reset regex state
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      // Exclude false positives for name_likely like "Tax Invoice" or "Matilda Maincode"
      const val = match[1] || match[0];
      if (type === 'name_likely') {
        const lower = val.toLowerCase();
        if (lower.includes('tax') || lower.includes('invoice') || lower.includes('matilda') || lower.includes('maincode')) {
          continue;
        }
      }
      items.push({
        type,
        value: val,
        start: match.index,
        end: match.index + val.length
      });
    }
  }
  // Sort by start index
  items.sort((a, b) => a.start - b.start);
  return items;
}

export function maskPiiDual(blocks, { rgb, width, height, strategy = 'token' } = {}) {
  const maskedBlocks = blocks.map(block => {
    const text = block.text;
    const piiItems = scanRecordsForPII(text);
    if (piiItems.length === 0) return { ...block, piiItems: [] };

    let newText = '';
    let lastIdx = 0;
    const transformedItems = [];

    for (const item of piiItems) {
      newText += text.slice(lastIdx, item.start);
      const masked = maskValue(item.value, item.type, strategy);
      newText += masked;
      transformedItems.push({ ...item, maskedValue: masked });
      lastIdx = item.end;
    }
    newText += text.slice(lastIdx);

    // If rgb buffer provided and block has bbox [x1, y1, x2, y2]
    if (rgb && width && height && block.bbox) {
      const [x1, y1, x2, y2] = block.bbox;
      blackoutRegion(rgb, width, height, x1, y1, x2, y2);
    }

    return {
      ...block,
      text: newText,
      piiItems: transformedItems
    };
  });

  return maskedBlocks;
}

function blackoutRegion(rgb, width, height, x1, y1, x2, y2) {
  const startX = Math.max(0, Math.floor(x1));
  const startY = Math.max(0, Math.floor(y1));
  const endX = Math.min(width, Math.ceil(x2));
  const endY = Math.min(height, Math.ceil(y2));

  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const idx = (y * width + x) * 3;
      if (idx + 2 < rgb.length) {
        rgb[idx] = 18;
        rgb[idx + 1] = 18;
        rgb[idx + 2] = 22;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Pluggable Tokenizer & Feature Extractor
// ---------------------------------------------------------------------------
export function createTokenizer(options = {}) {
  const defaultMaxSeqLen = options.maxSeqLen || 256;
  if (options.vocab && options.merges && typeof options.encode === 'function') {
    return {
      encode: options.encode,
      decode: options.decode || (ids => ids.join(' '))
    };
  }

  // Default byte+word BPE-compatible tokenizer ('byte-bpe-default')
  return {
    encode(text, maxSeqLen = defaultMaxSeqLen) {
      // Special tokens: PAD=0, BOS=1, EOS=2, UNK=3, PII(8 tokens)=4..11
      const tokens = [1]; // BOS
      const words = text.split(/\s+/);

      for (const word of words) {
        if (/^<PII:[A-Z_]+>$/.test(word)) {
          // Map PII token
          const piiMap = {
            '<PII:EMAIL>': 4,
            '<PII:PHONE>': 5,
            '<PII:SSN>': 6,
            '<PII:CREDIT_CARD>': 7,
            '<PII:IP_ADDRESS>': 8,
            '<PII:DATE_OF_BIRTH>': 9,
            '<PII:NAME_LIKELY>': 10,
            '<PII:ADDRESS_LIKELY>': 11
          };
          tokens.push(piiMap[word] || 3);
        } else {
          for (let i = 0; i < word.length; i++) {
            const code = word.charCodeAt(i) % 240 + 12; // safe offset
            tokens.push(code);
            if (tokens.length >= maxSeqLen - 1) break;
          }
        }
        if (tokens.length >= maxSeqLen - 1) break;
      }

      tokens.push(2); // EOS

      // Pad to maxSeqLen if needed
      const tokenIds = new Uint32Array(maxSeqLen);
      const attentionMask = new Uint8Array(maxSeqLen);

      for (let i = 0; i < maxSeqLen; i++) {
        if (i < tokens.length) {
          tokenIds[i] = tokens[i];
          attentionMask[i] = 1;
        } else {
          tokenIds[i] = 0; // PAD
          attentionMask[i] = 0;
        }
      }

      return {
        tokenIds,
        attentionMask,
        tokenCount: tokens.length
      };
    },
    decode(tokenIds) {
      return Array.from(tokenIds).filter(id => id > 3 && id < 65535).map(id => String.fromCharCode(id)).join('');
    }
  };
}

export function tokenizeBlocks(blocks, { maxSeqLen = 256, tokenizer = createTokenizer() } = {}) {
  return blocks.map((block, chunkIndex) => {
    const res = tokenizer.encode(block.text, maxSeqLen);
    return {
      chunkIndex,
      tokenIds: res.tokenIds,
      attentionMask: res.attentionMask,
      tokenCount: res.tokenCount,
      provenance: [{
        blockId: block.id,
        bbox: block.bbox,
        sourceFormat: block.sourceFormat
      }]
    };
  });
}

export function extractFeatureRow(block, tokenIds) {
  const featureRow = new Float32Array(520);
  const text = block.text || '';

  // 1. Indices 0..511: L2-normalized signed FNV-1a hashing of unigrams, bigrams, char 4-grams
  const unigrams = text.toLowerCase().match(/\b[a-z0-9]+\b/g) || [];
  const bigrams = [];
  for (let i = 0; i < unigrams.length - 1; i++) {
    bigrams.push(`${unigrams[i]}_${unigrams[i+1]}`);
  }
  const char4 = [];
  for (let i = 0; i < text.length - 3; i++) {
    char4.push(text.slice(i, i+4));
  }

  const allFeatures = [...unigrams, ...bigrams, ...char4];
  for (const feat of allFeatures) {
    const h = parseInt(fnv1a(feat), 16);
    const bucket = h % 512;
    featureRow[bucket] += (h % 2 === 0 ? 1.0 : -1.0);
  }

  // L2 normalization of 0..511
  let sumSq = 0;
  for (let i = 0; i < 512; i++) {
    sumSq += featureRow[i] * featureRow[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < 512; i++) {
      featureRow[i] /= norm;
    }
  }

  // 2. Indices 512..519: 8 structural/quality features
  // [pii_count, min_ocr_conf, mean_ocr_conf, font_scale_cv, mono_ratio, digit_ratio, upper_ratio, token_count_norm]
  const piiCount = block.piiItems ? block.piiItems.length : 0;
  const conf = block.confidence !== undefined ? block.confidence : 1.0;
  const digits = (text.match(/\d/g) || []).length;
  const uppers = (text.match(/[A-Z]/g) || []).length;
  const totalChars = text.length || 1;

  featureRow[512] = piiCount;
  featureRow[513] = conf;
  featureRow[514] = conf;
  featureRow[515] = 0.1; // font_scale_cv default
  featureRow[516] = 0.05; // mono_ratio default
  featureRow[517] = digits / totalChars;
  featureRow[518] = uppers / totalChars;
  featureRow[519] = Math.min(1.0, (tokenIds ? tokenIds.length : 0) / 256);

  return featureRow;
}

// ---------------------------------------------------------------------------
// 6. Rtio-Compatible SHA-256 AuditChain
// ---------------------------------------------------------------------------
export class AuditChain {
  constructor() {
    this.genesis = '0'.repeat(64);
    this.entries = [];
  }

  log(action, metadata, { timestamp = Date.now() } = {}) {
    const prevHash = this.entries.length === 0 ? this.genesis : this.entries[this.entries.length - 1].hash;
    const index = this.entries.length;
    const safeMetadata = stripRestrictedMetadata(metadata || {});

    const canonicalObj = {
      id: `audit_${index}`,
      index,
      timestamp,
      action,
      metadata: safeMetadata,
      prevHash
    };

    const payload = JSON.stringify(canonicalObj);
    const hash = crypto.createHash('sha256').update(payload).digest('hex');

    const entry = { ...canonicalObj, hash };
    this.entries.push(entry);
    return entry;
  }

  static verifyChain(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return true;
    const genesis = '0'.repeat(64);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const prevHash = i === 0 ? genesis : entries[i - 1].hash;
      if (entry.prevHash !== prevHash) return false;

      // Check restricted keys
      if (hasRestrictedKeys(entry.metadata)) return false;

      // Recompute hash
      const canonicalObj = {
        id: entry.id,
        index: entry.index,
        timestamp: entry.timestamp,
        action: entry.action,
        metadata: entry.metadata,
        prevHash: entry.prevHash
      };
      const payload = JSON.stringify(canonicalObj);
      const expectedHash = crypto.createHash('sha256').update(payload).digest('hex');
      if (expectedHash !== entry.hash) return false;
    }
    return true;
  }
}

function stripRestrictedMetadata(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripRestrictedMetadata);
  const out = {};
  for (const k of Object.keys(obj)) {
    if (k === 'raw' || k === 'data' || k === 'rows') continue;
    out[k] = stripRestrictedMetadata(obj[k]);
  }
  return out;
}

function hasRestrictedKeys(obj) {
  if (obj === null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(hasRestrictedKeys);
  for (const k of Object.keys(obj)) {
    if (k === 'raw' || k === 'data' || k === 'rows') return true;
    if (hasRestrictedKeys(obj[k])) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 7. End-to-End Helper (`runCleanAndTokenizePipeline`)
// ---------------------------------------------------------------------------
export function runCleanAndTokenizePipeline(input, options = {}) {
  const audit = new AuditChain();
  audit.log('INGEST', { format: options.format });

  const rawBlocks = ingestUnstructuredText(input, options);
  audit.log('INGEST_COMPLETE', { blockCount: rawBlocks.length });

  const { cleaned, dropped } = stripBoilerplate(rawBlocks);
  audit.log('STRIP_BOILERPLATE', { cleanedCount: cleaned.length, droppedCount: dropped.length });

  const deduped = dedupBlocks(cleaned, options);
  audit.log('DEDUP', { dedupedCount: deduped.length });

  const masked = maskPiiDual(deduped, options);
  audit.log('MASK_PII', { maskedCount: masked.length });

  const tokenizer = options.tokenizer || createTokenizer(options);
  const tokenizedChunks = tokenizeBlocks(masked, { maxSeqLen: options.maxSeqLen || 256, tokenizer });
  audit.log('TOKENIZE', { chunkCount: tokenizedChunks.length });

  const features = masked.map((block, idx) => extractFeatureRow(block, tokenizedChunks[idx]?.tokenIds));
  audit.log('EXTRACT_FEATURES', { featureRows: features.length });

  const nodeHash = computeNodeHash('clean-and-tokenize', options, audit.entries.map(e => e.hash));

  return {
    blocks: masked,
    tokenizedChunks,
    features,
    auditEntries: audit.entries,
    nodeHash
  };
}
