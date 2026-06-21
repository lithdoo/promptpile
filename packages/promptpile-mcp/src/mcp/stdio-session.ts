/**
 * Stdio MCP client session (single server). Used by smoke tests and future GatewayBackend wiring.
 *
 * Timeouts: optional **connectTimeoutMs** (initialize handshake) and **rpcTimeoutMs** (list/call);
 * if omitted, **timeoutMs** applies to both (see `mcp.toml` `[defaults]` init/list mapping in gateway).
 *
 * The SDK is loaded with `createRequire` + **`@modelcontextprotocol/sdk/client/*.js`** paths so this
 * package stays **CommonJS** (plain `require('@modelcontextprotocol/sdk/client')` is rewritten by `tsc`
 * in ways that break `package.json` exports).
 */

import { createRequire } from 'node:module';
import type { IOType } from 'node:child_process';
import type { Stream } from 'node:stream';

const requireSdk = createRequire(__dirname);

/** Mirrors `@modelcontextprotocol/sdk` StdioServerParameters (kept local to avoid duplicate imports). */
export type StdioServerParams = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: IOType | Stream | number;
};

export type StdioMcpSessionOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  stderr?: StdioServerParams['stderr'];
  /** Fallback when connect/rpc timeouts omitted; default 30_000. */
  timeoutMs?: number;
  /** Transport + MCP initialize — maps from config `init_timeout_ms`. */
  connectTimeoutMs?: number;
  /** `tools/list`, `tools/call` — maps from config `list_timeout_ms`. */
  rpcTimeoutMs?: number;
  clientInfo?: { name: string; version: string };
};

type McpSdk = {
  Client: (typeof import('@modelcontextprotocol/sdk/client'))['Client'];
  StdioClientTransport: (typeof import('@modelcontextprotocol/sdk/client/stdio'))['StdioClientTransport'];
};

let mcpSdkCache: McpSdk | undefined;

function loadMcpSdk(): McpSdk {
  if (!mcpSdkCache) {
    const clientMod = requireSdk('@modelcontextprotocol/sdk/client/index.js') as typeof import('@modelcontextprotocol/sdk/client');
    const stdioMod = requireSdk('@modelcontextprotocol/sdk/client/stdio.js') as typeof import('@modelcontextprotocol/sdk/client/stdio');
    mcpSdkCache = {
      Client: clientMod.Client,
      StdioClientTransport: stdioMod.StdioClientTransport,
    };
  }
  return mcpSdkCache;
}

function raceWithTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} (>${ms}ms)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  }) as Promise<T>;
}

export class StdioMcpSession {
  private readonly options: StdioMcpSessionOptions;
  private client: InstanceType<McpSdk['Client']> | undefined;
  private transport: InstanceType<McpSdk['StdioClientTransport']> | undefined;
  private readonly fallbackMs: number;

  constructor(options: StdioMcpSessionOptions) {
    this.options = options;
    this.fallbackMs = options.timeoutMs ?? 30_000;
  }

  private connectMs(): number {
    return this.options.connectTimeoutMs ?? this.fallbackMs;
  }

  private rpcMs(): number {
    return this.options.rpcTimeoutMs ?? this.fallbackMs;
  }

  /** Connect transport and complete MCP initialize handshake. */
  async connect(): Promise<void> {
    const { Client, StdioClientTransport } = loadMcpSdk();
    const ms = this.connectMs();
    const server: StdioServerParams = {
      command: this.options.command,
      args: this.options.args,
      env: this.options.env,
      cwd: this.options.cwd,
      stderr: this.options.stderr ?? 'inherit',
    };
    this.transport = new StdioClientTransport(server);
    this.client = new Client(this.options.clientInfo ?? { name: 'promptpile-mcp', version: '0.1.0' }, {});
    await raceWithTimeout(
      this.client.connect(this.transport, { timeout: ms, maxTotalTimeout: ms }),
      ms,
      'MCP stdio connect',
    );
  }

  async listTools(): Promise<Awaited<ReturnType<NonNullable<StdioMcpSession['client']>['listTools']>>> {
    const ms = this.rpcMs();
    const c = this.requireClient();
    return raceWithTimeout(c.listTools(undefined, { timeout: ms, maxTotalTimeout: ms }), ms, 'MCP listTools');
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Awaited<ReturnType<NonNullable<StdioMcpSession['client']>['callTool']>>> {
    const ms = options?.timeoutMs ?? this.rpcMs();
    const c = this.requireClient();
    return raceWithTimeout(
      c.callTool(
        { name, arguments: args },
        undefined,
        { timeout: ms, maxTotalTimeout: ms, signal: options?.signal },
      ),
      ms,
      'MCP callTool',
    );
  }

  /** Close MCP client and stdio transport (child process). */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
    this.client = undefined;
    this.transport = undefined;
  }

  private requireClient(): NonNullable<StdioMcpSession['client']> {
    if (!this.client) {
      throw new Error('StdioMcpSession: connect() must be called before this operation');
    }
    return this.client;
  }
}
