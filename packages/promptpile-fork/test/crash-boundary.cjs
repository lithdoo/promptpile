'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const helper = path.join(__dirname, 'helpers/crash.cjs');
for (const point of ['before_publish', 'after_publish']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-crash-'));
  try {
    const source = path.join(root, 'source'); const target = path.join(root, 'target'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, '[0]user.md'), 'crash boundary');
    const result = spawnSync(process.execPath, [helper, source, target, point], { encoding: 'utf8' });
    assert.strictEqual(result.status, 73, result.stderr);
    if (point === 'before_publish') {
      assert(!fs.existsSync(target));
      assert(fs.readdirSync(root).some(name => name.startsWith('.promptpile-fork.staging.')));
    } else {
      assert.strictEqual(fs.readFileSync(path.join(target, '[0]user.md'), 'utf8'), 'crash boundary');
      assert(!fs.readdirSync(root).some(name => name.startsWith('.promptpile-fork.staging.')));
    }
    assert(fs.readdirSync(root).some(name => name.startsWith('.promptpile-fork.claim.')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
console.log('fork crash publication boundary ok');
