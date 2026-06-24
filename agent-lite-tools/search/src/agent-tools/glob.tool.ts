import { resolve } from 'path'
import { stat } from 'fs/promises'
import { globFilesWithExecuteOptions, DEFAULT_GLOB_LIMIT } from '../libs/glob-files'
import { toRelativePath } from '../libs/to-relative-path'
import type { JsonObjectSchema } from '@agent-tool-lite/base'
import type { IgnoreController } from '../factory/ignore-controller'
import type { AgentToolDefinition, SearchToolExecuteContext } from './types'

const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead`

export type GlobToolInput = {
  pattern?: string
  path?: string
}

const INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pattern: {
      type: 'string',
      description: 'The glob pattern to match files against',
    },
    path: {
      type: 'string',
      description:
        'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
    },
  },
  required: ['pattern'],
}

export type GlobToolResult = {
  durationMs: number
  numFiles: number
  filenames: string[]
  truncated: boolean
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

function isUncPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//')
}

export function createGlobTool(
  ignoreController: IgnoreController,
): AgentToolDefinition<GlobToolInput, GlobToolResult, SearchToolExecuteContext> {
  return {
    name: 'Glob',
    description: DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    async execute(
      input: GlobToolInput,
      context: SearchToolExecuteContext,
    ): Promise<GlobToolResult> {
      const o = expectRecord(input)
      const pattern = typeof o.pattern === 'string' ? o.pattern : ''
      if (!pattern) {
        throw new Error('Missing pattern')
      }
      const pathRaw = typeof o.path === 'string' ? o.path : undefined
      const cwdBase = context?.cwd ?? process.cwd()
      const searchDir = pathRaw ? resolve(cwdBase, pathRaw) : cwdBase

      if (pathRaw && !isUncPath(searchDir)) {
        const st = await stat(searchDir).catch(() => null)
        if (!st || !st.isDirectory()) {
          throw new Error(`Path is not a directory or does not exist: ${pathRaw}`)
        }
      }

      const start = Date.now()
      const mergedIgnoreGlobs = [
        ...ignoreController.getIgnoreGlobs(searchDir),
        ...(context?.ignoreGlobs ?? []),
      ]
      const { files, truncated } = await globFilesWithExecuteOptions(
        pattern,
        searchDir,
        DEFAULT_GLOB_LIMIT,
        0,
        {
          ...context,
          ignoreGlobs: [...new Set(mergedIgnoreGlobs)],
        },
      )
      const filenames = files.map(f => toRelativePath(f, cwdBase))
      return {
        durationMs: Date.now() - start,
        numFiles: filenames.length,
        filenames,
        truncated,
      }
    },
  }
}
