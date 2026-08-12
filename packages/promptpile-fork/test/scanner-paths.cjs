'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSelectedArtifacts } = require('../dist/scanner');
const { resolveForkPaths } = require('../dist/paths');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-scan-'));
  try {
    const source = path.join(root, 'source'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, '[01]User.md'), 'u');
    fs.writeFileSync(path.join(source, '[1]assistant.calls.jsonl'), '{bad');
    fs.writeFileSync(path.join(source, '[1]assistant.result.jsonl'), 'bad');
    fs.writeFileSync(path.join(source, '[2]assistant.md'), 'excluded');
    fs.writeFileSync(path.join(source, 'lock'), 'ignored');
    fs.mkdirSync(path.join(source, 'nested'));
    fs.writeFileSync(path.join(source, 'nested', '[0]user.md'), 'ignored');
    const selected = await scanSelectedArtifacts(source, 1);
    assert.deepStrictEqual(selected.map(item => item.relativePath), [
      '[01]User.md', '[1]assistant.calls.jsonl', '[1]assistant.result.jsonl'
    ]);
    const resolved = await resolveForkPaths(source, path.join(root, 'target'));
    assert.strictEqual(resolved.source, fs.realpathSync(source));
    await assert.rejects(resolveForkPaths(source, path.join(source, 'target')), error => error.code === 'path_overlap');
    fs.mkdirSync(path.join(root, 'existing'));
    await assert.rejects(resolveForkPaths(source, path.join(root, 'existing')), error => error.code === 'target_exists');
    await assert.rejects(resolveForkPaths(source, path.join(root, 'missing', 'target')), error => error.code === 'invalid_target_parent');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('fork scanner and path validation ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
