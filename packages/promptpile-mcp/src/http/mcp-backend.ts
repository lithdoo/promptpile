import type { McpFileConfig } from '../mcp-config';
import { StdioMcpSession } from '../mcp/stdio-session';
import { routeExecToolName, toGatewayToolName } from '../mcp/tool-name';
import { executeCallsWithPolicy } from './execution';
import type { ExecCallItem, ExecCallResult, GatewayBackend, OpenAiToolEntry } from './types';

type McpListedTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

function emptyObjectSchema(): Record<string, unknown> {
  return { type: 'object', properties: {} };
}

function inputSchemaToParameters(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return schema as Record<string, unknown>;
  }
  return emptyObjectSchema();
}

function extractTextFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const b = block as { type: string; text?: string };
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** Map MCP `tools/call` result to exec-calls `content` / `error`. */
function mapCallToolResult(result: unknown): Pick<ExecCallResult, 'ok' | 'content' | 'error'> {
  const r = result as {
    isError?: boolean;
    content?: unknown;
    structuredContent?: Record<string, unknown>;
  };
  if (r.isError) {
    const msg =
      extractTextFromContent(r.content) ??
      (typeof r.content === 'string' ? r.content : undefined) ??
      'mcp_tool_error';
    return { ok: false, error: msg };
  }
  if (r.structuredContent !== undefined && Object.keys(r.structuredContent).length > 0) {
    return { ok: true, content: r.structuredContent };
  }
  const text = extractTextFromContent(r.content);
  if (text !== undefined) return { ok: true, content: text };
  return { ok: true, content: result };
}

async function disposeSessions(sessions: Iterable<StdioMcpSession>): Promise<void> {
  await Promise.all(
    [...sessions].map((s) =>
      s.close().catch(() => {
        /* ignore */
      }),
    ),
  );
}

function buildFlatToolIndex(
  toolsByServer: ReadonlyMap<string, McpListedTool[]>,
): Map<string, ReadonlySet<string>> {
  const m = new Map<string, ReadonlySet<string>>();
  for (const [serverId, tools] of toolsByServer) {
    m.set(serverId, new Set(tools.map((t) => t.name)));
  }
  return m;
}

/**
 * Connect to all configured MCP servers, cache `tools/list`, implement gateway routes.
 */
export async function createMcpGatewayBackend(config: McpFileConfig): Promise<GatewayBackend> {
  const serverIds = Object.keys(config.servers);
  const sessions = new Map<string, StdioMcpSession>();
  const status: Record<string, 'up' | 'down'> = {};
  const toolsByServer = new Map<string, McpListedTool[]>();

  for (const id of serverIds) {
    const entry = config.servers[id];
    const session = new StdioMcpSession({
      command: entry.command,
      args: entry.args,
      env: entry.env,
      cwd: entry.cwd,
      connectTimeoutMs: entry.init_timeout_ms ?? config.defaults.init_timeout_ms,
      rpcTimeoutMs: entry.list_timeout_ms ?? config.defaults.list_timeout_ms,
      clientInfo: { name: `promptpile-mcp:${id}`, version: '0.1.0' },
    });
    sessions.set(id, session);
  }

  const strict = config.behavior.failure_policy === 'strict';

  for (const id of serverIds) {
    const session = sessions.get(id)!;
    try {
      await session.connect();
      const listed = await session.listTools();
      const tools = (listed.tools ?? []) as McpListedTool[];
      toolsByServer.set(id, tools);
      status[id] = 'up';
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`promptpile-mcp: MCP server "${id}" failed: ${msg}`);
      status[id] = 'down';
      await session.close().catch(() => {});
      if (strict) {
        await disposeSessions(sessions.values());
        throw new Error(`promptpile-mcp: strict mode: server "${id}" failed: ${msg}`);
      }
    }
  }

  const anyUp = Object.values(status).some((s) => s === 'up');
  if (!anyUp) {
    await disposeSessions(sessions.values());
    throw new Error('promptpile-mcp: no MCP server connected');
  }

  const flatIndex = buildFlatToolIndex(toolsByServer);

  return {
    async dispose() {
      await disposeSessions(sessions.values());
    },

    async health() {
      const ok = Object.values(status).some((s) => s === 'up');
      return { ok, servers: { ...status } };
    },

    async exportTools(): Promise<{ tools: OpenAiToolEntry[]; warnings?: string[] }> {
      const warnings: string[] = [];
      for (const id of serverIds) {
        if (status[id] === 'down') warnings.push(`server_down:${id}`);
      }
      const tools: OpenAiToolEntry[] = [];
      const flat = config.behavior.flat_names;
      for (const [serverId, mcpTools] of toolsByServer) {
        if (status[serverId] !== 'up') continue;
        for (const t of mcpTools) {
          tools.push({
            type: 'function',
            function: {
              name: toGatewayToolName(serverId, t.name, flat),
              description: t.description,
              parameters: inputSchemaToParameters(t.inputSchema),
            },
          });
        }
      }
      return { tools, warnings: warnings.length > 0 ? warnings : undefined };
    },

    async execCalls(calls: ExecCallItem[], options): Promise<{ results: ExecCallResult[] }> {
      const flatNames = config.behavior.flat_names;
      const results = await executeCallsWithPolicy(
        calls,
        config.execution,
        async (call, execution) => {
          const routed = routeExecToolName(call.function.name, {
            flatNames,
            flatIndex,
            allowPrefixedUnderFlat: true,
          });
          if (!routed.ok) return { ok: false, error: routed.error };

          const { serverId, mcpToolName } = routed;
          if (!serverIds.includes(serverId)) return { ok: false, error: 'unknown_server' };
          if (status[serverId] !== 'up') return { ok: false, error: 'server_down' };
          const session = sessions.get(serverId);
          if (!session) return { ok: false, error: 'internal_no_session' };

          let argsObj: Record<string, unknown>;
          try {
            const parsed = JSON.parse(call.function.arguments) as unknown;
            if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
              return { ok: false, error: 'invalid_arguments_json' };
            }
            argsObj = parsed as Record<string, unknown>;
          } catch {
            return { ok: false, error: 'invalid_arguments_json' };
          }

          const raw = await session.callTool(mcpToolName, argsObj, {
            signal: execution.signal,
            timeoutMs: config.execution.call_timeout_ms,
          });
          return mapCallToolResult(raw);
        },
        options?.signal
      );
      return { results };
    },
  };
}
