import type Router from '@koa/router';
import { parseToolCallV1 } from 'promptpile-protocol/tool';
import type { ExecCallItem, GatewayBackend } from '../types';

function parseExecCallItem(value: unknown): ExecCallItem | undefined {
  const call = parseToolCallV1(value);
  return call?.type === 'function' ? call as ExecCallItem : undefined;
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
    const calls: ExecCallItem[] = [];
    for (const item of raw) {
      const parsed = parseExecCallItem(item);
      if (!parsed) {
        ctx.status = 400;
        ctx.type = 'application/json';
        ctx.body = { error: 'invalid_body', detail: 'invalid_call_item' };
        return;
      }
      calls.push(parsed);
    }
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
