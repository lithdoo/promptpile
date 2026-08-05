'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  appendUserMessage,
  buildMessages,
  scanDirectory
} = require(path.join(root, 'dist', 'file-handler.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-append-user-'));
try {
  const emptyDir = path.join(tmp, 'empty');
  fs.mkdirSync(emptyDir);

  const multiline = 'first line\nsecond line\n';
  const firstPath = appendUserMessage(emptyDir, scanDirectory(emptyDir), multiline);
  assert.strictEqual(path.basename(firstPath), '[0]user.md', 'empty directory starts at index zero');
  assert.strictEqual(fs.readFileSync(firstPath, 'utf8'), multiline, 'user content is preserved exactly');
  assert.deepStrictEqual(
    buildMessages(scanDirectory(emptyDir)),
    [{ role: 'user', content: multiline }],
    'the normal scanner can read an appended user message'
  );
  assert.ok(
    !fs.readdirSync(emptyDir).some(name => name.includes('.tmp-')),
    'atomic append leaves no temporary file behind'
  );

  const indexedDir = path.join(tmp, 'indexed');
  fs.mkdirSync(indexedDir);
  fs.writeFileSync(path.join(indexedDir, '[0]system.md'), 'system');
  fs.writeFileSync(path.join(indexedDir, '[2]assistant.md'), 'assistant');

  const nextPath = appendUserMessage(indexedDir, scanDirectory(indexedDir), 'next');
  assert.strictEqual(path.basename(nextPath), '[3]user.md', 'append follows the largest scanned index');
  assert.strictEqual(fs.readFileSync(nextPath, 'utf8'), 'next');

  fs.writeFileSync(path.join(indexedDir, '[4]user.md'), 'occupied');
  const collisionPath = appendUserMessage(indexedDir, scanDirectory(indexedDir), 'after occupied');
  assert.strictEqual(path.basename(collisionPath), '[5]user.md', 'append skips an occupied target index');
  assert.strictEqual(fs.readFileSync(path.join(indexedDir, '[4]user.md'), 'utf8'), 'occupied');

  console.log('append-user tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
