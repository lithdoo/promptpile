import { statSync } from 'fs'

/**
 * Normalized mtime in ms (floored) for consistent comparisons with read state.
 * Same idea as Claude `getFileModificationTime`.
 */
export function getFileModificationTime(filePath: string): number {
  return Math.floor(statSync(filePath).mtimeMs)
}
