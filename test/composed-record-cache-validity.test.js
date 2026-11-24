import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { buildAmnesiacCorpus, eraseEntity } from '../src/amnesiac-corpus.js';

const INPUTS = [
  {
    name: 'contracts/msa.txt',
    text: 'Vendor agreement between Acme GmbH and Ravi Chandra.\nInvoice queries go to ravi.chandra@corp.example.\nPayment terms are net 30 days from receipt.',
  },
  {
    name: 'notes/audit.txt',
    text: 'Audit sign-off pending from Ravi Chandra.\nThe reminder went to ravi.chandra@corp.example on Monday.',
  },
];

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

test('K7 cache validity: a composed record pin changes when an entity is erased through the corpus seam', async () => {
  const before = await buildAmnesiacCorpus(INPUTS, { identity: 'readable', composition: 'composed' });
  const person = before.entityIndex.find((entry) => entry.class === 'PERSON');
  assert.ok(person, 'the composed corpus must index the PERSON entity');

  const record = before.samples.find((sample) => sample.target === person.entityId);
  assert.ok(record, 'the PERSON entity must be the target of a composed record');

  // A cache built from pre-erasure bytes: the record pin and the corpus pin both come from those bytes.
  const cachedRecordPin = sha256Hex(JSON.stringify(record));
  const cachedCorpusPin = sha256Hex(before.jsonl);

  const after = eraseEntity(before, person.entityId);
  const liveCorpusPin = sha256Hex(after.jsonl);
  const liveRecord = after.samples.find((sample) => sample.id === record.id);
  const liveRecordPin = liveRecord ? sha256Hex(JSON.stringify(liveRecord)) : null;

  assert.equal(after.diffReceipt.corpusSha256Before, cachedCorpusPin, 'the erasure receipt must pin the pre-erasure bytes');
  assert.equal(after.diffReceipt.corpusSha256After, liveCorpusPin, 'the erasure receipt must pin the post-erasure bytes');
  assert.notEqual(liveCorpusPin, cachedCorpusPin, 'erasure must change the corpus bytes, so a stale cache pin cannot match');
  assert.notEqual(liveRecordPin, cachedRecordPin, 'the per-entity record pin must not match after erasure, so a stale KV cache entry is detectably invalid');
});
