import { mkdirSync, statSync } from 'fs'
import { dirname } from 'path'
import { readFileSyncWithMetadata } from './file-read-sync'
import { getFileModificationTime } from './get-mtime'
import { writeTextContent } from './write-text-content'
import type { FileReadStateMap } from './file-read-state'
import { isFullFileReadState } from './file-read-state'
import { expandPathForWrite } from './path-resolve'
import {
  FILE_MODIFIED_SINCE_READ_ERROR,
  FILE_NOT_READ_YET_ERROR,
  FILE_UNEXPECTEDLY_MODIFIED_ERROR,
} from './file-write-constants'

function isUncPath(p: string): boolean {
  return p.startsWith('\\\\') || p.startsWith('//')
}

function isEnoent(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

export type WriteTextFileResult = {
  kind: 'create' | 'update'
  filePath: string
  previousContent: string | null
}

/**
 * Write full file content with Claude FileWriteTool-style guards (read-before-write, mtime).
 * Pass the same `readFileState` map updated by read tools. New files (ENOENT) do not
 * require a prior read.
 */
export function writeTextFile(
  filePath: string,
  content: string,
  options: { readFileState: FileReadStateMap; cwd?: string; signal?: AbortSignal },
): WriteTextFileResult {
  const { readFileState, cwd, signal } = options
  signal?.throwIfAborted()

  const fullPath = expandPathForWrite(filePath, cwd)
  if (!fullPath) {
    throw new Error('Empty file path after path expansion')
  }

  if (!isUncPath(fullPath)) {
    let exists = false
    let fileMtimeMs = 0
    try {
      const st = statSync(fullPath)
      if (!st.isFile()) {
        throw new Error(`EISDIR or not a file: ${fullPath}`)
      }
      exists = true
      fileMtimeMs = Math.floor(st.mtimeMs)
    } catch (e) {
      if (!isEnoent(e)) {
        throw e
      }
    }

    if (exists) {
      const readRec = readFileState.get(fullPath)
      if (!readRec || readRec.isPartialView || !isFullFileReadState(readRec)) {
        throw new Error(FILE_NOT_READ_YET_ERROR)
      }
      const lastWriteTime = fileMtimeMs
      if (lastWriteTime > readRec.timestamp) {
        throw new Error(FILE_MODIFIED_SINCE_READ_ERROR)
      }
    }
  }

  const dir = dirname(fullPath)
  mkdirSync(dir, { recursive: true })

  let meta: ReturnType<typeof readFileSyncWithMetadata> | null
  try {
    meta = readFileSyncWithMetadata(fullPath)
  } catch (e) {
    if (isEnoent(e)) {
      meta = null
    } else {
      throw e
    }
  }

  if (meta !== null) {
    const lastWriteTime = getFileModificationTime(fullPath)
    const lastRead = readFileState.get(fullPath)
    if (!lastRead || lastWriteTime > lastRead.timestamp) {
      const isFullRead =
        lastRead != null &&
        lastRead.offset === undefined &&
        lastRead.limit === undefined
      if (!isFullRead || meta.content !== lastRead.content) {
        throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
      }
    }
  }

  const oldContent = meta?.content ?? null
  const enc = meta?.encoding ?? 'utf8'

  writeTextContent(fullPath, content, enc, 'LF')

  readFileState.set(fullPath, {
    content,
    timestamp: getFileModificationTime(fullPath),
  })

  return {
    kind: oldContent === null ? 'create' : 'update',
    filePath: fullPath,
    previousContent: oldContent,
  }
}
