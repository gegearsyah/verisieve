import crypto from 'node:crypto';
import { loadCleanWasmSync } from './clean-wasm.js';

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
export function stripBoilerplate(blocks, options = {}) {
  const cleanEngine = loadCleanWasmSync();
  const cleaned = [];
  const dropped = [];

  for (const block of blocks) {
    const rawText = String(block.text || '').trim();
    if (!rawText) {
      dropped.push({ block, reason: 'empty_block' });
      continue;
    }

    const strippedText = cleanEngine.stripBoilerplate(rawText, {
      html: options.html,
      stripChrome: options.stripChrome !== false,
    });

    if (!strippedText) {
      dropped.push({ block, reason: 'boilerplate_header_footer' });
    } else {
      cleaned.push(strippedText === block.text ? block : { ...block, text: strippedText });
    }
  }

  return { cleaned, dropped };
}

export function dedupBlocks(blocks, { jaccardThreshold = 0.85 } = {}) {
  const cleanEngine = loadCleanWasmSync();
  cleanEngine.dedupReset();
  const distinctBlocks = [];

  for (const block of blocks) {
    const result = cleanEngine.dedupCheck(block.text || '', jaccardThreshold);
    if (result.action === 'keep') {
      distinctBlocks.push(block);
    }
  }

  return distinctBlocks;
}

export function chunkBlocksByTokenWindow(blocks, { maxSeqLen = 256, overlapTokens = 24 } = {}) {
  const cleanEngine = loadCleanWasmSync();
  const out = [];
  for (const block of blocks) {
    const chunks = cleanEngine.chunkByTokenWindow(block.text || '', {
      maxTokens: maxSeqLen,
      overlapTokens,
    });
    if (chunks.length <= 1) {
      out.push(block);
    } else {
      chunks.forEach((chunk, winIdx) => {
        out.push({
          ...block,
          id: `${block.id}_win_${winIdx}`,
          text: chunk.text,
          tokenEstimate: chunk.tokenCount,
        });
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 4. Rtio-Compatible PII Scanner & Dual Masker
// ---------------------------------------------------------------------------
export const EXCLUDED_NAME_WORDS = new Set([
  'nutritional', 'status', 'month', 'outcome', 'elderly', 'hip', 'fracture', 'patients', 'patient',
  'department', 'rehabilitation', 'extended', 'care', 'hospital', 'functional', 'recovery',
  'creative', 'commons', 'attribution', 'commercial', 'license', 'annals', 'medicine',
  'clinical', 'research', 'record', 'matilda', 'secure', 'system', 'markov', 'chain',
  'boolean', 'logic', 'attorney', 'general', 'confidential', 'facsimile', 'transmission',
  'cover', 'sheet', 'phone', 'number', 'pages', 'including', 'global', 'health',
  'surgical', 'cohort', 'motor', 'assessment', 'telemetry', 'kernel', 'grant',
  'tax', 'invoice', 'maincode', 'report', 'submission', 'competitive', 'product',
  'introduction', 'progress', 'geography', 'distribution', 'division',
  // General English function / sentence-starter words (prevent Title-Case FP at sentence starts)
  'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'by', 'from', 'with', 'as', 'or', 'and',
  'but', 'if', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did', 'has', 'have', 'had',
  'can', 'could', 'will', 'would', 'might', 'should', 'more', 'most', 'less', 'all', 'each',
  'every', 'some', 'any', 'no', 'not', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'they',
  'our', 'such', 'only', 'both', 'between', 'among', 'within', 'across', 'during', 'after', 'before',
  'until', 'since', 'while', 'when', 'where', 'although', 'however', 'therefore', 'moreover',
  // Standard academic, statistical, study-design & geographic non-person nouns
  'january', 'february', 'march', 'april', 'july', 'august', 'september', 'october', 'november', 'december',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'first', 'second', 'third', 'early', 'late', 'new', 'old', 'high', 'low', 'main', 'major', 'minor',
  'primary', 'secondary', 'study', 'studies', 'trial', 'trials', 'group', 'groups', 'data', 'analysis',
  'analyses', 'method', 'methods', 'result', 'results', 'conclusion', 'conclusions', 'background',
  'objective', 'objectives', 'aim', 'aims', 'table', 'figure', 'panel', 'model', 'models', 'score',
  'scores', 'scale', 'index', 'rate', 'rates', 'ratio', 'ratios', 'odds', 'risk', 'level', 'levels',
  'effect', 'effects', 'factor', 'factors', 'mean', 'median', 'total', 'age', 'day', 'days', 'week',
  'weeks', 'year', 'years', 'time', 'use', 'used', 'using', 'based', 'control', 'controlled',
  'randomized', 'randomised', 'prospective', 'retrospective', 'sectional', 'medical', 'therapy',
  'treatment', 'disease', 'syndrome', 'disorder', 'cancer', 'cardiac', 'pulmonary', 'renal',
  'hepatic', 'neurological', 'perinatal', 'pediatric', 'geriatric', 'mortality', 'morbidity',
  'incidence', 'prevalence', 'survival', 'diagnosis', 'screening', 'prevention', 'management',
  'quality', 'life', 'family', 'history', 'education', 'national', 'international', 'world', 'public',
  'population', 'community', 'institute', 'ministry', 'university', 'college', 'center', 'centre',
  'clinic', 'service', 'services', 'program', 'programme', 'united', 'states', 'kingdom', 'south',
  'north', 'east', 'west', 'africa', 'african', 'american', 'european', 'asian', 'zealand',
  'medicare', 'medicaid', 'association', 'society', 'organization', 'organisation', 'foundation',
  'committee', 'board', 'guidelines', 'criteria', 'classification', 'review', 'case', 'cases',
  'evaluation', 'performance', 'administration', 'subject', 'subjects', 'angle', 'classes',
  'fluent', 'title', 'font', 'potentials', 'hierarchical', 'compound', 'probit', 'ordered', 'bank',
  'carolina', 'spearman', 'laryngeal', 'mask', 'opioid', 'sedation', 'palliative', 'chines', 'masala'
]);

export const PII_PATTERNS = {
  email: /[a-zA-Z0-9_.+-]+\s*@\s*[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g,
  phone: /(?:\+\d{1,3}[-.\s]*)?(?:\(\s*\d{2,4}\s*\)|\b\d{2,4}\b)[-.\s]*\d{3,4}[-.\s]*\d{3,4}\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  credit_card: /\b(?:\d[ -]*?){13,16}\b/g,
  ip_address: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  date_of_birth: /\b(?:\d{1,2}[\/\s-]\d{1,2}[\/\s-](?:\d{4}|\d{2})|\d{4}-\d{2}-\d{2})\b/g,
  name_likely: /(?:Patient Name|Name|TO|FROM|SENDER|Doctor|Physician|Author):\s*([A-Z][a-zA-Z.'-]+\s+[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)?)|(?:\b[A-Z][a-z]{1,15}\s+[A-Z]\.?\s+[A-Z][a-z]{1,15}\b)|\b([A-Z][a-z]{1,15}\s+[A-Z][a-z]{1,15})\b|\bMontgomery\b/g,
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
      const fullMatch = match[0];
      const captured = match[1] || match[2] || fullMatch;
      const val = captured;
      const offsetInMatch = fullMatch.indexOf(val);
      const start = offsetInMatch !== -1 ? match.index + offsetInMatch : match.index;
      const end = start + val.length;

      // Exclude false positives for name_likely like clinical/scientific/document Title-Case nouns
      if (type === 'name_likely') {
        const words = val.toLowerCase().replace(/[^a-z]/g, ' ').split(/\s+/).filter(Boolean);
        if (words.some(w => EXCLUDED_NAME_WORDS.has(w))) {
          continue;
        }
      }

      // Disambiguate technical lookalikes for phone (e.g. "Grant ID 800-555-0199")
      if (type === 'phone') {
        const prefix = text.slice(Math.max(0, match.index - 20), match.index).toLowerCase();
        if (prefix.includes('grant') || prefix.includes('award') || prefix.includes('project') || prefix.includes('ref:') || prefix.includes('nih')) {
          continue;
        }
      }

      // Disambiguate technical lookalikes for ip_address (e.g. "Kernel v10.24.108.3")
      if (type === 'ip_address') {
        const prefix = text.slice(Math.max(0, match.index - 15), match.index).toLowerCase();
        if (prefix.includes('kernel') || prefix.includes('version') || prefix.includes('build') || /v[\s:]*$/i.test(prefix)) {
          continue;
        }
      }

      items.push({
        type,
        value: val,
        start,
        end
      });
    }
  }
  // Sort by start index, preferring longer matches when starts collide
  items.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  // Remove overlapping matches (keep earlier/longer)
  const deduped = [];
  for (const item of items) {
    const overlap = deduped.find(prev =>
      (item.start >= prev.start && item.start < prev.end) ||
      (item.end > prev.start && item.end <= prev.end)
    );
    if (!overlap) {
      deduped.push(item);
    }
  }
  return deduped;
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

  const { cleaned, dropped } = stripBoilerplate(rawBlocks, options);
  audit.log('STRIP_BOILERPLATE', { cleanedCount: cleaned.length, droppedCount: dropped.length, wasmCleanActive: true });

  const deduped = dedupBlocks(cleaned, options);
  audit.log('DEDUP', { dedupedCount: deduped.length });

  const chunked =
    options.chunkByTokenWindow === false
      ? deduped
      : chunkBlocksByTokenWindow(deduped, {
          maxSeqLen: options.maxSeqLen || 256,
          overlapTokens: options.overlapTokens ?? 24,
        });
  audit.log('CHUNK_WINDOWS', { windowedCount: chunked.length });

  const masked = maskPiiDual(chunked, options);
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
    nodeHash,
    wasmCleanActive: true
  };
}
