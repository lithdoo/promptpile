import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { checkCallsStatus } from '../exec-calls/check-status';
import { runCheck } from './check';
import { runExecCalls } from './exec-calls';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const callRow = (id: string, name: string): string =>
  JSON.stringify({
    id,
    type: 'function',
    function: { name, arguments: '{}' },
  }) + '\n';

const snapshot = (directory: string): string[] =>
  fs.readdirSync(directory).sort().map((name) =>
    `${name}:${fs.readFileSync(path.join(directory, name)).toString('base64')}`
  );

describe('layered Conversation output boundary', () => {
  it('executes and checks calls only in the explicitly selected output directory', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-layered-output-'));
    const base = path.join(root, 'base');
    const output = path.join(root, 'session-output');
    fs.mkdirSync(base);
    fs.mkdirSync(output);
    fs.writeFileSync(path.join(base, '[40]assistant.calls.jsonl'), callRow('base-call', 'base_tool'));
    fs.writeFileSync(path.join(output, '[1]assistant.calls.jsonl'), callRow('output-call', 'output_tool'));
    const baseBefore = snapshot(base);

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        calls: Array<{ id: string }>;
      };
      assert.deepEqual(request.calls.map(({ id }) => id), ['output-call']);
      return new Response(JSON.stringify({
        results: [{
          toolCallId: 'output-call',
          ok: true,
          content: { source: 'output' },
          attempts: 1,
          durationMs: 1,
        }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const originalLog = console.log;
    console.log = () => undefined;
    try {
      const execCode = await runExecCalls({
        baseUrl: 'http://127.0.0.1:8765',
        dir: output,
      });
      assert.equal(execCode, 0);

      const outputCalls = path.join(output, '[1]assistant.calls.jsonl');
      assert.equal(checkCallsStatus(outputCalls).status, 'complete');
      assert.equal(await runCheck({ input: outputCalls }), 0);
      assert.ok(fs.existsSync(path.join(output, '[1]assistant.result.jsonl')));
      assert.deepEqual(snapshot(base), baseBefore, 'input layers remain byte-for-byte unchanged');
      assert.ok(!fs.existsSync(path.join(base, '[40]assistant.result.jsonl')));
    } finally {
      console.log = originalLog;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
