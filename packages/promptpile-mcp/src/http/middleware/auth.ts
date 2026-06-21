import type { Context, Middleware, Next } from 'koa';

export type AuthOptions = {
  /** 未设置则不校验（除 /health 外路由在本中间件前仍须匹配路径）。 */
  token?: string;
};

/**
 * 配置了 token 时：除 /health 外要求 Authorization: Bearer <token>。
 */
export function createAuthMiddleware(options: AuthOptions): Middleware {
  const { token } = options;
  return async (ctx: Context, next: Next): Promise<void> => {
    if (!token) {
      await next();
      return;
    }
    if (ctx.path === '/health') {
      await next();
      return;
    }
    const auth = ctx.get('authorization');
    const prefix = 'Bearer ';
    if (!auth.startsWith(prefix) || auth.slice(prefix.length) !== token) {
      ctx.status = 401;
      ctx.type = 'application/json';
      ctx.body = { error: 'unauthorized' };
      return;
    }
    await next();
  };
}
