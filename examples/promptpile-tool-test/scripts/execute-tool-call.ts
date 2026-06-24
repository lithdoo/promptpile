import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAccessController,
  createFileEditTool,
  createFileWriteTool,
  createReadFileInRangeTool,
  type AgentToolDefinition,
} from '@agent-tool-lite/file'
import {
  createGlobTool,
  createGrepTool,
  createIgnoreController,
} from '@agent-tool-lite/search'
import { bashTool, powershellTool } from '@agent-tool-lite/shell'
import {
  createAiConfigController,
  createSearxngConfigController,
  createSearxngSearchTool,
  createWebFetchTool,
} from '@agent-tool-lite/web'

export type ExecuteToolCallInput = {
  name: string
  arguments: string
  toolCallId: string
}

const toolTestDebug = (): boolean => {
  const v = process.env.PROMPTPILE_DEBUG?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

const thisFileDir = dirname(fileURLToPath(import.meta.url))
const exampleRoot = resolve(thisFileDir, '..')
// File-tool roots: see roots.txt (shell tools ignore roots; cwd below applies).
const rootsFilePath = resolve(exampleRoot, 'roots.txt')
const ignoreFilePath = resolve(exampleRoot, 'ignore.txt')
// Optional agent-lite web-tool config only; promptpile itself uses promptpile.toml.
// Supports AI_MODEL / AI_API_KEY / AI_API_BASE_URL and optional SEARXNG_* keys.
const envPath = resolve(exampleRoot, '.env')

/** When `.env` has no `SEARXNG_DEFAULT_ENGINES`, prefer quality-oriented engines (order matters for SearXNG). */
const DEFAULT_SEARXNG_ENGINES: readonly string[] = [
  'google',
  'bing',
  'brave',
  'duckduckgo',
]

const accessController = createAccessController()
const readFileTool = createReadFileInRangeTool(accessController)
const writeFileTool = createFileWriteTool(accessController)
const editFileTool = createFileEditTool(accessController)

const ignoreController = createIgnoreController([])
const globTool = createGlobTool(ignoreController)
const grepTool = createGrepTool(ignoreController)

const aiConfigController = createAiConfigController({})
const searxngConfigController = createSearxngConfigController({})
const webFetchTool = createWebFetchTool(aiConfigController)
const searxngSearchTool = createSearxngSearchTool(
  searxngConfigController,
  aiConfigController,
)

let initPromise: Promise<void> | undefined
const ensureInit = async (): Promise<void> => {
  if (!initPromise) {
    initPromise = (async () => {
      await accessController.setRootsFile(rootsFilePath)
      await ignoreController.setIgnoreFile(ignoreFilePath)
      await Promise.all([
        aiConfigController.setAiConfigFile(envPath),
        searxngConfigController.setSearxngConfigFile(envPath),
      ])
      const mergedSearx = searxngConfigController.getSearxngConfig()
      const patch: {
        baseUrl?: string
        defaultEngines?: string[]
      } = {}
      if (!mergedSearx.baseUrl?.trim()) {
        patch.baseUrl = (
          process.env.SEARXNG_BASE_URL?.trim() ||
          'http://service.lithd.ltd:8080'
        ).replace(/\/+$/, '')
      }
      if (!mergedSearx.defaultEngines?.length) {
        patch.defaultEngines = [...DEFAULT_SEARXNG_ENGINES]
      }
      if (Object.keys(patch).length > 0) {
        searxngConfigController.setSearxngConfig(patch)
      }
    })()
  }
  return initPromise
}

const registerUnique = (
  map: Map<string, AgentToolDefinition>,
  tool: AgentToolDefinition,
): void => {
  if (!map.has(tool.name)) map.set(tool.name, tool)
}

const toolMap = new Map<string, AgentToolDefinition>()
registerUnique(toolMap, readFileTool)
registerUnique(toolMap, writeFileTool)
registerUnique(toolMap, editFileTool)
registerUnique(toolMap, globTool)
registerUnique(toolMap, grepTool)
registerUnique(toolMap, bashTool)
registerUnique(toolMap, powershellTool)
registerUnique(toolMap, webFetchTool)
registerUnique(toolMap, searxngSearchTool)

/**
 * Execute one tool call from `[idx]assistant.calls.jsonl`.
 *
 * The returned string becomes the `content` field of the corresponding line
 * in `[idx]assistant.result.jsonl`. Non-string results are JSON-stringified.
 */
export async function executeToolCall(
  input: ExecuteToolCallInput,
): Promise<string> {
  await ensureInit()

  if (toolTestDebug()) {
    const argPreview =
      input.arguments.length > 200
        ? `${input.arguments.slice(0, 200)}…`
        : input.arguments
    console.error(
      `[promptpile-tool-test] executeToolCall name=${input.name} id=${input.toolCallId} args(${input.arguments.length} chars)=${JSON.stringify(argPreview)}`,
    )
  }

  const tool = toolMap.get(input.name)
  if (!tool) {
    if (toolTestDebug()) {
      console.error(
        `[promptpile-tool-test] unknown tool "${input.name}"; registered: ${[...toolMap.keys()].sort().join(', ')}`,
      )
    }
    throw new Error(`Unknown tool: ${input.name}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = input.arguments.trim()
      ? (JSON.parse(input.arguments) as Record<string, unknown>)
      : {}
  } catch {
    throw new Error(
      `Invalid JSON arguments for ${input.name}: ${input.arguments}`,
    )
  }

  const result = await tool.execute(parsed, { cwd: exampleRoot })
  const out = typeof result === 'string' ? result : JSON.stringify(result)
  if (toolTestDebug()) {
    const preview =
      out.length > 400 ? `${out.slice(0, 400)}… (${out.length} chars)` : out
    console.error(
      `[promptpile-tool-test] executeToolCall ok name=${input.name} result=${JSON.stringify(preview)}`,
    )
  }
  return out
}
