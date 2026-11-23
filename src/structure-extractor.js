/**
 * Tier-0 Deterministic Structural Extractor (0 MB ML weights, zero external deps)
 *
 * Node.js port of Rtio/frontend/lib/verisieve/structure-extractor.ts:
 * Preserves document hierarchy, section breadcrumbs, repeated table headers,
 * DOCX styles/tables/footnotes (with bit-3 ZIP Central Directory support),
 * CSV/TSV row-0 column headers, and GFM Markdown tables + TOC JSON tree.
 */

import zlib from 'node:zlib';

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function normalizeHeadingTitle(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isLikelyRunningHeaderFooter(text, pageCounts) {
  const key = normalizeHeadingTitle(text).toLowerCase();
  if (!key || key.length > 110) return false;
  const pages = pageCounts.get(key);
  return Boolean(pages && pages.size >= 3);
}

function detectPdfBodyFontSize(records) {
  const weights = new Map();
  for (const rec of records) {
    const t = String(rec.text || '').trim();
    if (!t || !Number.isFinite(rec.fontSizePx) || rec.fontSizePx <= 0) continue;
    const bucket = Math.round(rec.fontSizePx * 2) / 2;
    weights.set(bucket, (weights.get(bucket) || 0) + t.length);
  }
  let bestSize = 11;
  let bestWeight = -1;
  for (const [size, weight] of weights.entries()) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestSize = size;
    }
  }
  return bestSize;
}

function inferPdfHeadingLevel(rec, bodySize) {
  const t = normalizeHeadingTitle(rec.text);
  if (t.length < 3 || t.length > 160) return null;
  if (!/[a-zA-Z]/.test(t)) return null;
  if (/^[•▪◦‣\-–—*]\s+/.test(t)) return null;
  if (/[.,;!?]$/.test(t)) return null;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 18) return null;

  const size = rec.fontSizePx || bodySize;
  if (size >= bodySize * 1.55) return 1;
  if (size >= bodySize * 1.2) return 2;
  if (
    rec.fontStyle === 'bold_stamp' &&
    size >= bodySize * 0.98 &&
    t.length <= 110 &&
    words.length <= 14
  ) {
    return 3;
  }
  return null;
}

class SectionTreeBuilder {
  constructor() {
    this.roots = [];
    this.stack = [];
    this.counter = 0;
  }

  pushHeading(title, level, pageNo) {
    const cleanTitle = normalizeHeadingTitle(title);
    const clampedLevel = Math.max(1, Math.min(6, level));

    while (this.stack.length > 0 && this.stack[this.stack.length - 1].level >= clampedLevel) {
      this.stack.pop();
    }

    const pathTitles = [...this.stack.map((n) => n.title), cleanTitle];
    const node = {
      nodeId: `sec:${this.counter++}`,
      title: cleanTitle,
      level: clampedLevel,
      pageStart: pageNo,
      pageEnd: pageNo,
      breadcrumb: pathTitles.join(' > '),
      children: [],
    };

    if (this.stack.length > 0) {
      this.stack[this.stack.length - 1].children.push(node);
    } else {
      this.roots.push(node);
    }
    this.stack.push(node);
    return node;
  }

  touchPage(pageNo) {
    if (pageNo === null || pageNo === undefined) return;
    for (const node of this.stack) {
      if (node.pageStart === null || pageNo < node.pageStart) node.pageStart = pageNo;
      if (node.pageEnd === null || pageNo > node.pageEnd) node.pageEnd = pageNo;
    }
  }

  currentPath() {
    return this.stack.map((n) => n.title);
  }

  currentBreadcrumb() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].breadcrumb : '';
  }

  currentSectionId() {
    return this.stack.length > 0 ? this.stack[this.stack.length - 1].nodeId : 'sec:root';
  }

  getRoots() {
    return this.roots;
  }
}

/**
 * Converts born-digital PdfLineRecord[] into section-grouped prose blocks with
 * hierarchical breadcrumbs and a deterministic PageIndex-compatible TOC tree.
 */
export function extractStructuredPdfBlocks(source, lineRecords = []) {
  if (!Array.isArray(lineRecords) || lineRecords.length === 0) {
    return { blocks: [], tree: [] };
  }

  const bodySize = detectPdfBodyFontSize(lineRecords);

  // Track identical short lines repeated across >= 3 distinct pages (running headers/footers)
  const pageCounts = new Map();
  for (const rec of lineRecords) {
    const key = normalizeHeadingTitle(rec.text).toLowerCase();
    if (!key || key.length > 110) continue;
    let set = pageCounts.get(key);
    if (!set) {
      set = new Set();
      pageCounts.set(key, set);
    }
    set.add(rec.pageIndex ?? 0);
  }

  const treeBuilder = new SectionTreeBuilder();
  const blocks = [];

  let accLines = [];
  let accPageStart = null;
  let accPageEnd = null;
  let accFontStyle = 'sans_serif';

  const flushSectionBody = () => {
    if (accLines.length === 0) return;
    const text = accLines.join('\n').trim();
    if (text.length >= 4) {
      blocks.push({
        text,
        source,
        breadcrumb: treeBuilder.currentBreadcrumb(),
        sectionPath: treeBuilder.currentPath(),
        sectionId: treeBuilder.currentSectionId(),
        pageStart: accPageStart,
        pageEnd: accPageEnd,
        fontStyle: accFontStyle,
        structRole: 'SECTION_BODY',
      });
    }
    accLines = [];
    accPageStart = null;
    accPageEnd = null;
    accFontStyle = 'sans_serif';
  };

  for (const rec of lineRecords) {
    const text = normalizeHeadingTitle(rec.text);
    if (!text) continue;
    if (isLikelyRunningHeaderFooter(text, pageCounts)) continue;

    const pageNo = Number.isFinite(rec.pageIndex) ? rec.pageIndex + 1 : 1;
    const headingLevel = inferPdfHeadingLevel(rec, bodySize);

    if (headingLevel !== null) {
      flushSectionBody();
      treeBuilder.pushHeading(text, headingLevel, pageNo);
      continue;
    }

    treeBuilder.touchPage(pageNo);
    if (accPageStart === null) {
      accPageStart = pageNo;
      accFontStyle = rec.fontStyle || 'sans_serif';
    }
    accPageEnd = pageNo;
    accLines.push(text);
  }

  flushSectionBody();

  if (blocks.length === 0 && lineRecords.length > 0) {
    const fallbackText = lineRecords
      .map((r) => normalizeHeadingTitle(r.text))
      .filter(Boolean)
      .join('\n');
    if (fallbackText.length >= 4) {
      blocks.push({
        text: fallbackText,
        source,
        breadcrumb: '',
        sectionPath: [],
        sectionId: 'sec:root',
        pageStart: 1,
        pageEnd: (lineRecords[lineRecords.length - 1].pageIndex ?? 0) + 1,
        fontStyle: 'sans_serif',
        structRole: 'PARAGRAPH',
      });
    }
  }

  return { blocks, tree: treeBuilder.getRoots() };
}

function looksLikeHeaderRow(row) {
  const nonEmpty = row.map((c) => String(c || '').trim()).filter(Boolean);
  if (nonEmpty.length === 0) return false;
  const alphaCells = nonEmpty.filter((c) => /[a-zA-Z]/.test(c)).length;
  return alphaCells >= Math.ceil(nonEmpty.length / 2);
}

/**
 * RFC-4180 delimited CSV/TSV parser supporting quoted commas and escaped quotes.
 */
export function parseDelimitedRows(rawText, delimiter) {
  const text = String(rawText || '');
  if (!text.trim()) return [];
  const sep = delimiter || (text.split(/\r?\n/)[0].includes('\t') && !text.split(/\r?\n/)[0].includes(',') ? '\t' : ',');

  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  row.push(cell);
  if (row.some((c) => c.trim().length > 0)) rows.push(row);
  return rows;
}

/**
 * Formats parsed CSV/TSV rows so column headers from row 0 are preserved and
 * repeated on every data row (preventing header loss during chunking/retrieval).
 */
export function formatDelimitedTableBlocks(source, parsedRows = [], options = {}) {
  if (!Array.isArray(parsedRows) || parsedRows.length === 0) {
    return { blocks: [], tree: [] };
  }

  const breadcrumb = options.breadcrumb || '';
  const sectionPath = options.sectionPath || (breadcrumb ? breadcrumb.split(' > ') : []);
  const sectionId = options.sectionId || 'sec:table';

  const hasHeader = parsedRows.length > 1 && looksLikeHeaderRow(parsedRows[0]);
  const headers = hasHeader ? parsedRows[0].map((h, i) => String(h || '').trim() || `Column ${i + 1}`) : [];
  const dataRows = hasHeader ? parsedRows.slice(1) : parsedRows;

  const blocks = [];
  for (const cells of dataRows) {
    let text;
    if (hasHeader) {
      const pairs = [];
      for (let i = 0; i < cells.length; i++) {
        const val = String(cells[i] || '').trim();
        if (!val) continue;
        const col = headers[i] || `Column ${i + 1}`;
        pairs.push(`${col}: ${val}`);
      }
      text = pairs.join(' | ');
    } else {
      text = cells.map((c) => String(c || '').trim()).filter(Boolean).join(' | ');
    }
    if (text.length >= 4) {
      blocks.push({
        text,
        source,
        breadcrumb,
        sectionPath,
        sectionId,
        pageStart: null,
        pageEnd: null,
        fontStyle: 'sans_serif',
        structRole: 'TABLE_ROW',
        tableHeaders: hasHeader ? headers : [],
      });
    }
  }

  return { blocks, tree: [] };
}

function locateZipEntriesViaCentralDirectory(buffer, targetNames) {
  const found = new Map();
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return null;

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  let pos = cdOffset;

  for (let i = 0; i < totalEntries && pos + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(pos) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(pos + 10);
    const compressedSize = buffer.readUInt32LE(pos + 20);
    const uncompressedSize = buffer.readUInt32LE(pos + 24);
    const fileNameLen = buffer.readUInt16LE(pos + 28);
    const extraLen = buffer.readUInt16LE(pos + 30);
    const commentLen = buffer.readUInt16LE(pos + 32);
    const localHeaderOffset = buffer.readUInt32LE(pos + 42);
    const fileName = buffer.toString('utf8', pos + 46, pos + 46 + fileNameLen);

    if (targetNames.has(fileName) || targetNames.has(fileName.toLowerCase())) {
      found.set(fileName.toLowerCase(), {
        compressionMethod,
        compressedSize,
        uncompressedSize,
        localHeaderOffset,
      });
    }
    pos += 46 + fileNameLen + extraLen + commentLen;
  }
  return found;
}

function inflateZipEntrySafe(buffer, dataOffset, compressionMethod, compressedSize, uncompressedSize, options = {}) {
  const maxUncompressedBytes = options.maxUncompressedBytes ?? 32 * 1024 * 1024;
  const maxCompressionRatio = options.maxCompressionRatio ?? 250;
  if (dataOffset < 0 || compressedSize < 0 || dataOffset + compressedSize > buffer.length) {
    return '';
  }
  if (uncompressedSize > maxUncompressedBytes) {
    throw new Error(`DOCX_ZIP_BOMB_DETECTED: Declared uncompressed size (${uncompressedSize}) exceeds limit (${maxUncompressedBytes})`);
  }
  const fileData = buffer.subarray(dataOffset, dataOffset + compressedSize);
  let inflated;
  if (compressionMethod === 8) {
    inflated = zlib.inflateRawSync(fileData, { maxOutputLength: maxUncompressedBytes });
  } else if (compressionMethod === 0) {
    inflated = fileData;
    if (inflated.length > maxUncompressedBytes) {
      throw new Error(`DOCX_ZIP_BOMB_DETECTED: Stored entry exceeds limit (${maxUncompressedBytes})`);
    }
  } else {
    return '';
  }
  const ratio = inflated.length / Math.max(compressedSize, 1024);
  if (ratio > maxCompressionRatio) {
    throw new Error(`DOCX_ZIP_BOMB_DETECTED: Compression ratio ${ratio.toFixed(1)}x exceeds max ${maxCompressionRatio}x`);
  }
  return inflated.toString('utf8');
}

function extractZipXmlEntriesSync(buffer, targetNames, options = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  const found = new Map();
  const cdEntries = locateZipEntriesViaCentralDirectory(buf, targetNames);

  if (cdEntries) {
    for (const [name, entry] of cdEntries.entries()) {
      const lfhOff = entry.localHeaderOffset;
      if (lfhOff + 30 > buf.length || buf.readUInt32LE(lfhOff) !== 0x04034b50) continue;
      const lfhNameLen = buf.readUInt16LE(lfhOff + 26);
      const lfhExtraLen = buf.readUInt16LE(lfhOff + 28);
      const dataOffset = lfhOff + 30 + lfhNameLen + lfhExtraLen;
      const xml = inflateZipEntrySafe(
        buf,
        dataOffset,
        entry.compressionMethod,
        entry.compressedSize,
        entry.uncompressedSize,
        options
      );
      if (xml) found.set(name, xml);
    }
    return found;
  }

  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }
    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const uncompressedSize = buf.readUInt32LE(offset + 22);
    const fileNameLen = buf.readUInt16LE(offset + 26);
    const extraFieldLen = buf.readUInt16LE(offset + 28);
    const fileName = buf.toString('utf8', offset + 30, offset + 30 + fileNameLen);
    const dataOffset = offset + 30 + fileNameLen + extraFieldLen;

    if (targetNames.has(fileName) || targetNames.has(fileName.toLowerCase())) {
      const xml = inflateZipEntrySafe(buf, dataOffset, compressionMethod, compressedSize, uncompressedSize, options);
      if (xml) found.set(fileName.toLowerCase(), xml);
    }
    offset = compressedSize > 0 ? dataOffset + compressedSize : offset + 4;
  }
  return found;
}

function extractParagraphText(pXml) {
  const cleaned = String(pXml || '')
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/gi, '')
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/gi, '');
  let pText = '';
  const tokRegex = /<(w:t|w:tab|w:br|w:cr)\b[^>]*(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let tok;
  while ((tok = tokRegex.exec(cleaned)) !== null) {
    const tag = tok[1].toLowerCase();
    if (tag === 'w:tab') pText += '\t';
    else if (tag === 'w:br' || tag === 'w:cr') pText += ' ';
    else if (tok[2] !== undefined) pText += decodeXmlEntities(tok[2]);
  }
  return pText.replace(/[ \f\v]+/g, ' ').trim();
}

function inferDocxHeadingLevel(pXml) {
  const styleMatch = String(pXml || '').match(/<w:pStyle\b[^>]*w:val="([^"]+)"/i);
  if (!styleMatch) return null;
  const val = styleMatch[1].trim();
  if (/^title$/i.test(val)) return 1;
  const headingMatch = val.match(/^Heading\s*([1-6])$/i);
  if (headingMatch) return Number(headingMatch[1]);
  return null;
}

/**
 * Extracts structured blocks (headings + breadcrumbs, tables with repeated column headers,
 * paragraphs, and footnotes) + TOC tree from a binary DOCX ZIP buffer.
 */
export function extractDocxStructured(source, buffer, options = {}) {
  const entries = extractZipXmlEntriesSync(
    buffer,
    new Set(['word/document.xml', 'word/footnotes.xml']),
    options
  );
  const documentXml = entries.get('word/document.xml') || '';
  if (!documentXml) return { blocks: [], tree: [] };

  const treeBuilder = new SectionTreeBuilder();
  const blocks = [];

  let accParagraphs = [];
  const flushParagraphs = () => {
    if (accParagraphs.length === 0) return;
    const text = accParagraphs.join('\n').trim();
    if (text.length >= 4) {
      blocks.push({
        text,
        source,
        breadcrumb: treeBuilder.currentBreadcrumb(),
        sectionPath: treeBuilder.currentPath(),
        sectionId: treeBuilder.currentSectionId(),
        pageStart: null,
        pageEnd: null,
        fontStyle: 'sans_serif',
        structRole: 'SECTION_BODY',
      });
    }
    accParagraphs = [];
  };

  const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*?)<\/w:body>/);
  const bodyXml = bodyMatch ? bodyMatch[1] : documentXml;
  const tokenRegex = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

  let matchedAny = false;
  for (const match of bodyXml.matchAll(tokenRegex)) {
    matchedAny = true;
    const snippet = match[0];

    if (snippet.startsWith('<w:tbl')) {
      flushParagraphs();
      const rows = [];
      for (const tr of snippet.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        const cells = [];
        for (const tc of tr[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
          const cellParts = [];
          for (const cp of tc[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
            const ct = extractParagraphText(cp[0]);
            if (ct) cellParts.push(ct);
          }
          cells.push(cellParts.join(' ').trim());
        }
        if (cells.some(Boolean)) rows.push(cells);
      }

      if (rows.length > 0) {
        const tableOut = formatDelimitedTableBlocks(source, rows, {
          breadcrumb: treeBuilder.currentBreadcrumb(),
          sectionPath: treeBuilder.currentPath(),
          sectionId: treeBuilder.currentSectionId(),
        });
        blocks.push(...tableOut.blocks);
      }
      continue;
    }

    const pText = extractParagraphText(snippet);
    if (!pText) continue;
    const headingLevel = inferDocxHeadingLevel(snippet);
    if (headingLevel !== null) {
      flushParagraphs();
      treeBuilder.pushHeading(pText, headingLevel, null);
    } else {
      accParagraphs.push(pText);
    }
  }

  flushParagraphs();

  if (!matchedAny && blocks.length === 0) {
    const runs = [];
    for (const tm of documentXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
      runs.push(decodeXmlEntities(tm[1]));
    }
    const fallback = runs.join(' ').replace(/\s+/g, ' ').trim();
    if (fallback.length >= 4) {
      blocks.push({
        text: fallback,
        source,
        breadcrumb: '',
        sectionPath: [],
        sectionId: 'sec:root',
        pageStart: null,
        pageEnd: null,
        fontStyle: 'sans_serif',
        structRole: 'PARAGRAPH',
      });
    }
  }

  const footnotesXml = entries.get('word/footnotes.xml') || '';
  if (footnotesXml) {
    for (const fnMatch of footnotesXml.matchAll(/<w:footnote\b([^>]*)>([\s\S]*?)<\/w:footnote>/g)) {
      const attrs = fnMatch[1];
      if (/w:type="(separator|continuationSeparator)"/i.test(attrs)) continue;
      if (/w:id="(?:-1|0)"/.test(attrs)) continue;
      const fnParts = [];
      for (const fp of fnMatch[2].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
        const ft = extractParagraphText(fp[0]);
        if (ft) fnParts.push(ft);
      }
      const fnText = fnParts.join(' ').trim();
      if (fnText.length >= 4) {
        blocks.push({
          text: fnText,
          source,
          breadcrumb: 'Footnotes',
          sectionPath: ['Footnotes'],
          sectionId: 'sec:footnotes',
          pageStart: null,
          pageEnd: null,
          fontStyle: 'sans_serif',
          structRole: 'FOOTNOTE',
        });
      }
    }
  }

  return { blocks, tree: treeBuilder.getRoots() };
}

function splitMarkdownTableRow(line) {
  let trimmed = String(line || '').trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((c) => c.trim());
}

function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}

/**
 * Parses Markdown heading hierarchy (# .. ######) AND GFM tables into
 * section-grouped blocks and a deterministic TOC tree.
 */
export function extractMarkdownStructured(source, rawText) {
  const treeBuilder = new SectionTreeBuilder();
  const blocks = [];
  const lines = String(rawText || '').split(/\r?\n/);

  let acc = [];
  const flush = () => {
    if (!acc.length) return;
    const text = acc.join('\n').trim();
    if (text.length >= 4) {
      blocks.push({
        text,
        source,
        breadcrumb: treeBuilder.currentBreadcrumb(),
        sectionPath: treeBuilder.currentPath(),
        sectionId: treeBuilder.currentSectionId(),
        pageStart: null,
        pageEnd: null,
        fontStyle: 'sans_serif',
        structRole: 'SECTION_BODY',
      });
    }
    acc = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flush();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      treeBuilder.pushHeading(headingMatch[2], headingMatch[1].length, null);
      continue;
    }

    // Detect GFM Markdown table: header row + separator row
    if (trimmed.includes('|') && i + 1 < lines.length && isMarkdownTableSeparator(lines[i + 1])) {
      flush();
      const tableRows = [splitMarkdownTableRow(trimmed)];
      i += 2;
      while (i < lines.length) {
        const rowLine = lines[i].trim();
        if (!rowLine || !rowLine.includes('|') || /^#{1,6}\s+/.test(rowLine)) {
          i--;
          break;
        }
        tableRows.push(splitMarkdownTableRow(rowLine));
        i++;
      }
      const tableOut = formatDelimitedTableBlocks(source, tableRows, {
        breadcrumb: treeBuilder.currentBreadcrumb(),
        sectionPath: treeBuilder.currentPath(),
        sectionId: treeBuilder.currentSectionId(),
      });
      blocks.push(...tableOut.blocks);
      continue;
    }

    acc.push(trimmed);
  }
  flush();

  return { blocks, tree: treeBuilder.getRoots() };
}
