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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-real-stream-e2e-'));
  const messages = path.join(root, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]user.md'), 'answer the request');
  fs.writeFileSync(path.join(messages, 'final.md'), 'produce the final answer');
  fs.writeFileSync(path.join(messages, 'tools.toml'), [
    '[[tools]]',
    'name = "fixture_tool"',
    'description = "A fixture tool that is not called."',
    'parameters = { type = "object", properties = {} }',
    ''
  ].join('\n'));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push(parsed);
      const requestNumber = requests.length;
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (requestNumber === 3) {
        response.end([
          `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-check', type: 'function', function: { name: 'react_check_decision', arguments: '{"decision":false}' } }] } }] })}`,
          'data: [DONE]', ''
        ].join('\n\n'));
        return;
      }
      const content = requestNumber === 1
        ? 'thought result'
        : requestNumber === 2
          ? 'observe result'
          : '真实最终回答';
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 2) } }] })}\n\n`);
      response.end(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(2) } }] })}\n\ndata: [DONE]\n\n`);
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
      'max_step = 1',
      'tools_file = "tools.toml"',
      'thought_llm_api = "local"',
      'observe_llm_api = "local"',
      'check_llm_api = "local"',
      'final_llm_api = "local"',
      'final_prompt = "final.md"',
      ''
    ].join('\n'));

    const result = await run(root, ['--config', config, '--output-format', 'stream-json']);
    assert.strictEqual(result.code, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.strictEqual(requests.length, 4, 'Thought, Observe, Check and Final use the real Promptpile CLI');
    const events = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.deepStrictEqual(events.map(event => event.sequence), events.map((_event, index) => index));
    assert.deepStrictEqual(events.map(event => event.type), [
      'session.started',
      'phase.started', 'phase.completed',
      'phase.started', 'phase.completed',
      'phase.started', 'phase.completed',
      'phase.started', 'final.delta', 'final.delta', 'phase.completed',
      'session.completed'
    ]);
    assert.strictEqual(events.find(event => event.phase === 'check' && event.type === 'phase.completed').continue, false);
    const finalText = events.filter(event => event.type === 'final.delta').map(event => event.content).join('');
    assert.strictEqual(finalText, '真实最终回答');
    assert.deepStrictEqual(events.at(-1), {
      type: 'session.completed',
      stop_reason: 'final',
      steps_completed: 1,
      final: { status: 'completed', content: finalText },
      schema_version: 1,
      session_id: events[0].session_id,
      sequence: events.length - 1
    });
    assert.ok(!result.stdout.includes('thought result'));
    assert.ok(!result.stdout.includes('observe result'));
    console.log('promptpile-react real composed stream-json E2E ok');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
