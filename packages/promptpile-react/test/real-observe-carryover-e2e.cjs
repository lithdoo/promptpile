'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const reactRoot = path.join(__dirname, '..');
const reactCli = path.join(reactRoot, 'dist', 'index.js');

const run = (cwd, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [reactCli, ...args], {
    cwd,
    env: { ...process.env, PROMPTPILE_BIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let stdout = ''; let stderr = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolve({ code, stdout, stderr }));
});

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-real-carryover-'));
  const messages = path.join(root, 'messages');
  const workRoot = path.join(root, 'work-root');
  fs.mkdirSync(messages);
  fs.mkdirSync(workRoot);
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'perform the task');
  fs.writeFileSync(path.join(messages, 'tools.toml'), [
    '[[tools]]',
    'name = "fixture_tool"',
    'description = "A fixture tool that is not called."',
    'parameters = { type = "object", properties = {} }',
    ''
  ].join('\n'));
  const requests = [];
  const snapshots = [];
  const snapshotWork = () => {
    const sessions = fs.readdirSync(workRoot);
    if (sessions.length === 0) return [];
    const session = path.join(workRoot, sessions[0]);
    const rootFiles = fs.readdirSync(session).filter(name => /^\[\d+\]assistant\.md$/.test(name));
    const archive = path.join(session, '.observe_files');
    const archived = fs.existsSync(archive)
      ? fs.readdirSync(archive).filter(name => /^\[\d+\]assistant\.md$/.test(name)).map(name => `.observe_files/${name}`)
      : [];
    return [...rootFiles, ...archived].sort();
  };
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      snapshots.push(snapshotWork());
      const n = requests.length;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (n % 3 === 0) {
        const decision = n < 9;
        response.end([
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: `check-${n}`, type: 'function', function: { name: 'react_check_decision', arguments: JSON.stringify({ decision }) } }] } }] })}`,
          'data: [DONE]', ''
        ].join('\n\n'));
        return;
      }
      const iteration = Math.floor((n - 1) / 3);
      const content = n % 3 === 1 ? `thought-${iteration}` : `observe-${iteration}`;
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`);
    });
  });

  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    const config = path.join(root, 'react.toml');
    fs.writeFileSync(config, [
      '[[llm_api]]',
      'name = "local"',
      'model = "fixture-model"',
      `base_url = "http://127.0.0.1:${address.port}/v1"`,
      'api_key = "fixture-key"',
      '',
      '[promptpile-react]',
      `dirs = ["${messages.replace(/\\/g, '\\\\')}"]`,
      `work_root = "${workRoot.replace(/\\/g, '\\\\')}"`,
      'max_step = 3',
      'observe_carryover = 1',
      'tools_file = "tools.toml"',
      'thought_llm_api = "local"',
      'observe_llm_api = "local"',
      'check_llm_api = "local"',
      ''
    ].join('\n'));

    const result = await run(root, ['--config', config, '--output-format', 'stream-json']);
    assert.strictEqual(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.strictEqual(requests.length, 9, 'three real Thought/Observe/Check iterations complete');
    const secondThought = requests[3].messages.map(message => message.content).join('\n');
    assert.match(secondThought, /observe-0/, 'retained Observe enters the next Thought context');
    const thirdThought = requests[6].messages.map(message => message.content).join('\n');
    assert.match(thirdThought, /observe-1/, 'latest retained Observe remains visible');
    assert.doesNotMatch(thirdThought, /observe-0/, 'archived Observe is no longer scanned');
    assert.deepStrictEqual(snapshots[8], [
      '.observe_files/[1]assistant.md',
      '.observe_files/[3]assistant.md',
      '[0]assistant.md',
      '[2]assistant.md',
      '[4]assistant.md',
      '[5]assistant.md'
    ], 'real Promptpile keeps monotonic indices while pruning older Observe turns');
    assert.deepStrictEqual(fs.readdirSync(workRoot), [], 'successful session cleanup remains unchanged');
    console.log('promptpile-react real Observe carryover E2E ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
