'use strict';
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-fd3-real-'));
  const messages = path.join(root, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'hello');
  const promptpilePackage = require.resolve('promptpile/package.json');
  const metadata = JSON.parse(fs.readFileSync(promptpilePackage, 'utf8'));
  const cli = path.resolve(path.dirname(promptpilePackage), metadata.bin.promptpile);
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"choices":[{"delta":{"content":"fd "}}]}\n\n');
      response.end('data: {"choices":[{"delta":{"content":"真实"}}]}\n\ndata: [DONE]\n\n');
    });
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    const child = spawn(process.execPath, [cli,
      '-d', messages,
      '--api-key', 'test-key',
      '--api-base-url', `http://127.0.0.1:${address.port}/v1`,
      '--disable-tool', '--quiet',
      '--output-pile-fd', '3', '--output-pile-format', 'json'
    ], { cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'pipe'], windowsHide: true });
    let transport = ''; let stdout = ''; let stderr = '';
    child.stdio[3].setEncoding('utf8'); child.stdio[3].on('data', chunk => { transport += chunk; });
    child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    assert.strictEqual(code, 0, `stdout=${stdout}\nstderr=${stderr}`);
    assert.deepStrictEqual(transport.trim().split(/\r?\n/).map(JSON.parse), [
      { type: 'assistant_delta', content: 'fd ' },
      { type: 'assistant_delta', content: '真实' },
      { type: 'assistant_done' }
    ]);
    console.log(`promptpile-react real Promptpile fd3 proof ok (${process.platform}, Node ${process.versions.node})`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
