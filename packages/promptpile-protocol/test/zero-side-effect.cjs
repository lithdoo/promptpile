'use strict';
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
for (const target of ['promptpile-protocol', 'promptpile-protocol/conversation', 'promptpile-protocol/fingerprint', 'promptpile-protocol/tool', 'promptpile-protocol/receipt']) {
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(target)})`], { cwd: __dirname, encoding: 'utf8', timeout: 5000 });
  assert.strictEqual(result.status, 0, result.stderr);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, '');
}
