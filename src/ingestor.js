import crypto from 'node:crypto';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// 1. Real URL & Link-List Capture (NO Silent Fallback)
// ---------------------------------------------------------------------------
export async function ingestUrl(url, options = {}) {
  let res;
  try {
    res = await fetch(url, { headers: options.headers || {} });
  } catch (err) {
    throw new Error(`URL_FETCH_FAILED: Failed to fetch ${url} - ${err.message}`);
  }
  if (!res.ok) {
    throw new Error(`URL_FETCH_FAILED: ${url} returned non-2xx status ${res.status} ${res.statusText}`);
  }
  const html = await res.text();
  return stripHtmlBoilerplate(html, { url });
}

export async function ingestLinkList(urls, options = {}) {
  const results = [];
  for (const url of urls) {
    try {
      const res = await ingestUrl(url, options);
      results.push({ url, success: true, ...res });
    } catch (err) {
      if (options.throwOnError) {
        throw err;
      }
      results.push({ url, success: false, error: err.message });
    }
  }
  return results;
}

export function stripHtmlBoilerplate(html, options = {}) {
  const rawBytes = Buffer.byteLength(html, 'utf8');

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : (options.url || 'Untitled');

  // Extract links <a href="...">
  const links = [];
  const linkRegex = /<a\s+(?:[^>]*?\s+)?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({ href: match[1], text: match[2].replace(/<[^>]+>/g, '').trim() });
  }

  // Strip boilerplate tags: script, style, nav, header, footer, aside, noscript, svg, form
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '');

  // Replace block tags with newlines
  cleaned = cleaned.replace(/<\/?(p|div|li|tr|h[1-6]|br|article|section)\b[^>]*>/gi, '\n');

  // Strip remaining HTML tags
  const plainText = cleaned.replace(/<[^>]+>/g, '');

  // Decode basic HTML entities
  const decoded = plainText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  const lines = decoded.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const boilerplateStrippedBytes = Buffer.byteLength(lines.join('\n'), 'utf8');

  return {
    sourceType: 'url',
    title,
    rawBytes,
    boilerplateStrippedBytes,
    lines,
    links,
    sha256: crypto.createHash('sha256').update(lines.join('\n')).digest('hex')
  };
}

// ---------------------------------------------------------------------------
// 2. Zero-Dependency Word (.docx) Ingestion (Central Directory + Bit-3 + Bomb Guard)
// ---------------------------------------------------------------------------
function decodeXmlEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return '';
      return String.fromCodePoint(cp);
    })
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function findZipCentralDirectory(buffer) {
  const minPos = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      const commentLen = buffer.readUInt16LE(i + 20);
      if (i + 22 + commentLen <= buffer.length) {
        return {
          totalEntries: buffer.readUInt16LE(i + 10),
          cdSize: buffer.readUInt32LE(i + 12),
          cdOffset: buffer.readUInt32LE(i + 16),
        };
      }
    }
  }
  return null;
}

function locateEntryViaCentralDirectory(buffer, targetName) {
  const eocd = findZipCentralDirectory(buffer);
  if (!eocd) return null;
  let pos = eocd.cdOffset;
  const cdEnd = Math.min(buffer.length, eocd.cdOffset + eocd.cdSize);
  let fallbackMatch = null;

  for (let idx = 0; idx < eocd.totalEntries && pos + 46 <= cdEnd; idx++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const flags = buffer.readUInt16LE(pos + 8);
    const compressionMethod = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const fileNameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const fileName = buffer.toString('utf8', pos + 46, pos + 46 + fileNameLen);

    const entry = {
      fileName,
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    };
    if (fileName === targetName) return entry;
    if (!fallbackMatch && fileName.toLowerCase() === targetName) fallbackMatch = entry;
    pos += 46 + fileNameLen + extraLen + commentLen;
  }
  return fallbackMatch;
}

function inflateZipEntrySafe(buffer, dataOffset, compressionMethod, compressedSize, uncompressedSize, options) {
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 32 * 1024 * 1024;
  const maxCompressionRatio = options.maxCompressionRatio ?? 250;
  if (dataOffset < 0 || compressedSize < 0 || dataOffset + compressedSize > buffer.length) {
    throw new Error('DOCX_PARSE_FAILED: ZIP entry bounds exceed archive buffer');
  }
  if (uncompressedSize > maxUncompressedBytes) {
    throw new Error(`DOCX_ZIP_BOMB_DETECTED: Declared uncompressed size (${uncompressedSize}) exceeds limit (${maxUncompressedBytes})`);
  }
  const fileData = buffer.subarray(dataOffset, dataOffset + compressedSize);
  let inflated;
  if (compressionMethod === 8) {
    try {
      inflated = zlib.inflateRawSync(fileData, { maxOutputLength: maxUncompressedBytes });
    } catch (err) {
      if (/maxOutputLength|too large|buffer/i.test(err.message)) {
        throw new Error(`DOCX_ZIP_BOMB_DETECTED: Decompressed stream exceeds limit (${maxUncompressedBytes}): ${err.message}`);
      }
      throw err;
    }
  } else if (compressionMethod === 0) {
    inflated = fileData;
    if (inflated.length > maxUncompressedBytes) {
      throw new Error(`DOCX_ZIP_BOMB_DETECTED: Stored entry exceeds limit (${maxUncompressedBytes})`);
    }
  } else {
    throw new Error(`DOCX_PARSE_FAILED: Unsupported ZIP compression method ${compressionMethod}`);
  }
  const ratio = inflated.length / Math.max(compressedSize, 1024);
  if (ratio > maxCompressionRatio) {
    throw new Error(`DOCX_ZIP_BOMB_DETECTED: Compression ratio ${ratio.toFixed(1)}x exceeds max ${maxCompressionRatio}x`);
  }
  return inflated.toString('utf8');
}

export function extractDocxText(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('extractDocxText requires a Node Buffer');
  }

  let xmlContent = null;
  const cdEntry = locateEntryViaCentralDirectory(buffer, 'word/document.xml');
  if (cdEntry) {
    const lfhOff = cdEntry.localHeaderOffset;
    if (lfhOff + 30 > buffer.length || buffer.readUInt32LE(lfhOff) !== 0x04034b50) {
      throw new Error('DOCX_PARSE_FAILED: Corrupt Local File Header referenced by Central Directory');
    }
    const lfhNameLen = buffer.readUInt16LE(lfhOff + 26);
    const lfhExtraLen = buffer.readUInt16LE(lfhOff + 28);
    const dataOffset = lfhOff + 30 + lfhNameLen + lfhExtraLen;
    xmlContent = inflateZipEntrySafe(
      buffer,
      dataOffset,
      cdEntry.compressionMethod,
      cdEntry.compressedSize,
      cdEntry.uncompressedSize,
      options
    );
  } else {
    // Legacy LFH-only fallback only when bit-3 data descriptor is NOT set
    let offset = 0;
    while (offset < buffer.length - 30) {
      if (buffer.readUInt32LE(offset) !== 0x04034b50) {
        offset++;
        continue;
      }
      const flags = buffer.readUInt16LE(offset + 6);
      const compressionMethod = buffer.readUInt16LE(offset + 8);
      const compressedSize = buffer.readUInt32LE(offset + 18);
      const uncompressedSize = buffer.readUInt32LE(offset + 22);
      const fileNameLength = buffer.readUInt16LE(offset + 26);
      const extraFieldLength = buffer.readUInt16LE(offset + 28);
      const fileNameOffset = offset + 30;
      const fileName = buffer.toString('utf8', fileNameOffset, fileNameOffset + fileNameLength);
      const dataOffset = fileNameOffset + fileNameLength + extraFieldLength;

      if (fileName === 'word/document.xml') {
        if ((flags & 0x0008) !== 0 && compressedSize === 0) {
          throw new Error('DOCX_PARSE_FAILED: Bit-3 Data Descriptor entry requires ZIP Central Directory');
        }
        xmlContent = inflateZipEntrySafe(buffer, dataOffset, compressionMethod, compressedSize, uncompressedSize, options);
        break;
      }
      offset = dataOffset + compressedSize;
    }
  }

  if (!xmlContent) {
    throw new Error('DOCX_PARSE_FAILED: word/document.xml not found in ZIP archive');
  }

  // Extract paragraphs <w:p>...</w:p>, preserve <w:t> runs, <w:tab/>, <w:br/>, <w:cr/>, exclude <w:delText>/<w:instrText>
  const paragraphs = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  let pMatch;

  while ((pMatch = pRegex.exec(xmlContent)) !== null) {
    const cleanedParaXml = pMatch[1]
      .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/gi, '')
      .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/gi, '');

    const tokRegex = /<(w:t|w:tab|w:br|w:cr)\b[^>]*(?:\/>|>([\s\S]*?)<\/\1>)/gi;
    let tok;
    let pText = '';
    while ((tok = tokRegex.exec(cleanedParaXml)) !== null) {
      const tag = tok[1].toLowerCase();
      if (tag === 'w:tab') pText += '\t';
      else if (tag === 'w:br' || tag === 'w:cr') pText += '\n';
      else if (tok[2] !== undefined) pText += decodeXmlEntities(tok[2]);
    }
    for (const sub of pText.split(/\n/)) {
      const trimmed = sub.trim();
      if (trimmed) paragraphs.push(trimmed);
    }
  }

  const rawBytes = buffer.length;
  const textJoined = paragraphs.join('\n');
  const boilerplateStrippedBytes = Buffer.byteLength(textJoined, 'utf8');

  return {
    sourceType: 'docx',
    rawBytes,
    boilerplateStrippedBytes,
    lines: paragraphs,
    sha256: crypto.createHash('sha256').update(textJoined).digest('hex')
  };
}

// ---------------------------------------------------------------------------
// 3. Deterministic Deduplication (Exact SHA-256 + Jaccard 3-gram Shingles)
// ---------------------------------------------------------------------------
export function computeShingles(text, k = 3) {
  const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
  const shingles = new Set();
  if (words.length < k) {
    shingles.add(words.join(' '));
    return shingles;
  }
  for (let i = 0; i <= words.length - k; i++) {
    shingles.add(words.slice(i, i + k).join(' '));
  }
  return shingles;
}

export function jaccardSimilarity(setA, setB) {
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

export function deduplicateChunks(chunks, options = {}) {
  const threshold = options.threshold ?? 0.85;
  const uniqueChunks = [];
  const duplicateIds = [];
  const seenHashes = new Set();
  const seenShingles = [];

  let duplicatesRemoved = 0;

  for (const chunk of chunks) {
    const text = chunk.text || chunk;
    const sha = crypto.createHash('sha256').update(text).digest('hex');

    if (seenHashes.has(sha)) {
      duplicatesRemoved++;
      duplicateIds.push(chunk.id || sha);
      continue;
    }

    const shingles = computeShingles(text);
    let isDuplicate = false;

    for (const existing of seenShingles) {
      const sim = jaccardSimilarity(shingles, existing);
      if (sim >= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (isDuplicate) {
      duplicatesRemoved++;
      duplicateIds.push(chunk.id || sha);
    } else {
      seenHashes.add(sha);
      seenShingles.push(shingles);
      uniqueChunks.push(chunk);
    }
  }

  return {
    uniqueChunks,
    duplicatesRemoved,
    duplicateIds
  };
}

// ---------------------------------------------------------------------------
// 4. Counts-and-Sources Manifest (`buildCorpusManifest`)
// ---------------------------------------------------------------------------
export function buildCorpusManifest(results = []) {
  const sources = results.map(r => ({
    sourceId: r.sourceId || r.id || 'src_unknown',
    sourceType: r.sourceType || 'text',
    rawBytes: r.rawBytes || 0,
    boilerplateStrippedBytes: r.boilerplateStrippedBytes || 0,
    chunksExtracted: r.chunksExtracted || r.lines?.length || 0,
    duplicatesRemoved: r.duplicatesRemoved || 0,
    piiSpansMasked: r.piiSpansMasked || 0,
    keepSafeCount: r.keepSafeCount || 0,
    abstainCount: r.abstainCount || 0,
    dropCount: r.dropCount || 0,
    tokenCount: r.tokenCount || 0,
    sha256: r.sha256 || ''
  }));

  const aggregate = {
    totalSources: sources.length,
    totalRawBytes: sources.reduce((sum, s) => sum + s.rawBytes, 0),
    totalBoilerplateStrippedBytes: sources.reduce((sum, s) => sum + s.boilerplateStrippedBytes, 0),
    totalChunksExtracted: sources.reduce((sum, s) => sum + s.chunksExtracted, 0),
    totalDuplicatesRemoved: sources.reduce((sum, s) => sum + s.duplicatesRemoved, 0),
    totalPiiSpansMasked: sources.reduce((sum, s) => sum + s.piiSpansMasked, 0),
    totalKeepSafe: sources.reduce((sum, s) => sum + s.keepSafeCount, 0),
    totalAbstain: sources.reduce((sum, s) => sum + s.abstainCount, 0),
    totalDrop: sources.reduce((sum, s) => sum + s.dropCount, 0),
    totalTokens: sources.reduce((sum, s) => sum + s.tokenCount, 0),
    manifestSha256: ''
  };

  aggregate.manifestSha256 = crypto.createHash('sha256').update(JSON.stringify({ sources, aggregate })).digest('hex');

  return {
    sources,
    aggregate
  };
}
