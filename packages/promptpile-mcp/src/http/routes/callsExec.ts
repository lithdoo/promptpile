import type Router from '@koa/router';
import type { ExecCallItem, GatewayBackend } from '../types';

function isExecCallItem(x: unknown): x is ExecCallItem {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.type !== 'function') return false;
  const fn = o.function;
  if (typeof fn !== 'object' || fn === null) return false;
  const f = fn as Record<string, unknown>;
  return typeof f.name === 'string' && typeof f.arguments === 'string';
}

export function registerCallsExec(router: Router, backend: GatewayBackend): void {
  router.post('/v1/calls/exec', async (ctx) => {
    const body = ctx.request.body;
    if (typeof body !== 'object' || body === null || !('calls' in body)) {
      ctx.status = 400;
      ctx.type = 'application/json';
      ctx.body = { error: 'invalid_body', detail: 'missing_calls' };
      return;
    }
    const raw = (body as { calls: unknown }).calls;
    if (!Array.isArray(raw)) {
      ctx.status = 400;
      ctx.type = 'application/json';
      ctx.body = { error: 'invalid_body', detail: 'calls_must_be_array' };
      return;
    }
    for (const item of raw) {
      if (!isExecCallItem(item)) {
        ctx.status = 400;
        ctx.type = 'application/json';
        ctx.body = { error: 'invalid_body', detail: 'invalid_call_item' };
        return;
      }
    }
    const calls = raw as ExecCallItem[];
    const controller = new AbortController();
    const abort = (): void =>
      controller.abort(new Error('http_client_disconnected'));
    const onClose = (): void => {
      if (!ctx.res.writableEnded) abort();
    };
    ctx.req.once('aborted', abort);
    ctx.res.once('close', onClose);
    try {
      ctx.body = await backend.execCalls(calls, { signal: controller.signal });
    } finally {
      ctx.req.removeListener('aborted', abort);
      ctx.res.removeListener('close', onClose);
    }
  });
}
