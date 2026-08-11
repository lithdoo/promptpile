'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const cli = path.join(packageRoot, 'dist', 'index.js');
const {
  parseInvocationId,
  resolveInvocationContext
} = require(path.join(packageRoot, 'dist', 'invocation-context.js'));

const run = (cwd, args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
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
});

const makeMessages = (root, name) => {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, '[0]user.md'), 'same prompt');
  return directory;
};

(async () => {
  assert.strictEqual(parseInvocationId('a'), 'a');
  assert.strictEqual(parseInvocationId('run:01J.X_Y-Z'), 'run:01J.X_Y-Z');
  assert.strictEqual(parseInvocationId('x'.repeat(128)), 'x'.repeat(128));
  assert.deepStrictEqual(resolveInvocationContext(undefined), { id: null });
  assert.deepStrictEqual(resolveInvocationContext('run:resolved'), { id: 'run:resolved' });
  for (const invalid of ['', 'x'.repeat(129), ' has-space', 'has space', '../escape', 'a\\b', '换行', 'a\nb']) {
    assert.throws(() => parseInvocationId(invalid), /invalid invocation id: expected 1-128 characters/);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-invocation-receipt-'));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end([
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}`,
        '',
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 }
        })}`,
        '',
        'data: [DONE]',
        ''
      ].join('\n'));
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const apiArgs = [
      '--api-key', 'key',
      '--api-base-url', `http://127.0.0.1:${address.port}/v1`,
      '--model', 'receipt-model',
      '--disable-tool',
      '--quiet'
    ];

    const hookHelper = path.join(root, 'capture-hook.js');
    fs.writeFileSync(hookHelper, [
      "const fs = require('fs');",
      "fs.writeFileSync(process.env.HOOK_CAPTURE, JSON.stringify({",
      "  hasInvocationId: Object.prototype.hasOwnProperty.call(process.env, 'PROMPTPILE_INVOCATION_ID'),",
      "  invocationId: process.env.PROMPTPILE_INVOCATION_ID,",
      "  receiptExistsDuringHook: fs.existsSync(process.env.RECEIPT_PATH),",
      "  assistantExists: !process.env.PROMPTPILE_ASSISTANT_MD_FILE || fs.existsSync(process.env.PROMPTPILE_ASSISTANT_MD_FILE)",
      "}));",
      "if (process.env.HOOK_STDERR) process.stderr.write(process.env.HOOK_STDERR);",
      "process.exit(Number(process.env.HOOK_EXIT_CODE || 0));",
      ''
    ].join('\n'));
    const hook = path.join(root, process.platform === 'win32' ? 'capture-hook.cmd' : 'capture-hook.sh');
    fs.writeFileSync(hook, process.platform === 'win32'
      ? '@node "%HOOK_HELPER%"\r\n'
      : '#!/bin/sh\nexec node "$HOOK_HELPER"\n');
    if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);

    const messagesA = makeMessages(root, 'messages-a');
    const receiptA = path.join(root, 'receipts', 'a.json');
    const outputA = path.join(root, 'outputs', 'a.md');
    const captureA = path.join(root, 'capture-a.json');
    const first = await run(root, [
      '-d', messagesA, ...apiArgs,
      '--continue', '-o', outputA,
      '--invocation-id', 'run:01J.X_Y-Z',
      '--receipt', receiptA,
      '--after-hook-path', hook,
      '--after-hook-failure', 'error'
    ], {
      HOOK_HELPER: hookHelper,
      HOOK_CAPTURE: captureA,
      RECEIPT_PATH: receiptA
    });
    assert.strictEqual(first.code, 0, first.stderr);
    const hookA = JSON.parse(fs.readFileSync(captureA, 'utf8'));
    assert.deepStrictEqual(hookA, {
      hasInvocationId: true,
      invocationId: 'run:01J.X_Y-Z',
      receiptExistsDuringHook: false,
      assistantExists: true
    });
    const docA = JSON.parse(fs.readFileSync(receiptA, 'utf8'));
    assert.strictEqual(docA.schemaVersion, 1);
    assert.strictEqual(docA.status, 'completed');
    assert.strictEqual(docA.invocationId, 'run:01J.X_Y-Z');
    assert.strictEqual(docA.artifacts.assistant, path.join(fs.realpathSync(messagesA), '[1]assistant.md'));
    assert.strictEqual(docA.artifacts.mainOutput, path.resolve(outputA));
    assert.ok(fs.existsSync(docA.artifacts.assistant));
    assert.ok(fs.existsSync(docA.artifacts.mainOutput));
    assert.strictEqual(docA.model, 'receipt-model');
    assert.strictEqual(docA.finishReason, 'stop');
    assert.deepStrictEqual(docA.usage, { inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    assert.deepStrictEqual(docA.hook, {
      status: 'succeeded', failureMode: 'error', path: fs.realpathSync(hook), exitCode: 0
    });

    const messagesB = makeMessages(root, 'messages-b');
    const receiptB = path.join(root, 'receipts', 'b.json');
    const captureB = path.join(root, 'capture-b.json');
    const second = await run(root, [
      '-d', messagesB, ...apiArgs,
      '--receipt', receiptB,
      '--after-hook-path', hook
    ], {
      HOOK_HELPER: hookHelper,
      HOOK_CAPTURE: captureB,
      RECEIPT_PATH: receiptB,
      PROMPTPILE_INVOCATION_ID: 'stale-parent-value'
    });
    assert.strictEqual(second.code, 0, second.stderr);
    assert.deepStrictEqual(requests[0], requests[1], 'invocation metadata must not alter the model request body');
    const hookB = JSON.parse(fs.readFileSync(captureB, 'utf8'));
    assert.strictEqual(hookB.hasInvocationId, false, 'an inherited invocation id must be scrubbed');
    assert.strictEqual(JSON.parse(fs.readFileSync(receiptB, 'utf8')).invocationId, null);
    assert.ok(!JSON.stringify(requests).includes('run:01J.X_Y-Z'));
    assert.ok(!fs.readdirSync(messagesA).some(name => name.includes('run:01J')));

    for (const invalid of ['../escape', 'bad\nINJECTED', 'x'.repeat(129), 'unicode-世界']) {
      const before = requests.length;
      const failed = await run(root, ['-d', messagesB, ...apiArgs, '--invocation-id', invalid]);
      assert.strictEqual(failed.code, 1);
      assert.strictEqual(requests.length, before, 'invalid invocation id must fail before the model call');
      assert.ok(!failed.stderr.includes('INJECTED'), 'the untrusted value must not be echoed into diagnostics');
    }

    const subcommand = await run(root, [
      '--invocation-id', 'root-only', 'conversation', 'inspect', '-d', messagesB
    ]);
    assert.strictEqual(subcommand.code, 1);
    assert.match(subcommand.stderr, /--invocation-id is only valid for root completion/);

    const collisionTarget = path.join(root, 'collision.md');
    fs.writeFileSync(collisionTarget, 'preserve');
    const beforeCollision = requests.length;
    const collision = await run(root, [
      '-d', messagesB, ...apiArgs, '-o', collisionTarget, '--receipt', collisionTarget
    ]);
    assert.strictEqual(collision.code, 1);
    assert.match(collision.stderr, /output artifact target collision/);
    assert.strictEqual(requests.length, beforeCollision);
    assert.strictEqual(fs.readFileSync(collisionTarget, 'utf8'), 'preserve');

    const messagesWarn = makeMessages(root, 'messages-warn');
    const warnReceipt = path.join(root, 'receipts', 'warn.json');
    const warnCapture = path.join(root, 'capture-warn.json');
    const warned = await run(root, [
      '-d', messagesWarn, ...apiArgs,
      '--receipt', warnReceipt,
      '--after-hook-path', hook,
      '--after-hook-failure', 'warn'
    ], {
      HOOK_HELPER: hookHelper,
      HOOK_CAPTURE: warnCapture,
      RECEIPT_PATH: warnReceipt,
      HOOK_EXIT_CODE: '7',
      HOOK_STDERR: 'raw-secret-hook-tail'
    });
    assert.strictEqual(warned.code, 0, warned.stderr);
    const warnDoc = JSON.parse(fs.readFileSync(warnReceipt, 'utf8'));
    assert.deepStrictEqual(warnDoc.hook, {
      status: 'exited_nonzero', failureMode: 'warn', path: fs.realpathSync(hook), exitCode: 7
    });
    assert.ok(!fs.readFileSync(warnReceipt, 'utf8').includes('raw-secret-hook-tail'));

    const messagesStrict = makeMessages(root, 'messages-strict');
    const strictReceipt = path.join(root, 'receipts', 'strict.json');
    const strictCapture = path.join(root, 'capture-strict.json');
    const strict = await run(root, [
      '-d', messagesStrict, ...apiArgs,
      '--continue', '--receipt', strictReceipt,
      '--after-hook-path', hook,
      '--after-hook-failure', 'error'
    ], {
      HOOK_HELPER: hookHelper,
      HOOK_CAPTURE: strictCapture,
      RECEIPT_PATH: strictReceipt,
      HOOK_EXIT_CODE: '9'
    });
    assert.strictEqual(strict.code, 1);
    assert.strictEqual(fs.existsSync(strictReceipt), false, 'strict hook failure must not publish a completed receipt');
    assert.strictEqual(fs.readFileSync(path.join(messagesStrict, '[1]assistant.md'), 'utf8'), 'answer');

    console.log('invocation-id-receipt.cjs: ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
