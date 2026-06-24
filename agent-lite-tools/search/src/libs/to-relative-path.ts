import { relative, resolve } from 'path'

/**
 * Return path relative to cwd when possible; otherwise absolute resolved path.
 */
export function toRelativePath(filePath: string, cwd: string): string {
  const abs = resolve(filePath)
  const base = resolve(cwd)
  let rel = relative(base, abs)
  if (rel.startsWith('..') || rel === '') {
    return abs
  }
  return rel
}
