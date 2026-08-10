'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const inspectModule = require('../dist/conversation-inspect');
const {
  formatConversationInspectionJson,
  formatConversationInspectionText,
  inspectConversation
} = inspectModule;
const { scanDirectory } = require('../dist/file-handler');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-inspect-'));

try {
  assert.strictEqual(
    inspectModule.buildConversationInspection,
    undefined,
    'the single-directory builder must remain module-private'
  );

  const empty = inspectConversation(root, './empty');
  assert.deepStrictEqual(empty, {
    schemaVersion: 1,
    directory: './empty',
    artifactCount: 0,
    maxIndex: null,
    artifacts: []
  });
  assert.strictEqual(
    formatConversationInspectionText(empty),
    'Conversation: ./empty\nArtifacts: 0\nMax index: null\n\n'
  );
  assert.strictEqual(
    formatConversationInspectionJson(empty),
    `${JSON.stringify(empty, null, 2)}\n`
  );

  fs.writeFileSync(path.join(root, '[0]system.md'), 'system body');
  fs.writeFileSync(path.join(root, '[1]user.md'), 'one');
  fs.writeFileSync(path.join(root, '[01]user.md'), 'zero-padded');
  fs.writeFileSync(path.join(root, '[2]assistant.md'), 'assistant body');
  fs.writeFileSync(path.join(root, '[2]assistant.calls.jsonl'), 'not valid jsonl');
  fs.writeFileSync(path.join(root, '[2]assistant.extra.json'), 'not valid json');
  fs.writeFileSync(path.join(root, '[2]assistant.result.jsonl'), 'also not valid jsonl');
  fs.writeFileSync(path.join(root, '[3]CustomRole.json'), 'not valid json');
  fs.writeFileSync(path.join(root, '[4]alpha.md'), 'alpha');
  fs.writeFileSync(path.join(root, '[4]beta.md'), 'beta');
  fs.writeFileSync(path.join(root, '[5]user.MD'), 'ignored uppercase extension');
  fs.writeFileSync(path.join(root, 'unknown.txt'), 'ignored unknown file');
  fs.mkdirSync(path.join(root, 'nested'));
  fs.writeFileSync(path.join(root, 'nested', '[6]user.md'), 'ignored nested file');

  const scanned = scanDirectory(root);
  const originalReadFileSync = fs.readFileSync;
  let inspection;
  try {
    fs.readFileSync = () => {
      throw new Error('artifact content must not be read');
    };
    inspection = inspectConversation(root, './messages');
    formatConversationInspectionText(inspection);
    formatConversationInspectionJson(inspection);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }

  assert.strictEqual(inspection.directory, './messages');
  assert.strictEqual(inspection.artifactCount, scanned.length);
  assert.strictEqual(inspection.artifactCount, inspection.artifacts.length);
  assert.strictEqual(inspection.maxIndex, 4);
  assert.deepStrictEqual(
    inspection.artifacts,
    scanned.map(file => ({
      index: file.idx,
      kind: file.fileKind,
      role: file.role,
      extension: file.extension,
      path: file.relativePath
    }))
  );

  assert.strictEqual(inspection.artifacts.filter(artifact => artifact.index === 1).length, 2);
  assert.ok(inspection.artifacts.some(artifact => artifact.path === '[1]user.md'));
  assert.ok(inspection.artifacts.some(artifact => artifact.path === '[01]user.md'));
  assert.ok(inspection.artifacts.some(artifact => artifact.role === 'CustomRole'));
  assert.deepStrictEqual(
    inspection.artifacts
      .filter(artifact => artifact.index === 2)
      .map(artifact => artifact.kind),
    ['message', 'assistant_call', 'assistant_extra', 'assistant_result']
  );
  assert.ok(!inspection.artifacts.some(artifact => artifact.index === 5));
  assert.ok(!inspection.artifacts.some(artifact => artifact.index === 6));

  const json = formatConversationInspectionJson(inspection);
  assert.deepStrictEqual(JSON.parse(json), inspection);
  assert.strictEqual(json.endsWith('\n'), true);
  assert.strictEqual(json.endsWith('\n\n'), false);

  const text = formatConversationInspectionText(inspection);
  assert.match(text, /^Conversation: \.\/messages\nArtifacts: 10\nMax index: 4\n\n/);
  assert.match(text, /\[2\]\s+assistant_call\s+assistant\s+jsonl\s+\[2\]assistant\.calls\.jsonl/);

  console.log('conversation inspect read model tests ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
