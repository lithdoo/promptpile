import { isAbsolute, resolve, normalize, sep } from 'path'
import { homedir } from 'os'

/**
 * Minimal path resolution: `~` → home, relative paths from `cwd` (default `process.cwd()`).
 */
export function expandPathForWrite(filePath: string, cwd: string = process.cwd()): string {
  const trimmed = filePath.trim()
  if (trimmed === '') {
    return trimmed
  }
  if (trimmed === '~') {
    return homedir()
  }
  if (trimmed.startsWith('~' + sep)) {
    return resolve(homedir(), trimmed.slice(2))
  }
  if (isAbsolute(trimmed)) {
    return normalize(trimmed)
  }
  return normalize(resolve(cwd, trimmed))
}
