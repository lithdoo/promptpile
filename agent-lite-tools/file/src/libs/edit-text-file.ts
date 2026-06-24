import { mkdirSync, statSync } from 'fs'
import { dirname } from 'path'
import { readFileSyncWithMetadata } from './file-read-sync'
import { getFileModificationTime } from './get-mtime'
import { writeTextFile } from './write-file'
import { writeTextContent } from './write-text-content'
import type { FileReadStateMap } from './file-read-state'
import { isFullFileReadState } from './file-read-state'
import { expandPathForWrite } from './path-resolve'
import {
  fileEditAmbiguousError,
  FILE_DOES_NOT_EXIST_ERROR,
  FILE_EDIT_CREATE_EXISTS_ERROR,
  FILE_EDIT_SAME_STRING_ERROR,
  FILE_EDIT_NOTEBOOK_ERROR,
} from './file-edit-constants'
import {
  findActualString,
  preserveQuoteStyle,
} from './file-edit-text'
import { getPatchForEdit } from './get-patch-for-edit'
import {
  FILE_MODIFIED_SINCE_READ_ERROR,
  FILE_NOT_READ_YET_ERROR,
  FILE_UNEXPECTEDLY_MODIFIED_ERROR,
} from './file-write-constants'
import type { StructuredPatchHunk } from './patch-from-contents'

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

export type EditTextFileInput = {
  old_string: string
  new_string: string
  replace_all?: boolean
}

export type EditTextFileResult = {
  filePath: string
  oldString: string
  actualOldString: string
  newString: string
  actualNewString: string
  originalFile: string
  updatedFile: string
  structuredPatch: StructuredPatchHunk[]
  replaceAll: boolean
  kind: 'create' | 'update'
}

/**
 * String replace in a file with Claude `Edit` tool–style guards (`readFileState`, mtime).
 * New files: `old_string === ''` and path missing; existing files need a full-file read in state.
 */
export function editTextFile(
  filePath: string,
  input: EditTextFileInput,
  options: {
    readFileState: FileReadStateMap
    cwd?: string
    signal?: AbortSignal
  },
): EditTextFileResult {
  const { readFileState, cwd, signal } = options
  const { old_string, new_string, replace_all: replaceAllIn = false } = input
  const replaceAll = replaceAllIn === true
  signal?.throwIfAborted()

  if (old_string === new_string) {
    throw new Error(FILE_EDIT_SAME_STRING_ERROR)
  }

  const fullPath = expandPathForWrite(filePath, cwd)
  if (!fullPath) {
    throw new Error('Empty file path after path expansion')
  }

  if (fullPath.toLowerCase().endsWith('.ipynb')) {
    throw new Error(FILE_EDIT_NOTEBOOK_ERROR)
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

  if (meta === null) {
    if (old_string !== '') {
      throw new Error(FILE_DOES_NOT_EXIST_ERROR)
    }
    const wr = writeTextFile(fullPath, new_string, {
      readFileState,
      cwd,
      signal,
    })
    const { patch, updatedFile: uf } = getPatchForEdit({
      filePath: fullPath,
      fileContents: '',
      oldString: '',
      newString: new_string,
      replaceAll: false,
    })
    return {
      filePath: fullPath,
      oldString: old_string,
      actualOldString: '',
      newString: new_string,
      actualNewString: new_string,
      originalFile: '',
      updatedFile: uf,
      structuredPatch: patch,
      replaceAll: false,
      kind: wr.kind,
    }
  }

  if (old_string === '' && meta.content.trim() !== '') {
    throw new Error(FILE_EDIT_CREATE_EXISTS_ERROR)
  }

  {
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

  const originalFileContents = meta.content
  const enc = meta.encoding
  const endings = meta.lineEndings

  const actualOldString =
    old_string === ''
      ? ''
      : findActualString(originalFileContents, old_string)
  if (old_string !== '' && actualOldString == null) {
    throw new Error(
      `String to replace not found in file.\nString: ${old_string}`,
    )
  }

  const actualNewString = preserveQuoteStyle(
    old_string,
    old_string === '' ? '' : actualOldString!,
    new_string,
  )

  const searchIn =
    old_string === '' ? '' : (actualOldString as string)
  if (old_string !== '') {
    const matches = originalFileContents.split(searchIn).length - 1
    if (matches > 1 && !replaceAll) {
      throw new Error(fileEditAmbiguousError(matches, old_string))
    }
  }

  const { patch, updatedFile } = getPatchForEdit({
    filePath: fullPath,
    fileContents: originalFileContents,
    oldString: searchIn,
    newString: actualNewString,
    replaceAll,
  })

  writeTextContent(fullPath, updatedFile, enc, endings)

  readFileState.set(fullPath, {
    content: updatedFile,
    timestamp: getFileModificationTime(fullPath),
  })

  return {
    filePath: fullPath,
    oldString: old_string,
    actualOldString: old_string === '' ? '' : (actualOldString as string),
    newString: new_string,
    actualNewString,
    originalFile: originalFileContents,
    updatedFile,
    structuredPatch: patch,
    replaceAll,
    kind: 'update',
  }
}
