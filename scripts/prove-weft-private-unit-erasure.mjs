#!/usr/bin/env node
/**
 * scripts/prove-weft-private-unit-erasure.mjs
 *
 * Regenerate-minus-unit byte-diff erasure receipt for a company-private
 * knowledge unit (issue #59 corpus ask 4): reads a private-unit overlay
 * corpus ({ docs, links, knowledgeUnits } shape, written by
 * scripts/generate-weft-estate-extension-v5.mjs), regenerates the same
 * artifact minus one unit's footprint (its docs, the links touching them,
 * its unit record), and emits a receipt proving exactly what changed:
 *
 *   - sha256 and byte size of the original and the regenerated file,
 *   - the removed doc ids, the removed links, the removed unit record,
 *   - the byte offset of the first difference,
 *   - and the unchanged-bytes assertion: every retained doc, link, and unit
 *     record serializes byte-identically in the regenerated artifact, so the
 *     only change is the unit's own footprint.
 *
 * Fail-closed: an unknown unit id, a unit whose claimed docs are missing,
 * or a link that references a removed doc after regeneration is a typed
 * error and nothing is written. Honest scope: this proves erasability of
 * the unit inside the Weft corpus artifact this lane owns; the full amnesiac
 * corpus-regeneration mechanism (src/) consumes the same footprint later,
 * and no claim is made here about its pipeline.
 *
 * No teacher, no network, fully deterministic.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export class WeftErasureProofError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'WeftErasureProofError';
    this.code = 'WEFT_ERASURE_PROOF';
    this.reason = reason;
  }
}

const sha256Hex = (data) => crypto.createHash('sha256').update(data).digest('hex');

/**
 * Regenerate the overlay corpus minus one knowledge unit's footprint.
 * Returns { original, regenerated, removed, firstDiffOffset } where the
 * regenerated corpus is a fresh object; the original is untouched.
 */
export function regenerateCorpusMinusUnit(corpus, unitId) {
  if (!corpus || !Array.isArray(corpus.docs) || !Array.isArray(corpus.links) || !Array.isArray(corpus.knowledgeUnits)) {
    throw new WeftErasureProofError('the overlay corpus must be a { docs, links, knowledgeUnits } JSON object', 'corpus-shape');
  }
  const unit = corpus.knowledgeUnits.find((u) => u && u.id === unitId);
  if (!unit) {
    throw new WeftErasureProofError(
      `unknown knowledge unit ${JSON.stringify(unitId)}; the overlay carries ${JSON.stringify(corpus.knowledgeUnits.map((u) => u && u.id))}`,
      'unit-unknown'
    );
  }
  // A unit must own its claimed docs: every claimed id must exist, and no doc
  // outside the claim may carry the unit id.
  const docById = new Map(corpus.docs.map((d) => [d.id, d]));
  const claimed = new Set(Array.isArray(unit.docIds) ? unit.docIds : []);
  if (!claimed.size) {
    throw new WeftErasureProofError(`unit ${JSON.stringify(unitId)} claims no docs`, 'unit-docs-empty');
  }
  for (const id of claimed) {
    if (!docById.has(id)) {
      throw new WeftErasureProofError(`unit ${JSON.stringify(unitId)} claims doc ${JSON.stringify(id)} which is absent from the overlay`, 'unit-doc-missing');
    }
  }
  for (const doc of corpus.docs) {
    if (!claimed.has(doc.id) && String(doc.knowledgeUnitId || '') === unitId) {
      throw new WeftErasureProofError(
        `doc ${JSON.stringify(doc.id)} carries unit ${JSON.stringify(unitId)} but the unit does not claim it; the footprint is inconsistent`,
        'footprint-inconsistent'
      );
    }
  }
  const removedDocs = corpus.docs.filter((d) => claimed.has(d.id));
  const keptDocs = corpus.docs.filter((d) => !claimed.has(d.id));
  const removedLinks = corpus.links.filter((l) => claimed.has(l.a) || claimed.has(l.b));
  const keptLinks = corpus.links.filter((l) => !claimed.has(l.a) && !claimed.has(l.b));
  // No dangling link may survive regeneration.
  const keptIds = new Set(keptDocs.map((d) => d.id));
  for (const link of keptLinks) {
    if (!keptIds.has(link.a) || !keptIds.has(link.b)) {
      throw new WeftErasureProofError(
        `a retained link references a removed doc (${JSON.stringify(link)}); regeneration would leave a dangling link`,
        'dangling-link'
      );
    }
  }
  const regenerated = {
    ...corpus,
    docs: keptDocs,
    links: keptLinks,
    knowledgeUnits: corpus.knowledgeUnits.filter((u) => u && u.id !== unitId),
  };
  return { regenerated, removedDocs, removedLinks, removedUnit: unit };
}

/**
 * The byte-diff receipt. The unchanged-bytes assertion is record-granular:
 * every retained doc, link, and unit record serializes byte-identically in
 * the regenerated artifact, which is the strongest claim a stable JSON
 * assembly can make; the file-level firstDiffOffset and digests give the
 * byte-level color.
 */
export function buildErasureReceipt(corpusPath, unitId, outPath) {
  const originalBytes = fs.readFileSync(corpusPath);
  const originalText = originalBytes.toString('utf8');
  let corpus;
  try {
    corpus = JSON.parse(originalText);
  } catch (err) {
    throw new WeftErasureProofError(`overlay corpus is unreadable: ${err.message}`, 'corpus-unreadable');
  }
  const { regenerated, removedDocs, removedLinks, removedUnit } = regenerateCorpusMinusUnit(corpus, unitId);
  const regeneratedText = JSON.stringify(regenerated) + '\n';

  // Unchanged-bytes assertion: each retained record is byte-identical.
  const originalDocsById = new Map(corpus.docs.map((d) => [d.id, d]));
  const originalLinkById = new Map(corpus.links.map((l) => [`${l.a}|${l.b}|${l.type}`, l]));
  const unchangedDocs = regenerated.docs.filter((d) => JSON.stringify(d) === JSON.stringify(originalDocsById.get(d.id)));
  const unchangedLinks = regenerated.links.filter(
    (l) => JSON.stringify(l) === JSON.stringify(originalLinkById.get(`${l.a}|${l.b}|${l.type}`))
  );
  const unchangedUnits = regenerated.knowledgeUnits.filter((u) => {
    const orig = corpus.knowledgeUnits.find((x) => x.id === u.id);
    return JSON.stringify(u) === JSON.stringify(orig);
  });
  const allUnchanged = unchangedDocs.length === regenerated.docs.length
    && unchangedLinks.length === regenerated.links.length
    && unchangedUnits.length === regenerated.knowledgeUnits.length;

  // First differing byte between the two files.
  let firstDiffOffset = -1;
  const n = Math.min(originalText.length, regeneratedText.length);
  for (let i = 0; i < n; i++) {
    if (originalText[i] !== regeneratedText[i]) { firstDiffOffset = i; break; }
  }
  if (firstDiffOffset < 0 && originalText.length !== regeneratedText.length) firstDiffOffset = n;

  if (outPath) fs.writeFileSync(outPath, regeneratedText);
  const receipt = {
    kind: 'weft-private-unit-erasure-receipt',
    corpus: path.relative(ROOT, corpusPath).split(path.sep).join('/'),
    unitId,
    sha256: { before: sha256Hex(originalBytes), after: sha256Hex(Buffer.from(regeneratedText, 'utf8')) },
    bytes: { before: originalBytes.length, after: Buffer.byteLength(regeneratedText, 'utf8') },
    removed: {
      docs: removedDocs.map((d) => d.id),
      docCount: removedDocs.length,
      links: removedLinks.map((l) => `${l.a}|${l.b}|${l.type}`),
      linkCount: removedLinks.length,
      unitRecordId: removedUnit.id,
    },
    retained: {
      docs: regenerated.docs.length,
      links: regenerated.links.length,
      knowledgeUnits: regenerated.knowledgeUnits.length,
    },
    firstDiffOffset,
    unchangedBytesAssertion: {
      claim: 'every retained doc, link, and unit record serializes byte-identically in the regenerated artifact; the only change is the removed unit footprint',
      verified: allUnchanged,
      unchangedDocs: unchangedDocs.length,
      unchangedLinks: unchangedLinks.length,
      unchangedUnits: unchangedUnits.length,
    },
    scopeNote: 'proves erasability of the unit inside the Weft corpus artifact (overlay corpus); the full amnesiac corpus-regeneration mechanism consumes the same footprint downstream and is not claimed here',
  };
  if (!allUnchanged) {
    throw new WeftErasureProofError('the unchanged-bytes assertion failed: a retained record changed during regeneration', 'unchanged-violation');
  }
  return { receipt, regeneratedText };
}

function cliValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

// Runs offline; the script body only reads and writes repo-local files.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const corpusPath = cliValue('--corpus');
    const unitId = cliValue('--unit');
    if (!corpusPath || !unitId) {
      console.error('usage: node scripts/prove-weft-private-unit-erasure.mjs --corpus <overlay.json> --unit <unitId> [--receipt <out.json>]');
      process.exit(2);
    }
    const resolved = path.resolve(corpusPath);
    const minusName = resolved.replace(/\.json$/, `-minus-${unitId}.tmp.json`);
    const { receipt, regeneratedText } = buildErasureReceipt(resolved, unitId, minusName);
    const receiptPath = cliValue('--receipt') || minusName.replace(/\.tmp\.json$/, '-receipt.json');
    fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
    console.error(`erasure proof: removed ${receipt.removed.docCount} docs / ${receipt.removed.linkCount} links for unit ${unitId}`);
    console.error(`sha256: ${receipt.sha256.before} -> ${receipt.sha256.after}`);
    console.error(`regenerated corpus: ${minusName}`);
    console.error(`receipt: ${receiptPath}`);
  } catch (err) {
    console.error(`erasure proof failed: ${err.code || err.name} ${err.reason ? `(${err.reason})` : ''}: ${err.message}`);
    process.exit(2);
  }
}
