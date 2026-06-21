import type { ExecCallItem, GatewayBackend } from './types';

/** 占位后端：无 MCP 连接时的固定响应。 */
export function createStubBackend(): GatewayBackend {
  return {
    async dispose() {
      /* no-op */
    },
    async health() {
      return { ok: true, servers: {} };
    },
    async exportTools() {
      return { tools: [], warnings: ['mcp_not_connected'] };
    },
    async execCalls(calls: ExecCallItem[]) {
      return {
        results: calls.map((c) => ({
          toolCallId: c.id,
          ok: false,
          error: 'mcp_not_connected',
        })),
      };
    },
  };
}
