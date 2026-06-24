import { setStateFromReadInRange } from '../libs/file-read-state'
import { expandPathForWrite } from '../libs/path-resolve'
import { readFileInRange, type ReadFileRangeResult } from '../libs/read-file-in-range'
import type { JsonObjectSchema } from '@agent-tool-lite/base'
import type { AccessController } from '../factory/access-controller'
import type { AgentToolDefinition, FileToolExecuteContext } from './types'

const DESCRIPTION = `Read a text file from disk. Returns a slice of lines (0-based line index), with UTF-8 BOM stripped and CRLF normalized to LF in the returned content. Small files use a fast path; large or non-regular files stream. Set limit and/or max_bytes to avoid reading huge files in one go. If truncate_on_byte_limit is true, output is clipped to the byte budget at line boundaries (truncated_by_bytes on the result) instead of throwing.`

type ReadFileInRangeInput = {
  file_path?: string
  filePath?: string
  offset?: number | string
  limit?: number | string
  max_bytes?: number | string
  maxBytes?: number | string
  truncate_on_byte_limit?: boolean | 'true' | 'false'
  truncateOnByteLimit?: boolean | 'true' | 'false'
}

const INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    file_path: {
      type: 'string',
      description: 'Absolute or relative path to the file to read.',
    },
    offset: {
      type: 'number',
      description: '0-based line index to start from (inclusive). Default 0.',
    },
    limit: {
      type: 'number',
      description:
        'Maximum number of lines to return. Omit to read to end of file (subject to max_bytes if set).',
    },
    max_bytes: {
      type: 'number',
      description:
        'Maximum file size in bytes (guardrail). If the file is larger, throws unless truncate_on_byte_limit is true.',
    },
    truncate_on_byte_limit: {
      type: 'boolean',
      description:
        'If true with max_bytes set, cap returned text at the byte limit on line boundaries; sets truncated_by_bytes on the result instead of throwing.',
    },
  },
  required: ['file_path'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

function getOptionalNumber(o: Record<string, unknown>, key: string): number | undefined {
  if (!(key in o) || o[key] === undefined || o[key] === null) {
    return undefined
  }
  const v = o[key]
  if (typeof v === 'number' && Number.isFinite(v)) {
    return v
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  throw new Error(`Invalid number property: ${key}`)
}

function getOptionalBool(o: Record<string, unknown>, key: string): boolean | undefined {
  if (!(key in o) || o[key] === undefined || o[key] === null) {
    return undefined
  }
  const v = o[key]
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  throw new Error(`Invalid boolean property: ${key}`)
}

export function createReadFileInRangeTool(
  accessController: AccessController,
): AgentToolDefinition<ReadFileInRangeInput, ReadFileRangeResult, FileToolExecuteContext> {
  return {
    name: 'read_file',
    description: DESCRIPTION,
    inputSchema: INPUT_SCHEMA,
    async execute(input: ReadFileInRangeInput, context: FileToolExecuteContext) {
      const o = expectRecord(input)

      const filePath =
        (typeof o.file_path === 'string' && o.file_path) ||
        (typeof o.filePath === 'string' && o.filePath) ||
        ''
      if (!filePath) {
        throw new Error('Missing file_path (or filePath)')
      }

      const offset = getOptionalNumber(o, 'offset') ?? 0
      const limit = getOptionalNumber(o, 'limit')
      const maxBytes =
        getOptionalNumber(o, 'max_bytes') ?? getOptionalNumber(o, 'maxBytes')
      const truncateOnByteLimit =
        getOptionalBool(o, 'truncate_on_byte_limit') ??
        getOptionalBool(o, 'truncateOnByteLimit') ??
        false

      if (offset < 0 || (limit !== undefined && limit < 0)) {
        throw new Error('offset and limit must be non-negative')
      }

      const resolvedPath = accessController.resolveAndAuthorize(filePath, context?.cwd)
      const canonicalPath = expandPathForWrite(resolvedPath, context?.cwd)

      const result = await readFileInRange(
        canonicalPath,
        offset,
        limit,
        maxBytes,
        context?.signal,
        { truncateOnByteLimit },
      )

      if (context?.readFileState) {
        setStateFromReadInRange(context.readFileState, canonicalPath, result, {
          offsetLines: offset,
          maxLines: limit,
        })
      }

      return result
    },
  }
}
