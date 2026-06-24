import { basename, dirname, isAbsolute, join, sep } from 'path'
import { isEnvTruthy } from './env-truthy'
import { runRipgrep } from './run-ripgrep'
import type { SearchToolExecuteContext } from '../agent-tools/types'

export const DEFAULT_GLOB_LIMIT = 100

/**
 * Extracts the static base directory from a glob pattern (ported from Claude Code).
 */
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  const staticPrefix = pattern.slice(0, match.index)
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  if (process.platform === 'win32' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

export type GlobFilesOptions = {
  limit: number
  offset: number
  signal?: AbortSignal
  timeoutMs?: number
  maxBuffer?: number
  ignoreGlobs?: string[]
}

export async function globFiles(
  filePattern: string,
  cwd: string,
  opts: GlobFilesOptions,
): Promise<{ files: string[]; truncated: boolean }> {
  let searchDir = cwd
  let searchPattern = filePattern

  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = isAbsolute(baseDir) ? baseDir : join(cwd, baseDir)
      searchPattern = relativePattern
    }
  }

  const noIgnore = isEnvTruthy(
    process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true',
    true,
  )
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true', true)

  const args: string[] = [
    '--files',
    '--glob',
    searchPattern,
    '--sort=modified',
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  for (const pattern of opts.ignoreGlobs ?? []) {
    if (pattern) {
      args.push('--glob', `!${pattern}`)
    }
  }

  const lines = await runRipgrep(args, searchDir, {
    cwd: searchDir,
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
    maxBuffer: opts.maxBuffer,
  })

  const absolutePaths = lines.map(p => (isAbsolute(p) ? p : join(searchDir, p)))

  const truncated = absolutePaths.length > opts.offset + opts.limit
  const files = absolutePaths.slice(opts.offset, opts.offset + opts.limit)

  return { files, truncated }
}

export async function globFilesWithExecuteOptions(
  filePattern: string,
  cwd: string,
  limit: number,
  offset: number,
  exec?: SearchToolExecuteContext,
): Promise<{ files: string[]; truncated: boolean }> {
  const ignoreGlobs = [
    ...(exec?.ignoreGlobs ?? []),
  ]
  return globFiles(filePattern, cwd, {
    limit,
    offset,
    signal: exec?.signal,
    timeoutMs: exec?.timeoutMs,
    maxBuffer: exec?.maxStdoutBytes,
    ignoreGlobs,
  })
}
