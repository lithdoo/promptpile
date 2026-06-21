import type { Middleware } from 'koa';

/** 成功响应默认 JSON（下游仍可按需覆盖 ctx.type）。 */
export function createJsonContentTypeMiddleware(): Middleware {
  return async (ctx, next) => {
    await next();
    if (ctx.body !== undefined && ctx.status < 400 && !ctx.type) {
      ctx.type = 'application/json; charset=utf-8';
    }
  };
}
