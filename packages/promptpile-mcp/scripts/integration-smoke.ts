import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

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
function run(bin: string, args: string[], cwd: string): string {
  const result = spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-integration-'));
  const packageRoot = path.resolve(__dirname, '../..');
  const bin = path.join(packageRoot, 'dist/src/index.js');
  const fixture = path.join(packageRoot, 'test-fixtures/stdio-server.cjs');
  const port = await freePort();
  const config = path.join(root, 'mcp.json');
  fs.writeFileSync(config, JSON.stringify({ version: 1, gateway: { port }, servers: {
    fixture: { command: process.execPath, args: [fixture] },
  } }));
  const child = spawn(process.execPath, [bin, 'launch', '--config', config], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  child.stderr.on('data', (chunk) => { errors += String(chunk); });
  try {
    const base = `http://127.0.0.1:${port}`;
    await waitHealth(`${base}/health`);
    const tools = path.join(root, '.tools.toml');
    run(bin, ['export-tools', '--base-url', base, '--output', tools], root);
    assert.match(fs.readFileSync(tools, 'utf8'), /mcp__fixture__echo/);
    const calls = path.join(root, 'turn.calls.jsonl');
    fs.writeFileSync(calls, JSON.stringify({ id: 'call-1', type: 'function', function: {
      name: 'mcp__fixture__counter', arguments: '{}',
    } }) + '\n');
    run(bin, ['exec-calls', '--base-url', base, '--input', calls], root);
    const result = path.join(root, 'turn.result.jsonl');
    assert.equal(JSON.parse(fs.readFileSync(result, 'utf8')).tool_call_id, 'call-1');
    assert.match(run(bin, ['check', '--input', calls], root), /status: complete/);
    console.log('integration smoke: ok');
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert.equal(errors, '');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
