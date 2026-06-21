/** OpenAI Chat Completions 形态的工具条目（与 promptpile tools-loader 对齐）。 */
export type OpenAiToolEntry = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type ExecCallItem = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

export type ExecCallResult = {
  toolCallId: string;
  ok: boolean;
  content?: unknown;
  error?: string;
  attempts?: number;
  durationMs?: number;
};

export type ExecCallsOptions = {
  signal?: AbortSignal;
};

/** MCP 会话实现须满足的网关后端契约（可由 stub 或真实 MCP 替换）。 */
export type GatewayBackend = {
  health(): Promise<{ ok: boolean; servers: Record<string, 'up' | 'down'> }>;
  exportTools(): Promise<{ tools: OpenAiToolEntry[]; warnings?: string[] }>;
  execCalls(calls: ExecCallItem[], options?: ExecCallsOptions): Promise<{ results: ExecCallResult[] }>;
  /** Optional teardown (close MCP stdio sessions, etc.). */
  dispose?(): Promise<void>;
};
