import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  API_TEACHER_LICENCE,
  WeftTeacherUnavailableError,
  resolveLocalTeacher,
} from '../scripts/build-weft-training-pairs.mjs';
import {
  NEGATIVES_CAP,
  STRATA_LICENCE,
  WeftStrataConfigError,
  findParaphraseCandidates,
  lexicalOverlap,
  pairSeed,
  positivePrompt,
  negativePrompt,
  remapIdentityCollisions,
  runStrata,
} from '../scripts/generate-weft-paraphrase-strata.mjs';
import { ORG_PROFILES } from '../scripts/generate-weft-live-corpus-v5.mjs';

// W-STRATA contract tests: a stub teacher, a tiny temp coverage corpus, no
// network and no key. Importing the strata driver must make no teacher call.
const DRIVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'generate-weft-paraphrase-strata.mjs');
const PROFILE = 'hospital-network';
const PROFILE_CULTURE_NAMES = ORG_PROFILES.find((p) => p.id === PROFILE).nameCultures.flatMap((c) => c.names);

const SOURCE = {
  id: 'alpha-c0-src-doc-1',
  format: 'email',
  department: 'finance',
  theme: 'alpha',
  source: 'synthetic-estate',
  text: 'Astrid Lindqvist filed the alpha figures: delta, echo, and the depot overheads programme stays flat.',
  identities: [{ key: 'emp-astrid', surface: 'Astrid Lindqvist', class: 'person' }],
};
const ANCHOR = {
  id: 'alpha-c5-anchor-doc-9',
  format: 'ticket',
  department: 'clinical',
  theme: 'alpha',
  source: 'synthetic-estate',
  text: 'Marisol Reyes escalated the same alpha matter in a ticket.',
  identities: [{ key: 'emp-marisol', surface: 'Marisol Reyes', class: 'person' }],
};

function expectedParaphraseDepartment() {
  const departments = ORG_PROFILES.find((p) => p.id === PROFILE).departments;
  const eligible = departments.filter((d) => d !== SOURCE.department && d !== ANCHOR.department);
  return eligible[pairSeed(SOURCE.id) % eligible.length];
}

function fixtureCorpus() {
  return { docs: [SOURCE, ANCHOR], links: [{ a: SOURCE.id, b: ANCHOR.id, type: 'thread' }] };
}

function writeTempCorpus(dir) {
  const file = path.join(dir, 'corpus.json');
  fs.writeFileSync(file, JSON.stringify(fixtureCorpus()) + '\n');
  return file;
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'weft-strata-'));
}

function stubTeacher(calls, options = {}) {
  const { paraphrase, negatives } = options;
  const stub = {
    kind: 'api',
    licence: API_TEACHER_LICENCE,
    auditEntry: { status: 'green' },
    usage: { calls: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  };
  stub.complete = function complete(prompt) {
    calls.push(prompt);
    stub.usage.calls += 1;
    stub.usage.promptTokens += 11;
    stub.usage.completionTokens += 23;
    stub.usage.totalTokens += 34;
    if (prompt.includes('Rewrite it into ONE new document')) {
        const theme = JSON.parse(/where theme is exactly ("[^"]+")/.exec(prompt)[1]);
        return JSON.stringify({
          docs: [{
            id: 'p-1',
            format: 'slides',
            department: theme === 'alpha' ? 'facilities' : 'nursing',
            theme,
            text: paraphrase?.text ?? 'brisk slide summary of the same matter with fresh wording',
            identities: paraphrase?.identities ?? [{ key: 'ph-free-1', surface: 'Sanna Kettunen', class: 'person' }],
          }],
          links: [],
        });
      }
      if (prompt.includes('Produce TWO documents')) {
        return JSON.stringify({
          docs: [
            {
              id: 'n-1',
              format: 'email',
              department: 'nursing',
              theme: JSON.parse(/theme ("[^"]+")/.exec(prompt)[1]),
              text: negatives?.textA ?? 'gateway rollout holds while the capacity dispute drags on',
              identities: [{ key: 'neg-a', surface: 'Beate Kesselring', class: 'person' }],
            },
            {
              id: 'n-2',
              format: 'ticket',
              department: 'pharmacy',
              theme: JSON.parse(/theme ("[^"]+")/.exec(prompt)[1]),
              text: negatives?.textB ?? 'gateway rollout stalls while the capacity dispute escalates',
              identities: [{ key: 'neg-b', surface: 'Dante Villanueva', class: 'person' }],
            },
          ],
          links: [],
        });
      }
      throw new Error(`stub teacher saw an unexpected prompt: ${prompt.slice(0, 80)}`);
    };
  return stub;
}

test('W-STRATA 1: the paraphrase prompt carries masked identity placeholders and the other-department rule', () => {
  const dir = tempDir();
  try {
    const calls = [];
    const corpusPath = writeTempCorpus(dir);
    runStrata(PROFILE, {
      limit: 1,
      teacher: stubTeacher(calls),
      corpusPath,
      outDir: path.join(dir, 'strata-run'),
    });
    assert.ok(calls.some((p) => p.includes('Rewrite it into ONE new document')), 'one positive call happened');
    const prompt = calls.find((p) => p.includes('Rewrite it into ONE new document'));
    assert.ok(prompt.includes('[PERSON_1]'), 'the masked source reaches the prompt as a bracketed role token');
    assert.ok(!prompt.includes('Astrid Lindqvist'), 'the source identity surface never reaches the teacher');
    assert.ok(
      prompt.includes(
        `written from the perspective of ${JSON.stringify(expectedParaphraseDepartment())} department (a different department than the source's)`
      ),
      'the other-department instruction names a third department, not the anchor department'
    );
    assert.ok(prompt.includes(`theme is exactly ${JSON.stringify(SOURCE.theme)}`), 'the theme is pinned verbatim');
    assert.ok(prompt.includes(`naming cultures to fit: ${JSON.stringify(['Nordic', 'Filipino', 'German'])}`), 'the profile cultures are named');
    assert.ok(!calls.some((p) => p.includes('Astrid Lindqvist')), 'no call carries the masked surface');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-STRATA 2: an anchor-colliding paraphrase is remapped once, or dropped and counted when remap cannot free it', () => {
  const dir = tempDir();
  try {
    // Remap path: the paraphrase reuses the anchor surface; one rename pass fixes it.
    const remapCalls = [];
    const corpusPath = writeTempCorpus(dir);
    const remapped = runStrata(PROFILE, {
      limit: 1,
      teacher: stubTeacher(remapCalls, {
        paraphrase: {
          text: 'fully fresh wording about the same matter, no shared names',
          identities: [{ key: 'eh', surface: 'Marisol Reyes', class: 'person' }],
        },
      }),
      corpusPath,
      outDir: path.join(dir, 'strata-run'),
    });
    assert.equal(remapped.receipt.counts.droppedIdentityCollisions, 0, 'the remap rescued the pair');
    assert.equal(remapped.receipt.counts.paraphraseHardPositive, 1);
    const pairB = remapped.pairs.find((p) => p.label === 'paraphrase-hard-positive').b;
    const renamed = pairB.identities[0].surface;
    assert.ok(PROFILE_CULTURE_NAMES.includes(renamed), 'the replacement name comes from the profile cultures');
    assert.notEqual(renamed.toLowerCase(), 'marisol reyes', 'the colliding surface is gone');
    assert.ok(!pairB.text.toLowerCase().includes('marisol reyes'), 'the colliding surface is scrubbed from the text');
    // Deterministic cursor: the scan starts at pairSeed(source) % cultures and
    // picks the earliest free name (source and anchor surfaces are forbidden).
    const forbidden = new Set([SOURCE.identities[0].surface, ANCHOR.identities[0].surface].map((s) => s.toLowerCase()));
    const cursor = pairSeed(SOURCE.id) % PROFILE_CULTURE_NAMES.length;
    let expected = null;
    for (let n = 0; n < PROFILE_CULTURE_NAMES.length && !expected; n++) {
      const cand = PROFILE_CULTURE_NAMES[(cursor + n) % PROFILE_CULTURE_NAMES.length];
      if (!forbidden.has(cand.toLowerCase())) expected = cand;
    }
    assert.equal(renamed, expected, 'the cursor is deterministic: the earliest free culture name wins');

    // Drop path: the corpus docs carry every profile culture name, so the
    // colliding surface has no free replacement name; the pair is dropped.
    const packedSource = {
      ...SOURCE,
      identities: PROFILE_CULTURE_NAMES.slice(0, 6).map((name, i) => ({
        key: `src-${name}-${i}`, surface: name, class: 'person',
      })),
    };
    const packedAnchor = {
      ...ANCHOR,
      identities: PROFILE_CULTURE_NAMES.slice(6).map((name, i) => ({
        key: `anch-${name}-${i}`, surface: name, class: 'person',
      })),
    };
    const packedPath = path.join(dir, 'packed.json');
    fs.writeFileSync(packedPath, JSON.stringify({ docs: [packedSource, packedAnchor], links: [{ a: packedSource.id, b: packedAnchor.id, type: 'thread' }] }) + '\n');
    const dropCalls = [];
    const dropped = runStrata(PROFILE, {
      limit: 1,
      teacher: stubTeacher(dropCalls, {
        paraphrase: {
          text: 'still echoing the anchor naming',
          identities: [{ key: 'eh', surface: 'Marisol Reyes', class: 'person' }],
        },
      }),
      corpusPath: packedPath,
      outDir: path.join(dir, 'strata-run-2'),
    });
    assert.equal(dropped.receipt.counts.paraphraseHardPositive, 0, 'the stuck pair is not emitted');
    assert.equal(dropped.receipt.counts.droppedIdentityCollisions, 1, 'the drop is counted in the receipt');
    const remnants = fs.readFileSync(path.join(dir, 'strata-run-2', 'strata-pairs.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(remnants.every((p) => p.label === 'paraphrase-hard-negative'), 'only the negative pass survives a full positive drop');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-STRATA 3: per-class counts and provenance land in the pairs and the receipt', () => {
  const dir = tempDir();
  try {
    const calls = [];
    const corpusPath = writeTempCorpus(dir);
    const { receipt, pairs, files } = runStrata(PROFILE, {
      limit: 2,
      teacher: stubTeacher(calls),
      corpusPath,
      outDir: path.join(dir, 'strata-run'),
    });
    assert.equal(receipt.kind, 'weft-paraphrase-strata-receipt');
    assert.equal(receipt.profile, PROFILE);
    assert.equal(receipt.seed, 20261130);
    assert.equal(receipt.licence, API_TEACHER_LICENCE);
    assert.equal(receipt.counts.paraphraseHardPositive, 1, 'one linked pair in, one positive out');
    assert.equal(receipt.counts.paraphraseHardNegative, Math.min(2, NEGATIVES_CAP), 'the negatives pass always runs');
    assert.equal(receipt.counts.droppedIdentityCollisions, 0);
    assert.equal(receipt.counts.droppedPlaceholderEcho, 0);
    assert.equal(receipt.negativesCaveat, 'near-topic negatives: talking-point difference is teacher-claimed, not mechanically verified');
    assert.equal(receipt.positivesAnchorToSource.mean, 1 / 18, 'the pre-paraphrase anchor-to-source baseline is recorded');
    assert.deepEqual(receipt.positivesAnchorToSource.perPair, [{ sourceDocId: SOURCE.id, overlap: 1 / 18 }]);
    const positive = pairs.find((p) => p.label === 'paraphrase-hard-positive');
    assert.equal(positive.a, ANCHOR.id, 'the anchor side keeps the original coverage doc id');
    assert.equal(positive.b.id, `ph-${SOURCE.id}`, 'the paraphrase doc id is namespaced from the source');
    assert.equal(positive.sourceDocId, SOURCE.id);
    assert.equal(positive.corpusProfile, PROFILE);
    assert.equal(positive.provenance, `paraphrase-of:${SOURCE.id}`);
    assert.equal(positive.theme, SOURCE.theme);
    assert.equal(positive.b.theme, SOURCE.theme);
    const negative = pairs.find((p) => p.label === 'paraphrase-hard-negative');
    assert.equal(negative.provenance, 'teacher-generated-near-topic');
    assert.equal(negative.corpusProfile, PROFILE);
    assert.ok(negative.a.id.startsWith('phn-') && negative.b.id.startsWith('phn-'), 'negative docs are namespaced');
    assert.ok(receipt.prompts.positive.includes('Rewrite it into ONE new document'), 'the verbatim positive prompt is recorded');
    assert.ok(receipt.prompts.negative.includes('Produce TWO documents'), 'the verbatim negative prompt is recorded');
    assert.equal(receipt.usage.calls, 3, 'one positive call plus two negative calls');
    assert.ok(typeof receipt.usage.wallclockMs === 'number');
    const lines = fs.readFileSync(files.pairs, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, pairs.length, 'one pair per JSONL line');
    assert.deepEqual(JSON.parse(lines[0]).provenance, positive.provenance);
    assert.ok(typeof receipt.usage.totalTokens === 'number');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-STRATA 4: the lexical-overlap numbers match hand-computed values', () => {
  // Tokens of length >= 4, lowercased, jaccard over the union.
  assert.equal(lexicalOverlap('alpha beta gamma delta echo', 'alpha beta gamma foxtrot golf'), 3 / 7);
  assert.equal(lexicalOverlap('zulu xray', 'alpha beta gamma foxtrot golf'), 0);
  assert.equal(lexicalOverlap('alpha bravo charlie delta', 'echo alpha foxtrot'), 1 / 6);
  assert.equal(lexicalOverlap('words over four length', 'words over four length'), 1, 'identical content sets overlap fully');
  assert.equal(lexicalOverlap('', ''), 0, 'empty inputs stay defined');
  assert.equal(lexicalOverlap('abc abcd xyzw', 'xyzw abcd wxyz'), 2 / 3, 'short tokens below the length floor are excluded');

  const dir = tempDir();
  try {
    // A controlled corpus whose texts are the exact strings above, so the
    // receipt matches the hand values instead of the prose fixture.
    const src = { ...SOURCE, text: 'alpha beta gamma delta echo' };
    const anc = { ...ANCHOR, text: 'zulu xray' };
    const corpusPath = path.join(dir, 'controlled.json');
    fs.writeFileSync(corpusPath, JSON.stringify({ docs: [src, anc], links: [{ a: src.id, b: anc.id, type: 'thread' }] }) + '\n');
    const { receipt } = runStrata(PROFILE, {
      limit: 1,
      teacher: stubTeacher([], {
        paraphrase: {
          text: 'alpha beta gamma foxtrot golf',
          identities: [{ key: 'ph-free-1', surface: 'Sanna Kettunen', class: 'person' }],
        },
        negatives: {
          textA: 'alpha bravo charlie delta',
          textB: 'echo alpha foxtrot',
        },
      }),
      corpusPath,
      outDir: path.join(dir, 'strata-run'),
    });
    assert.equal(receipt.lexicalOverlap.positivesSourceToParaphrase, 3 / 7, 'source to paraphrase overlap is low by construction');
    assert.equal(receipt.lexicalOverlap.positivesAnchorToParaphrase, 0);
    assert.equal(receipt.lexicalOverlap.negativesAToB, 1 / 6);
    assert.deepEqual(
      receipt.lexicalOverlap.positivesPerPair,
      [{ sourceDocId: SOURCE.id, sourceToParaphrase: 3 / 7, anchorToParaphrase: 0 }]
    );
    assert.equal(receipt.lexicalOverlap.negativesPerPair.length, 1);
    assert.equal(receipt.lexicalOverlap.negativesPerPair[0].overlap, 1 / 6);
    assert.equal(receipt.lexicalOverlap.negativesPerPair[0].aId, 'phn-0-1');
    assert.equal(receipt.positivesAnchorToSource.mean, 0, 'the baseline pair shares no content words');
    assert.deepEqual(receipt.positivesAnchorToSource.perPair, [{ sourceDocId: SOURCE.id, overlap: 0 }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-STRATA 5: fail-closed on a missing corpus; importing the module makes no teacher call', () => {
  const dir = tempDir();
  try {
    assert.throws(
      () => runStrata(PROFILE, {
        limit: 1,
        teacher: stubTeacher([]),
        corpusPath: path.join(dir, 'missing.json'),
        outDir: path.join(dir, 'strata-run'),
      }),
      (err) => err instanceof WeftStrataConfigError && err.reason === 'corpus-absent'
    );
    assert.throws(
      () => runStrata('no-such-profile', { limit: 1, teacher: stubTeacher([]) }),
      (err) => err instanceof WeftStrataConfigError && err.reason === 'profile-unknown'
    );
    assert.throws(
      () => runStrata(PROFILE, { limit: 0, teacher: stubTeacher([]) }),
      (err) => err instanceof WeftStrataConfigError && err.reason === 'limit-invalid'
    );
    assert.throws(
      () => runStrata(PROFILE, { teacher: stubTeacher([]) }),
      (err) => err instanceof WeftStrataConfigError && err.reason === 'limit-invalid'
    );

    // Importing the driver (no env, no corpus) exits cleanly and writes nothing:
    // the spending path lives behind the main guard only.
    const probe = spawnSync(process.execPath, [
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(DRIVER).href)});`,
    ], { cwd: dir, timeout: 30000 });
    assert.equal(probe.status, 0, probe.stderr);
    assert.equal(fs.readdirSync(dir).length, 0, 'importing the module writes nothing');

    // Candidate selection and seeding stay deterministic.
    const candidates = findParaphraseCandidates(fixtureCorpus());
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].source.id, SOURCE.id);
    assert.equal(candidates[0].anchor.id, ANCHOR.id);
    assert.equal(pairSeed(SOURCE.id), pairSeed(SOURCE.id), 'the pair seed is a pure function of the doc id');
    assert.equal(typeof positivePrompt({ seed: 1, paraphraseDepartment: 'nursing', cultureLabels: '[]', theme: 'alpha', sourceText: 'x' }), 'string');
    // The negative prompt must name the doc fields and pin the profile's
    // departments: the 2026-11-28 smoke got empty-text docs because the schema
    // line named no fields and let the teacher invent its own structure.
    const negPrompt = negativePrompt({ seed: 1, theme: 'alpha', cultureLabels: '[]', departments: ['ops', 'nursing'] });
    assert.match(negPrompt, /"id","format","department","theme","text","identities"/, 'the negative prompt names the full doc schema');
    assert.match(negPrompt, /\["ops","nursing"\]/, 'the negative prompt pins the profile departments');
    assert.equal(
      remapIdentityCollisions({ text: 'ok', identities: [] }, [], PROFILE_CULTURE_NAMES, 0).text,
      'ok',
      'a clean doc passes the remap untouched'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('W-STRATA 6: the green-only licence gate rejects a wrong licence and a non-api teacher', () => {
  assert.equal(STRATA_LICENCE, 'mistral-api-tos');
  assert.throws(
    () => runStrata(PROFILE, {
      limit: 1,
      env: { WEFT_TEACHER_KIND: 'api', WEFT_TEACHER_LICENCE: 'apache-2.0' },
    }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'api-licence-required'
  );
  assert.throws(
    () => runStrata(PROFILE, {
      limit: 1,
      env: { WEFT_TEACHER_CMD: 'llama-cli', WEFT_TEACHER_LICENCE: 'apache-2.0' },
    }),
    (err) => err instanceof WeftTeacherUnavailableError
  );
  assert.throws(
    () => runStrata(PROFILE, { limit: 1, teacher: { licence: API_TEACHER_LICENCE, complete: () => '{}' } }),
    (err) => err instanceof WeftTeacherUnavailableError && err.reason === 'licence-not-api'
  );
  // An env with no licence at all fails closed through the same resolver the
  // v5 corpus driver uses.
  assert.throws(
    () => runStrata(PROFILE, { limit: 1, env: {} }),
    (err) => err instanceof WeftTeacherUnavailableError
  );
  // Sanity: the resolver itself still accepts the green api class only.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'weft-strata-licence-'));
  try {
    const audit = {
      sources: [{ id: 'mistral-medium', modelId: 'mistral-medium', status: 'green', licence: API_TEACHER_LICENCE }],
    };
    const auditPath = path.join(tmp, 'audit.json');
    fs.writeFileSync(auditPath, JSON.stringify(audit) + '\n');
    const resolved = resolveLocalTeacher({
      WEFT_TEACHER_KIND: 'api',
      WEFT_TEACHER_LICENCE: API_TEACHER_LICENCE,
      WEFT_LICENCE_AUDIT: auditPath,
      WEFT_TEACHER_CMD: process.execPath,
    });
    assert.equal(resolved.kind, 'api');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('W-STRATA 7: key collisions and placeholder echoes drop and are counted', () => {
  const dir = tempDir();
  try {
    const corpusPath = writeTempCorpus(dir);
    const keyCollision = runStrata(PROFILE, {
      limit: 1,
      teacher: stubTeacher([], {
        paraphrase: {
          text: 'fresh wording about the same matter with new names',
          identities: [{ key: 'emp-astrid', surface: 'Different Name', class: 'person' }],
        },
      }),
      corpusPath,
      outDir: path.join(dir, 'key-collision'),
    });
    assert.equal(keyCollision.receipt.counts.paraphraseHardPositive, 0, 'a shared identity key is not emitted');
    assert.equal(keyCollision.receipt.counts.droppedIdentityCollisions, 1, 'the key clash goes through the drop path');

    const placeholderEcho = runStrata(PROFILE, {
      limit: 1,
      teacher: stubTeacher([], {
        paraphrase: {
          text: 'a fresh summary that echoes [PERSON_1] again',
          identities: [{ key: 'ph-free-2', surface: 'Sanna Kettunen', class: 'person' }],
        },
      }),
      corpusPath,
      outDir: path.join(dir, 'placeholder-echo'),
    });
    assert.equal(placeholderEcho.receipt.counts.paraphraseHardPositive, 0, 'a placeholder echo is not emitted');
    assert.equal(placeholderEcho.receipt.counts.droppedPlaceholderEcho, 1, 'the echo is counted');
    assert.equal(placeholderEcho.receipt.counts.droppedIdentityCollisions, 0, 'the echo is not confused with an identity clash');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// W-STRATA 8: docs without text are failed samples, not silently accepted
// pairs; the 2026-11-28 smoke shipped twenty negatives with empty text
// because the negative prompt named no doc fields and validation only
// checked the docs array length.
test('W-STRATA 8: a sample whose docs lack text fails closed', () => {
  const dir = tempDir();
  try {
    const corpusPath = writeTempCorpus(dir);
    const teacher = stubTeacher([], {
      negatives: { textA: '', textB: 'gateway rollout stalls while the capacity dispute escalates' },
    });
    assert.throws(
      () => runStrata(PROFILE, { limit: 1, teacher, corpusPath, outDir: path.join(dir, 'strata-empty') }),
      WeftTeacherUnavailableError,
      'a docs array with empty text never becomes a pair'
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
