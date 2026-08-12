import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { describe, it } from 'node:test';
import { runExecCalls } from './exec-calls';
import { executionClaimPath } from '../exec-calls/execution-claim';

function writeCalls(file: string): void {
  fs.writeFileSync(file, JSON.stringify({
    id: 'a', type: 'function', function: { name: 'counter', arguments: '{}' },
  }) + '\n');
}

async function listen(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

describe('runExecCalls existing result diagnostics', () => {
  it('fails closed for an incomplete result without making a request', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-exec-warning-'));
    const calls = path.join(root, 'turn.calls.jsonl');
    const result = path.join(root, 'turn.result.jsonl');
    fs.writeFileSync(calls, ['a', 'b'].map((id) => JSON.stringify({
      id,
      type: 'function',
      function: { name: 'tool', arguments: '{}' },
    })).join('\n') + '\n');
    fs.writeFileSync(result, JSON.stringify({ tool_call_id: 'a', content: 'ok' }) + '\n');
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
    try {
      const code = await runExecCalls({
        baseUrl: 'http://127.0.0.1:1',
        input: calls,
      });
      assert.equal(code, 1);
      assert.ok(warnings.some((warning) => warning.includes('result 不完整')));
      assert.ok(warnings.some((warning) => warning.includes('b')));
    } finally {
      console.warn = originalWarn;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('runExecCalls execution ownership', () => {
  it('allows exactly one concurrent executor to reach the gateway', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-contention-'));
    const calls = path.join(root, 'turn.calls.jsonl');
    const result = path.join(root, 'turn.result.jsonl');
    writeCalls(calls);
    let requests = 0;
    const gateway = await listen((_req, res) => {
      requests++;
      setTimeout(() => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ results: [{ toolCallId: 'a', ok: true, content: 'once' }] }));
      }, 40);
    });
    try {
      const [first, second] = await Promise.all([
        runExecCalls({ baseUrl: gateway.url, input: calls }),
        runExecCalls({ baseUrl: gateway.url, input: calls }),
      ]);
      assert.deepEqual([first, second].sort(), [0, 1]);
      assert.equal(requests, 1);
      assert.ok(fs.existsSync(result));
      assert.equal(fs.existsSync(executionClaimPath(result)), false);
    } finally {
      await gateway.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('retains the claim after an indeterminate response and blocks replay', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-indeterminate-'));
    const calls = path.join(root, 'turn.calls.jsonl');
    const result = path.join(root, 'turn.result.jsonl');
    writeCalls(calls);
    let requests = 0;
    const gateway = await listen((_req, res) => {
      requests++;
      res.setHeader('content-type', 'application/json');
      res.end('{"results":');
    });
    try {
      assert.equal(await runExecCalls({ baseUrl: gateway.url, input: calls }), 1);
      assert.ok(fs.existsSync(executionClaimPath(result)));
      assert.equal(await runExecCalls({ baseUrl: gateway.url, input: calls }), 1);
      assert.equal(requests, 1);
      assert.equal(fs.existsSync(result), false);
    } finally {
      await gateway.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
