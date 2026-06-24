import type { ToolExecuteContext } from '@agent-tool-lite/base'
import type { FileReadStateMap } from '../libs/file-read-state'

export type { AgentToolDefinition, JsonObjectSchema } from '@agent-tool-lite/base'

export type FileToolExecuteContext = ToolExecuteContext & {
  /** Required by the Write/Edit tools: share the same map as reads. */
  readFileState?: FileReadStateMap
}