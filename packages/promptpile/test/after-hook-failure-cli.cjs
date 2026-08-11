'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const cli = path.join(packageRoot, 'dist', 'index.js');
const run = (cwd, args, { env = {}, input } = {}) => new Promise((resolve, reject) => {
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

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-after-hook-policy-'));
  const messages = path.join(root, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'hello');
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      requestCount += 1;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'answer' } }] })}\n\ndata: [DONE]\n\n`);
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
      '--disable-tool', '--quiet'
    ];
    const helper = path.join(root, 'hook-helper.js');
    fs.writeFileSync(helper, [
      "const fs = require('fs');",
      "if (process.env.HOOK_MARKER) fs.appendFileSync(process.env.HOOK_MARKER, 'ran\\n');",
      "if (process.env.HOOK_STDOUT_BYTES) process.stdout.write('x'.repeat(Number(process.env.HOOK_STDOUT_BYTES)));",
      "if (process.env.HOOK_STDERR) process.stderr.write(process.env.HOOK_STDERR);",
      "process.exit(Number(process.env.HOOK_EXIT_CODE || 0));",
      ''
    ].join('\n'));
    const hook = path.join(root, process.platform === 'win32' ? 'hook.cmd' : 'hook.sh');
    fs.writeFileSync(hook, process.platform === 'win32'
      ? '@node "%HOOK_HELPER%"\r\n'
      : '#!/bin/sh\nexec node "$HOOK_HELPER"\n');
    if (process.platform !== 'win32') fs.chmodSync(hook, 0o755);
    const hookEnv = { HOOK_HELPER: helper };
    const missingHook = path.join(root, 'missing-hook.sh');

    const warnOutput = path.join(root, 'invalid-warn', 'answer.md');
    const beforeWarn = requestCount;
    const invalidWarn = await run(root, [
      '-d', messages, ...apiArgs, '-o', warnOutput,
      '--after-hook-path', missingHook, '--after-hook-failure', 'warn'
    ]);
    assert.strictEqual(invalidWarn.code, 0, invalidWarn.stderr);
    assert.match(invalidWarn.stderr, /Warning: after-hook script is not executable/);
    assert.strictEqual(requestCount, beforeWarn + 1);
    assert.strictEqual(fs.readFileSync(warnOutput, 'utf8'), 'answer');

    const strictOutput = path.join(root, 'invalid-error', 'answer.md');
    const beforeStrict = requestCount;
    const invalidStrict = await run(root, [
      '-d', messages, ...apiArgs, '-o', strictOutput,
      '--after-hook-path', missingHook, '--after-hook-failure', 'error'
    ]);
    assert.strictEqual(invalidStrict.code, 1);
    assert.match(invalidStrict.stderr, /Error: after-hook script is not executable/);
    assert.strictEqual(requestCount, beforeStrict);
    assert.strictEqual(fs.existsSync(path.dirname(strictOutput)), false);

    const freshOutputDirectory = path.join(root, 'fresh-output-directory');
    const strictWithFreshOutput = await run(root, [
      '--output-dir', freshOutputDirectory, ...apiArgs,
      '--after-hook-path', missingHook, '--after-hook-failure', 'error'
    ]);
    assert.strictEqual(strictWithFreshOutput.code, 1);
    assert.match(strictWithFreshOutput.stderr, /Error: after-hook script is not executable/);
    assert.strictEqual(requestCount, beforeStrict);
    assert.strictEqual(fs.existsSync(freshOutputDirectory), true,
      'v1 accepts output-directory configuration preparation before strict hook validation');
    assert.deepStrictEqual(fs.readdirSync(freshOutputDirectory), [],
      'strict invalid hook creates no Conversation artifacts in a prepared output directory');

    const beforeInputFiles = fs.readdirSync(messages).sort();
    const invalidInput = await run(root, [
      '-d', messages, ...apiArgs, '--input',
      '--after-hook-path', missingHook, '--after-hook-failure', 'error'
    ], { input: 'must not be appended' });
    assert.strictEqual(invalidInput.code, 1);
    assert.deepStrictEqual(fs.readdirSync(messages).sort(), beforeInputFiles);
    assert.strictEqual(requestCount, beforeStrict);

    const invalidMode = await run(root, [
      '-d', messages, ...apiArgs, '--after-hook-failure', 'ignore'
    ]);
    assert.strictEqual(invalidMode.code, 1);
    assert.match(invalidMode.stderr, /invalid after-hook failure mode/);
    assert.strictEqual(requestCount, beforeStrict);

    const noDefault = await run(root, [
      '-d', messages, ...apiArgs,
      '--allow-default-after-hook', '--after-hook-failure', 'error'
    ]);
    assert.strictEqual(noDefault.code, 0, noDefault.stderr);

    const successMarker = path.join(root, 'success.marker');
    const success = await run(root, [
      '-d', messages, ...apiArgs, '--after-hook-path', hook, '--after-hook-failure', 'error'
    ], { env: { ...hookEnv, HOOK_MARKER: successMarker, HOOK_STDOUT_BYTES: '131072' } });
    assert.strictEqual(success.code, 0, success.stderr);
    assert.strictEqual(success.stdout, '', 'hook stdout is discarded even in quiet mode');
    assert.strictEqual(fs.readFileSync(successMarker, 'utf8'), 'ran\n');

    const warnMarker = path.join(root, 'runtime-warn.marker');
    const runtimeWarnOutput = path.join(root, 'runtime-warn', 'answer.md');
    const runtimeWarnMessages = path.join(root, 'runtime-warn-messages');
    fs.mkdirSync(runtimeWarnMessages);
    fs.writeFileSync(path.join(runtimeWarnMessages, '[0]user.md'), 'hello');
    const runtimeWarn = await run(root, [
      '-d', runtimeWarnMessages, ...apiArgs, '-o', runtimeWarnOutput, '--continue',
      '--after-hook-path', hook, '--after-hook-failure', 'warn'
    ], { env: { ...hookEnv, HOOK_MARKER: warnMarker, HOOK_EXIT_CODE: '7', HOOK_STDERR: 'hook-tail' } });
    assert.strictEqual(runtimeWarn.code, 0, runtimeWarn.stderr);
    assert.match(runtimeWarn.stderr, /Warning: after-hook exited with code 7/);
    assert.match(runtimeWarn.stderr, /hook-tail/);
    assert.strictEqual(fs.readFileSync(runtimeWarnOutput, 'utf8'), 'answer');
    assert.strictEqual(fs.readFileSync(path.join(runtimeWarnMessages, '[1]assistant.md'), 'utf8'), 'answer');
    assert.ok(fs.existsSync(warnMarker));

    const errorMarker = path.join(root, 'runtime-error.marker');
    const runtimeErrorOutput = path.join(root, 'runtime-error', 'answer.md');
    const runtimeErrorMessages = path.join(root, 'runtime-error-messages');
    fs.mkdirSync(runtimeErrorMessages);
    fs.writeFileSync(path.join(runtimeErrorMessages, '[0]user.md'), 'hello');
    const runtimeError = await run(root, [
      '-d', runtimeErrorMessages, ...apiArgs, '-o', runtimeErrorOutput, '--continue',
      '--after-hook-path', hook, '--after-hook-failure', 'error'
    ], { env: {
      ...hookEnv,
      HOOK_MARKER: errorMarker,
      HOOK_EXIT_CODE: '7',
      HOOK_STDERR: 'bounded-error-tail',
      PROMPTPILE_TEST_SECRET: 'do-not-print'
    } });
    assert.strictEqual(runtimeError.code, 1);
    assert.match(runtimeError.stderr, /Error: after-hook exited with code 7/);
    assert.ok(!runtimeError.stderr.includes('do-not-print'));
    assert.strictEqual(fs.readFileSync(runtimeErrorOutput, 'utf8'), 'answer');
    assert.strictEqual(fs.readFileSync(path.join(runtimeErrorMessages, '[1]assistant.md'), 'utf8'), 'answer');
    assert.ok(fs.existsSync(errorMarker));

    const upstreamMarker = path.join(root, 'upstream.marker');
    const upstreamFailure = await run(root, [
      '-d', messages, ...apiArgs, '-o', messages,
      '--after-hook-path', hook, '--after-hook-failure', 'error'
    ], { env: { ...hookEnv, HOOK_MARKER: upstreamMarker } });
    assert.strictEqual(upstreamFailure.code, 1);
    assert.strictEqual(fs.existsSync(upstreamMarker), false, 'hook is skipped after main output failure');

    const conflictMarker = path.join(root, 'conflict.marker');
    const conflict = await run(root, [
      '-d', messages, ...apiArgs, '--continue', '--expected-output-next-index', '99',
      '--after-hook-path', hook, '--after-hook-failure', 'error'
    ], { env: { ...hookEnv, HOOK_MARKER: conflictMarker } });
    assert.strictEqual(conflict.code, 3, conflict.stderr);
    assert.strictEqual(fs.existsSync(conflictMarker), false, 'hook is skipped after OCC conflict');

    console.log('after-hook failure CLI tests ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
