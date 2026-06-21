import Router from '@koa/router';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import type { GatewayBackend } from './types';
import { createAuthMiddleware } from './middleware/auth';
import { createErrorHandlerMiddleware } from './middleware/errorHandler';
import { createJsonContentTypeMiddleware } from './middleware/jsonContentType';
import { registerCallsExec } from './routes/callsExec';
import { registerHealth } from './routes/health';
import { registerToolsExport } from './routes/toolsExport';

export type CreateGatewayAppOptions = {
  token?: string;
  backend: GatewayBackend;
};

export function createGatewayApp(options: CreateGatewayAppOptions): Koa {
  const { token, backend } = options;
  const app = new Koa();
  app.use(createErrorHandlerMiddleware());
  app.use(
    bodyParser({
      jsonLimit: '2mb',
    })
  );
  app.use(createAuthMiddleware({ token }));
  app.use(createJsonContentTypeMiddleware());

  const router = new Router();
  registerHealth(router, backend);
  registerToolsExport(router, backend);
  registerCallsExec(router, backend);

  app.use(router.routes());
  app.use(router.allowedMethods());

  return app;
}
