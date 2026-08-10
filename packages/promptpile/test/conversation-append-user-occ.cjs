const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const cli = path.join(packageRoot, 'dist', 'index.js');
const { fingerprintConversationDirectory } = require(path.join(
  packageRoot,
  'dist',
  'conversation-fingerprint.js'
));

const run = (args, input = '') => spawnSync(process.execPath, [cli, ...args], {
  cwd: packageRoot,
  input,
  encoding: 'utf8'
});

const contender = (args, input) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: packageRoot,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', status => resolve({ status, stdout, stderr }));
  child.stdin.end(input);
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-append-occ-'));
  try {
    const fingerprint = (await fingerprintConversationDirectory(root)).fingerprint;
    const baseArgs = [
      'conversation', 'append-user', '-d', root,
      '--expect-fingerprint', fingerprint,
      '--expected-next-index', '0'
    ];

    const mismatch = run([
      'conversation', 'append-user', '-d', root,
      '--expected-next-index', '1'
    ], 'no write');
    assert.strictEqual(mismatch.status, 3);
    assert.strictEqual(mismatch.stdout, '');
    assert.match(mismatch.stderr, /next_index_mismatch/);
    assert.deepStrictEqual(fs.readdirSync(root), []);

    const [a, b] = await Promise.all([
      contender(baseArgs, 'writer a'),
      contender(baseArgs, 'writer b')
    ]);
    const results = [a, b];
    assert.strictEqual(results.filter(result => result.status === 0).length, 1);
    assert.strictEqual(results.filter(result => result.status === 3).length, 1);
    assert.strictEqual(results.find(result => result.status === 3).stdout, '');
    assert.strictEqual(fs.readdirSync(root).filter(name => /^\[\d+\]user\.md$/.test(name)).length, 1);
    assert.ok(!fs.existsSync(path.join(root, '.promptpile.occ.claim')));

    const malformed = run([
      'conversation', 'append-user', '-d', root,
      '--expect-fingerprint', 'PROMPTPILE-CONVERSATION-V1:SHA256:bad'
    ], 'bad');
    assert.strictEqual(malformed.status, 1);
    assert.strictEqual(malformed.stdout, '');
    console.log('conversation append-user OCC tests ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
