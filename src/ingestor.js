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
// 2. Zero-Dependency Word (.docx) Ingestion
// ---------------------------------------------------------------------------
export function extractDocxText(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('extractDocxText requires a Node Buffer');
  }

  // Scan ZIP local file headers (signature 0x04034b50)
  let offset = 0;
  let xmlContent = null;

  while (offset < buffer.length - 30) {
    const sig = buffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) {
      offset++;
      continue;
    }

    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraFieldLength = buffer.readUInt16LE(offset + 28);

    const fileNameOffset = offset + 30;
    const fileName = buffer.toString('utf8', fileNameOffset, fileNameOffset + fileNameLength);
    const dataOffset = fileNameOffset + fileNameLength + extraFieldLength;

    if (fileName === 'word/document.xml') {
      const fileData = buffer.slice(dataOffset, dataOffset + compressedSize);
      if (compressionMethod === 8) {
        // Deflated
        const inflated = zlib.inflateRawSync(fileData);
        xmlContent = inflated.toString('utf8');
      } else if (compressionMethod === 0) {
        // Stored
        xmlContent = fileData.toString('utf8');
      }
      break;
    }

    offset = dataOffset + compressedSize;
  }

  if (!xmlContent) {
    throw new Error('DOCX_PARSE_FAILED: word/document.xml not found in ZIP archive');
  }

  // Extract paragraphs <w:p>...</w:p> and text <w:t>...</w:t>
  const paragraphs = [];
  const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  let pMatch;

  while ((pMatch = pRegex.exec(xmlContent)) !== null) {
    const pContent = pMatch[1];
    const tRegex = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi;
    let tMatch;
    let pText = '';
    while ((tMatch = tRegex.exec(pContent)) !== null) {
      pText += tMatch[1];
    }
    const trimmed = pText.trim();
    if (trimmed) {
      paragraphs.push(trimmed);
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
