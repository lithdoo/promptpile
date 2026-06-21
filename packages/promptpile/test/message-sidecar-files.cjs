'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const {
  parsePipeSeparatedPaths,
  parseSidecarBasename,
  loadSidecarMessages,
  applyInsertFiles,
  applyAppendFiles
} = require(path.join(root, 'dist', 'message-sidecar-files.js'));

assert.deepStrictEqual(parsePipeSeparatedPaths(undefined), []);
assert.deepStrictEqual(parsePipeSeparatedPaths(''), []);
assert.deepStrictEqual(parsePipeSeparatedPaths('  '), []);
assert.deepStrictEqual(parsePipeSeparatedPaths('a.system.md| b.user.md '), [
  'a.system.md',
  'b.user.md'
]);
assert.deepStrictEqual(parsePipeSeparatedPaths('only.system.md'), ['only.system.md']);

assert.throws(() => parseSidecarBasename('/x/bad.md'), /basename must be/);
assert.throws(() => parseSidecarBasename('/x/x.tool.md'), /system, user, or assistant/);
assert.deepStrictEqual(parseSidecarBasename('/x/react.core.system.md'), {
  name: 'react.core',
  role: 'system'
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-sidecar-'));
try {
  const emptyPath = path.join(tmp, 'empty.system.md');
  fs.writeFileSync(emptyPath, '   \n', 'utf8');
  const goodPath = path.join(tmp, 'hello.user.md');
  fs.writeFileSync(goodPath, 'hi', 'utf8');

  const loaded = loadSidecarMessages(tmp, `${emptyPath}|${goodPath}`);
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].role, 'user');
  assert.strictEqual(loaded[0].content, 'hi');

  const base = [{ role: 'user', content: 'scan' }];
  const inserted = applyInsertFiles(base, [{ role: 'system', content: 'pre' }]);
  assert.deepStrictEqual(inserted, [
    { role: 'system', content: 'pre' },
    { role: 'user', content: 'scan' }
  ]);
  const appended = applyAppendFiles(base, [{ role: 'assistant', content: 'post' }]);
  assert.deepStrictEqual(appended, [
    { role: 'user', content: 'scan' },
    { role: 'assistant', content: 'post' }
  ]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('message-sidecar-files tests ok');
