'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  parseObserveFileIndexV1,
  maxRootConversationIndex,
  readObserveFileIndex,
  registerObserveAndPrune,
  verifyObserveRetentionInvariants
} = require(path.join(root, 'dist', 'observe-files.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-observe-files-'));
const work = path.join(tmp, 'work');
fs.mkdirSync(work);
const session = { sessionId: 'observe-files', workRootAbs: tmp, workDirectoryAbs: work };
const write = (name, body = name) => {
  const candidate = path.join(work, name);
  fs.writeFileSync(candidate, body);
  return candidate;
};

try {
  assert.deepStrictEqual(parseObserveFileIndexV1({ version: 1, indices: [1, 3] }), { version: 1, indices: [1, 3] });
  for (const bad of [
    null,
    { version: 2, indices: [] },
    { version: 1, indices: [1, 1] },
    { version: 1, indices: [3, 1] },
    { version: 1, indices: [-1] },
    { version: 1, indices: [1.5] }
  ]) assert.throws(() => parseObserveFileIndexV1(bad));

  write('[0]assistant.md', 'thought 0');
  const observe1 = write('[1]assistant.md', 'observe 1');
  write('[1]assistant.extra.json', '{}');
  assert.strictEqual(registerObserveAndPrune({ session, assistantPath: observe1, carryover: 2 }), 1);
  assert.deepStrictEqual(readObserveFileIndex(session).indices, [1]);
  assert.ok(fs.existsSync(observe1));

  write('[2]assistant.md', 'thought 2');
  const observe3 = write('[3]assistant.md', 'observe 3');
  registerObserveAndPrune({ session, assistantPath: observe3, carryover: 2 });
  write('[4]assistant.md', 'thought 4');
  const observe5 = write('[5]assistant.md', 'observe 5');
  registerObserveAndPrune({ session, assistantPath: observe5, carryover: 2 });

  const archive = path.join(work, '.observe_files');
  assert.deepStrictEqual(readObserveFileIndex(session).indices, [1, 3, 5], 'identity ledger remains append-only');
  assert.ok(fs.existsSync(path.join(archive, '[1]assistant.md')));
  assert.ok(fs.existsSync(path.join(archive, '[1]assistant.extra.json')), 'sidecar follows primary');
  assert.ok(!fs.existsSync(observe1));
  assert.ok(fs.existsSync(observe3));
  assert.ok(fs.existsSync(observe5), 'newest Observe remains active');
  assert.ok(fs.existsSync(path.join(work, '[0]assistant.md')), 'Thought 0 remains active');
  assert.ok(fs.existsSync(path.join(work, '[2]assistant.md')), 'Thought 2 remains active');
  assert.ok(fs.existsSync(path.join(work, '[4]assistant.md')), 'Thought 4 remains active');
  verifyObserveRetentionInvariants({ session, carryover: 2, newestObserveIndex: 5 });

  assert.throws(
    () => registerObserveAndPrune({ session, assistantPath: observe5, carryover: 2 }),
    /strictly ascending/
  );

  const staleWork = path.join(tmp, 'stale');
  fs.mkdirSync(staleWork);
  const staleSession = { sessionId: 'stale', workRootAbs: tmp, workDirectoryAbs: staleWork };
  const staleObserve = path.join(staleWork, '[1]assistant.md');
  fs.writeFileSync(staleObserve, 'stale observe');
  fs.writeFileSync(path.join(staleWork, '[2]assistant.md'), 'newer thought');
  assert.throws(
    () => registerObserveAndPrune({ session: staleSession, assistantPath: staleObserve, carryover: 1 }),
    /maximum index/
  );
  assert.ok(!fs.existsSync(path.join(staleWork, '.observe_files')), 'failed preflight has no ledger side effect');

  const scannerWork = path.join(tmp, 'scanner-semantics');
  fs.mkdirSync(scannerWork);
  fs.writeFileSync(path.join(scannerWork, '[7]critic.json'), '{}');
  fs.writeFileSync(path.join(scannerWork, '[8]assistant.calls.jsonl'), '');
  fs.writeFileSync(path.join(scannerWork, '[9]assistant.txt'), 'ignored');
  fs.mkdirSync(path.join(scannerWork, '[10]nested.md'));
  const scannerSession = { sessionId: 'scanner', workRootAbs: tmp, workDirectoryAbs: scannerWork };
  assert.strictEqual(
    maxRootConversationIndex(scannerSession),
    8,
    'maximum index uses the public Conversation artifact classifier used by Promptpile scanning'
  );

  const collisionWork = path.join(tmp, 'collision');
  fs.mkdirSync(path.join(collisionWork, '.observe_files'), { recursive: true });
  const collisionSession = { sessionId: 'collision', workRootAbs: tmp, workDirectoryAbs: collisionWork };
  const c1 = path.join(collisionWork, '[1]assistant.md');
  fs.writeFileSync(c1, 'one');
  registerObserveAndPrune({ session: collisionSession, assistantPath: c1, carryover: 1 });
  const c3 = path.join(collisionWork, '[3]assistant.md');
  fs.writeFileSync(c3, 'three');
  fs.writeFileSync(path.join(collisionWork, '.observe_files', '[1]assistant.md'), 'collision');
  assert.throws(
    () => registerObserveAndPrune({ session: collisionSession, assistantPath: c3, carryover: 1 }),
    /already exists/
  );
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('promptpile-react observe files tests ok');
