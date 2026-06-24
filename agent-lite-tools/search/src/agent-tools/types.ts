import type {
  AgentToolDefinition,
  JsonObjectSchema,
  ToolExecuteContext,
} from '@agent-tool-lite/base'

export type { AgentToolDefinition, JsonObjectSchema } from '@agent-tool-lite/base'

export type SearchToolExecuteContext = ToolExecuteContext & {
  /** Exec timeout in ms (default 60_000). */
  timeoutMs?: number
  /** Max stdout bytes before string truncation (default 20MB). */
  maxStdoutBytes?: number
  /** Additional per-call ignore globs (`rg --glob !<pattern>`). */
  ignoreGlobs?: string[]
}
