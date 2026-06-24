import { createSearchTools } from './factory/create-search-tools'
import type { AgentToolDefinition } from './agent-tools/types'

/** One OpenAI Chat Completions `tools[]` entry (`type: "function"`). */
export type OpenAiFunctionToolDefinition = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export function agentToolToOpenAi(def: AgentToolDefinition): OpenAiFunctionToolDefinition {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  }
}

/** Glob + Grep as OpenAI-style tool definitions (append to your `tools` array). */
export function searchToolsOpenAiDefinitions(): OpenAiFunctionToolDefinition[] {
  const tools = createSearchTools()
  return [agentToolToOpenAi(tools.globTool), agentToolToOpenAi(tools.grepTool)]
}
