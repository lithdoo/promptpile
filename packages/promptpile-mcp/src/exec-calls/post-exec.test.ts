import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { postExecCalls } from './post-exec';

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
