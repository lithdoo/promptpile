import type Router from '@koa/router';
import type { GatewayBackend } from '../types';

export function registerToolsExport(router: Router, backend: GatewayBackend): void {
  router.get('/v1/tools/export', async (ctx) => {
    ctx.body = await backend.exportTools();
  });
}
