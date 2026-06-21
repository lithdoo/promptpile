import type Router from '@koa/router';
import type { GatewayBackend } from '../types';

export function registerHealth(router: Router, backend: GatewayBackend): void {
  router.get('/health', async (ctx) => {
    ctx.body = await backend.health();
  });
}
