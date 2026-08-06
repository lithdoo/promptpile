const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildMessages, scanDirectory } = require('../dist/file-handler');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-protocol-'));

try {
  fs.writeFileSync(path.join(root, '[1]CustomRole.md'), 'custom');
  fs.writeFileSync(path.join(root, '[2]user.MD'), 'ignored');
  fs.writeFileSync(path.join(root, '[3]Assistant.CALLS.JSONL'), 'ignored');
  fs.writeFileSync(path.join(root, '[4]assistant.calls.jsonl'), '');

  const files = scanDirectory(root);
  assert.deepStrictEqual(
    files.map(({ idx, role, fileKind }) => ({ idx, role, fileKind })),
    [
      { idx: 1, role: 'CustomRole', fileKind: 'message' },
      { idx: 4, role: 'assistant', fileKind: 'assistant_call' },
    ]
  );
  assert.strictEqual(
    buildMessages(files.filter(({ idx }) => idx === 1))[0].role,
    'CustomRole'
  );
  console.log('conversation protocol scanner tests ok');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
