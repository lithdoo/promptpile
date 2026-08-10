'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const cli = path.join(packageRoot, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-layered-cli-'));

const run = (args, stdin = '', extraEnv = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd: tmp,
    env: { ...process.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk.toString(); });
  child.stderr.on('data', chunk => { stderr += chunk.toString(); });
  child.on('close', code => resolve({ code, stdout, stderr }));
  child.stdin.end(stdin);
});

(async () => {
  const base = path.join(tmp, 'base');
  const session = path.join(tmp, 'session');
  fs.mkdirSync(base);
  fs.mkdirSync(session);
  fs.writeFileSync(path.join(base, '[10]system.md'), 'base-ten');
  fs.writeFileSync(path.join(session, '[0]user.md'), 'session-zero');
  const originalBaseMode = fs.statSync(base).mode;
  if (process.platform !== 'win32') {
    fs.chmodSync(path.join(base, '[10]system.md'), 0o444);
    fs.chmodSync(base, 0o555);
  }

  const receivedBodies = [];
  const server = http.createServer((request, response) => {
    let raw = '';
    request.on('data', chunk => { raw += chunk.toString(); });
    request.on('end', () => {
      receivedBodies.push(JSON.parse(raw));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (receivedBodies.length !== 2) {
        response.end('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n');
      } else {
        response.end([
          'data: {"choices":[{"delta":{"content":"written","reasoning_content":"trace","tool_calls":[{"index":0,"id":"call_output","type":"function","function":{"name":"write_test","arguments":"{}"}}]}}]}',
          '',
          'data: [DONE]',
          '',
          ''
        ].join('\n'));
      }
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const result = await run([
      '-d',
      base,
      '-d',
      session,
      '--api-key',
      'test-key',
      '--api-base-url',
      `http://127.0.0.1:${address.port}/v1`,
      '--disable-tool',
      '--quiet'
    ]);
    assert.strictEqual(result.code, 0, result.stderr);
    assert.deepStrictEqual(
      receivedBodies[0].messages,
      [
        { role: 'system', content: 'base-ten' },
        { role: 'user', content: 'session-zero' }
      ],
      'public CLI sends scan(base) followed by scan(session), not global idx order'
    );

    const hookCapture = path.join(tmp, 'hook-capture.json');
    const hookPath = path.join(
      tmp,
      process.platform === 'win32' ? 'capture-hook.cmd' : 'capture-hook.sh'
    );
    fs.writeFileSync(
      hookPath,
      `${process.platform === 'win32' ? '@' : ''}node -e "const fs=require('fs');fs.writeFileSync(process.env.HOOK_CAPTURE,JSON.stringify({cwd:process.cwd(),scan:process.env.PROMPTPILE_SCAN_DIRECTORY,inputs:JSON.parse(process.env.PROMPTPILE_INPUT_DIRECTORIES_JSON),output:process.env.PROMPTPILE_OUTPUT_DIRECTORY,md:process.env.PROMPTPILE_ASSISTANT_MD_FILE,calls:process.env.PROMPTPILE_ASSISTANT_CALL_FILE,extra:process.env.PROMPTPILE_ASSISTANT_EXTRA_FILE}))"\n`
    );
    const continued = await run([
      '-d',
      base,
      '--output-dir',
      session,
      '--continue',
      '--after-hook-path',
      hookPath,
      '--api-key',
      'test-key',
      '--api-base-url',
      `http://127.0.0.1:${address.port}/v1`,
      '--disable-tool',
      '--quiet'
    ], '', { HOOK_CAPTURE: hookCapture });
    assert.strictEqual(continued.code, 0, continued.stderr);
    assert.deepStrictEqual(
      receivedBodies[1].messages,
      [
        { role: 'system', content: 'base-ten' },
        { role: 'user', content: 'session-zero' }
      ],
      'output directory is read automatically as the final layer'
    );
    assert.strictEqual(
      fs.readFileSync(path.join(session, '[1]assistant.md'), 'utf8'),
      'written',
      'next idx is calculated from the output directory rather than base idx 10'
    );
    const calls = fs.readFileSync(path.join(session, '[1]assistant.calls.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    assert.strictEqual(calls[0].id, 'call_output');
    assert.deepStrictEqual(
      JSON.parse(fs.readFileSync(path.join(session, '[1]assistant.extra.json'), 'utf8')),
      { reasoning_content: 'trace' }
    );
    const hook = JSON.parse(fs.readFileSync(hookCapture, 'utf8'));
    assert.strictEqual(hook.cwd, fs.realpathSync(session));
    assert.strictEqual(hook.scan, '');
    assert.deepStrictEqual(hook.inputs, [fs.realpathSync(base), fs.realpathSync(session)]);
    assert.strictEqual(hook.output, fs.realpathSync(session));
    assert.strictEqual(hook.md, path.join(fs.realpathSync(session), '[1]assistant.md'));
    assert.strictEqual(hook.calls, path.join(fs.realpathSync(session), '[1]assistant.calls.jsonl'));
    assert.strictEqual(hook.extra, path.join(fs.realpathSync(session), '[1]assistant.extra.json'));
    assert.ok(
      !fs.readdirSync(base).some(name => name.startsWith('[11]assistant')),
      'read-only base layer receives no continuation artifacts'
    );

    const inputRun = await run([
      '-d',
      base,
      '--output-dir',
      session,
      '--input',
      '--api-key',
      'test-key',
      '--api-base-url',
      `http://127.0.0.1:${address.port}/v1`,
      '--disable-tool',
      '--missing-tool-results',
      'ignore',
      '--quiet'
    ], 'new-session-user\n');
    assert.strictEqual(inputRun.code, 0, inputRun.stderr);
    assert.strictEqual(
      fs.readFileSync(path.join(session, '[2]user.md'), 'utf8'),
      'new-session-user',
      '--input appends only to the output directory using its local idx'
    );
    assert.strictEqual(receivedBodies[2].messages.at(-1).content, 'new-session-user');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (process.platform !== 'win32') {
      fs.chmodSync(base, originalBaseMode & 0o777);
      fs.chmodSync(path.join(base, '[10]system.md'), 0o644);
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log('layered conversation CLI contract tests ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
