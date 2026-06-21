import type { McpExecution } from '../mcp-config';
import type { ExecCallItem, ExecCallResult } from './types';

export type ExecuteOneCall = (
  call: ExecCallItem,
  options: { signal: AbortSignal; attempt: number }
) => Promise<Pick<ExecCallResult, 'ok' | 'content' | 'error'>>;

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function isTransientExecutionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code && ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) {
    return true;
  }
  const text = errorText(error).toLowerCase();
  return /timeout|timed out|temporar|unavailable|connection (?:reset|closed|refused)|broken pipe|transport closed/.test(text);
}

function abortError(reason: string): Error {
  const error = new Error(reason);
  error.name = 'AbortError';
  return error;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError('cancelled'));
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError('cancelled'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function callSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(abortError('call_timeout')), timeoutMs);
  const onAbort = (): void => controller.abort(parent?.reason ?? abortError('cancelled'));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

async function executeWithRetry(
  call: ExecCallItem,
  config: McpExecution,
  parentSignal: AbortSignal | undefined,
  execute: ExecuteOneCall
): Promise<ExecCallResult> {
  const started = Date.now();
  const retrySafe = config.retry_safe_tools.includes(call.function.name);
  let attempt = 0;

  while (attempt < config.retry_max_attempts) {
    attempt += 1;
    if (parentSignal?.aborted) {
      return { toolCallId: call.id, ok: false, error: 'cancelled', attempts: attempt - 1, durationMs: Date.now() - started };
    }
    const scoped = callSignal(parentSignal, config.call_timeout_ms);
    try {
      const result = await execute(call, { signal: scoped.signal, attempt });
      return { toolCallId: call.id, ...result, attempts: attempt, durationMs: Date.now() - started };
    } catch (error) {
      const cancelled = parentSignal?.aborted === true;
      const timedOut = scoped.signal.aborted && !cancelled;
      const canRetry = retrySafe && !cancelled && attempt < config.retry_max_attempts &&
        (timedOut || isTransientExecutionError(error));
      if (!canRetry) {
        return {
          toolCallId: call.id,
          ok: false,
          error: cancelled ? 'cancelled' : timedOut ? 'call_timeout' : errorText(error),
          attempts: attempt,
          durationMs: Date.now() - started,
        };
      }
      try {
        await sleep(config.retry_base_delay_ms * 2 ** (attempt - 1), parentSignal);
      } catch {
        return { toolCallId: call.id, ok: false, error: 'cancelled', attempts: attempt, durationMs: Date.now() - started };
      }
    } finally {
      scoped.dispose();
    }
  }
  return { toolCallId: call.id, ok: false, error: 'retry_exhausted', attempts: attempt, durationMs: Date.now() - started };
}

export async function executeCallsWithPolicy(
  calls: ExecCallItem[],
  config: McpExecution,
  execute: ExecuteOneCall,
  signal?: AbortSignal
): Promise<ExecCallResult[]> {
  const results = new Array<ExecCallResult | undefined>(calls.length);
  let nextIndex = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted || stopped) return;
      const index = nextIndex++;
      if (index >= calls.length) return;
      const result = await executeWithRetry(calls[index], config, signal, execute);
      results[index] = result;
      if (!result.ok && config.failure_policy === 'fail_fast') stopped = true;
    }
  };

  const count = Math.min(config.concurrency, Math.max(calls.length, 1));
  await Promise.all(Array.from({ length: count }, () => worker()));

  for (let i = 0; i < calls.length; i += 1) {
    if (!results[i]) {
      results[i] = {
        toolCallId: calls[i].id,
        ok: false,
        error: signal?.aborted ? 'cancelled' : 'cancelled_fail_fast',
        attempts: 0,
        durationMs: 0,
      };
    }
  }
  return results as ExecCallResult[];
}
