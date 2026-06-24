import { editTextFile, type EditTextFileResult } from '../libs/edit-text-file'
import type { JsonObjectSchema } from '@agent-tool-lite/base'
import type { AccessController } from '../factory/access-controller'
import type { AgentToolDefinition, FileToolExecuteContext } from './types'

const DESCRIPTION = `Edit a file by replacing an exact string with another. For **existing** files, the file must have been read first (full read, not a line slice) and the same readFileState map must be passed. To create a new file, set old_string to the empty string. Path can be absolute, relative to cwd, or use ~ for home.`

type FileEditInput = {
  file_path?: string
  filePath?: string
  old_string?: string
  new_string?: string
  replace_all?: boolean | 'true' | 'false'
}

const INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file_path: {
      type: 'string',
      description: 'Path to the file to edit (absolute, relative, or ~).',
    },
    old_string: {
      type: 'string',
      description: 'Text to find and replace. Use empty string to create a new file.',
    },
    new_string: { type: 'string', description: 'Replacement text.' },
    replace_all: {
      type: 'boolean',
      description: 'If true, replace every occurrence of old_string.',
    },
  },
  required: ['file_path', 'old_string', 'new_string'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

function parseBoolean(v: unknown): boolean | undefined {
  if (v === undefined) {
    return undefined
  }
  if (typeof v === 'boolean') {
    return v
  }
  if (v === 'true') {
    return true
  }
  if (v === 'false') {
    return false
  }
  return undefined
}

export function createFileEditTool(
  accessController: AccessController,
): AgentToolDefinition<FileEditInput, EditTextFileResult, FileToolExecuteContext> {
  return {
    name: 'Edit',
    description: DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    async execute(
      input: FileEditInput,
      context: FileToolExecuteContext,
    ): Promise<EditTextFileResult> {
      const o = expectRecord(input)
      const filePath =
        (typeof o.file_path === 'string' && o.file_path) ||
        (typeof o.filePath === 'string' && o.filePath) ||
        ''
      if (!filePath) {
        throw new Error('Missing file_path (or filePath)')
      }
      if (typeof o.old_string !== 'string') {
        throw new Error('Missing old_string')
      }
      if (typeof o.new_string !== 'string') {
        throw new Error('Missing new_string')
      }
      const replaceAll = parseBoolean(o.replace_all) ?? false

      const readFileState = context?.readFileState
      if (!readFileState) {
        throw new Error(
          'editFileTool.execute requires context.readFileState (shared with read_file results)',
        )
      }

      const resolvedPath = accessController.resolveAndAuthorize(filePath, context?.cwd)
      return editTextFile(
        resolvedPath,
        {
          old_string: o.old_string,
          new_string: o.new_string,
          replace_all: replaceAll,
        },
        {
          readFileState,
          cwd: context?.cwd,
          signal: context?.signal,
        },
      )
    },
  }
}
