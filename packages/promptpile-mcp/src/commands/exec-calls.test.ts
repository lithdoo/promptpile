import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it } from 'node:test';
import { runExecCalls } from './exec-calls';

describe('runExecCalls existing result diagnostics', () => {
  it('warns and skips an incomplete result without making a request', async () => {
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
      assert.equal(code, 0);
      assert.ok(warnings.some((warning) => warning.includes('result 不完整')));
      assert.ok(warnings.some((warning) => warning.includes('b')));
    } finally {
      console.warn = originalWarn;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
