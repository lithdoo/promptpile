import type {
  AgentToolDefinition,
  JsonObjectSchema,
  ToolExecuteContext,
} from '@agent-tool-lite/base'

export type { AgentToolDefinition, JsonObjectSchema, ToolExecuteContext }

export type ShellToolExecuteContext = ToolExecuteContext & {
  /** Working directory for this invocation only; not persisted across calls. */
  cwd?: string
}
