import { stringify as tomlStringify } from '@iarna/toml'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileTools } from '@agent-tool-lite/file'
import { createSearchTools } from '@agent-tool-lite/search'
import { createShellTools } from '@agent-tool-lite/shell'
import { createWebTools } from '@agent-tool-lite/web'

type AgentToolLike = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  execute: (...args: unknown[]) => unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const isAgentToolLike = (value: unknown): value is AgentToolLike => {
  if (!isRecord(value)) return false
  return (
    typeof value.name === 'string' &&
    value.name.length > 0 &&
    typeof value.description === 'string' &&
    value.description.length > 0 &&
    typeof value.execute === 'function' &&
    isRecord(value.inputSchema)
  )
}

const collectTools = (factoryResult: Record<string, unknown>): AgentToolLike[] =>
  Object.values(factoryResult).filter(isAgentToolLike)

const fileTools = createFileTools()
const searchTools = createSearchTools()
const shellTools = createShellTools()
const webTools = createWebTools()

const allTools = [
  ...collectTools(fileTools as unknown as Record<string, unknown>),
  ...collectTools(searchTools as unknown as Record<string, unknown>),
  ...collectTools(shellTools as unknown as Record<string, unknown>),
  ...collectTools(webTools as unknown as Record<string, unknown>),
]

const seenNames = new Set<string>()
const dedupedTools = allTools.filter((tool) => {
  if (seenNames.has(tool.name)) return false
  seenNames.add(tool.name)
  return true
})

const tomlTools = dedupedTools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  parameters: JSON.stringify(tool.inputSchema),
}))

const thisFileDir = dirname(fileURLToPath(import.meta.url))
const messagesDir = resolve(thisFileDir, '..', 'messages')
const toolsTomlPath = resolve(messagesDir, '.tools.toml')
const toolsJsonlPath = resolve(messagesDir, '.tools.jsonl')

mkdirSync(messagesDir, { recursive: true })
writeFileSync(toolsTomlPath, tomlStringify({ tools: tomlTools } as never), 'utf8')

if (existsSync(toolsJsonlPath)) {
  rmSync(toolsJsonlPath)
}

console.log(`[ok] wrote ${tomlTools.length} tools: ${toolsTomlPath}`)
if (existsSync(toolsJsonlPath)) {
  console.log(`[warn] .tools.jsonl still exists: ${toolsJsonlPath}`)
} else {
  console.log('[ok] removed legacy .tools.jsonl (if existed)')
}
