'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const cli = path.join(packageRoot, 'dist', 'index.js');

const run = (cwd, args, env = {}, input) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...env },
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
  child.stdin.end(input);
});

const makeMessages = (root, name) => {
  const directory = path.join(root, name);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, '[0]user.md'), 'same prompt');
  return directory;
};

(async () => {
  const publishedSchema = JSON.parse(fs.readFileSync(
    path.join(packageRoot, 'dist', 'completion-receipt-v1.schema.json'),
    'utf8'
  ));
  const contractSchema = JSON.parse(fs.readFileSync(
    path.join(packageRoot, '..', '..', 'doc', '15-contracts', 'completion-receipt-v1.schema.json'),
    'utf8'
  ));
  assert.deepStrictEqual(publishedSchema, contractSchema,
    'the npm package schema copy must match the normative contract');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-invocation-receipt-'));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ body: JSON.parse(body), headers: request.headers });
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
      RECEIPT_PATH: receiptA,
      PROMPTPILE_INVOCATION_ID: 'stale-must-be-overridden'
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
      '--continue',
      '--receipt', receiptB,
      '--after-hook-path', hook
    ], {
      HOOK_HELPER: hookHelper,
      HOOK_CAPTURE: captureB,
      RECEIPT_PATH: receiptB,
      PROMPTPILE_INVOCATION_ID: 'stale-parent-value'
    });
    assert.strictEqual(second.code, 0, second.stderr);
    assert.deepStrictEqual(requests[0].body, requests[1].body,
      'invocation metadata must not alter the model request body');
    assert.ok(!JSON.stringify(requests[0].headers).includes('run:01J.X_Y-Z'),
      'invocation metadata must not alter provider request headers');
    const hookB = JSON.parse(fs.readFileSync(captureB, 'utf8'));
    assert.strictEqual(hookB.hasInvocationId, false, 'an inherited invocation id must be scrubbed');
    assert.strictEqual(JSON.parse(fs.readFileSync(receiptB, 'utf8')).invocationId, null);
    assert.ok(!JSON.stringify(requests.map(entry => entry.body)).includes('run:01J.X_Y-Z'));
    assert.ok(!fs.readdirSync(messagesA).some(name => name.includes('run:01J')));
    assert.deepStrictEqual(
      fs.readFileSync(path.join(messagesA, '[1]assistant.md')),
      fs.readFileSync(path.join(messagesB, '[1]assistant.md')),
      'invocation metadata must not alter Conversation artifact bytes'
    );
    const fingerprintA = await run(root, [
      'conversation', 'fingerprint', '-d', messagesA
    ]);
    const fingerprintB = await run(root, [
      'conversation', 'fingerprint', '-d', messagesB
    ]);
    assert.strictEqual(fingerprintA.code, 0, fingerprintA.stderr);
    assert.strictEqual(fingerprintB.code, 0, fingerprintB.stderr);
    assert.strictEqual(fingerprintA.stdout, fingerprintB.stdout,
      'invocation metadata must not alter Conversation Fingerprint');

    for (const invalid of ['../escape', 'bad\nINJECTED', 'x'.repeat(129), 'unicode-世界']) {
      const before = requests.length;
      const failed = await run(root, ['-d', messagesB, ...apiArgs, '--invocation-id', invalid]);
      assert.strictEqual(failed.code, 1);
      assert.strictEqual(requests.length, before, 'invalid invocation id must fail before the model call');
      assert.ok(!failed.stderr.includes('INJECTED'), 'the untrusted value must not be echoed into diagnostics');
    }

    const sideEffectMessages = makeMessages(root, 'messages-invalid-side-effects');
    const sideEffectParent = path.join(root, 'must-not-exist');
    const beforeSideEffectFiles = fs.readdirSync(sideEffectMessages).sort();
    const beforeSideEffectRequests = requests.length;
    const invalidBeforeSideEffects = await run(root, [
      '-d', sideEffectMessages, ...apiArgs,
      '--input',
      '-o', path.join(sideEffectParent, 'answer.md'),
      '--output-pile-file', path.join(sideEffectParent, 'pile.jsonl'),
      '--receipt', path.join(sideEffectParent, 'receipt.json'),
      '--invocation-id', 'invalid id'
    ], {}, 'must not be appended');
    assert.strictEqual(invalidBeforeSideEffects.code, 1);
    assert.strictEqual(requests.length, beforeSideEffectRequests);
    assert.deepStrictEqual(fs.readdirSync(sideEffectMessages).sort(), beforeSideEffectFiles,
      'invalid invocation id must precede root --input mutation');
    assert.strictEqual(fs.existsSync(sideEffectParent), false,
      'invalid invocation id must precede sink parent preparation');

    const subcommand = await run(root, [
      '--invocation-id', 'root-only', 'conversation', 'inspect', '-d', messagesB
    ]);
    assert.strictEqual(subcommand.code, 1);
    assert.match(subcommand.stderr, /--invocation-id is only valid for root completion/);
    const receiptSubcommand = await run(root, [
      '--receipt', path.join(root, 'root-only.json'),
      'conversation', 'inspect', '-d', messagesB
    ]);
    assert.strictEqual(receiptSubcommand.code, 1);
    assert.match(receiptSubcommand.stderr, /--receipt is only valid for root completion/);

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

    const conversationReceiptTarget = path.join(messagesB, '[0]user.md');
    const beforeConversationCollision = requests.length;
    const conversationCollision = await run(root, [
      '-d', messagesB, ...apiArgs, '--receipt', conversationReceiptTarget
    ]);
    assert.strictEqual(conversationCollision.code, 1);
    assert.match(conversationCollision.stderr, /Conversation namespace/);
    assert.strictEqual(requests.length, beforeConversationCollision);
    assert.strictEqual(fs.readFileSync(conversationReceiptTarget, 'utf8'), 'same prompt');

    const pileMessagesA = makeMessages(root, 'messages-pile-a');
    const pileMessagesB = makeMessages(root, 'messages-pile-b');
    const pileA = path.join(root, 'piles', 'with-id.jsonl');
    const pileB = path.join(root, 'piles', 'without-id.jsonl');
    const pileWithId = await run(root, [
      '-d', pileMessagesA, ...apiArgs,
      '--output-pile-file', pileA,
      '--output-pile-format', 'json',
      '--invocation-id', 'pile-isolation'
    ]);
    const pileWithoutId = await run(root, [
      '-d', pileMessagesB, ...apiArgs,
      '--output-pile-file', pileB,
      '--output-pile-format', 'json'
    ]);
    assert.strictEqual(pileWithId.code, 0, pileWithId.stderr);
    assert.strictEqual(pileWithoutId.code, 0, pileWithoutId.stderr);
    assert.strictEqual(fs.readFileSync(pileA, 'utf8'), fs.readFileSync(pileB, 'utf8'));
    assert.ok(!fs.readFileSync(pileA, 'utf8').includes('pile-isolation'));

    const dumpRoot = path.join(root, 'llm-dump-isolation');
    fs.mkdirSync(dumpRoot);
    const dumpMessages = makeMessages(root, 'messages-dump');
    const dumpRun = await run(dumpRoot, [
      '-d', dumpMessages, ...apiArgs, '--invocation-id', 'run:01J.X_Y-Z'
    ], { PROMPTPILE_DUMP_LLM: '1' });
    assert.strictEqual(dumpRun.code, 0, dumpRun.stderr);
    const requestDumps = fs.readdirSync(dumpRoot).filter(name => name.endsWith('.req.json'));
    assert.strictEqual(requestDumps.length, 1);
    const dumpText = fs.readFileSync(path.join(dumpRoot, requestDumps[0]), 'utf8');
    assert.ok(!dumpText.includes('run:01J.X_Y-Z'), 'Invocation ID must not enter LLM dump v1');
    assert.deepStrictEqual(JSON.parse(dumpText).body, requests[requests.length - 1].body);

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
