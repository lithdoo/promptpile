const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildMessages,
  compareConversationArtifacts,
  compareUtf8Bytes,
  scanDirectory
} = require('../dist/file-handler');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-protocol-'));

try {
  fs.writeFileSync(path.join(root, '[1]CustomRole.md'), 'custom');
  fs.writeFileSync(path.join(root, '[2]user.MD'), 'ignored');
  fs.writeFileSync(path.join(root, '[3]Assistant.CALLS.JSONL'), 'ignored');
  fs.writeFileSync(path.join(root, '[4]assistant.calls.jsonl'), '');
  fs.writeFileSync(path.join(root, '[5]assistant.json'), 'assistant json');
  fs.writeFileSync(path.join(root, '[5]assistant.md'), 'assistant markdown');
  fs.writeFileSync(path.join(root, '[6]é.md'), 'precomposed');
  fs.writeFileSync(path.join(root, '[6]e\u0301.md'), 'combining');
  fs.writeFileSync(path.join(root, '[7]user.md'), 'plain');
  fs.writeFileSync(path.join(root, '[07]user.md'), 'zero padded');
  fs.writeFileSync(path.join(root, '[9007199254740991]user.md'), 'largest valid index');
  fs.writeFileSync(path.join(root, '[9007199254740992]user.md'), 'outside safe integer range');
  fs.writeFileSync(
    path.join(root, '[9007199254740992]assistant.extra.json'),
    'must not fall back to a normal .json message'
  );

  const files = scanDirectory(root);
  assert.deepStrictEqual(
    files.map(({ idx, role, fileKind }) => ({ idx, role, fileKind })),
    [
      { idx: 1, role: 'CustomRole', fileKind: 'message' },
      { idx: 4, role: 'assistant', fileKind: 'assistant_call' },
      { idx: 5, role: 'assistant', fileKind: 'message' },
      { idx: 5, role: 'assistant', fileKind: 'message' },
      { idx: 6, role: 'e\u0301', fileKind: 'message' },
      { idx: 6, role: 'é', fileKind: 'message' },
      { idx: 7, role: 'user', fileKind: 'message' },
      { idx: 7, role: 'user', fileKind: 'message' },
      { idx: Number.MAX_SAFE_INTEGER, role: 'user', fileKind: 'message' },
    ]
  );
  assert.strictEqual(
    buildMessages(files.filter(({ idx }) => idx === 1))[0].role,
    'CustomRole'
  );
  assert.deepStrictEqual(
    files.filter(({ idx }) => idx === 5).map(({ relativePath }) => relativePath),
    ['[5]assistant.json', '[5]assistant.md'],
    'assistant.json remains an ordinary message before assistant.md'
  );
  assert.ok(compareUtf8Bytes('A', 'a') < 0);
  assert.ok(compareUtf8Bytes('e\u0301', 'é') < 0);
  assert.ok(!files.some(({ relativePath }) => relativePath.includes('9007199254740992')));

  const sameArtifactAtDifferentRoots = [
    { ...files[0], path: path.join(root, 'z', files[0].relativePath) },
    { ...files[0], path: path.join(root, 'a', files[0].relativePath) }
  ];
  assert.strictEqual(
    compareConversationArtifacts(sameArtifactAtDifferentRoots[0], sameArtifactAtDifferentRoots[1]),
    0,
    'absolute path is not part of canonical scanner order'
  );
  console.log('conversation protocol scanner tests ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
