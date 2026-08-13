import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const STDIO_FIXTURE = String.raw`const readline = require('node:readline');
let counter = 0;
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'initialize') result(request.id, {
    protocolVersion: request.params.protocolVersion,
    capabilities: { tools: {} },
    serverInfo: { name: 'composition-fixture', version: '1.0.0' },
  });
  else if (request.method === 'tools/list') result(request.id, { tools: [{
    name: 'counter', inputSchema: { type: 'object' },
  }] });
  else if (request.method === 'tools/call') {
    counter += 1;
    result(request.id, { content: [{ type: 'text', text: String(counter) }] });
  } else if (request.id !== undefined) send({
    jsonrpc: '2.0', id: request.id,
    error: { code: -32601, message: 'not found' },
  });
});
`;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitHealth(url: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ok = await new Promise<boolean>((resolve) => {
      const request = http.get(url, (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      });
      request.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('gateway did not become healthy');
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  const child = spawn(command, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) {
    throw new Error(`${path.basename(command)} ${args.join(' ')} failed (${code}):\n${stdout}\n${stderr}`);
  }
  return stdout;
}

function publicBin(binDirectory: string, name: string): string {
  return path.join(
    path.resolve(binDirectory),
    process.platform === 'win32' ? `${name}.cmd` : name
  );
}

export async function runCompositionWitness(binDirectory: string): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-composition-'));
  const promptpile = publicBin(binDirectory, 'promptpile');
  const mcp = publicBin(binDirectory, 'promptpile-mcp');
  assert.ok(fs.existsSync(promptpile), `public promptpile bin missing: ${promptpile}`);
  assert.ok(fs.existsSync(mcp), `public promptpile-mcp bin missing: ${mcp}`);

  const fixture = path.join(root, 'stdio-server.cjs');
  fs.writeFileSync(fixture, STDIO_FIXTURE, 'utf8');
  const gatewayPort = await freePort();
  const config = path.join(root, 'mcp.json');
  fs.writeFileSync(config, JSON.stringify({
    version: 1,
    gateway: { port: gatewayPort },
    servers: { fixture: { command: process.execPath, args: [fixture] } },
  }));
  const gateway = spawn(mcp, ['launch', '--config', config], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32',
  });
  let gatewayErrors = '';
  gateway.stderr.on('data', (chunk) => { gatewayErrors += String(chunk); });

  const modelRequests: Array<Record<string, unknown>> = [];
  const model = http.createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => { raw += String(chunk); });
    request.on('end', () => {
      modelRequests.push(JSON.parse(raw) as Record<string, unknown>);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      if (modelRequests.length === 1) {
        response.end([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"mcp__fixture__counter","arguments":"{}"}}]},"finish_reason":"tool_calls"}]}',
          '', 'data: [DONE]', '', '',
        ].join('\n'));
      } else {
        response.end('data: {"choices":[{"delta":{"content":"complete"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
      }
    });
  });

  try {
    const gatewayBase = `http://127.0.0.1:${gatewayPort}`;
    await waitHealth(`${gatewayBase}/health`);
    await new Promise<void>((resolve, reject) => {
      model.once('error', reject);
      model.listen(0, '127.0.0.1', resolve);
    });
    const modelAddress = model.address();
    if (!modelAddress || typeof modelAddress === 'string') throw new Error('missing model address');
    const modelBase = `http://127.0.0.1:${modelAddress.port}/v1`;
    const tools = path.join(root, '.tools.toml');
    await run(mcp, ['export-tools', '--base-url', gatewayBase, '--output', tools], root);
    assert.match(fs.readFileSync(tools, 'utf8'), /mcp__fixture__counter/);

    const conversation = path.join(root, 'conversation');
    fs.mkdirSync(conversation);
    fs.writeFileSync(path.join(conversation, '[0]user.md'), 'increment once');
    const promptArgs = [
      '-d', conversation, '--output-dir', conversation, '--continue', '--quiet',
      '--api-key', 'fixture-key', '--api-base-url', modelBase, '--model', 'fixture-model',
      '--tools-file', tools,
    ];
    await run(promptpile, promptArgs, root);
    const calls = path.join(conversation, '[1]assistant.calls.jsonl');
    assert.equal(JSON.parse(fs.readFileSync(calls, 'utf8')).id, 'call-1');
    await run(mcp, ['exec-calls', '--base-url', gatewayBase, '--input', calls], root);
    const result = path.join(conversation, '[1]assistant.result.jsonl');
    assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')).tool_call_id, 'call-1');
    assert.match(await run(mcp, ['check', '--input', calls], root), /status: complete/);

    await run(promptpile, promptArgs, root);
    assert.equal(modelRequests.length, 2);
    const secondMessages = modelRequests[1].messages as Array<Record<string, unknown>>;
    assert.ok(secondMessages.some((message) =>
      message.role === 'assistant' && Array.isArray(message.tool_calls) &&
      (message.tool_calls as Array<{ id?: string }>)[0]?.id === 'call-1'
    ));
    assert.ok(secondMessages.some((message) =>
      message.role === 'tool' && message.tool_call_id === 'call-1' && message.content === '1'
    ));
    assert.equal(fs.readFileSync(path.join(conversation, '[2]assistant.md'), 'utf8'), 'complete');
  } finally {
    await new Promise<void>((resolve) => model.close(() => resolve()));
    if (gateway.exitCode === null) {
      if (process.platform === 'win32') {
        if (!Number.isInteger(gateway.pid) || (gateway.pid ?? 0) <= 0) {
          throw new Error('gateway PID unavailable for fixture cleanup');
        }
        spawnSync('taskkill.exe', ['/PID', String(gateway.pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } else {
        gateway.kill('SIGTERM');
      }
      await new Promise<void>((resolve) => gateway.once('exit', () => resolve()));
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(gatewayErrors, '');
}
