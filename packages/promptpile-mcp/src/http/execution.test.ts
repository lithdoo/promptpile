import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { McpExecution } from '../mcp-config';
import { executeCallsWithPolicy } from './execution';
import type { ExecCallItem } from './types';

const call = (id: string, name = id): ExecCallItem => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});

const config = (overrides: Partial<McpExecution> = {}): McpExecution => ({
  concurrency: 2,
  call_timeout_ms: 1_000,
  failure_policy: 'continue',
  retry_max_attempts: 1,
  retry_base_delay_ms: 0,
  retry_safe_tools: [],
  ...overrides,
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('executeCallsWithPolicy', () => {
  it('runs calls concurrently and preserves input order', async () => {
    let active = 0;
    let maxActive = 0;
    const results = await executeCallsWithPolicy(
      [call('1'), call('2'), call('3'), call('4')],
      config({ concurrency: 2 }),
      async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(item.id === '1' ? 25 : 5);
        active -= 1;
        return { ok: true, content: item.id };
      }
    );

    assert.equal(maxActive, 2);
    assert.deepEqual(results.map((result) => result.toolCallId), ['1', '2', '3', '4']);
    assert.deepEqual(results.map((result) => result.content), ['1', '2', '3', '4']);
  });

  it('times out a call', async () => {
    const [result] = await executeCallsWithPolicy(
      [call('slow')],
      config({ call_timeout_ms: 10 }),
      async (_item, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      })
    );

    assert.equal(result.ok, false);
    assert.equal(result.error, 'call_timeout');
    assert.equal(result.attempts, 1);
  });

  it('retries transient failures only for explicitly safe tools', async () => {
    const attempts = new Map<string, number>();
    const results = await executeCallsWithPolicy(
      [call('safe', 'safe_tool'), call('unsafe', 'unsafe_tool')],
      config({
        retry_max_attempts: 3,
        retry_safe_tools: ['safe_tool'],
      }),
      async (item) => {
        const count = (attempts.get(item.id) ?? 0) + 1;
        attempts.set(item.id, count);
        if (count === 1) {
          const error = new Error('connection reset') as NodeJS.ErrnoException;
          error.code = 'ECONNRESET';
          throw error;
        }
        return { ok: true, content: 'ok' };
      }
    );

    assert.equal(results[0].ok, true);
    assert.equal(results[0].attempts, 2);
    assert.equal(results[1].ok, false);
    assert.equal(results[1].attempts, 1);
  });

  it('does not retry MCP business errors', async () => {
    let attempts = 0;
    const [result] = await executeCallsWithPolicy(
      [call('business', 'safe_tool')],
      config({ retry_max_attempts: 3, retry_safe_tools: ['safe_tool'] }),
      async () => {
        attempts += 1;
        return { ok: false, error: 'tool_rejected' };
      }
    );

    assert.equal(attempts, 1);
    assert.equal(result.error, 'tool_rejected');
  });

  it('stops scheduling new calls in fail_fast mode', async () => {
    let executed = 0;
    const results = await executeCallsWithPolicy(
      [call('1'), call('2'), call('3')],
      config({ concurrency: 1, failure_policy: 'fail_fast' }),
      async () => {
        executed += 1;
        return { ok: false, error: 'failed' };
      }
    );

    assert.equal(executed, 1);
    assert.deepEqual(results.map((result) => result.error), ['failed', 'cancelled_fail_fast', 'cancelled_fail_fast']);
    assert.deepEqual(results.map((result) => result.attempts), [1, 0, 0]);
  });

  it('cancels in-flight work and does not schedule remaining calls', async () => {
    const controller = new AbortController();
    let executed = 0;
    const pending = executeCallsWithPolicy(
      [call('1'), call('2')],
      config({ concurrency: 1 }),
      async (_item, options) => {
        executed += 1;
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
      },
      controller.signal
    );
    setTimeout(() => controller.abort(new Error('user_cancelled')), 10);
    const results = await pending;

    assert.equal(executed, 1);
    assert.deepEqual(results.map((result) => result.error), ['cancelled', 'cancelled']);
  });
});
