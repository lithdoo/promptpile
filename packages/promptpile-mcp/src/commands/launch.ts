import { hasMcpServers, readMcpConfig } from '../mcp-config';
import { createMcpGatewayBackend } from '../http/mcp-backend';
import { createStubBackend } from '../http/stub-backend';
import type { GatewayBackend } from '../http/types';
import { startGatewayServer } from '../http/server';
import { parsePortArg } from '../cli-shared';

export type LaunchCliOptions = {
  /** 已解析：来自 --config 或 MCP_CONFIG */
  configPath: string;
  /** 原始 CLI 字符串，未传则为 undefined（与配置文件合并） */
  port?: string;
  token?: string;
};

export async function runLaunch(opts: LaunchCliOptions): Promise<number> {
  let file: ReturnType<typeof readMcpConfig>;
  try {
    file = readMcpConfig(opts.configPath);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  let port: number | undefined;
  try {
    port = opts.port !== undefined ? parsePortArg(opts.port) : file.gateway.port;
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  if (port === undefined) {
    console.error(
      'promptpile-mcp: 须指定 --port，或在配置文件 [gateway] / gateway.port 中设置 port。'
    );
    return 1;
  }

  const token = opts.token !== undefined ? opts.token : file.gateway.token;

  let backend: GatewayBackend;
  if (hasMcpServers(file)) {
    try {
      backend = await createMcpGatewayBackend(file);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(msg);
      return 1;
    }
  } else {
    backend = createStubBackend();
  }

  let url: string;
  let close: () => Promise<void>;
  try {
    const s = await startGatewayServer({
      port,
      token: token || undefined,
      backend,
    });
    url = s.url;
    close = s.close;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`promptpile-mcp: 端口 ${port} 已被占用`);
    } else {
      console.error(`promptpile-mcp: 启动失败: ${msg}`);
    }
    await backend.dispose?.().catch(() => {});
    return 1;
  }

  console.log(`promptpile-mcp: 网关已监听 ${url}（Ctrl+C 退出）`);

  await new Promise<void>((resolve) => {
    let exiting = false;
    const onSignal = (): void => {
      if (exiting) return;
      exiting = true;
      void (async () => {
        try {
          await backend.dispose?.();
        } catch {
          /* ignore */
        }
        try {
          await close();
        } catch {
          /* ignore */
        }
        resolve();
      })();
    };
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
  });

  return 0;
}
