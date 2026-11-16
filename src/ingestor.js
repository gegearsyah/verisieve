import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import zlib from 'node:zlib';

// ---------------------------------------------------------------------------
// 1. SSRF-Hardened URL & Link-List Capture (Zero Local Fallback)
// ---------------------------------------------------------------------------
const DISALLOWED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
]);

function ipv4ToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const oct = Number(part);
    if (oct < 0 || oct > 255) return null;
    n = (n << 8) | oct;
  }
  return n >>> 0;
}

function inCidr4(ipInt, base, maskBits) {
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isDisallowedIpAddress(rawIp) {
  if (typeof rawIp !== 'string') return true;
  const ip = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0].toLowerCase();
  const ver = net.isIP(ip);
  if (ver === 4) {
    const n = ipv4ToInt(ip);
    if (n === null) return true;
    return (
      inCidr4(n, '0.0.0.0', 8) ||
      inCidr4(n, '10.0.0.0', 8) ||
      inCidr4(n, '100.64.0.0', 10) ||
      inCidr4(n, '127.0.0.0', 8) ||
      inCidr4(n, '169.254.0.0', 16) ||
      inCidr4(n, '172.16.0.0', 12) ||
      inCidr4(n, '192.0.0.0', 24) ||
      inCidr4(n, '192.168.0.0', 16) ||
      inCidr4(n, '198.18.0.0', 15) ||
      inCidr4(n, '224.0.0.0', 4) ||
      inCidr4(n, '240.0.0.0', 4)
    );
  }

  if (ver === 6) {
    if (ip === '::' || ip === '::1') return true;
    if (ip.startsWith('::ffff:')) {
      const suffix = ip.slice('::ffff:'.length);
      if (net.isIP(suffix) === 4) return isDisallowedIpAddress(suffix);
      const hexParts = suffix.split(':');
      if (hexParts.length === 2) {
        const hi = parseInt(hexParts[0], 16);
        const lo = parseInt(hexParts[1], 16);
        if (Number.isFinite(hi) && Number.isFinite(lo)) {
          const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
          return isDisallowedIpAddress(v4);
        }
      }
    }
    const firstHextet = parseInt(ip.split(':')[0] || '0', 16);
    if (!Number.isFinite(firstHextet)) return true;
    if ((firstHextet & 0xfe00) === 0xfc00) return true;
    if ((firstHextet & 0xffc0) === 0xfe80) return true;
    if ((firstHextet & 0xff00) === 0xff00) return true;
    return false;
  }

  return true;
}

function isLoopbackHostOrIp(host) {
  const clean = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (clean === 'localhost' || clean === 'localhost.localdomain' || clean === '::1') return true;
  if (net.isIP(clean) === 4) {
    const n = ipv4ToInt(clean);
    return n !== null && inCidr4(n, '127.0.0.0', 8);
  }
  return false;
}

export function validatePublicUrlTarget(rawUrl, options = {}) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    throw new Error(`URL_SSRF_BLOCKED: Invalid URL (${err.message})`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`URL_SSRF_BLOCKED: Invalid protocol ${parsed.protocol} (only http/https supported)`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL_SSRF_BLOCKED: Embedded credentials in URL are not allowed');
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (options.allowPrivateNetworkForTest === true && isLoopbackHostOrIp(host)) {
    return parsed;
  }

  if (
    !host ||
    DISALLOWED_HOSTNAMES.has(host) ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    throw new Error(`URL_SSRF_BLOCKED: Blocked internal hostname: ${host || '(empty)'}`);
  }

  if (net.isIP(host)) {
    if (isDisallowedIpAddress(host)) {
      throw new Error(`URL_SSRF_BLOCKED: Blocked private or loopback IP address: ${host}`);
    }
  } else if (!host.includes('.')) {
    throw new Error(`URL_SSRF_BLOCKED: Blocked single-label internal hostname: ${host}`);
  }

  return parsed;
}

const defaultDnsLookup = (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

export async function assertSafePublicUrl(rawUrl, options = {}) {
  const parsed = validatePublicUrlTarget(rawUrl, options);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (options.allowPrivateNetworkForTest === true && isLoopbackHostOrIp(host)) {
    return parsed;
  }
  if (net.isIP(host)) {
    return parsed;
  }

  const lookupFn = typeof options.lookupFn === 'function' ? options.lookupFn : defaultDnsLookup;
  let records;
  try {
    records = await lookupFn(host);
  } catch (err) {
    throw new Error(`URL_FETCH_FAILED: DNS lookup failed for ${host} - ${err.message}`);
  }
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`URL_FETCH_FAILED: DNS resolution returned no addresses for ${host}`);
  }
  for (const rec of records) {
    if (isDisallowedIpAddress(rec.address)) {
      throw new Error(`URL_SSRF_BLOCKED: Target ${host} resolved to disallowed IP ${rec.address}`);
    }
  }
  return parsed;
}

async function readResponseWithLimit(res, maxBytes) {
  const clHeader = res.headers?.get?.('content-length');
  if (clHeader !== null && clHeader !== undefined && clHeader !== '') {
    const declared = Number(clHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel?.();
      throw new Error(`URL_RESPONSE_TOO_LARGE: Content-Length (${declared}) exceeds limit (${maxBytes})`);
    }
  }

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const bufChunk = Buffer.from(value);
        total += bufChunk.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new Error(`URL_RESPONSE_TOO_LARGE: Response body exceeds limit (${maxBytes})`);
        }
        chunks.push(bufChunk);
      }
      return Buffer.concat(chunks, total);
    } catch (err) {
      try {
        await reader.cancel();
      } catch {
        // Ignore cleanup errors
      }
      throw err;
    }
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) {
    throw new Error(`URL_RESPONSE_TOO_LARGE: Response body (${buf.length}) exceeds limit (${maxBytes})`);
  }
  return buf;
}

const TYPED_URL_ERROR_RE = /^(URL_SSRF_BLOCKED|URL_REDIRECT_LIMIT|URL_RESPONSE_TOO_LARGE|URL_FETCH_FAILED):/;

export async function fetchSafeUrlResponse(rawUrl, options = {}) {
  const maxRedirects = Number.isInteger(options.maxRedirects) && options.maxRedirects >= 0 ? options.maxRedirects : 5;
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0 ? options.maxBytes : 10 * 1024 * 1024;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 8000;
  const fetchFn = typeof options.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;

  let currentUrl = String(rawUrl || '');
  for (let hop = 0; ; hop++) {
    await assertSafePublicUrl(currentUrl, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetchFn(currentUrl, {
        headers: options.headers || {},
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (TYPED_URL_ERROR_RE.test(err.message || '')) {
        throw err;
      }
      const reason = err?.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : err.message;
      throw new Error(`URL_FETCH_FAILED: Failed to fetch ${currentUrl} - ${reason}`);
    }
    clearTimeout(timer);

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers?.get?.('location');
      await res.body?.cancel?.();
      if (!location) {
        throw new Error(`URL_FETCH_FAILED: Redirect ${res.status} missing Location header at ${currentUrl}`);
      }
      if (hop >= maxRedirects) {
        throw new Error(`URL_REDIRECT_LIMIT: Exceeded maxRedirects (${maxRedirects}) starting at ${rawUrl}`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    if (!res.ok) {
      await res.body?.cancel?.();
      throw new Error(`URL_FETCH_FAILED: ${currentUrl} returned non-2xx status ${res.status} ${res.statusText || ''}`);
    }

    const bodyBuffer = await readResponseWithLimit(res, maxBytes);
    return {
      url: rawUrl,
      finalUrl: currentUrl,
      status: res.status,
      contentType: res.headers?.get?.('content-type') || '',
      bodyBuffer,
    };
  }
}

export async function ingestUrl(url, options = {}) {
  const fetched = await fetchSafeUrlResponse(url, options);
  const html = fetched.bodyBuffer.toString('utf8');
  const stripped = stripHtmlBoilerplate(html, { url: fetched.finalUrl });
  return {
    ...stripped,
    url,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    contentType: fetched.contentType,
  };
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
      const code = (err.message.match(/^([A-Z0-9_]+):/) || [])[1] || 'URL_FETCH_FAILED';
      results.push({ url, success: false, code, error: err.message });
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
  const cleanText = lines.join('\n');
  const boilerplateStrippedBytes = Buffer.byteLength(cleanText, 'utf8');

  return {
    sourceType: 'url',
    title,
    rawBytes,
    boilerplateStrippedBytes,
    lines,
    cleanText,
    links,
    sha256: crypto.createHash('sha256').update(cleanText).digest('hex')
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
