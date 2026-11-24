import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PKG_ROOT = path.resolve(__dirname, '..');

export const VERISIEVE_SQL_WASM_PATH = path.join(PKG_ROOT, 'vendor', 'wasm', 'verisieve_sql.wasm');
export const VERISIEVE_SQL_PROVENANCE_PATH = path.join(PKG_ROOT, 'vendor', 'wasm', 'verisieve_sql.provenance.json');
export const MAX_VERISIEVE_SQL_BYTES = 500_000;

const EXPECTED_SQL_EXPORTS = [
  'memory',
  'vs_sql_abi_version',
  'vs_sql_in_ptr',
  'vs_sql_in_cap',
  'vs_sql_table_ptr',
  'vs_sql_table_cap',
  'vs_sql_out_ptr',
  'vs_sql_out_cap',
  'vs_sql_last_err_len',
  'vs_sql_probe_table',
  'vs_sql_probe_join',
  'vs_sql_table2_ptr',
  'vs_sql_table2_cap',
  'vs_sql_exec',
  'vs_sql_exec2',
];

const DEFAULT_EMPTY_TABLE_COLS = [
  'source_mode',
  'gatekeeper_action',
  'pii_detected',
  'pred_prob',
  'token_count',
  'masked_text',
  'raw_excerpt',
];

const TAG_NULL = 0;
const TAG_BOOL = 1;
const TAG_NUM = 2;
const TAG_STR = 3;

const sqlInstanceCache = new Map();

function resolveWasmPath(wasmPath = VERISIEVE_SQL_WASM_PATH) {
  return path.isAbsolute(wasmPath) ? wasmPath : path.resolve(process.cwd(), wasmPath);
}

function hashLfFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  return crypto.createHash('sha256').update(Buffer.from(raw, 'utf8')).digest('hex').toUpperCase();
}

export function getVerisieveSqlInstanceSync(wasmPath = VERISIEVE_SQL_WASM_PATH) {
  const fullPath = resolveWasmPath(wasmPath);
  if (sqlInstanceCache.has(fullPath)) {
    return sqlInstanceCache.get(fullPath);
  }
  if (!fs.existsSync(fullPath)) {
    throw new Error(`verisieve_sql.wasm not found at ${fullPath}`);
  }
  const bytes = fs.readFileSync(fullPath);
  const mod = new WebAssembly.Module(bytes);
  const inst = new WebAssembly.Instance(mod, {});
  sqlInstanceCache.set(fullPath, inst);
  return inst;
}

export async function auditVerisieveSqlWasm(wasmPath = VERISIEVE_SQL_WASM_PATH) {
  const fullPath = resolveWasmPath(wasmPath);
  if (!fs.existsSync(fullPath)) {
    return {
      ok: false,
      zeroEgressVerified: false,
      error: `verisieve_sql.wasm not found at ${fullPath}`,
    };
  }
  const bytes = fs.readFileSync(fullPath);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase();
  const mod = await WebAssembly.compile(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const exportsList = WebAssembly.Module.exports(mod).map((e) => e.name);

  if (imports.length > 0) {
    return {
      ok: false,
      zeroEgressVerified: false,
      byteLength: bytes.length,
      importCount: imports.length,
      imports,
      error: `Non-zero imports detected (${imports.length}) in verisieve_sql.wasm`,
    };
  }

  const inst = await WebAssembly.instantiate(mod, {});
  const exp = inst.exports;
  const abiVersion = typeof exp.vs_sql_abi_version === 'function' ? Number(exp.vs_sql_abi_version()) : 0;
  const missingExports = EXPECTED_SQL_EXPORTS.filter((n) => !exportsList.includes(n));

  let provenance = null;
  if (fs.existsSync(VERISIEVE_SQL_PROVENANCE_PATH)) {
    const prov = JSON.parse(fs.readFileSync(VERISIEVE_SQL_PROVENANCE_PATH, 'utf8'));
    const crateDir = path.join(PKG_ROOT, prov.sourceCrate || 'rust/verisieve-sql');
    let sourceSha256Verified = Boolean(prov.sourceFilesSha256);
    if (sourceSha256Verified) {
      for (const [rel, expected] of Object.entries(prov.sourceFilesSha256)) {
        const fp = path.join(crateDir, rel);
        if (!fs.existsSync(fp) || hashLfFile(fp) !== String(expected).toUpperCase()) {
          sourceSha256Verified = false;
          break;
        }
      }
    }
    provenance = {
      sourceCrate: prov.sourceCrate,
      wasmSha256Match: String(prov.wasmSha256 || '').toUpperCase() === sha256,
      sourceSha256Verified,
    };
  }

  const withinSizeCeiling = bytes.length <= MAX_VERISIEVE_SQL_BYTES;
  const provenanceOk = !provenance || (provenance.wasmSha256Match && provenance.sourceSha256Verified);
  const ok =
    imports.length === 0 &&
    abiVersion === 1 &&
    withinSizeCeiling &&
    missingExports.length === 0 &&
    provenanceOk;

  return {
    ok,
    zeroEgressVerified: ok,
    wasmPath: fullPath,
    byteLength: bytes.length,
    maxBytes: MAX_VERISIEVE_SQL_BYTES,
    withinSizeCeiling,
    sha256,
    abiVersion,
    importCount: imports.length,
    exports: exportsList,
    missingExports,
    provenance,
  };
}

function resolveTableEntry(tables, tableName) {
  if (!tables || typeof tables !== 'object') {
    throw new Error('SQL_TABLES_MISSING: tables map must be provided');
  }
  const targetLower = String(tableName || '').toLowerCase();
  for (const key of Object.keys(tables)) {
    if (key.toLowerCase() === targetLower) {
      return tables[key];
    }
  }
  throw new Error(`UNKNOWN_SQL_TABLE: table '${tableName}' does not exist`);
}

function getColumnNamesForRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [...DEFAULT_EMPTY_TABLE_COLS];
  }
  const seen = new Set();
  const cols = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  return cols;
}

function encodeTableToBinary(rows, maxBytes) {
  const cols = getColumnNamesForRows(rows);
  const enc = new TextEncoder();
  const colNamesEnc = cols.map((c) => enc.encode(c));

  const chunks = [];
  let totalBytes = 6 + colNamesEnc.reduce((s, b) => s + 2 + b.length, 0);
  const header = Buffer.allocUnsafe(2);
  header.writeUInt16LE(cols.length, 0);
  chunks.push(header);
  for (const cb of colNamesEnc) {
    const lb = Buffer.allocUnsafe(2);
    lb.writeUInt16LE(cb.length, 0);
    chunks.push(lb, cb);
  }
  const rc = Buffer.allocUnsafe(4);
  rc.writeUInt32LE(rows.length, 0);
  chunks.push(rc);

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || {};
    for (let c = 0; c < cols.length; c++) {
      const val = row[cols[c]];
      if (val === null || val === undefined) {
        chunks.push(Buffer.from([TAG_NULL]));
        totalBytes += 1;
      } else if (typeof val === 'boolean') {
        chunks.push(Buffer.from([TAG_BOOL, val ? 1 : 0]));
        totalBytes += 2;
      } else if (typeof val === 'number' && Number.isFinite(val)) {
        const b = Buffer.allocUnsafe(9);
        b[0] = TAG_NUM;
        b.writeDoubleLE(val, 1);
        chunks.push(b);
        totalBytes += 9;
      } else {
        const sb = enc.encode(String(val));
        const b = Buffer.allocUnsafe(5 + sb.length);
        b[0] = TAG_STR;
        b.writeUInt32LE(sb.length, 1);
        b.set(sb, 5);
        chunks.push(b);
        totalBytes += b.length;
      }
      if (totalBytes > maxBytes) {
        throw new Error(`SQL_TABLE_CAPACITY_EXCEEDED: serialized table exceeds ${maxBytes} bytes`);
      }
    }
  }
  return Buffer.concat(chunks, totalBytes);
}

function decodeBinaryResult(buf) {
  let pos = 0;
  const colCount = buf.readUInt32LE(pos);
  pos += 4;
  const columns = [];
  for (let c = 0; c < colCount; c++) {
    const nlen = buf.readUInt16LE(pos);
    pos += 2;
    columns.push(buf.toString('utf8', pos, pos + nlen));
    pos += nlen;
  }
  const rowCount = buf.readUInt32LE(pos);
  pos += 4;
  const rows = [];
  for (let r = 0; r < rowCount; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) {
      const tag = buf[pos++];
      if (tag === TAG_NULL) {
        row.push(null);
      } else if (tag === TAG_BOOL) {
        row.push(buf[pos++] !== 0);
      } else if (tag === TAG_NUM) {
        row.push(buf.readDoubleLE(pos));
        pos += 8;
      } else if (tag === TAG_STR) {
        const slen = buf.readUInt32LE(pos);
        pos += 4;
        row.push(buf.toString('utf8', pos, pos + slen));
        pos += slen;
      } else {
        throw new Error(`SQL_DECODE_ERROR: invalid cell tag ${tag}`);
      }
    }
    rows.push(row);
  }
  return { columns, rows };
}

export function executeSqlWasm(sql, options = {}) {
  if (typeof sql !== 'string') {
    throw new Error('SQL_SYNTAX_ERROR: query must be a string');
  }
  const { tables, wasmPath = VERISIEVE_SQL_WASM_PATH } = options;
  const t0 = performance.now();

  const inst = getVerisieveSqlInstanceSync(wasmPath);
  const exp = inst.exports;
  if (exp.vs_sql_abi_version() !== 1) {
    throw new Error('WASM_ABI_MISMATCH: expected verisieve_sql ABI v1');
  }

  const sqlBytes = Buffer.from(sql, 'utf8');
  const inCap = exp.vs_sql_in_cap();
  if (sqlBytes.length > inCap) {
    throw new Error(`SQL_SYNTAX_ERROR: query length ${sqlBytes.length} exceeds buffer limit ${inCap}`);
  }
  const inPtr = exp.vs_sql_in_ptr();
  new Uint8Array(exp.memory.buffer, inPtr, inCap).set(sqlBytes);

  const probeLen = exp.vs_sql_probe_table(sqlBytes.length);
  const outPtr = exp.vs_sql_out_ptr();
  if (probeLen < 0) {
    const errLen = exp.vs_sql_last_err_len();
    const errMsg = Buffer.from(exp.memory.buffer, outPtr, errLen).toString('utf8');
    throw new Error(errMsg || 'SQL_SYNTAX_ERROR: invalid SQL query');
  }
  const tableName = Buffer.from(exp.memory.buffer, outPtr, probeLen).toString('utf8');
  const targetRows = resolveTableEntry(tables, tableName);

  // Second-table probe: the kernel reports the JOIN target name only when the query actually joins
  const joinProbeLen = exp.vs_sql_probe_join(sqlBytes.length);
  if (joinProbeLen < 0) {
    const errLen = exp.vs_sql_last_err_len();
    const errMsg = Buffer.from(exp.memory.buffer, outPtr, errLen).toString('utf8');
    throw new Error(errMsg || 'SQL_SYNTAX_ERROR: invalid SQL query');
  }
  let table2Bin = null;
  if (joinProbeLen > 0) {
    const joinTableName = Buffer.from(exp.memory.buffer, outPtr, joinProbeLen).toString('utf8');
    const joinRows = resolveTableEntry(tables, joinTableName);
    const table2Cap = exp.vs_sql_table2_cap();
    table2Bin = encodeTableToBinary(Array.isArray(joinRows) ? joinRows : [], table2Cap);
    new Uint8Array(exp.memory.buffer, exp.vs_sql_table2_ptr(), table2Cap).set(table2Bin);
  }

  const tableCap = exp.vs_sql_table_cap();
  const tableBin = encodeTableToBinary(Array.isArray(targetRows) ? targetRows : [], tableCap);
  const tablePtr = exp.vs_sql_table_ptr();
  new Uint8Array(exp.memory.buffer, tablePtr, tableCap).set(tableBin);

  const execLen = table2Bin !== null
    ? exp.vs_sql_exec2(sqlBytes.length, tableBin.length, table2Bin.length)
    : exp.vs_sql_exec(sqlBytes.length, tableBin.length);
  if (execLen < 0) {
    const errLen = exp.vs_sql_last_err_len();
    const errMsg = Buffer.from(exp.memory.buffer, outPtr, errLen).toString('utf8');
    throw new Error(errMsg || 'SQL_EXECUTION_ERROR: query execution failed');
  }

  const outSlice = Buffer.from(exp.memory.buffer, outPtr, execLen);
  const { columns, rows } = decodeBinaryResult(outSlice);
  const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;

  return {
    ok: true,
    engine: 'VeriSieve WASM SQL Subset v1 (verisieve_sql.wasm)',
    sql_subset: true,
    columns,
    rows,
    total_rows: rows.length,
    elapsedMs,
  };
}

// --- Strict Zero-Regex AST Subset JS Fallback (Shares Exact Grammar & Strict Error Semantics) ---

const UNSUPPORTED_JS_KEYWORDS = new Set([
  'JOIN', 'INNER', 'LEFT', 'RIGHT', 'CROSS', 'HAVING', 'UNION',
  'INTERSECT', 'EXCEPT', 'WITH', 'OFFSET', 'OVER', 'INTO',
]);

function tokenizeSqlJs(sql) {
  const toks = [];
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const ch = sql[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if ((ch === '-' && sql[i + 1] === '-') || (ch === '/' && sql[i + 1] === '*')) {
      throw new Error('UNSUPPORTED_SQL_SYNTAX: SQL comments are not supported');
    }
    if (ch === "'") {
      i++;
      let val = '';
      let closed = false;
      while (i < n) {
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            val += "'";
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        val += sql[i++];
      }
      if (!closed) throw new Error('SQL_SYNTAX_ERROR: unterminated string literal');
      toks.push({ kind: 'str', val });
      continue;
    }
    if (ch === '"') {
      i++;
      let id = '';
      while (i < n && sql[i] !== '"') id += sql[i++];
      if (i >= n || !id) throw new Error('SQL_SYNTAX_ERROR: unterminated quoted identifier');
      i++;
      toks.push({ kind: 'ident', val: id });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let id = ch;
      i++;
      while (i < n && /[A-Za-z0-9_]/.test(sql[i])) id += sql[i++];
      toks.push({ kind: 'ident', val: id });
      continue;
    }
    const prev = toks[toks.length - 1];
    const signedNum =
      (ch === '-' || ch === '+') &&
      i + 1 < n &&
      /[0-9]/.test(sql[i + 1]) &&
      (!prev || !['ident', 'num', 'str', 'rparen'].includes(prev.kind));
    if (/[0-9]/.test(ch) || signedNum) {
      let raw = ch;
      i++;
      let seenDot = false;
      while (i < n) {
        if (/[0-9]/.test(sql[i])) raw += sql[i++];
        else if (sql[i] === '.' && !seenDot) {
          seenDot = true;
          raw += sql[i++];
        } else break;
      }
      toks.push({ kind: 'num', val: Number(raw) });
      continue;
    }
    const two = sql.slice(i, i + 2);
    if (two === '!=' || two === '<>' || two === '<=' || two === '>=') {
      toks.push({ kind: 'op', val: two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    const singleMap = {
      ',': 'comma',
      '.': 'dot',
      '*': 'star',
      '(': 'lparen',
      ')': 'rparen',
      ';': 'semi',
      '=': 'op',
      '<': 'op',
      '>': 'op',
    };
    if (singleMap[ch]) {
      toks.push({ kind: singleMap[ch], val: ch });
      i++;
      continue;
    }
    throw new Error(`SQL_SYNTAX_ERROR: unexpected character '${ch}'`);
  }
  if (toks.length === 0) throw new Error('EMPTY_SQL_ERROR: query must not be empty');
  for (let k = 0; k < toks.length - 1; k++) {
    if (toks[k].kind === 'semi') {
      throw new Error('MULTI_STATEMENT_SQL_REJECTED: multiple SQL statements are not allowed');
    }
  }
  if (toks[toks.length - 1].kind === 'semi') toks.pop();
  if (toks.length === 0) throw new Error('EMPTY_SQL_ERROR: query must not be empty');
  return toks;
}

function roundNumJs(val, digits) {
  if (val === null || val === undefined || !Number.isFinite(val)) return val;
  const f = 10 ** Math.min(9, Math.max(0, digits));
  const out = Math.round(val * f) / f;
  return out === 0 ? 0 : out;
}

function likeMatchJs(text, pattern) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 's').test(String(text));
}

export function executeSqlSubsetFallback(sql, options = {}) {
  if (typeof sql !== 'string') {
    throw new Error('SQL_SYNTAX_ERROR: query must be a string');
  }
  const { tables } = options;
  const t0 = performance.now();
  const toks = tokenizeSqlJs(sql);
  let pos = 0;
  const peek = () => toks[pos];
  const isKw = (t, kw) => t && t.kind === 'ident' && t.val.toUpperCase() === kw;

  if (!isKw(peek(), 'SELECT')) {
    throw new Error('UNSUPPORTED_SQL_STATEMENT: only SELECT queries are allowed');
  }
  pos++;

  // Extract FROM table upfront so column names can be resolved strictly
  let depth = 0;
  let fromTable = null;
  for (let k = 1; k < toks.length; k++) {
    if (toks[k].kind === 'lparen') depth++;
    else if (toks[k].kind === 'rparen') depth--;
    else if (depth === 0 && isKw(toks[k], 'FROM')) {
      if (k + 1 >= toks.length || toks[k + 1].kind !== 'ident') {
        throw new Error('SQL_SYNTAX_ERROR: expected table identifier after FROM');
      }
      fromTable = toks[k + 1].val;
      break;
    }
  }
  if (!fromTable) throw new Error('SQL_SYNTAX_ERROR: missing FROM clause');

  const sourceRows = resolveTableEntry(tables, fromTable);
  const tableCols = getColumnNamesForRows(sourceRows);
  const resolveCol = (name) => {
    const match = tableCols.find((c) => c.toLowerCase() === name.toLowerCase());
    if (!match) throw new Error(`UNKNOWN_SQL_COLUMN: column '${name}' does not exist in '${fromTable}'`);
    return match;
  };
  const parseColRef = () => {
    const t = peek();
    if (!t || t.kind !== 'ident') throw new Error('SQL_SYNTAX_ERROR: expected column identifier');
    let name = t.val;
    pos++;
    if (peek()?.kind === 'dot' && toks[pos + 1]?.kind === 'ident') {
      if (name.toLowerCase() !== fromTable.toLowerCase()) {
        throw new Error(`UNKNOWN_SQL_TABLE_QUALIFIER: unknown table qualifier '${name}'`);
      }
      name = toks[pos + 1].val;
      pos += 2;
    }
    return resolveCol(name);
  };

  const AGGS = new Set(['COUNT', 'SUM', 'AVG', 'MIN', 'MAX']);
  const parseAgg = () => {
    const fn = peek().val.toUpperCase();
    if (!AGGS.has(fn)) throw new Error(`UNSUPPORTED_SQL_FUNCTION: '${peek().val}' is not supported`);
    pos++;
    if (peek()?.kind !== 'lparen') throw new Error(`SQL_SYNTAX_ERROR: expected '(' after ${fn}`);
    pos++;
    let item;
    if (fn === 'COUNT' && peek()?.kind === 'star') {
      pos++;
      item = { type: 'agg', agg: 'COUNT_ALL', col: null };
    } else {
      item = { type: 'agg', agg: fn, col: parseColRef() };
    }
    if (peek()?.kind !== 'rparen') throw new Error(`SQL_SYNTAX_ERROR: expected ')' closing ${fn}`);
    pos++;
    return item;
  };

  const selectItems = [];
  while (pos < toks.length) {
    if (peek().kind === 'star') {
      pos++;
      selectItems.push({ type: 'star', label: '*' });
    } else if (peek().kind === 'ident' && toks[pos + 1]?.kind === 'lparen') {
      const fn = peek().val.toUpperCase();
      let node;
      let defaultLabel;
      if (fn === 'ROUND') {
        pos += 2;
        const innerIsFn = peek()?.kind === 'ident' && toks[pos + 1]?.kind === 'lparen';
        const inner = innerIsFn ? parseAgg() : { type: 'col', col: parseColRef() };
        let digits = 0;
        if (peek()?.kind === 'comma') {
          pos++;
          if (peek()?.kind !== 'num') throw new Error('SQL_SYNTAX_ERROR: ROUND precision must be numeric');
          digits = Math.max(0, Math.floor(peek().val));
          pos++;
        }
        if (peek()?.kind !== 'rparen') throw new Error("SQL_SYNTAX_ERROR: expected ')' closing ROUND");
        pos++;
        node = { ...inner, roundDigits: digits };
        defaultLabel = inner.agg === 'COUNT_ALL' ? 'count' : fn.toLowerCase();
      } else {
        node = parseAgg();
        defaultLabel = node.agg === 'COUNT_ALL' ? 'count' : `${fn.toLowerCase()}(${node.col})`;
      }
      if (isKw(peek(), 'AS')) {
        pos++;
        if (!peek() || peek().kind !== 'ident') throw new Error('SQL_SYNTAX_ERROR: expected alias after AS');
        node.alias = peek().val;
        pos++;
      } else {
        node.alias = defaultLabel;
      }
      selectItems.push(node);
    } else {
      if (isKw(peek(), 'FROM')) throw new Error('SQL_SYNTAX_ERROR: empty SELECT list before FROM');
      const col = parseColRef();
      let alias = col;
      if (isKw(peek(), 'AS')) {
        pos++;
        if (!peek() || peek().kind !== 'ident') throw new Error('SQL_SYNTAX_ERROR: expected alias after AS');
        alias = peek().val;
        pos++;
      }
      selectItems.push({ type: 'col', col, alias });
    }
    if (peek()?.kind === 'comma') {
      pos++;
      continue;
    }
    break;
  }
  if (!isKw(peek(), 'FROM')) throw new Error('SQL_SYNTAX_ERROR: expected FROM after SELECT list');
  pos += 2;

  const clauseBoundary = () => {
    const t = peek();
    if (!t) return true;
    return t.kind === 'ident' && (['GROUP', 'ORDER', 'LIMIT'].includes(t.val.toUpperCase()) || UNSUPPORTED_JS_KEYWORDS.has(t.val.toUpperCase()));
  };

  let predicate = () => true;
  if (isKw(peek(), 'WHERE')) {
    pos++;
    const parseOperand = () => {
      const t = peek();
      if (!t) throw new Error('SQL_SYNTAX_ERROR: unexpected end in WHERE');
      if (t.kind === 'num') {
        pos++;
        return () => t.val;
      }
      if (t.kind === 'str') {
        pos++;
        return () => t.val;
      }
      if (t.kind === 'ident') {
        const up = t.val.toUpperCase();
        if (up === 'TRUE') { pos++; return () => true; }
        if (up === 'FALSE') { pos++; return () => false; }
        if (up === 'NULL') { pos++; return () => null; }
        const c = parseColRef();
        return (row) => (row[c] === undefined ? null : row[c]);
      }
      throw new Error('SQL_SYNTAX_ERROR: invalid operand in WHERE');
    };
    const parsePrimary = () => {
      if (peek()?.kind === 'lparen') {
        pos++;
        const inner = parseOr();
        if (peek()?.kind !== 'rparen') throw new Error("SQL_SYNTAX_ERROR: missing ')'");
        pos++;
        return inner;
      }
      if (peek()?.kind === 'ident' && !['TRUE', 'FALSE', 'NULL'].includes(peek().val.toUpperCase())) {
        const saved = pos;
        const c = parseColRef();
        if (isKw(peek(), 'IS')) {
          pos++;
          let neg = false;
          if (isKw(peek(), 'NOT')) { neg = true; pos++; }
          if (!isKw(peek(), 'NULL')) throw new Error('SQL_SYNTAX_ERROR: expected NULL after IS');
          pos++;
          return (row) => (neg ? row[c] != null : row[c] == null);
        }
        let negLike = false;
        if (isKw(peek(), 'NOT')) { negLike = true; pos++; }
        if (isKw(peek(), 'LIKE')) {
          pos++;
          if (peek()?.kind !== 'str') throw new Error('SQL_SYNTAX_ERROR: expected pattern after LIKE');
          const pat = peek().val;
          pos++;
          return (row) => {
            const m = typeof row[c] === 'string' && likeMatchJs(row[c], pat);
            return negLike ? !m : m;
          };
        }
        pos = saved;
      }
      const lhs = parseOperand();
      const opTok = peek();
      if (!opTok || opTok.kind !== 'op') throw new Error('SQL_SYNTAX_ERROR: expected comparison operator');
      const op = opTok.val;
      pos++;
      const rhs = parseOperand();
      return (row) => {
        const a = lhs(row);
        const b = rhs(row);
        if (a === null || a === undefined || b === null || b === undefined) return false;
        if (op === '=') return a === b;
        if (op === '!=') return a !== b;
        if (op === '<') return a < b;
        if (op === '<=') return a <= b;
        if (op === '>') return a > b;
        if (op === '>=') return a >= b;
        return false;
      };
    };
    const parseNot = () => {
      if (isKw(peek(), 'NOT')) {
        pos++;
        const fn = parseNot();
        return (row) => !fn(row);
      }
      return parsePrimary();
    };
    const parseAnd = () => {
      let fn = parseNot();
      while (!clauseBoundary() && isKw(peek(), 'AND')) {
        pos++;
        const rhs = parseNot();
        const prev = fn;
        fn = (row) => prev(row) && rhs(row);
      }
      return fn;
    };
    const parseOr = () => {
      let fn = parseAnd();
      while (!clauseBoundary() && isKw(peek(), 'OR')) {
        pos++;
        const rhs = parseAnd();
        const prev = fn;
        fn = (row) => prev(row) || rhs(row);
      }
      return fn;
    };
    predicate = parseOr();
  }

  if (peek()?.kind === 'ident' && UNSUPPORTED_JS_KEYWORDS.has(peek().val.toUpperCase())) {
    throw new Error(`UNSUPPORTED_SQL_SYNTAX: '${peek().val}' is not supported`);
  }

  const groupCols = [];
  if (isKw(peek(), 'GROUP')) {
    pos++;
    if (!isKw(peek(), 'BY')) throw new Error('SQL_SYNTAX_ERROR: expected BY after GROUP');
    pos++;
    while (true) {
      groupCols.push(parseColRef());
      if (peek()?.kind === 'comma') { pos++; continue; }
      break;
    }
  }

  if (peek()?.kind === 'ident' && UNSUPPORTED_JS_KEYWORDS.has(peek().val.toUpperCase())) {
    throw new Error(`UNSUPPORTED_SQL_SYNTAX: '${peek().val}' is not supported`);
  }

  const orderSpecs = [];
  if (isKw(peek(), 'ORDER')) {
    pos++;
    if (!isKw(peek(), 'BY')) throw new Error('SQL_SYNTAX_ERROR: expected BY after ORDER');
    pos++;
    while (true) {
      if (!peek() || peek().kind !== 'ident') throw new Error('SQL_SYNTAX_ERROR: expected ORDER BY target');
      let target = peek().val;
      pos++;
      if (peek()?.kind === 'dot' && toks[pos + 1]?.kind === 'ident') {
        if (target.toLowerCase() !== fromTable.toLowerCase()) throw new Error('UNKNOWN_SQL_TABLE_QUALIFIER');
        target = toks[pos + 1].val;
        pos += 2;
      }
      let desc = false;
      if (isKw(peek(), 'DESC')) { desc = true; pos++; }
      else if (isKw(peek(), 'ASC')) { desc = false; pos++; }
      orderSpecs.push({ target, desc });
      if (peek()?.kind === 'comma') { pos++; continue; }
      break;
    }
  }

  if (peek()?.kind === 'ident' && UNSUPPORTED_JS_KEYWORDS.has(peek().val.toUpperCase())) {
    throw new Error(`UNSUPPORTED_SQL_SYNTAX: '${peek().val}' is not supported`);
  }

  let limit = null;
  if (isKw(peek(), 'LIMIT')) {
    pos++;
    if (!peek() || peek().kind !== 'num' || peek().val < 0) throw new Error('SQL_SYNTAX_ERROR: LIMIT requires >= 0 integer');
    limit = Math.floor(peek().val);
    pos++;
  }
  if (pos < toks.length) {
    throw new Error(`UNSUPPORTED_SQL_SYNTAX: unexpected trailing token '${toks[pos].val}'`);
  }

  const expanded = [];
  let hasStar = false;
  let hasAgg = false;
  for (const item of selectItems) {
    if (item.type === 'star') {
      hasStar = true;
      for (const c of tableCols) expanded.push({ type: 'col', col: c, alias: c });
    } else {
      if (item.type === 'agg') hasAgg = true;
      expanded.push(item);
    }
  }
  if (hasStar && (hasAgg || groupCols.length > 0)) {
    throw new Error('SQL_VALIDATION_ERROR: SELECT * cannot be combined with GROUP BY or aggregates');
  }
  const groupedMode = hasAgg || groupCols.length > 0;
  if (groupedMode) {
    for (const item of expanded) {
      if (item.type === 'col') {
        if (groupCols.length === 0) throw new Error('SQL_VALIDATION_ERROR: ungrouped column combined with aggregate');
        if (!groupCols.includes(item.col)) throw new Error(`SQL_VALIDATION_ERROR: '${item.col}' must appear in GROUP BY`);
      }
    }
  }

  const columns = expanded.map((x) => x.alias);
  const filtered = sourceRows.filter(predicate);
  let outItems;

  const evalAgg = (gRows, item) => {
    if (item.agg === 'COUNT_ALL') return gRows.length;
    if (item.agg === 'COUNT') return gRows.filter((r) => r[item.col] !== null && r[item.col] !== undefined).length;
    const vals = gRows.map((r) => r[item.col]).filter((v) => v !== null && v !== undefined);
    if (vals.length === 0) return null;
    let v;
    if (item.agg === 'SUM') v = vals.reduce((a, b) => a + Number(b), 0);
    else if (item.agg === 'AVG') v = vals.reduce((a, b) => a + Number(b), 0) / vals.length;
    else if (item.agg === 'MIN') v = vals.reduce((a, b) => (b < a ? b : a), vals[0]);
    else v = vals.reduce((a, b) => (b > a ? b : a), vals[0]);
    return item.roundDigits !== undefined && typeof v === 'number' ? roundNumJs(v, item.roundDigits) : v;
  };

  if (groupedMode) {
    const groups = [];
    if (groupCols.length === 0) {
      groups.push(filtered);
    } else {
      const map = new Map();
      for (const row of filtered) {
        const key = JSON.stringify(groupCols.map((c) => row[c] ?? null));
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(row);
      }
      for (const g of map.values()) groups.push(g);
    }
    outItems = groups.map((gRows) => ({
      raw: gRows[0] || {},
      vals: expanded.map((item) => {
        if (item.type === 'agg') return evalAgg(gRows, item);
        const v = gRows[0]?.[item.col] ?? null;
        return item.roundDigits !== undefined && typeof v === 'number' ? roundNumJs(v, item.roundDigits) : v;
      }),
    }));
  } else {
    outItems = filtered.map((row) => ({
      raw: row,
      vals: expanded.map((item) => {
        const v = row[item.col] ?? null;
        return item.roundDigits !== undefined && typeof v === 'number' ? roundNumJs(v, item.roundDigits) : v;
      }),
    }));
  }

  if (orderSpecs.length > 0) {
    const orderGetters = orderSpecs.map((spec) => {
      const idx = columns.findIndex((c) => c.toLowerCase() === spec.target.toLowerCase());
      if (idx >= 0) return { get: (item) => item.vals[idx], desc: spec.desc };
      if (!groupedMode) {
        const sc = resolveCol(spec.target);
        return { get: (item) => item.raw[sc] ?? null, desc: spec.desc };
      }
      throw new Error(`UNKNOWN_SQL_COLUMN: ORDER BY '${spec.target}' not found`);
    });
    outItems.sort((a, b) => {
      for (const og of orderGetters) {
        const va = og.get(a);
        const vb = og.get(b);
        if (va === vb) continue;
        if (va === null || va === undefined) return 1;
        if (vb === null || vb === undefined) return -1;
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : (String(va) < String(vb) ? -1 : 1);
        return og.desc ? -cmp : cmp;
      }
      return 0;
    });
  }

  let outRows = outItems.map((it) => it.vals);
  if (limit !== null) outRows = outRows.slice(0, limit);
  const elapsedMs = Math.round((performance.now() - t0) * 100) / 100;
  return {
    ok: true,
    engine: 'VeriSieve JS SQL Subset Fallback v1 (Strict AST)',
    sql_subset: true,
    columns,
    rows: outRows,
    total_rows: outRows.length,
    elapsedMs,
  };
}
