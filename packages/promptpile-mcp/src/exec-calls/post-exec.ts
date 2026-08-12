import type { ExecCallItem, ExecCallResult } from '../http/types';

export type ExecCallsHttpBody = {
  results: ExecCallResult[];
};

const BODY_SNIPPET_MAX = 500;
const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

function requestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('request_timeout')),
    timeoutMs
  );
  const onAbort = (): void =>
    controller.abort(parent?.reason ?? new Error('cancelled'));

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

export function truncateBody(text: string): string {
  if (text.length <= BODY_SNIPPET_MAX) return text;
  return `${text.slice(0, BODY_SNIPPET_MAX)}...`;
}

export async function postExecCalls(
  baseUrl: string,
  token: string | undefined,
  calls: ExecCallItem[],
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<{ ok: boolean; status: number; bodyText: string }> {
  const url = `${baseUrl}/v1/calls/exec`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (token !== undefined && token !== '') {
    headers.Authorization = `Bearer ${token}`;
  }

  const scoped = requestSignal(
    options?.signal,
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  );
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ calls }),
      signal: scoped.signal,
    });
    const bodyText = await res.text();
    return { ok: res.ok, status: res.status, bodyText };
  } finally {
    scoped.dispose();
  }
}

function parseExecCallResult(value: unknown, index: number): ExecCallResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`响应中 results[${index}] 须为对象`);
  }
  const row = value as Record<string, unknown>;
  if (typeof row.toolCallId !== 'string' || row.toolCallId.trim() === '') {
    throw new Error(`响应中 results[${index}].toolCallId 须为非空字符串`);
  }
  if (typeof row.ok !== 'boolean') {
    throw new Error(`响应中 results[${index}].ok 须为 boolean`);
  }
  if (row.attempts !== undefined &&
      (!Number.isInteger(row.attempts) || (row.attempts as number) < 0)) {
    throw new Error(`响应中 results[${index}].attempts 须为非负整数`);
  }
  if (row.durationMs !== undefined &&
      (typeof row.durationMs !== 'number' || !Number.isFinite(row.durationMs) || row.durationMs < 0)) {
    throw new Error(`响应中 results[${index}].durationMs 须为非负有限数`);
  }
  if (row.error !== undefined && typeof row.error !== 'string') {
    throw new Error(`响应中 results[${index}].error 须为字符串`);
  }
  return {
    toolCallId: row.toolCallId,
    ok: row.ok,
    ...(row.content !== undefined ? { content: row.content } : {}),
    ...(row.error !== undefined ? { error: row.error } : {}),
    ...(row.attempts !== undefined ? { attempts: row.attempts as number } : {}),
    ...(row.durationMs !== undefined ? { durationMs: row.durationMs } : {}),
  };
}

export function parseExecCallsResponseBody(
  bodyText: string,
  calls: readonly ExecCallItem[]
): ExecCallsHttpBody {
  let data: unknown;
  try {
    data = JSON.parse(bodyText) as unknown;
  } catch {
    throw new Error('响应不是合法 JSON');
  }
  if (!data || typeof data !== 'object' || !('results' in data)) {
    throw new Error('响应缺少 results 字段');
  }
  const results = (data as { results: unknown }).results;
  if (!Array.isArray(results)) {
    throw new Error('响应中 results 须为数组');
  }
  const parsed = results.map(parseExecCallResult);
  const expected = new Set(calls.map((call) => call.id));
  const seen = new Set<string>();
  for (const result of parsed) {
    if (!expected.has(result.toolCallId)) throw new Error(`响应包含未知 toolCallId: ${result.toolCallId}`);
    if (seen.has(result.toolCallId)) throw new Error(`响应包含重复 toolCallId: ${result.toolCallId}`);
    seen.add(result.toolCallId);
  }
  const missing = calls.filter((call) => !seen.has(call.id)).map((call) => call.id);
  if (missing.length > 0 || parsed.length !== calls.length) {
    throw new Error(`响应缺少 toolCallId: ${missing.join(', ')}`);
  }
  const byId = new Map(parsed.map((result) => [result.toolCallId, result]));
  return { results: calls.map((call) => byId.get(call.id)!) };
}
