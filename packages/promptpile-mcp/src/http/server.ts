import http from 'http';
import { createGatewayApp } from './app';
import type { GatewayBackend } from './types';

export type StartGatewayServerOptions = {
  port: number;
  token?: string;
  backend: GatewayBackend;
};

export async function startGatewayServer(
  options: StartGatewayServerOptions
): Promise<{ url: string; close: () => Promise<void> }> {
  const app = createGatewayApp(options);
  const server = http.createServer(app.callback());

  await new Promise<void>((resolve, reject) => {
    const onErr = (err: Error): void => {
      reject(err);
    };
    server.once('error', onErr);
    server.listen(options.port, '127.0.0.1', () => {
      server.removeListener('error', onErr);
      resolve();
    });
  });

  const url = `http://127.0.0.1:${options.port}`;
  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}
