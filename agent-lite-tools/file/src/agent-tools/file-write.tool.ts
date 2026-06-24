import { writeTextFile, type WriteTextFileResult } from '../libs/write-file'
import type { JsonObjectSchema } from '@agent-tool-lite/base'
import type { AccessController } from '../factory/access-controller'
import type { AgentToolDefinition, FileToolExecuteContext } from './types'

const DESCRIPTION = `Write a text file in full. For **existing** files, the file must have been read first (full read, not a line slice) and the same readFileState map must be passed in execute options. New files can be created without a prior read. Path can be absolute, relative to cwd, or use ~ for home.`

type FileWriteInput = {
  file_path?: string
  filePath?: string
  content?: string
}

const INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file_path: {
      type: 'string',
      description: 'Path to the file to write (absolute, relative, or ~).',
    },
    content: { type: 'string', description: 'Full new file content.' },
  },
  required: ['file_path', 'content'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

export function createFileWriteTool(
  accessController: AccessController,
): AgentToolDefinition<FileWriteInput, WriteTextFileResult, FileToolExecuteContext> {
  return {
    name: 'Write',
    description: DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    async execute(
      input: FileWriteInput,
      context: FileToolExecuteContext,
    ): Promise<WriteTextFileResult> {
      const o = expectRecord(input)
      const filePath =
        (typeof o.file_path === 'string' && o.file_path) ||
        (typeof o.filePath === 'string' && o.filePath) ||
        ''
      if (!filePath) {
        throw new Error('Missing file_path (or filePath)')
      }
      const content = typeof o.content === 'string' ? o.content : undefined
      if (content === undefined) {
        throw new Error('Missing content')
      }
      const readFileState = context?.readFileState
      if (!readFileState) {
        throw new Error(
          'writeFileTool.execute requires context.readFileState (shared with read_file results)',
        )
      }
      const resolvedPath = accessController.resolveAndAuthorize(filePath, context?.cwd)
      return writeTextFile(resolvedPath, content, {
        readFileState,
        cwd: context?.cwd,
        signal: context?.signal,
      })
    },
  }
}
