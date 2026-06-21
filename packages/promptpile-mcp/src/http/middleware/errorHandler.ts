import type { Context, Middleware, Next } from 'koa';

/** 捕获路由抛错，输出 JSON（不显式暴露 stack）。 */
export function createErrorHandlerMiddleware(): Middleware {
  return async (ctx: Context, next: Next): Promise<void> => {
    try {
      await next();
    } catch (err: unknown) {
      if (err instanceof SyntaxError) {
        ctx.status = 400;
        ctx.type = 'application/json';
        ctx.body = { error: 'invalid_body', detail: 'invalid_json' };
        return;
      }
      const status =
        typeof err === 'object' &&
        err !== null &&
        'status' in err &&
        typeof (err as { status: unknown }).status === 'number'
          ? (err as { status: number }).status
          : 500;
      const normalized =
        status >= 400 && status < 600 ? status : status === 413 ? 413 : 500;
      ctx.status = normalized;
      ctx.type = 'application/json';
      if (normalized === 413) {
        ctx.body = { error: 'payload_too_large' };
        return;
      }
      ctx.body =
        normalized === 500
          ? { error: 'internal' }
          : {
              error:
                typeof err === 'object' &&
                err !== null &&
                'message' in err &&
                typeof (err as { message: unknown }).message === 'string'
                  ? (err as { message: string }).message
                  : 'error',
            };
    }
  };
}
