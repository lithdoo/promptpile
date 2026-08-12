import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

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
      const request = http.get(url, (response) => { response.resume(); resolve(response.statusCode === 200); });
      request.on('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('gateway did not become healthy');
}
async function run(bin: string, args: string[], cwd: string): Promise<string> {
  const child = spawn(process.execPath, [bin, ...args], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`${args.join(' ')} failed (${code}):\n${stdout}\n${stderr}`);
  return stdout;
}
function resolveBins(packageRoot: string): { mcp: string; promptpile: string } {
  const installedPromptpile = path.resolve(packageRoot, '../promptpile/dist/index.js');
  return {
    mcp: path.join(packageRoot, 'dist/src/index.js'),
    promptpile: fs.existsSync(installedPromptpile)
      ? installedPromptpile
      : path.resolve(packageRoot, '../promptpile/dist/index.js'),
  };
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-composition-'));
  const packageRoot = path.resolve(__dirname, '../..');
  const bins = resolveBins(packageRoot);
  assert.ok(fs.existsSync(bins.promptpile), `promptpile CLI missing: ${bins.promptpile}`);
  const fixture = path.join(packageRoot, 'test-fixtures/stdio-server.cjs');
  const gatewayPort = await freePort();
  const config = path.join(root, 'mcp.json');
  fs.writeFileSync(config, JSON.stringify({ version: 1, gateway: { port: gatewayPort }, servers: {
    fixture: { command: process.execPath, args: [fixture] },
  } }));
  const gateway = spawn(process.execPath, [bins.mcp, 'launch', '--config', config], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
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
    await run(bins.mcp, ['export-tools', '--base-url', gatewayBase, '--output', tools], root);
    assert.match(fs.readFileSync(tools, 'utf8'), /mcp__fixture__counter/);

    const conversation = path.join(root, 'conversation');
    fs.mkdirSync(conversation);
    fs.writeFileSync(path.join(conversation, '[0]user.md'), 'increment once');
    const promptArgs = [
      '-d', conversation, '--output-dir', conversation, '--continue', '--quiet',
      '--api-key', 'fixture-key', '--api-base-url', modelBase, '--model', 'fixture-model',
      '--tools-file', tools,
    ];
    await run(bins.promptpile, promptArgs, root);
    const calls = path.join(conversation, '[1]assistant.calls.jsonl');
    assert.equal(JSON.parse(fs.readFileSync(calls, 'utf8')).id, 'call-1');
    await run(bins.mcp, ['exec-calls', '--base-url', gatewayBase, '--input', calls], root);
    const result = path.join(conversation, '[1]assistant.result.jsonl');
    assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')).tool_call_id, 'call-1');
    assert.match(await run(bins.mcp, ['check', '--input', calls], root), /status: complete/);

    await run(bins.promptpile, promptArgs, root);
    assert.equal(modelRequests.length, 2);
    const secondMessages = modelRequests[1].messages as Array<Record<string, unknown>>;
    assert.ok(secondMessages.some((message) =>
      message.role === 'assistant' &&
      Array.isArray(message.tool_calls) &&
      (message.tool_calls as Array<{ id?: string }>)[0]?.id === 'call-1'
    ));
    assert.ok(secondMessages.some((message) =>
      message.role === 'tool' && message.tool_call_id === 'call-1' && message.content === '1'
    ));
    assert.equal(fs.readFileSync(path.join(conversation, '[2]assistant.md'), 'utf8'), 'complete');
    console.log('Promptpile -> MCP -> Promptpile composition smoke: ok');
  } finally {
    await new Promise<void>((resolve) => model.close(() => resolve()));
    gateway.kill('SIGTERM');
    await new Promise<void>((resolve) => gateway.once('exit', () => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(gatewayErrors, '');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
