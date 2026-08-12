'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const helper = path.join(__dirname, 'helpers/contender.cjs');
const run = (source, target) => new Promise(resolve => {
  const child = spawn(process.execPath, [helper, source, target], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', code => resolve({ code, stdout, stderr }));
});
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-race-'));
  try {
    const source = path.join(root, 'source'); const target = path.join(root, 'target'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, '[0]user.md'), 'race');
    const results = await Promise.all([run(source, target), run(source, target)]);
    assert.strictEqual(results.filter(result => result.code === 0).length, 1, JSON.stringify(results));
    assert.strictEqual(results.filter(result => result.code === 1).length, 1, JSON.stringify(results));
    assert(results.some(result => /target_claimed|target_exists/.test(result.stdout)));
    assert(fs.existsSync(target), `winner must publish target: ${JSON.stringify(results)}`);
    assert.deepStrictEqual(fs.readdirSync(target), ['[0]user.md']);
    assert(!fs.readdirSync(root).some(name => name.startsWith('.promptpile-fork.claim.')),
      'losing contender must not remove the winner claim, and winner must clean it after publication');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('fork target contention ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
