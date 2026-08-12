import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { parseExecCallsResponseBody, postExecCalls } from './post-exec';

const calls = [
  { id: 'a', type: 'function' as const, function: { name: 'one', arguments: '{}' } },
  { id: 'b', type: 'function' as const, function: { name: 'two', arguments: '{}' } },
];

describe('parseExecCallsResponseBody', () => {
  it('validates completeness and restores input order', () => {
    const parsed = parseExecCallsResponseBody(JSON.stringify({ results: [
      { toolCallId: 'b', ok: false, error: 'no', attempts: 1, durationMs: 2 },
      { toolCallId: 'a', ok: true, content: 'yes' },
    ] }), calls);
    assert.deepEqual(parsed.results.map((row) => row.toolCallId), ['a', 'b']);
  });

  it('rejects missing, duplicate, unknown, and malformed results', () => {
    assert.throws(() => parseExecCallsResponseBody('{"results":[]}', calls), /缺少/);
    assert.throws(() => parseExecCallsResponseBody(JSON.stringify({ results: [
      { toolCallId: 'a', ok: true }, { toolCallId: 'a', ok: true },
    ] }), calls), /重复/);
    assert.throws(() => parseExecCallsResponseBody(JSON.stringify({ results: [
      { toolCallId: 'a', ok: true }, { toolCallId: 'c', ok: true },
    ] }), calls), /未知/);
    assert.throws(() => parseExecCallsResponseBody(JSON.stringify({ results: [
      { toolCallId: 'a', ok: 'true' }, { toolCallId: 'b', ok: true },
    ] }), calls), /boolean/);
  });
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installPendingFetch(): void {
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return reject(new Error('missing signal'));
      if (signal.aborted) return reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as typeof fetch;
}

describe('postExecCalls', () => {
  it('keeps the request timeout when an external signal is provided', async () => {
    installPendingFetch();
    const parent = new AbortController();
    await assert.rejects(
      postExecCalls('http://127.0.0.1:1', undefined, [], {
        signal: parent.signal,
        timeoutMs: 10,
      }),
      /request_timeout/
    );
  });

  it('propagates external cancellation before the timeout', async () => {
    installPendingFetch();
    const parent = new AbortController();
    const pending = postExecCalls('http://127.0.0.1:1', undefined, [], {
      signal: parent.signal,
      timeoutMs: 1_000,
    });
    parent.abort(new Error('user_cancelled'));
    await assert.rejects(pending, /user_cancelled/);
  });
});
