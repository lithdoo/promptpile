import type { ReadFileRangeResult } from './read-file-in-range'

/**
 * Per-path view of a file the model may have read; mirrors Claude
 * `readFileState` / FileWriteTool expectations.
 */
export type FileReadStateEntry = {
  content: string
  /** Aligned with `Math.floor(mtimeMs)` at read and write time. */
  timestamp: number
  offset?: number
  limit?: number
  isPartialView?: boolean
}

export type FileReadStateMap = Map<string, FileReadStateEntry>

/**
 * `true` when the read covered the full file (Claude: `offset` and `limit` both `undefined` on state).
 * Our `readFileInRange(…, 0, undefined, …)` full read should go through
 * {@link setStateFromReadInRange} without storing offset/limit.
 */
export function isFullFileReadState(e: FileReadStateEntry | undefined): boolean {
  if (!e) return false
  return e.offset === undefined && e.limit === undefined && !e.isPartialView
}

/**
 * After {@link readFileInRange}, record state so {@link writeTextFile} can enforce read-before-write.
 * Use the same `offset` and `maxLines` arguments you passed to `readFileInRange` (0-based line offset).
 */
export function setStateFromReadInRange(
  map: FileReadStateMap,
  filePath: string,
  result: ReadFileRangeResult,
  readArgs: { offsetLines: number; maxLines?: number },
): void {
  const partial =
    result.truncatedByBytes === true ||
    readArgs.maxLines !== undefined ||
    readArgs.offsetLines > 0

  if (!partial) {
    map.set(filePath, {
      content: result.content,
      timestamp: Math.floor(result.mtimeMs),
    })
    return
  }

  map.set(filePath, {
    content: result.content,
    timestamp: Math.floor(result.mtimeMs),
    offset: readArgs.offsetLines,
    limit: readArgs.maxLines,
    isPartialView: true,
  })
}

/**
 * For tools that read the full file with {@link readFileSyncWithMetadata} / {@link readFileSync}.
 */
export function setStateFromFullRead(
  map: FileReadStateMap,
  filePath: string,
  content: string,
  mtimeMs: number,
): void {
  map.set(filePath, {
    content,
    timestamp: Math.floor(mtimeMs),
  })
}
