'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
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

const run = (cwd, args, stdin = '', extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
  child.stdin.end(stdin);
});

const sendCompletion = (response, content) => {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
};

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-root-occ-'));
  const inputOnly = path.join(root, 'input-only');
  const conflictDir = path.join(root, 'continue-conflict');
  const combinedDir = path.join(root, 'combined');
  const combinedConflictDir = path.join(root, 'combined-conflict');
  const baseDir = path.join(root, 'base');
  fs.mkdirSync(inputOnly);
  fs.mkdirSync(conflictDir);
  fs.mkdirSync(combinedDir);
  fs.mkdirSync(combinedConflictDir);
  fs.mkdirSync(baseDir);
  fs.writeFileSync(path.join(baseDir, '[10]system.md'), 'read-only base');
  fs.writeFileSync(path.join(conflictDir, '[0]user.md'), 'initial');

  let requestCount = 0;
  let conflictFingerprint;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', async () => {
      requestCount += 1;
      if (requestCount === 2) {
        const competing = spawnSync(process.execPath, [
          cli,
          'conversation', 'append-user', '-d', conflictDir,
          '--expect-fingerprint', conflictFingerprint,
          '--expected-next-index', '1',
          '--quiet'
        ], { cwd: root, input: 'competing writer', encoding: 'utf8' });
        assert.strictEqual(competing.status, 0, competing.stderr);
        sendCompletion(response, 'assistant-conflict');
        return;
      }
      if (requestCount === 4) {
        const current = await fingerprintConversationDirectory(combinedConflictDir);
        const competing = spawnSync(process.execPath, [
          cli,
          'conversation', 'append-user', '-d', combinedConflictDir,
          '--expect-fingerprint', current.fingerprint,
          '--expected-next-index', '1',
          '--quiet'
        ], { cwd: root, input: 'combined competitor', encoding: 'utf8' });
        assert.strictEqual(competing.status, 0, competing.stderr);
        sendCompletion(response, 'combined-must-conflict');
        return;
      }
      sendCompletion(response, requestCount === 1 ? 'input-response' : 'combined-response');
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const api = `http://127.0.0.1:${address.port}/v1`;

    const invalidUse = await run(root, [
      '-d', inputOnly,
      '--expected-output-next-index', '0',
      '--api-key', 'test-key', '--api-base-url', api,
      '--disable-tool', '--quiet'
    ]);
    assert.strictEqual(invalidUse.code, 1);
    assert.match(invalidUse.stderr, /require --input or --continue/);
    assert.strictEqual(requestCount, 0);

    const preflightMismatch = await run(root, [
      '-d', inputOnly, '--input',
      '--expected-output-next-index', '1',
      '--api-key', 'test-key', '--api-base-url', api,
      '--disable-tool', '--quiet'
    ], 'must not be written');
    assert.strictEqual(preflightMismatch.code, 3, preflightMismatch.stderr);
    assert.strictEqual(requestCount, 0, 'preflight mismatch must not call the model');
    assert.deepStrictEqual(fs.readdirSync(inputOnly), []);

    const inputFingerprint = (await fingerprintConversationDirectory(inputOnly)).fingerprint;
    const inputSuccess = await run(root, [
      '-d', inputOnly, '--input',
      '--expect-output-fingerprint', inputFingerprint,
      '--expected-output-next-index', '0',
      '--api-key', 'test-key', '--api-base-url', api,
      '--disable-tool', '--quiet'
    ], 'input message');
    assert.strictEqual(inputSuccess.code, 0, inputSuccess.stderr);
    assert.strictEqual(fs.readFileSync(path.join(inputOnly, '[0]user.md'), 'utf8'), 'input message');

    conflictFingerprint = (await fingerprintConversationDirectory(conflictDir)).fingerprint;
    const mainOutput = path.join(root, 'post-model-output.md');
    const outputPile = path.join(root, 'post-model-output.jsonl');
    const hookMarker = path.join(root, 'hook-ran.txt');
    const hook = path.join(root, process.platform === 'win32' ? 'hook.cmd' : 'hook.sh');
    fs.writeFileSync(
      hook,
      process.platform === 'win32'
        ? '@node -e "require(\'fs\').writeFileSync(process.env.HOOK_MARKER,\'ran\')"\n'
        : '#!/bin/sh\nnode -e "require(\'fs\').writeFileSync(process.env.HOOK_MARKER,\'ran\')"\n'
    );
    if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);
    const continueConflict = await run(root, [
      '-d', conflictDir, '--continue',
      '--expect-output-fingerprint', conflictFingerprint,
      '--expected-output-next-index', '1',
      '--api-key', 'test-key', '--api-base-url', api,
      '--disable-tool', '--quiet', '--output', mainOutput,
      '--output-pile-file', outputPile, '--output-pile-format', 'json',
      '--after-hook-path', hook
    ], '', { HOOK_MARKER: hookMarker });
    assert.strictEqual(continueConflict.code, 3, continueConflict.stderr);
    assert.match(continueConflict.stderr, /(fingerprint_mismatch|next_index_mismatch)/);
    assert.strictEqual(fs.readFileSync(mainOutput, 'utf8'), 'assistant-conflict');
    assert.deepStrictEqual(
      fs.readFileSync(outputPile, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
      [
        { type: 'assistant_delta', content: 'assistant-conflict' },
        { type: 'assistant_done' }
      ],
      'model-stream completion remains independent from the later Conversation commit conflict'
    );
    assert.ok(!fs.existsSync(path.join(conflictDir, '[1]assistant.md')));
    assert.strictEqual(fs.readFileSync(path.join(conflictDir, '[1]user.md'), 'utf8'), 'competing writer');
    assert.ok(!fs.existsSync(hookMarker), 'after-hook must not run after post-model conflict');

    const combinedFingerprint = (await fingerprintConversationDirectory(combinedDir)).fingerprint;
    const combined = await run(root, [
      '-d', baseDir, '--output-dir', combinedDir, '--input', '--continue',
      '--expect-output-fingerprint', combinedFingerprint,
      '--expected-output-next-index', '0',
      '--api-key', 'test-key', '--api-base-url', api,
      '--disable-tool', '--quiet'
    ], 'combined input');
    assert.strictEqual(combined.code, 0, combined.stderr);
    assert.strictEqual(fs.readFileSync(path.join(combinedDir, '[0]user.md'), 'utf8'), 'combined input');
    assert.strictEqual(
      fs.readFileSync(path.join(combinedDir, '[1]assistant.md'), 'utf8'),
      'combined-response'
    );
    assert.ok(!fs.existsSync(path.join(combinedDir, '.promptpile.occ.claim')));
    assert.strictEqual(fs.readFileSync(path.join(baseDir, '[10]system.md'), 'utf8'), 'read-only base');
    assert.deepStrictEqual(fs.readdirSync(baseDir), ['[10]system.md']);

    const combinedConflictFingerprint = (
      await fingerprintConversationDirectory(combinedConflictDir)
    ).fingerprint;
    const combinedConflict = await run(root, [
      '-d', combinedConflictDir, '--input', '--continue',
      '--expect-output-fingerprint', combinedConflictFingerprint,
      '--expected-output-next-index', '0',
      '--api-key', 'test-key', '--api-base-url', api,
      '--disable-tool', '--quiet'
    ], 'retained input');
    assert.strictEqual(combinedConflict.code, 3, combinedConflict.stderr);
    assert.strictEqual(
      fs.readFileSync(path.join(combinedConflictDir, '[0]user.md'), 'utf8'),
      'retained input'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(combinedConflictDir, '[1]user.md'), 'utf8'),
      'combined competitor'
    );
    assert.ok(!fs.existsSync(path.join(combinedConflictDir, '[1]assistant.md')));
    assert.ok(!fs.existsSync(path.join(combinedConflictDir, '[2]assistant.md')));
    assert.strictEqual(requestCount, 4);
    console.log('root Conversation OCC tests ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
