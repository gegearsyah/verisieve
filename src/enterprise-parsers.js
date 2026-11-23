/**
 * Zero-dependency Deep Enterprise Multimodal Parsers powered by `verisieve_media.wasm` (ABI v1).
 *
 * Covers every enterprise unstructured data family + hidden forensic leak vectors:
 * - Email & Contacts: `.eml`, `.mbox`, `.msg` (CFBF/OLE2 via WASM), `.vcf`
 * - Office & Docs: `.docx` (forensic), `.pptx` (slides + speaker notes + hidden slides + comments + charts + SmartArt),
 *   `.xlsx` (sheets + hidden/veryHidden tabs + merged headers + threadedComments + pivotCache forensic audit),
 *   `.odt` / `.ods` / `.odp`, `.epub`
 * - Transcripts, Chat & SaaS: `.vtt`, `.srt`, Slack Export JSON, Jira/Zendesk/Teams JSON, `.ics` (RFC 5545)
 * - Engineering & Network: `.ipynb` (code + cell outputs!), `.har` (deep auth/cookie cleaner), `.env`, K8s `Secret` YAML (base64 data decode!), `.sql`
 * - Hardened Recursive Archives: `.zip`, `.tar`, `.tar.gz`, `.tgz` (max depth 2, bomb + Zip-Slip guards)
 */

import crypto from 'node:crypto';
import { loadMediaWasmSync } from './media-wasm.js';
import { formatDelimitedTableBlocks } from './structure-extractor.js';

const UTF8_DEC = new TextDecoder('utf-8', { fatal: false });
const LATIN1_DEC = new TextDecoder('latin1', { fatal: false });

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function decodeXmlEntities(text) {
  return String(text || '')
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
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripHtmlTags(html) {
  return decodeXmlEntities(
    String(html || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<div[^>]*class=["'][^"']*(?:gmail_quote|yahoo_quoted|OutlookMessageHeader)[^"']*["'][^>]*>[\s\S]*$/gi, '')
      .replace(/<\/?(p|div|li|tr|h[1-6]|br|blockquote|table|section|article)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function makeBlock({
  source,
  modality,
  breadcrumb,
  text,
  structRole = 'PROSE',
  timeRangeMs,
  wordTimestamps,
  speakerId,
  frameTimeMs,
  ocrBoxes,
  parentSource,
  threadId,
  tableHeaders,
  forensicSource,
}) {
  const clean = String(text || '').trim();
  if (!clean) return null;
  const block = {
    source,
    modality,
    breadcrumb: breadcrumb || source,
    text: clean,
    structRole,
    contentHash: sha256Hex(`${source}|${breadcrumb || ''}|${clean}`).slice(0, 16),
  };
  if (timeRangeMs) block.timeRangeMs = timeRangeMs;
  if (wordTimestamps) block.wordTimestamps = wordTimestamps;
  if (speakerId) block.speakerId = speakerId;
  if (frameTimeMs !== undefined) block.frameTimeMs = frameTimeMs;
  if (ocrBoxes) block.ocrBoxes = ocrBoxes;
  if (parentSource) block.parentSource = parentSource;
  if (threadId) block.threadId = threadId;
  if (tableHeaders) block.tableHeaders = tableHeaders;
  if (forensicSource) block.forensicSource = forensicSource;
  return block;
}

// ---------------------------------------------------------------------------
// 1. Email Suite: `.eml`, `.mbox`, `.msg` (CFBF via WASM), `.vcf`
// ---------------------------------------------------------------------------

export function decodeRfc2047(raw) {
  return String(raw || '').replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (_, charset, enc, payload) => {
      try {
        let bytes;
        if (enc.toUpperCase() === 'B') {
          bytes = Buffer.from(payload, 'base64');
        } else {
          const qp = payload.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__, h) =>
            String.fromCharCode(parseInt(h, 16))
          );
          bytes = Buffer.from(qp, 'latin1');
        }
        const cs = charset.toLowerCase();
        if (cs.includes('utf-8') || cs.includes('utf8')) return UTF8_DEC.decode(bytes);
        return LATIN1_DEC.decode(bytes);
      } catch {
        return payload;
      }
    }
  );
}

function decodeQuotedPrintable(raw) {
  const unfolded = String(raw || '').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let i = 0; i < unfolded.length; i++) {
    if (unfolded[i] === '=' && i + 2 < unfolded.length && /^[0-9A-Fa-f]{2}$/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(unfolded.charCodeAt(i) & 0xff);
    }
  }
  return UTF8_DEC.decode(Uint8Array.from(bytes));
}

function parseHeadersBlock(rawHeaderStr) {
  const headers = {};
  const received = [];
  // RFC 5322 header unfolding (CRLF followed by WSP)
  const unfolded = String(rawHeaderStr || '').replace(/\r?\n([ \t]+)/g, ' ');
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = decodeRfc2047(line.slice(idx + 1).trim());
    if (key === 'received') {
      received.push(val);
    } else if (!headers[key]) {
      headers[key] = val;
    } else {
      headers[key] += `, ${val}`;
    }
  }
  if (received.length > 0) headers._received = received;
  return headers;
}

function extractHeaderParam(headerVal, paramName) {
  if (!headerVal) return null;
  const rx = new RegExp(`${paramName}\\*?\\s*=\\s*(?:"([^"]+)"|'([^']+)'|([^;\\s]+))`, 'i');
  const m = String(headerVal).match(rx);
  if (!m) return null;
  let val = m[1] || m[2] || m[3] || '';
  // RFC 2231 charset'lang'percent-encoded
  const rfc2231 = val.match(/^[^']*'[^']*'(.*)$/);
  if (rfc2231) {
    try {
      val = decodeURIComponent(rfc2231[1]);
    } catch {
      val = rfc2231[1];
    }
  }
  return decodeRfc2047(val);
}

/**
 * Multi-locale reply-chain, Outlook header, signature, and legal disclaimer stripper.
 * Prevents 5x-10x duplicate PII leakage across long email threads.
 */
export function stripEmailReplyAndSignature(rawText) {
  const lines = String(rawText || '').split(/\r?\n/);
  const kept = [];
  let strippedQuotedLines = 0;
  let strippedSignatureLines = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Standard signature delimiter "-- " or mobile footer
    if (
      /^--\s*$/.test(line) ||
      /^_{4,}$/.test(trimmed) ||
      /^Sent from my (iPhone|iPad|Android|Samsung|Galaxy|BlackBerry|Mobile)/i.test(trimmed) ||
      /^Get Outlook for (iOS|Android)/i.test(trimmed)
    ) {
      strippedSignatureLines += lines.length - i;
      break;
    }

    // Legal confidentiality boilerplate footer
    if (
      /^(CONFIDENTIALITY NOTICE|DISCLAIMER|This e-?mail(?: message)?(?: and any attachments)? is confidential|Privileged\/Confidential Information)/i.test(
        trimmed
      )
    ) {
      strippedSignatureLines += lines.length - i;
      break;
    }

    // Multi-locale reply header markers (EN, DE, FR, ES, Outlook forwarded block)
    if (
      /^On .+ wrote:\s*$/i.test(trimmed) ||
      /^Am .+ schrieb .+:\s*$/i.test(trimmed) ||
      /^Le .+ a écrit\s*:\s*$/i.test(trimmed) ||
      /^El .+ escribió:\s*$/i.test(trimmed) ||
      /^-{3,}\s*(Original Message|Forwarded message|Begin forwarded message)\s*-{3,}$/i.test(trimmed) ||
      (/^From:\s+.+/.test(trimmed) && i + 1 < lines.length && /^(Sent|Date|To):\s+/i.test(lines[i + 1].trim()))
    ) {
      strippedQuotedLines += lines.length - i;
      break;
    }

    // Inline quoted lines (`> ...`)
    if (trimmed.startsWith('>')) {
      strippedQuotedLines++;
      continue;
    }

    kept.push(line);
  }

  return {
    visibleText: kept.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    strippedQuotedLines,
    strippedSignatureLines,
  };
}

function splitHeaderAndBody(rawStr) {
  const m = rawStr.match(/\r?\n\r?\n/);
  if (!m || m.index === undefined) {
    return { headerRaw: '', bodyRaw: rawStr };
  }
  return {
    headerRaw: rawStr.slice(0, m.index),
    bodyRaw: rawStr.slice(m.index + m[0].length),
  };
}

function parseMimeEntity(rawStr, depth = 0, out = { textParts: [], htmlParts: [], attachments: [], nestedEmails: [] }) {
  if (depth > 5) return out;
  const { headerRaw, bodyRaw } = splitHeaderAndBody(rawStr);
  const headers = parseHeadersBlock(headerRaw);
  const ct = String(headers['content-type'] || 'text/plain; charset=utf-8');
  const ctLower = ct.toLowerCase();
  const cte = String(headers['content-transfer-encoding'] || '').trim().toLowerCase();
  const cd = String(headers['content-disposition'] || '').toLowerCase();
  const filename = extractHeaderParam(headers['content-disposition'], 'filename') || extractHeaderParam(ct, 'name');

  if (ctLower.startsWith('multipart/')) {
    const boundary = extractHeaderParam(ct, 'boundary');
    if (boundary) {
      const escaped = boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = bodyRaw.split(new RegExp(`--${escaped}(?:--)?\\r?\\n?`));
      // Skip preamble (index 0) and epilogue
      for (let i = 1; i < parts.length; i++) {
        const part = parts[i];
        if (!part || part.trim() === '' || part.trim() === '--') continue;
        parseMimeEntity(part, depth + 1, out);
      }
      return out;
    }
  }

  if (ctLower.startsWith('message/rfc822')) {
    out.nestedEmails.push(bodyRaw);
    return out;
  }

  const isAttachment =
    cd.includes('attachment') ||
    (Boolean(filename) && !ctLower.startsWith('text/plain') && !ctLower.startsWith('text/html')) ||
    (ctLower.startsWith('image/') && (cd.includes('inline') || Boolean(headers['content-id'])));

  if (isAttachment) {
    let bytes;
    if (cte === 'base64') {
      bytes = Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64');
    } else if (cte === 'quoted-printable') {
      bytes = Buffer.from(decodeQuotedPrintable(bodyRaw), 'utf8');
    } else {
      bytes = Buffer.from(bodyRaw, 'latin1');
    }
    const extGuess = ctLower.includes('pdf')
      ? '.pdf'
      : ctLower.includes('png')
        ? '.png'
        : ctLower.includes('jpeg')
          ? '.jpg'
          : ctLower.includes('csv')
            ? '.csv'
            : '.bin';
    out.attachments.push({
      filename: filename || `inline_${out.attachments.length + 1}${extGuess}`,
      mimeType: ct.split(';')[0].trim().toLowerCase(),
      contentId: headers['content-id'] || null,
      bytes: new Uint8Array(bytes),
    });
    return out;
  }

  let decodedText;
  if (cte === 'base64') {
    decodedText = UTF8_DEC.decode(Buffer.from(bodyRaw.replace(/\s+/g, ''), 'base64'));
  } else if (cte === 'quoted-printable') {
    decodedText = decodeQuotedPrintable(bodyRaw);
  } else {
    decodedText = bodyRaw;
  }

  if (ctLower.startsWith('text/html')) {
    out.htmlParts.push(decodedText);
  } else {
    out.textParts.push(decodedText);
  }
  return out;
}

export function parseEmlBuffer(source, buf, options = {}) {
  const rawStr = typeof buf === 'string' ? buf : UTF8_DEC.decode(buf);
  const { headerRaw } = splitHeaderAndBody(rawStr);
  const headers = parseHeadersBlock(headerRaw);
  const mime = parseMimeEntity(rawStr);

  const threadId = headers['in-reply-to'] || headers['references']?.split(/\s+/)[0] || headers['message-id'] || source;
  const blocks = [];
  const forensicFindings = [];

  // Emit structured headers block (ensures From/To/Cc/Reply-To/Subject PII is always redacted!)
  const headerLines = [];
  for (const key of ['from', 'to', 'cc', 'bcc', 'reply-to', 'subject', 'date']) {
    if (headers[key]) headerLines.push(`${key.toUpperCase()}: ${headers[key]}`);
  }
  if (headerLines.length > 0) {
    const hb = makeBlock({
      source,
      modality: 'email',
      breadcrumb: `${source} > Headers`,
      text: headerLines.join('\n'),
      structRole: 'HEADER',
      parentSource: options.parentSource,
      threadId,
    });
    if (hb) blocks.push(hb);
  }

  if (Array.isArray(headers._received) && headers._received.length > 0) {
    forensicFindings.push({
      vector: 'email_received_headers',
      count: headers._received.length,
      detail: 'Email contains Received SMTP relay headers that may disclose internal IP addresses.',
    });
  }

  const rawBody =
    mime.textParts.length > 0
      ? mime.textParts.join('\n\n')
      : mime.htmlParts.map(stripHtmlTags).join('\n\n');

  const stripped = stripEmailReplyAndSignature(rawBody);
  if (stripped.strippedQuotedLines > 0 || stripped.strippedSignatureLines > 0) {
    forensicFindings.push({
      vector: 'email_reply_chain_and_signature_stripped',
      strippedQuotedLines: stripped.strippedQuotedLines,
      strippedSignatureLines: stripped.strippedSignatureLines,
    });
  }

  const paras = stripped.visibleText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((p, idx) => {
    const b = makeBlock({
      source,
      modality: 'email',
      breadcrumb: `${source} > Body > Paragraph ${idx + 1}`,
      text: p,
      structRole: 'PROSE',
      parentSource: options.parentSource,
      threadId,
    });
    if (b) blocks.push(b);
  });

  // Recursively handle nested forwarded `message/rfc822` emails
  mime.nestedEmails.forEach((nested, idx) => {
    const childSrc = `${source}::forwarded_${idx + 1}.eml`;
    const childRes = parseEmlBuffer(childSrc, nested, { ...options, parentSource: source });
    blocks.push(...childRes.blocks);
    forensicFindings.push(...childRes.forensicFindings);
    mime.attachments.push(...childRes.attachments);
  });

  return {
    source,
    modality: 'email',
    headers,
    threadId,
    blocks,
    attachments: mime.attachments.map((a) => ({ ...a, parentSource: source })),
    forensicFindings,
  };
}

export function parseMboxBuffer(source, buf, options = {}) {
  const rawStr = typeof buf === 'string' ? buf : UTF8_DEC.decode(buf);
  // RFC 4155 mbox message separator line: starts with "From " at start of file or after newline
  const parts = rawStr.split(/(?:^|\r?\n)From [^\r\n]+\r?\n/).filter((p) => p.trim().length > 0);
  const blocks = [];
  const attachments = [];
  const forensicFindings = [];

  parts.forEach((part, idx) => {
    const unescaped = part.replace(/^>From /gm, 'From ');
    const msgSrc = `${source}#msg_${idx + 1}.eml`;
    const parsed = parseEmlBuffer(msgSrc, unescaped, { ...options, parentSource: source });
    blocks.push(...parsed.blocks);
    attachments.push(...parsed.attachments);
    forensicFindings.push(...parsed.forensicFindings);
  });

  return {
    source,
    modality: 'email',
    messageCount: parts.length,
    blocks,
    attachments,
    forensicFindings,
  };
}

export function parseMsgBuffer(source, buf, options = {}) {
  const engine = loadMediaWasmSync();
  const parsed = engine.parseOutlookMsg(buf);
  const blocks = [];
  const forensicFindings = [];

  const headerLines = [];
  if (parsed.senderName || parsed.senderEmail) {
    headerLines.push(`FROM: ${parsed.senderName}${parsed.senderEmail ? ` <${parsed.senderEmail}>` : ''}`.trim());
  }
  if (parsed.displayTo) headerLines.push(`TO: ${parsed.displayTo}`);
  if (parsed.displayCc) headerLines.push(`CC: ${parsed.displayCc}`);
  if (parsed.subject) headerLines.push(`SUBJECT: ${parsed.subject}`);

  if (headerLines.length > 0) {
    const hb = makeBlock({
      source,
      modality: 'email',
      breadcrumb: `${source} > Outlook Headers`,
      text: headerLines.join('\n'),
      structRole: 'HEADER',
      parentSource: options.parentSource,
    });
    if (hb) blocks.push(hb);
  }

  if (parsed.transportHeaders) {
    forensicFindings.push({
      vector: 'outlook_msg_transport_headers',
      byteLen: parsed.transportHeaders.length,
    });
  }

  const rawBody = parsed.bodyText || stripHtmlTags(parsed.bodyHtml);
  const stripped = stripEmailReplyAndSignature(rawBody);
  for (const [idx, p] of stripped.visibleText.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).entries()) {
    const b = makeBlock({
      source,
      modality: 'email',
      breadcrumb: `${source} > Body > Paragraph ${idx + 1}`,
      text: p,
      structRole: 'PROSE',
      parentSource: options.parentSource,
    });
    if (b) blocks.push(b);
  }

  return {
    source,
    modality: 'email',
    blocks,
    attachments: (parsed.attachments || []).map((a) => ({ ...a, parentSource: source })),
    forensicFindings,
  };
}

// ---------------------------------------------------------------------------
// 2. Hardened Office & OpenDocument Suite (via `verisieve_media.wasm` ZIP CD)
// ---------------------------------------------------------------------------

function readZipXmlMap(buf, options = {}) {
  const engine = loadMediaWasmSync();
  const entries = engine.listZipEntries(buf);
  const maxOutBytes = options.maxOutBytes ?? 32 * 1024 * 1024;
  const maxRatio = options.maxRatio ?? 250;
  const map = new Map();
  const binaryChildren = [];

  for (const entry of entries) {
    if (entry.isDir) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.xml') || lower.endsWith('.rels') || lower.endsWith('.xhtml') || lower.endsWith('.html') || lower.endsWith('.opf')) {
      const bytes = engine.extractZipEntry(buf, entry.index, { maxOutBytes, maxRatio });
      map.set(entry.name, UTF8_DEC.decode(bytes));
    } else if (
      lower.includes('/embeddings/') ||
      (lower.includes('/media/') && /\.(png|jpe?g|bmp|webp)$/i.test(lower))
    ) {
      const bytes = engine.extractZipEntry(buf, entry.index, { maxOutBytes, maxRatio });
      binaryChildren.push({ filename: entry.name, bytes });
    }
  }
  return { entries, xmlMap: map, binaryChildren };
}

function extractDocPropsFindings(source, xmlMap, modality, parentSource) {
  const blocks = [];
  const findings = [];
  for (const propFile of ['docProps/core.xml', 'docProps/app.xml', 'docProps/custom.xml', 'meta.xml']) {
    const xml = xmlMap.get(propFile);
    if (!xml) continue;
    const fields = [];
    const tagRx = /<(?:dc:creator|cp:lastModifiedBy|dc:title|dc:subject|Company|Manager|meta:initial-creator)\b[^>]*>([\s\S]*?)<\/[^>]+>/gi;
    let m;
    while ((m = tagRx.exec(xml)) !== null) {
      const val = decodeXmlEntities(m[1]).trim();
      if (val) fields.push(val);
    }
    if (fields.length > 0) {
      findings.push({
        vector: 'office_document_properties',
        part: propFile,
        fieldsCount: fields.length,
      });
      const b = makeBlock({
        source,
        modality,
        breadcrumb: `${source} > Metadata (${propFile})`,
        text: `Document Properties: ${fields.join(' | ')}`,
        structRole: 'HEADER',
        parentSource,
        forensicSource: propFile,
      });
      if (b) blocks.push(b);
    }
  }
  return { blocks, findings };
}

function extractXmlTextRuns(xml, tagPattern = /<(?:a:t|w:t|t)\b[^>]*>([\s\S]*?)<\/(?:a:t|w:t|t)>/gi) {
  const parts = [];
  let m;
  while ((m = tagPattern.exec(xml)) !== null) {
    const t = decodeXmlEntities(m[1]);
    if (t) parts.push(t);
  }
  return parts.join('').replace(/\s+/g, ' ').trim();
}

export function extractDocxForensic(source, buf, options = {}) {
  const { xmlMap, binaryChildren } = readZipXmlMap(buf, options);
  const blocks = [];
  const forensicFindings = [];

  const docProps = extractDocPropsFindings(source, xmlMap, 'document', options.parentSource);
  blocks.push(...docProps.blocks);
  forensicFindings.push(...docProps.findings);

  const mainXml = xmlMap.get('word/document.xml') || '';
  const delMatches = mainXml.match(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/gi) || [];
  if (delMatches.length > 0) {
    forensicFindings.push({
      vector: 'docx_tracked_change_deletions',
      count: delMatches.length,
      detail: 'Deleted tracked-change text (<w:delText>) stripped before corpus emission.',
    });
  }

  // Extract visible paragraphs (stripping <w:delText> & <w:instrText>)
  const cleanMain = mainXml
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/gi, '')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/gi, '');
  const pRx = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
  let pm;
  let pIdx = 0;
  while ((pm = pRx.exec(cleanMain)) !== null) {
    const text = extractXmlTextRuns(pm[1], /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi);
    if (!text) continue;
    pIdx++;
    const b = makeBlock({
      source,
      modality: 'document',
      breadcrumb: `${source} > Paragraph ${pIdx}`,
      text,
      structRole: 'PROSE',
      parentSource: options.parentSource,
    });
    if (b) blocks.push(b);
  }

  // Hidden / secondary Word streams: headers, footers, comments, footnotes, endnotes
  for (const [partName, xml] of xmlMap.entries()) {
    const lower = partName.toLowerCase();
    if (
      /^word\/(header\d*|footer\d*|comments|footnotes|endnotes)\.xml$/i.test(lower)
    ) {
      const label = lower.includes('comment')
        ? 'Comments'
        : lower.includes('header')
          ? 'Header'
          : lower.includes('footer')
            ? 'Footer'
            : 'Notes';
      const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
      let m;
      const lines = [];
      while ((m = pRegex.exec(xml)) !== null) {
        const t = extractXmlTextRuns(m[1], /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi);
        if (t) lines.push(t);
      }
      if (lines.length > 0) {
        forensicFindings.push({ vector: `docx_${label.toLowerCase()}`, part: partName, lines: lines.length });
        const b = makeBlock({
          source,
          modality: 'document',
          breadcrumb: `${source} > ${label} (${partName})`,
          text: lines.join('\n'),
          structRole: label === 'Comments' ? 'SPEAKER_NOTES' : 'HEADER',
          parentSource: options.parentSource,
          forensicSource: partName,
        });
        if (b) blocks.push(b);
      }
    }
  }

  return {
    source,
    modality: 'document',
    blocks,
    attachments: binaryChildren.map((c) => ({ ...c, parentSource: source })),
    forensicFindings,
  };
}

export function extractPptxStructured(source, buf, options = {}) {
  const { xmlMap, binaryChildren } = readZipXmlMap(buf, options);
  const blocks = [];
  const forensicFindings = [];

  const docProps = extractDocPropsFindings(source, xmlMap, 'slide', options.parentSource);
  blocks.push(...docProps.blocks);
  forensicFindings.push(...docProps.findings);

  const numericSort = (a, b) => {
    const na = parseInt(a.match(/(\d+)\.xml$/i)?.[1] || '0', 10);
    const nb = parseInt(b.match(/(\d+)\.xml$/i)?.[1] || '0', 10);
    return na - nb;
  };

  // 1. Slides (+ hidden slide detection + slide tables)
  const slideFiles = [...xmlMap.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k)).sort(numericSort);
  for (const slidePath of slideFiles) {
    const slideNum = slidePath.match(/slide(\d+)\.xml$/i)?.[1] || '?';
    const xml = xmlMap.get(slidePath) || '';
    const isHidden = /<p:sld\b[^>]*\bshow=["']0["']/i.test(xml);
    if (isHidden) {
      forensicFindings.push({ vector: 'pptx_hidden_slide', slide: Number(slideNum), part: slidePath });
    }
    const slideTag = isHidden ? `Slide ${slideNum} (Hidden)` : `Slide ${slideNum}`;

    // Extract tables `<a:tbl>` first so header-bound TABLE_ROW blocks are preserved
    const tblRx = /<a:tbl\b[^>]*>([\s\S]*?)<\/a:tbl>/gi;
    let tm;
    let tblIdx = 0;
    while ((tm = tblRx.exec(xml)) !== null) {
      tblIdx++;
      const rows = [];
      const trRx = /<a:tr\b[^>]*>([\s\S]*?)<\/a:tr>/gi;
      let trm;
      while ((trm = trRx.exec(tm[1])) !== null) {
        const cells = [];
        const tcRx = /<a:tc\b[^>]*>([\s\S]*?)<\/a:tc>/gi;
        let tcm;
        while ((tcm = tcRx.exec(trm[1])) !== null) {
          cells.push(extractXmlTextRuns(tcm[1], /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi));
        }
        if (cells.some(Boolean)) rows.push(cells);
      }
      if (rows.length >= 2) {
        const formatted = formatDelimitedTableBlocks(source, rows, {
          breadcrumb: `${source} > ${slideTag} > Table ${tblIdx}`,
        });
        for (const tb of formatted.blocks) {
          const b = makeBlock({
            source,
            modality: 'slide',
            breadcrumb: tb.breadcrumb,
            text: tb.text,
            structRole: 'TABLE_ROW',
            parentSource: options.parentSource,
            tableHeaders: tb.tableHeaders,
          });
          if (b) blocks.push(b);
        }
      }
    }

    // Extract non-table slide paragraphs
    const withoutTables = xml.replace(/<a:tbl\b[^>]*>[\s\S]*?<\/a:tbl>/gi, '');
    const pRx = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    const lines = [];
    let pm;
    while ((pm = pRx.exec(withoutTables)) !== null) {
      const t = extractXmlTextRuns(pm[1], /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi);
      if (t) lines.push(t);
    }
    if (lines.length > 0) {
      const b = makeBlock({
        source,
        modality: 'slide',
        breadcrumb: `${source} > ${slideTag}`,
        text: lines.join('\n'),
        structRole: 'PROSE',
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
  }

  // 2. Presenter Speaker Notes (CRITICAL hidden leak vector!)
  const noteFiles = [...xmlMap.keys()].filter((k) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(k)).sort(numericSort);
  for (const notePath of noteFiles) {
    const noteNum = notePath.match(/notesSlide(\d+)\.xml$/i)?.[1] || '?';
    const xml = xmlMap.get(notePath) || '';
    const pRx = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/gi;
    const lines = [];
    let pm;
    while ((pm = pRx.exec(xml)) !== null) {
      const t = extractXmlTextRuns(pm[1], /<a:t\b[^>]*>([\s\S]*?)<\/a:t>/gi);
      if (t && t !== noteNum) lines.push(t);
    }
    if (lines.length > 0) {
      forensicFindings.push({ vector: 'pptx_speaker_notes', slide: Number(noteNum), part: notePath });
      const b = makeBlock({
        source,
        modality: 'slide',
        breadcrumb: `${source} > Slide ${noteNum} > Speaker Notes`,
        text: lines.join('\n'),
        structRole: 'SPEAKER_NOTES',
        parentSource: options.parentSource,
        forensicSource: notePath,
      });
      if (b) blocks.push(b);
    }
  }

  // 3. Slide Comments, Charts, and SmartArt Diagrams
  for (const [partName, xml] of xmlMap.entries()) {
    if (/^ppt\/comments\/comment\d*\.xml$/i.test(partName)) {
      const texts = [];
      const rx = /<p:text\b[^>]*>([\s\S]*?)<\/p:text>/gi;
      let m;
      while ((m = rx.exec(xml)) !== null) {
        const t = decodeXmlEntities(m[1]).trim();
        if (t) texts.push(t);
      }
      if (texts.length > 0) {
        forensicFindings.push({ vector: 'pptx_comments', part: partName, count: texts.length });
        const b = makeBlock({
          source,
          modality: 'slide',
          breadcrumb: `${source} > Comments (${partName})`,
          text: texts.join('\n'),
          structRole: 'SPEAKER_NOTES',
          parentSource: options.parentSource,
          forensicSource: partName,
        });
        if (b) blocks.push(b);
      }
    } else if (/^ppt\/(charts\/chart|diagrams\/data)\d+\.xml$/i.test(partName)) {
      const t = extractXmlTextRuns(xml, /<(?:a:t|c:v)\b[^>]*>([\s\S]*?)<\/(?:a:t|c:v)>/gi);
      if (t) {
        const kind = partName.includes('charts') ? 'Chart' : 'SmartArt';
        const b = makeBlock({
          source,
          modality: 'slide',
          breadcrumb: `${source} > ${kind} (${partName})`,
          text: t,
          structRole: 'PROSE',
          parentSource: options.parentSource,
        });
        if (b) blocks.push(b);
      }
    }
  }

  return {
    source,
    modality: 'slide',
    blocks,
    attachments: binaryChildren.map((c) => ({ ...c, parentSource: source })),
    forensicFindings,
  };
}

function colRefToIndex(colStr) {
  let idx = 0;
  for (let i = 0; i < colStr.length; i++) {
    idx = idx * 26 + (colStr.charCodeAt(i) - 64);
  }
  return idx - 1;
}

export function extractXlsxStructured(source, buf, options = {}) {
  const { xmlMap, binaryChildren } = readZipXmlMap(buf, options);
  const blocks = [];
  const forensicFindings = [];

  const docProps = extractDocPropsFindings(source, xmlMap, 'table', options.parentSource);
  blocks.push(...docProps.blocks);
  forensicFindings.push(...docProps.findings);

  // 1. Parse Shared Strings (`xl/sharedStrings.xml`, supporting rich-text `<r><t>`)
  const sharedStrings = [];
  const ssXml = xmlMap.get('xl/sharedStrings.xml') || '';
  if (ssXml) {
    const siRx = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    let m;
    while ((m = siRx.exec(ssXml)) !== null) {
      const tParts = [];
      const tRx = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
      let tm;
      while ((tm = tRx.exec(m[1])) !== null) {
        tParts.push(decodeXmlEntities(tm[1]));
      }
      sharedStrings.push(tParts.join(''));
    }
  }

  // 2. Parse Workbook sheet names & detect `hidden` / `veryHidden` tabs!
  const sheets = [];
  const wbXml = xmlMap.get('xl/workbook.xml') || '';
  const relsXml = xmlMap.get('xl/_rels/workbook.xml.rels') || '';
  const relMap = new Map();
  const relRx = /<Relationship\b[^>]*Id=["']([^"']+)["'][^>]*Target=["']([^"']+)["']/gi;
  let rm;
  while ((rm = relRx.exec(relsXml)) !== null) {
    relMap.set(rm[1], rm[2].replace(/^\/+/, ''));
  }

  const sheetRx = /<sheet\b([^>]+)\/?>/gi;
  let sm;
  let sheetAutoIdx = 0;
  while ((sm = sheetRx.exec(wbXml)) !== null) {
    sheetAutoIdx++;
    const attrs = sm[1];
    const name = decodeXmlEntities(attrs.match(/\bname=["']([^"']+)["']/i)?.[1] || `Sheet${sheetAutoIdx}`);
    const state = attrs.match(/\bstate=["']([^"']+)["']/i)?.[1] || 'visible';
    const rId = attrs.match(/\br:id=["']([^"']+)["']/i)?.[1] || '';
    const relTarget = relMap.get(rId) || `worksheets/sheet${sheetAutoIdx}.xml`;
    const partPath = relTarget.startsWith('xl/') ? relTarget : `xl/${relTarget}`;
    if (state !== 'visible') {
      forensicFindings.push({ vector: 'xlsx_hidden_sheet', sheetName: name, state, part: partPath });
    }
    sheets.push({ name, state, partPath });
  }
  if (sheets.length === 0) {
    for (const k of [...xmlMap.keys()].filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(x)).sort()) {
      sheets.push({ name: k.split('/').pop().replace('.xml', ''), state: 'visible', partPath: k });
    }
  }

  // 3. Parse each worksheet into header-bound GFM TABLE_ROW blocks
  for (const sheet of sheets) {
    const xml = xmlMap.get(sheet.partPath);
    if (!xml) continue;
    const gridRows = [];
    const rowRx = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
    let rmatch;
    while ((rmatch = rowRx.exec(xml)) !== null) {
      const cells = [];
      const cRx = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
      let cm;
      while ((cm = cRx.exec(rmatch[1])) !== null) {
        const attrs = cm[1];
        const inner = cm[2];
        const ref = attrs.match(/\br=["']([A-Z]+)\d+["']/i)?.[1];
        const colIdx = ref ? colRefToIndex(ref.toUpperCase()) : cells.length;
        const tType = attrs.match(/\bt=["']([^"']+)["']/i)?.[1] || '';

        let val = '';
        if (tType === 's') {
          const idxStr = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
          val = idxStr !== undefined ? (sharedStrings[Number(idxStr)] ?? '') : '';
        } else if (tType === 'inlineStr') {
          val = extractXmlTextRuns(inner, /<t\b[^>]*>([\s\S]*?)<\/t>/gi);
        } else {
          val = decodeXmlEntities(inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || '').trim();
        }
        while (cells.length <= colIdx) cells.push('');
        cells[colIdx] = val;
      }
      if (cells.some((c) => c !== '')) gridRows.push(cells);
    }

    if (gridRows.length >= 2) {
      const label = sheet.state === 'visible' ? `Sheet: ${sheet.name}` : `Sheet: ${sheet.name} (${sheet.state})`;
      const formatted = formatDelimitedTableBlocks(source, gridRows, {
        breadcrumb: `${source} > ${label}`,
      });
      for (const tb of formatted.blocks) {
        const b = makeBlock({
          source,
          modality: 'table',
          breadcrumb: tb.breadcrumb,
          text: tb.text,
          structRole: 'TABLE_ROW',
          parentSource: options.parentSource,
          tableHeaders: tb.tableHeaders,
        });
        if (b) blocks.push(b);
      }
    } else if (gridRows.length === 1) {
      const b = makeBlock({
        source,
        modality: 'table',
        breadcrumb: `${source} > Sheet: ${sheet.name}`,
        text: gridRows[0].filter(Boolean).join(' | '),
        structRole: 'TABLE_ROW',
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
  }

  // 4. Legacy Comments (`xl/comments*.xml`) AND Modern Excel 365 Threaded Comments!
  for (const [partName, xml] of xmlMap.entries()) {
    if (/^xl\/comments\d*\.xml$/i.test(partName) || /^xl\/threadedComments\/threadedComment\d*\.xml$/i.test(partName)) {
      const commentTexts = [];
      const rx = /<(?:t|text)\b[^>]*>([\s\S]*?)<\/(?:t|text)>/gi;
      let m;
      while ((m = rx.exec(xml)) !== null) {
        const t = decodeXmlEntities(m[1]).trim();
        if (t) commentTexts.push(t);
      }
      if (commentTexts.length > 0) {
        forensicFindings.push({ vector: 'xlsx_cell_comments', part: partName, count: commentTexts.length });
        const b = makeBlock({
          source,
          modality: 'table',
          breadcrumb: `${source} > Cell Comments (${partName})`,
          text: commentTexts.join('\n'),
          structRole: 'SPEAKER_NOTES',
          parentSource: options.parentSource,
          forensicSource: partName,
        });
        if (b) blocks.push(b);
      }
    }
  }

  // 5. PivotTable Caches (`xl/pivotCache/pivotCacheRecords*.xml` & `pivotCacheDefinition*.xml`)
  // HUGE forgotten leak vector: Excel caches entire deleted source tables inside pivotCache!
  for (const [partName, xml] of xmlMap.entries()) {
    if (/^xl\/pivotCache\/pivotCache(Records|Definition)\d*\.xml$/i.test(partName)) {
      const vals = [];
      const rx = /<s\b[^>]*\bv=["']([^"']+)["']/gi;
      let m;
      while ((m = rx.exec(xml)) !== null && vals.length < 500) {
        const v = decodeXmlEntities(m[1]).trim();
        if (v) vals.push(v);
      }
      if (vals.length > 0) {
        forensicFindings.push({
          vector: 'xlsx_pivot_cache_hidden_records',
          part: partName,
          cachedValuesCount: vals.length,
          detail: 'Excel PivotCache retains cached source strings even after original rows/sheets are deleted.',
        });
        const b = makeBlock({
          source,
          modality: 'table',
          breadcrumb: `${source} > PivotCache Forensic Audit (${partName})`,
          text: vals.join(' | '),
          structRole: 'TABLE_ROW',
          parentSource: options.parentSource,
          forensicSource: partName,
        });
        if (b) blocks.push(b);
      }
    }
  }

  return {
    source,
    modality: 'table',
    blocks,
    attachments: binaryChildren.map((c) => ({ ...c, parentSource: source })),
    forensicFindings,
  };
}

export function extractOdfStructured(source, buf, options = {}) {
  const { xmlMap } = readZipXmlMap(buf, options);
  const blocks = [];
  const forensicFindings = [];
  const ext = source.toLowerCase();
  const modality = ext.endsWith('.ods') ? 'table' : ext.endsWith('.odp') ? 'slide' : 'document';

  const docProps = extractDocPropsFindings(source, xmlMap, modality, options.parentSource);
  blocks.push(...docProps.blocks);
  forensicFindings.push(...docProps.findings);

  const contentXml = xmlMap.get('content.xml') || '';
  // Extract annotations/comments (`<office:annotation>`)
  const annRx = /<office:annotation\b[^>]*>([\s\S]*?)<\/office:annotation>/gi;
  let am;
  const anns = [];
  while ((am = annRx.exec(contentXml)) !== null) {
    const t = stripHtmlTags(am[1]);
    if (t) anns.push(t);
  }
  if (anns.length > 0) {
    forensicFindings.push({ vector: 'odf_annotations', count: anns.length });
    const b = makeBlock({
      source,
      modality,
      breadcrumb: `${source} > Annotations`,
      text: anns.join('\n'),
      structRole: 'SPEAKER_NOTES',
      parentSource: options.parentSource,
      forensicSource: 'content.xml#annotations',
    });
    if (b) blocks.push(b);
  }

  const cleanXml = contentXml.replace(/<office:annotation\b[^>]*>[\s\S]*?<\/office:annotation>/gi, '');
  const pRx = /<text:(?:p|h)\b[^>]*>([\s\S]*?)<\/text:(?:p|h)>/gi;
  let pm;
  let idx = 0;
  while ((pm = pRx.exec(cleanXml)) !== null) {
    const t = decodeXmlEntities(pm[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!t) continue;
    idx++;
    const b = makeBlock({
      source,
      modality,
      breadcrumb: `${source} > Block ${idx}`,
      text: t,
      structRole: 'PROSE',
      parentSource: options.parentSource,
    });
    if (b) blocks.push(b);
  }

  return { source, modality, blocks, attachments: [], forensicFindings };
}

export function extractEpubStructured(source, buf, options = {}) {
  const { xmlMap } = readZipXmlMap(buf, options);
  const blocks = [];
  const xhtmlFiles = [...xmlMap.keys()]
    .filter((k) => /\.(xhtml|html|htm)$/i.test(k))
    .sort();
  xhtmlFiles.forEach((chapter, idx) => {
    const text = stripHtmlTags(xmlMap.get(chapter) || '');
    if (!text) return;
    const b = makeBlock({
      source,
      modality: 'document',
      breadcrumb: `${source} > Chapter ${idx + 1} (${chapter})`,
      text,
      structRole: 'PROSE',
      parentSource: options.parentSource,
    });
    if (b) blocks.push(b);
  });
  return { source, modality: 'document', blocks, attachments: [], forensicFindings: [] };
}

// ---------------------------------------------------------------------------
// 3. Subtitles (.vtt/.srt), Slack/Jira/Teams JSON, Calendar (.ics), vCard (.vcf)
// ---------------------------------------------------------------------------

function parseTimestampToMs(raw) {
  const clean = String(raw || '').trim().replace(',', '.');
  const parts = clean.split(':').map(Number);
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return Math.round((parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000);
  if (parts.length === 2) return Math.round((parts[0] * 60 + parts[1]) * 1000);
  return Math.round((parts[0] || 0) * 1000);
}

function formatMsTimestamp(ms) {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export function parseSubtitleTranscript(source, rawText, options = {}) {
  const blocks = [];
  const cues = String(rawText || '')
    .replace(/^\uFEFF/, '')
    .replace(/^WEBVTT[^\n]*\n+/i, '')
    .split(/\r?\n\r?\n/);

  for (const cue of cues) {
    const lines = cue.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const tsIdx = lines.findIndex((l) => l.includes('-->'));
    if (tsIdx === -1) continue;
    const [startStr, endStr] = lines[tsIdx].split('-->').map((s) => s.trim().split(/\s+/)[0]);
    const startMs = parseTimestampToMs(startStr);
    const endMs = parseTimestampToMs(endStr);
    let body = lines.slice(tsIdx + 1).join(' ').trim();
    if (!body) continue;

    let speakerId = null;
    // WebVTT `<v Elena Vance>Hello...`
    const vTag = body.match(/^<v(?:\.[^>\s]+)?\s+([^>]+)>([\s\S]*)$/i);
    if (vTag) {
      speakerId = vTag[1].trim();
      body = vTag[2].replace(/<\/v>/gi, '').trim();
    } else {
      // Plain `Speaker Name: text`
      const spkMatch = body.match(/^([A-Za-z][A-Za-z0-9 ._-]{1,36}):\s+(.+)$/);
      if (spkMatch) {
        speakerId = spkMatch[1].trim();
        body = spkMatch[2].trim();
      }
    }
    body = body.replace(/<[^>]+>/g, '').trim();

    const textWithSpeaker = speakerId ? `${speakerId}: ${body}` : body;
    const b = makeBlock({
      source,
      modality: 'audio',
      breadcrumb: `${source} > ${formatMsTimestamp(startMs)}–${formatMsTimestamp(endMs)}${speakerId ? ` > ${speakerId}` : ''}`,
      text: textWithSpeaker,
      structRole: 'TRANSCRIPT_TURN',
      timeRangeMs: { startMs, endMs },
      speakerId: speakerId || undefined,
      parentSource: options.parentSource,
    });
    if (b) blocks.push(b);
  }

  return { source, modality: 'audio', blocks, attachments: [], forensicFindings: [] };
}

export function parseSlackExportJson(source, rawText, usersMap = {}, options = {}) {
  const parsed = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
  const messages = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.messages) ? parsed.messages : [];
  const blocks = [];
  const forensicFindings = [];

  const lookupUser = (uid) => {
    if (!uid) return 'unknown_user';
    const rec = usersMap[uid];
    if (!rec) return uid;
    if (typeof rec === 'string') return rec;
    return rec.real_name || rec.profile?.real_name || rec.name || uid;
  };

  // Group threaded replies by `thread_ts`
  const threadBuckets = new Map();
  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;
    const key = msg.thread_ts || msg.ts || `idx_${threadBuckets.size}`;
    if (!threadBuckets.has(key)) threadBuckets.set(key, []);
    threadBuckets.get(key).push(msg);
  }

  for (const [threadTs, msgs] of threadBuckets.entries()) {
    const lines = [];
    for (const msg of msgs) {
      const userLabel = lookupUser(msg.user || msg.user_profile?.real_name);
      let text = String(msg.text || '');
      // Resolve `<@U0123ABC>` mentions and `<mailto:a@b.com|a@b.com>`
      text = text
        .replace(/<@([A-Z0-9]+)(?:\|[^>]+)?>/g, (_, uid) => lookupUser(uid))
        .replace(/<mailto:([^|>]+)(?:\|[^>]+)?>/gi, '$1')
        .replace(/<(https?:\/\/[^|>]+)(?:\|([^>]+))?>/gi, (_, url, lbl) => (lbl ? `${lbl} (${url})` : url));

      if (Array.isArray(msg.files) && msg.files.length > 0) {
        forensicFindings.push({
          vector: 'slack_file_attachments',
          threadTs,
          count: msg.files.length,
        });
      }
      if (text.trim()) lines.push(`${userLabel}: ${text.trim()}`);
    }
    if (lines.length > 0) {
      const b = makeBlock({
        source,
        modality: 'chat',
        breadcrumb: `${source} > Thread ${threadTs}`,
        text: lines.join('\n'),
        structRole: 'TRANSCRIPT_TURN',
        threadId: String(threadTs),
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
  }

  return { source, modality: 'chat', blocks, attachments: [], forensicFindings };
}

export function parseTicketExportJson(source, rawText, options = {}) {
  const parsed = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.issues)
      ? parsed.issues
      : Array.isArray(parsed?.tickets)
        ? parsed.tickets
        : [parsed];
  const blocks = [];

  for (const [idx, item] of items.entries()) {
    if (!item || typeof item !== 'object') continue;
    const fields = item.fields || item;
    const key = item.key || item.id || `ticket_${idx + 1}`;
    const summary = fields.summary || fields.subject || fields.title || '';
    const reporter = fields.reporter?.displayName || fields.reporter?.emailAddress || fields.requester?.name || '';
    const desc = typeof fields.description === 'string' ? fields.description : '';
    const header = [summary && `Summary: ${summary}`, reporter && `Reporter: ${reporter}`].filter(Boolean).join(' | ');
    if (header || desc) {
      const b = makeBlock({
        source,
        modality: 'chat',
        breadcrumb: `${source} > Ticket ${key}`,
        text: [header, desc].filter(Boolean).join('\n'),
        structRole: 'PROSE',
        threadId: String(key),
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
    const comments = fields.comment?.comments || fields.comments || [];
    if (Array.isArray(comments)) {
      comments.forEach((c, cIdx) => {
        const author = c.author?.displayName || c.author?.emailAddress || c.author_name || '';
        const body = typeof c.body === 'string' ? c.body : '';
        if (body.trim()) {
          const cb = makeBlock({
            source,
            modality: 'chat',
            breadcrumb: `${source} > Ticket ${key} > Comment ${cIdx + 1}`,
            text: author ? `${author}: ${body.trim()}` : body.trim(),
            structRole: 'TRANSCRIPT_TURN',
            threadId: String(key),
            parentSource: options.parentSource,
          });
          if (cb) blocks.push(cb);
        }
      });
    }
  }

  return { source, modality: 'chat', blocks, attachments: [], forensicFindings: [] };
}

export function parseIcsCalendar(source, rawText, options = {}) {
  // RFC 5545 line unfolding: CRLF/LF followed by single space or tab
  const unfolded = String(rawText || '').replace(/\r?\n[ \t]/g, '');
  const events = unfolded.split(/BEGIN:VEVENT/i).slice(1);
  const blocks = [];
  const forensicFindings = [];

  events.forEach((ev, idx) => {
    const body = ev.split(/END:VEVENT/i)[0] || '';
    const lines = [];
    let attendeeCount = 0;
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const colonIdx = trimmed.indexOf(':');
      if (colonIdx <= 0) continue;
      const keyPart = trimmed.slice(0, colonIdx);
      const keyName = keyPart.split(';')[0].toUpperCase();
      const val = trimmed.slice(colonIdx + 1).replace(/\\n/g, '\n').replace(/\\,/g, ',');

      if (keyName === 'SUMMARY' || keyName === 'DTSTART' || keyName === 'LOCATION' || keyName === 'DESCRIPTION') {
        lines.push(`${keyName}: ${val}`);
      } else if (keyName === 'ORGANIZER' || keyName === 'ATTENDEE') {
        attendeeCount++;
        const cn = keyPart.match(/CN=([^;]+)/i)?.[1]?.replace(/^"|"$/g, '') || '';
        const addr = val.replace(/^mailto:/i, '');
        lines.push(`${keyName}: ${cn ? `${cn} <${addr}>` : addr}`);
      }
    }
    if (attendeeCount > 0) {
      forensicFindings.push({ vector: 'ics_attendee_emails', eventIndex: idx + 1, attendeeCount });
    }
    if (lines.length > 0) {
      const b = makeBlock({
        source,
        modality: 'chat',
        breadcrumb: `${source} > Event ${idx + 1}`,
        text: lines.join('\n'),
        structRole: 'HEADER',
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
  });

  return { source, modality: 'chat', blocks, attachments: [], forensicFindings };
}

export function parseVcfContacts(source, rawText, options = {}) {
  const unfolded = String(rawText || '').replace(/\r?\n[ \t]/g, '');
  const cards = unfolded.split(/BEGIN:VCARD/i).slice(1);
  const blocks = [];
  cards.forEach((card, idx) => {
    const body = card.split(/END:VCARD/i)[0] || '';
    const lines = [];
    for (const line of body.split(/\r?\n/)) {
      const m = line.match(/^(FN|N|EMAIL|TEL|ADR|ORG|TITLE|NOTE)(?:;[^:]*)?:(.*)$/i);
      if (m) lines.push(`${m[1].toUpperCase()}: ${m[2].trim()}`);
    }
    if (lines.length > 0) {
      const b = makeBlock({
        source,
        modality: 'chat',
        breadcrumb: `${source} > Contact ${idx + 1}`,
        text: lines.join('\n'),
        structRole: 'HEADER',
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
  });
  return { source, modality: 'chat', blocks, attachments: [], forensicFindings: [] };
}

// ---------------------------------------------------------------------------
// 4. Engineering Artifacts: `.ipynb`, `.har`, `.env`, K8s `Secret` YAML, `.sql`
// ---------------------------------------------------------------------------

export function parseJupyterNotebook(source, rawText, options = {}) {
  const nb = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
  const cells = Array.isArray(nb?.cells) ? nb.cells : [];
  const blocks = [];
  const forensicFindings = [];

  cells.forEach((cell, idx) => {
    const srcText = Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || '');
    if (srcText.trim()) {
      const b = makeBlock({
        source,
        modality: 'secret_log',
        breadcrumb: `${source} > Cell ${idx + 1} (${cell.cell_type || 'code'})`,
        text: srcText.trim(),
        structRole: 'PROSE',
        parentSource: options.parentSource,
      });
      if (b) blocks.push(b);
    }
    if (Array.isArray(cell.outputs) && cell.outputs.length > 0) {
      const outTexts = [];
      for (const o of cell.outputs) {
        if (o.text) outTexts.push(Array.isArray(o.text) ? o.text.join('') : String(o.text));
        if (o.data?.['text/plain']) {
          const tp = o.data['text/plain'];
          outTexts.push(Array.isArray(tp) ? tp.join('') : String(tp));
        }
      }
      const joined = outTexts.join('\n').trim();
      if (joined) {
        forensicFindings.push({ vector: 'ipynb_cell_output', cellIndex: idx + 1, chars: joined.length });
        const ob = makeBlock({
          source,
          modality: 'secret_log',
          breadcrumb: `${source} > Cell ${idx + 1} > Output`,
          text: joined,
          structRole: 'TABLE_ROW',
          parentSource: options.parentSource,
          forensicSource: `cell_${idx + 1}_output`,
        });
        if (ob) blocks.push(ob);
      }
    }
  });

  return { source, modality: 'secret_log', blocks, attachments: [], forensicFindings };
}

const SENSITIVE_HAR_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-session-token',
]);

const SENSITIVE_QUERY_PARAMS = new Set([
  'access_token',
  'id_token',
  'refresh_token',
  'token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'code',
  'sig',
]);

export function parseHarArchive(source, rawText, options = {}) {
  const har = typeof rawText === 'string' ? JSON.parse(rawText) : rawText;
  const entries = Array.isArray(har?.log?.entries) ? har.log.entries : [];
  const scrubbedHar = JSON.parse(JSON.stringify(har));
  const blocks = [];
  const forensicFindings = [];
  let sensitiveHeaderHits = 0;
  let sensitiveQueryHits = 0;

  entries.forEach((entry, idx) => {
    const scrubbedEntry = scrubbedHar.log.entries[idx];
    const req = entry.request || {};
    const res = entry.response || {};
    const lines = [`${req.method || 'GET'} ${req.url || ''}`];

    for (const [bagName, bag, scrubbedBag] of [
      ['REQ_HEADER', req.headers || [], scrubbedEntry.request?.headers || []],
      ['RES_HEADER', res.headers || [], scrubbedEntry.response?.headers || []],
    ]) {
      bag.forEach((h, hIdx) => {
        if (!h || !h.name) return;
        if (SENSITIVE_HAR_HEADERS.has(String(h.name).toLowerCase())) {
          sensitiveHeaderHits++;
          lines.push(`${bagName} ${h.name}: ${h.value}`);
          if (scrubbedBag[hIdx]) scrubbedBag[hIdx].value = '<SECRET:HAR_HEADER>';
        }
      });
    }

    (req.queryString || []).forEach((q, qIdx) => {
      if (q && SENSITIVE_QUERY_PARAMS.has(String(q.name || '').toLowerCase())) {
        sensitiveQueryHits++;
        lines.push(`QUERY ${q.name}=${q.value}`);
        if (scrubbedEntry.request?.queryString?.[qIdx]) {
          scrubbedEntry.request.queryString[qIdx].value = '<SECRET:HAR_QUERY>';
        }
      }
    });

    if (req.postData?.text) {
      lines.push(`POST_BODY: ${String(req.postData.text).slice(0, 4000)}`);
    }

    const b = makeBlock({
      source,
      modality: 'secret_log',
      breadcrumb: `${source} > Entry ${idx + 1}`,
      text: lines.join('\n'),
      structRole: 'HEADER',
      parentSource: options.parentSource,
    });
    if (b) blocks.push(b);
  });

  if (sensitiveHeaderHits > 0 || sensitiveQueryHits > 0) {
    forensicFindings.push({
      vector: 'har_credentials_scrubbed',
      sensitiveHeaderHits,
      sensitiveQueryHits,
    });
  }

  return {
    source,
    modality: 'secret_log',
    blocks,
    scrubbedHarJson: JSON.stringify(scrubbedHar, null, 2),
    attachments: [],
    forensicFindings,
  };
}

export function parseConfigOrSecretFile(source, rawText, options = {}) {
  const text = String(rawText || '');
  const blocks = [];
  const forensicFindings = [];

  // Detect Kubernetes `kind: Secret` base64-encoded `data:` entries!
  if (/^\s*kind:\s*Secret\b/im.test(text) && /^\s*data:\s*$/im.test(text)) {
    const decodedLines = [];
    let inData = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*data:\s*$/.test(line)) {
        inData = true;
        continue;
      }
      if (inData && /^\S/.test(line)) inData = false;
      if (inData) {
        const m = line.match(/^\s+([A-Za-z0-9._-]+):\s*["']?([A-Za-z0-9+/=]{8,})["']?\s*$/);
        if (m) {
          try {
            const decoded = Buffer.from(m[2], 'base64').toString('utf8');
            decodedLines.push(`${m[1]}=${decoded}`);
          } catch {}
        }
      }
    }
    if (decodedLines.length > 0) {
      forensicFindings.push({
        vector: 'k8s_secret_base64_decoded',
        keysDecoded: decodedLines.length,
      });
      const kb = makeBlock({
        source,
        modality: 'secret_log',
        breadcrumb: `${source} > K8s Secret Decoded Data`,
        text: decodedLines.join('\n'),
        structRole: 'HEADER',
        parentSource: options.parentSource,
        forensicSource: 'k8s_secret_base64',
      });
      if (kb) blocks.push(kb);
    }
  }

  const mainBlock = makeBlock({
    source,
    modality: 'secret_log',
    breadcrumb: `${source} > Raw Config`,
    text,
    structRole: 'PROSE',
    parentSource: options.parentSource,
  });
  if (mainBlock) blocks.push(mainBlock);

  return { source, modality: 'secret_log', blocks, attachments: [], forensicFindings };
}

// ---------------------------------------------------------------------------
// 5. Unified Enterprise Format Router + Hardened Recursive Archive Unpacker
// ---------------------------------------------------------------------------

export const ENTERPRISE_TEXT_EXTENSIONS = new Set([
  '.eml', '.mbox', '.msg', '.vcf',
  '.docx', '.docm', '.pptx', '.pptm', '.xlsx', '.xlsm', '.odt', '.ods', '.odp', '.epub',
  '.vtt', '.srt', '.ics',
  '.ipynb', '.har', '.env', '.pem', '.key', '.crt', '.yaml', '.yml', '.sql', '.log', '.tfstate',
  '.tex', '.typ', '.bib',
  '.zip', '.tar', '.tgz', '.gz',
]);

export function parseEnterpriseBuffer(source, buf, options = {}) {
  const depth = options._depth ?? 0;
  const maxDepth = options.maxArchiveDepth ?? 2;
  const maxArchiveRatio = options.maxArchiveRatio ?? 25;
  const maxArchiveEntryBytes = options.maxArchiveEntryBytes ?? 32 * 1024 * 1024;
  const maxArchiveTotalBytes = options.maxArchiveTotalBytes ?? 100 * 1024 * 1024;
  const lower = String(source || '').toLowerCase();
  const baseName = String(source || '').split(/[/\\]/).pop() || '';
  const u8 = buf instanceof Uint8Array ? buf : Buffer.from(buf);

  // Detect Microsoft Office `~$*` temporary owner lock files (contain Windows username PII!)
  if (baseName.startsWith('~$') && u8.byteLength < 1024) {
    const ownerHint = UTF8_DEC.decode(u8).replace(/[^\x20-\x7E]+/g, ' ').trim();
    return {
      source,
      modality: 'document',
      blocks: ownerHint
        ? [
            makeBlock({
              source,
              modality: 'document',
              breadcrumb: `${source} > Office Lock Owner`,
              text: `Office Lock Owner: ${ownerHint}`,
              structRole: 'HEADER',
              parentSource: options.parentSource,
              forensicSource: 'office_temp_lock_file',
            }),
          ].filter(Boolean)
        : [],
      attachments: [],
      forensicFindings: [{ vector: 'office_temp_lock_file', byteLen: u8.byteLength }],
    };
  }

  const recurseAttachments = (result) => {
    if (!result.attachments || result.attachments.length === 0 || depth >= maxDepth) {
      return result;
    }
    const childBlocks = [];
    const childFindings = [];
    for (const att of result.attachments) {
      const childName = `${source}::${att.filename}`;
      if (isEnterpriseFile(childName) && att.bytes && att.bytes.byteLength > 0) {
        try {
          const sub = parseEnterpriseBuffer(childName, att.bytes, {
            ...options,
            parentSource: source,
            _depth: depth + 1,
          });
          childBlocks.push(...sub.blocks);
          childFindings.push(...sub.forensicFindings);
        } catch (err) {
          childFindings.push({ vector: 'attachment_parse_error', child: childName, error: err.message });
        }
      }
    }
    return {
      ...result,
      blocks: [...result.blocks, ...childBlocks],
      forensicFindings: [...result.forensicFindings, ...childFindings],
    };
  };

  if (lower.endsWith('.zip')) {
    if (depth >= maxDepth) {
      throw new Error(`ARCHIVE_MAX_DEPTH_EXCEEDED: Nesting depth ${depth} exceeds max ${maxDepth}`);
    }
    const engine = loadMediaWasmSync();
    const entries = engine.listZipEntries(u8);
    if (entries.length > 500) {
      throw new Error(`ARCHIVE_TOO_MANY_ENTRIES: ${entries.length} exceeds limit 500`);
    }
    const blocks = [];
    const forensicFindings = [];
    const childFiles = [];
    let totalBytes = 0;

    for (const entry of entries) {
      if (entry.isDir) continue;
      const childBytes = engine.extractZipEntry(u8, entry.index, {
        maxOutBytes: maxArchiveEntryBytes,
        maxRatio: maxArchiveRatio,
      });
      totalBytes += childBytes.byteLength;
      if (totalBytes > maxArchiveTotalBytes) {
        throw new Error(`ARCHIVE_TOTAL_SIZE_EXCEEDED: Aggregate decompressed bytes exceed ${maxArchiveTotalBytes}`);
      }
      const childSource = `${source}::${entry.name}`;
      childFiles.push({ source: childSource, bytes: childBytes });
      if (isEnterpriseFile(childSource)) {
        const sub = parseEnterpriseBuffer(childSource, childBytes, {
          ...options,
          parentSource: source,
          _depth: depth + 1,
        });
        blocks.push(...sub.blocks);
        forensicFindings.push(...sub.forensicFindings);
      } else if (/\.(exe|dll|msi|bat|cmd|ps1|scr|com)$/i.test(childSource)) {
        forensicFindings.push({ vector: 'zip_executable_binary_skipped', child: entry.name, bytes: childBytes.byteLength });
      } else if (/\.(txt|md|csv|tsv|json|html|htm|xml|py|js|ts|java|c|cpp|h|rs|go|sh|typ|tex|bib|svg)$/i.test(childSource)) {
        const txt = UTF8_DEC.decode(childBytes).trim();
        if (txt) {
          const b = makeBlock({
            source: childSource,
            modality: 'document',
            breadcrumb: childSource,
            text: txt,
            structRole: 'PROSE',
            parentSource: source,
          });
          if (b) blocks.push(b);
        }
      }
    }
    return { source, modality: 'document', blocks, childFiles, attachments: [], forensicFindings };
  }

  if (lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    if (depth >= maxDepth) {
      throw new Error(`ARCHIVE_MAX_DEPTH_EXCEEDED: Nesting depth ${depth} exceeds max ${maxDepth}`);
    }
    const engine = loadMediaWasmSync();
    const entries = engine.unpackTarArchive(u8, {
      maxTotalBytes: maxArchiveTotalBytes,
      maxRatio: maxArchiveRatio,
    });
    const blocks = [];
    const forensicFindings = [];
    const childFiles = [];
    for (const entry of entries) {
      if (entry.isDir) continue;
      const childSource = `${source}::${entry.name}`;
      childFiles.push({ source: childSource, bytes: entry.bytes });
      if (isEnterpriseFile(childSource)) {
        const sub = parseEnterpriseBuffer(childSource, entry.bytes, {
          ...options,
          parentSource: source,
          _depth: depth + 1,
        });
        blocks.push(...sub.blocks);
        forensicFindings.push(...sub.forensicFindings);
      } else if (/\.(exe|dll|msi|bat|cmd|ps1|scr|com)$/i.test(childSource)) {
        forensicFindings.push({ vector: 'zip_executable_binary_skipped', child: entry.name, bytes: childBytes.byteLength });
      } else if (/\.(txt|md|csv|tsv|json|html|htm|xml|py|js|ts|java|c|cpp|h|rs|go|sh|typ|tex|bib|svg)$/i.test(childSource)) {
        const txt = UTF8_DEC.decode(entry.bytes).trim();
        if (txt) {
          const b = makeBlock({
            source: childSource,
            modality: 'document',
            breadcrumb: childSource,
            text: txt,
            structRole: 'PROSE',
            parentSource: source,
          });
          if (b) blocks.push(b);
        }
      }
    }
    return { source, modality: 'document', blocks, childFiles, attachments: [], forensicFindings };
  }

  if (lower.endsWith('.eml')) return recurseAttachments(parseEmlBuffer(source, u8, options));
  if (lower.endsWith('.mbox')) return recurseAttachments(parseMboxBuffer(source, u8, options));
  if (lower.endsWith('.msg')) return recurseAttachments(parseMsgBuffer(source, u8, options));
  if (lower.endsWith('.vcf')) return parseVcfContacts(source, UTF8_DEC.decode(u8), options);
  if (lower.endsWith('.docx') || lower.endsWith('.docm')) return recurseAttachments(extractDocxForensic(source, u8, options));
  if (lower.endsWith('.pptx') || lower.endsWith('.pptm')) return recurseAttachments(extractPptxStructured(source, u8, options));
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return recurseAttachments(extractXlsxStructured(source, u8, options));
  if (lower.endsWith('.odt') || lower.endsWith('.ods') || lower.endsWith('.odp')) {
    return extractOdfStructured(source, u8, options);
  }
  if (lower.endsWith('.epub')) return extractEpubStructured(source, u8, options);
  if (lower.endsWith('.vtt') || lower.endsWith('.srt')) {
    return parseSubtitleTranscript(source, UTF8_DEC.decode(u8), options);
  }
  if (lower.endsWith('.ics')) return parseIcsCalendar(source, UTF8_DEC.decode(u8), options);
  if (lower.endsWith('.ipynb')) return parseJupyterNotebook(source, UTF8_DEC.decode(u8), options);
  if (lower.endsWith('.har')) return parseHarArchive(source, UTF8_DEC.decode(u8), options);
  if (/\.(env|pem|key|crt|yaml|yml|sql|log|tfstate|tex|typ|bib)$/i.test(lower) || /(?:^|\/)\.env(?:\..+)?$/i.test(lower)) {
    return parseConfigOrSecretFile(source, UTF8_DEC.decode(u8), options);
  }
  if (lower.endsWith('.json')) {
    const raw = UTF8_DEC.decode(u8);
    const parsed = JSON.parse(raw);
    if (parsed?.log?.entries) return parseHarArchive(source, parsed, options);
    if (
      (Array.isArray(parsed) && parsed[0]?.ts && (parsed[0]?.user || parsed[0]?.text)) ||
      Array.isArray(parsed?.messages)
    ) {
      return parseSlackExportJson(source, parsed, options.usersMap || {}, options);
    }
    if (parsed?.issues || parsed?.tickets || parsed?.fields?.summary) {
      return parseTicketExportJson(source, parsed, options);
    }
  }

  return {
    source,
    modality: 'document',
    blocks: [
      makeBlock({
        source,
        modality: 'document',
        breadcrumb: source,
        text: UTF8_DEC.decode(u8),
        structRole: 'PROSE',
        parentSource: options.parentSource,
      }),
    ].filter(Boolean),
    attachments: [],
    forensicFindings: [],
  };
}

export function isEnterpriseFile(filename) {
  const lower = String(filename || '').toLowerCase();
  if (/(?:^|[/\\])\.env(?:\..+)?$/i.test(lower)) return true;
  if (lower.endsWith('.tar.gz')) return true;
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return ENTERPRISE_TEXT_EXTENSIONS.has(lower.slice(dot));
}
