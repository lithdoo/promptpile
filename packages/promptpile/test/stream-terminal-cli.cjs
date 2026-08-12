'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const cli = path.join(__dirname, '..', 'dist', 'index.js');

const run = (cwd, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd, env: { ...process.env, NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stderr }));
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-stream-terminal-'));
  let mode = 'partial';
  let requestCount = 0;
  const server = http.createServer((request, response) => {
    requestCount += 1;
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      const partial = 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n';
      response.end(mode === 'malformed' ? `${partial}data: {broken\n\n` : partial);
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const messages = path.join(root, 'messages');
    fs.mkdirSync(messages);
    fs.writeFileSync(path.join(messages, '[0]user.md'), 'hello');
    const address = server.address();
    const common = ['-d', messages, '--api-key', 'key', '--api-base-url', `http://127.0.0.1:${address.port}/v1`, '--model', 'terminal-test', '--disable-tool', '--continue', '--quiet'];
    for (const currentMode of ['partial', 'malformed']) {
      mode = currentMode;
      const output = path.join(root, `${currentMode}.md`);
      const receipt = path.join(root, `${currentMode}.receipt.json`);
      const result = await run(root, [...common, '-o', output, '--receipt', receipt]);
      assert.strictEqual(result.code, 1, result.stderr);
      assert.match(result.stderr, currentMode === 'partial' ? /without a terminal marker/ : /malformed non-empty data payload/);
      assert.strictEqual(fs.existsSync(output), false);
      assert.strictEqual(fs.existsSync(path.join(messages, '[1]assistant.md')), false);
      assert.strictEqual(fs.existsSync(receipt), false);
    }
    assert.strictEqual(requestCount, 2);
    console.log('stream-terminal-cli.cjs: ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
