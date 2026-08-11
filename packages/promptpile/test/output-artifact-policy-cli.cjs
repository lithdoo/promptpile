'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const cli = path.join(packageRoot, 'dist', 'index.js');
const run = (cwd, args, extraEnv = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd, env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-output-policy-cli-'));
  const messages = path.join(root, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'hello');
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(
        `data: ${JSON.stringify({ choices: [{ delta: {
          content: 'answer', reasoning_content: 'reason',
          tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'f', arguments: '{}' } }]
        } }] })}\n\ndata: [DONE]\n\n`
      );
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const apiArgs = ['--api-key', 'key', '--api-base-url', `http://127.0.0.1:${address.port}/v1`, '--disable-tool'];

    const resultPath = path.join(root, 'collision', 'result.md');
    const collision = await run(root, ['-d', messages, ...apiArgs,
      '--output', resultPath, '--output-pile-file', path.join(root, 'collision', 'result.calls.jsonl')]);
    assert.strictEqual(collision.code, 1);
    assert.match(collision.stderr, /target collision/);
    assert.strictEqual(requestCount, 0);
    assert.strictEqual(fs.existsSync(path.dirname(resultPath)), false, 'collision does not mkdir or truncate');

    const invalidPile = await run(root, ['-d', messages, ...apiArgs, '--output-pile-file', messages]);
    assert.strictEqual(invalidPile.code, 1);
    assert.strictEqual(requestCount, 0, 'pile readiness failure happens before API request');

    const hookHelper = path.join(root, 'hook-helper.js');
    const hookMarker = path.join(root, 'hook-env.json');
    fs.writeFileSync(hookHelper, `require('fs').writeFileSync(process.env.HOOK_MARKER, JSON.stringify({\n` +
      `output: process.env.PROMPTPILE_OUTPUT_FILE, calls: process.env.PROMPTPILE_CALLS_FILE,\n` +
      `body: process.env.PROMPTPILE_ASSISTANT_MD_FILE, conversationCalls: process.env.PROMPTPILE_ASSISTANT_CALL_FILE,\n` +
      `conversationExtra: process.env.PROMPTPILE_ASSISTANT_EXTRA_FILE\n}));\n`);
    const hookPath = path.join(root, process.platform === 'win32' ? 'hook.cmd' : 'hook.sh');
    fs.writeFileSync(hookPath, process.platform === 'win32'
      ? '@node "%HOOK_HELPER%"\r\n'
      : '#!/bin/sh\nnode "$HOOK_HELPER"\n');
    if (process.platform !== 'win32') fs.chmodSync(hookPath, 0o755);

    const protectedHook = await run(root, ['-d', messages, ...apiArgs,
      '--output', hookPath, '--after-hook-path', hookPath]);
    assert.strictEqual(protectedHook.code, 1);
    assert.match(protectedHook.stderr, /overwrite resolved after-hook/);
    assert.strictEqual(requestCount, 0);

    const main = path.join(root, 'success', 'result.md');
    const pile = path.join(root, 'success', 'pile.jsonl');
    const success = await run(root, ['-d', messages, '--continue', ...apiArgs, '--quiet',
      '--output', main, '--output-pile-file', pile, '--output-pile-format', 'json',
      '--after-hook-path', hookPath
    ], { HOOK_HELPER: hookHelper, HOOK_MARKER: hookMarker });
    assert.strictEqual(success.code, 0, success.stderr);
    assert.strictEqual(success.stdout, '', 'quiet suppresses terminal output only');
    assert.strictEqual(requestCount, 1);
    assert.strictEqual(fs.readFileSync(main, 'utf8'), 'answer');
    assert.ok(fs.existsSync(path.join(root, 'success', 'result.calls.jsonl')));
    assert.ok(fs.existsSync(path.join(root, 'success', 'result.extra.json')));
    assert.deepStrictEqual(fs.readFileSync(pile, 'utf8').trim().split('\n').map(JSON.parse), [
      { type: 'assistant_delta', content: 'answer' }, { type: 'assistant_done' }
    ]);
    const env = JSON.parse(fs.readFileSync(hookMarker, 'utf8').replace(/^\uFEFF/, ''));
    assert.strictEqual(env.output, main);
    assert.strictEqual(env.calls, path.join(root, 'success', 'result.calls.jsonl'));
    assert.strictEqual(env.body, path.join(messages, '[1]assistant.md'));
    assert.strictEqual(env.conversationCalls, path.join(messages, '[1]assistant.calls.jsonl'));
    assert.strictEqual(env.conversationExtra, path.join(messages, '[1]assistant.extra.json'));
    console.log('output artifact policy CLI tests ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
