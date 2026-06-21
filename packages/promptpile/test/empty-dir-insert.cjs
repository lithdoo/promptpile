'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const root = path.join(__dirname, '..');
const { loadSidecarMessages, applyInsertFiles } = require(path.join(
  root,
  'dist',
  'message-sidecar-files.js'
));
const { buildMessages } = require(path.join(root, 'dist', 'file-handler.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-empty-insert-'));
try {
  const emptyDir = path.join(tmp, 'empty-scan');
  fs.mkdirSync(emptyDir, { recursive: true });

  const sidecar = path.join(tmp, 'check.system.md');
  fs.writeFileSync(sidecar, 'system prompt', 'utf8');

  const inserts = loadSidecarMessages(tmp, sidecar);
  assert.strictEqual(inserts.length, 1);
  assert.strictEqual(inserts[0].role, 'system');

  const messages = applyInsertFiles([], inserts);
  assert.deepStrictEqual(messages, [{ role: 'system', content: 'system prompt' }]);

  const fromScan = buildMessages([]);
  assert.deepStrictEqual(fromScan, []);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('empty-dir-insert tests ok');
