/**
 * Sync full-file read with encoding + line-ending metadata (ported from Claude
 * Code `src/utils/fileRead.ts`). `logForDebugging` replaced with optional callback.
 */
import {
  type FileReadSyncFs,
  defaultFileReadSyncFs,
  safeResolvePath,
} from './fs-operations-minimal'

export type LineEndingType = 'CRLF' | 'LF'

export function detectEncodingForResolvedPath(
  resolvedPath: string,
  fsImpl: FileReadSyncFs = defaultFileReadSyncFs,
): BufferEncoding {
  const { buffer, bytesRead } = fsImpl.readSync(resolvedPath, {
    length: 4096,
  })

  if (bytesRead === 0) {
    return 'utf8'
  }

  if (bytesRead >= 2) {
    if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf16le'
  }

  if (
    bytesRead >= 3 &&
    buffer[0] === 0xef &&
    buffer[1] === 0xbb &&
    buffer[2] === 0xbf
  ) {
    return 'utf8'
  }

  return 'utf8'
}

export function detectLineEndingsForString(content: string): LineEndingType {
  let crlfCount = 0
  let lfCount = 0

  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') {
      if (i > 0 && content[i - 1] === '\r') {
        crlfCount++
      } else {
        lfCount++
      }
    }
  }

  return crlfCount > lfCount ? 'CRLF' : 'LF'
}

export type ReadFileSyncWithMetadataOptions = {
  /** Override fs (e.g. tests); defaults to Node `fs`. */
  fs?: FileReadSyncFs
  /** Called when reading through a symlink (replaces Claude `logForDebugging`). */
  onSymlinkTraverse?: (message: string) => void
}

export function readFileSyncWithMetadata(
  filePath: string,
  options?: ReadFileSyncWithMetadataOptions,
): {
  content: string
  encoding: BufferEncoding
  lineEndings: LineEndingType
} {
  const fsImpl = options?.fs ?? defaultFileReadSyncFs
  const { resolvedPath, isSymlink } = safeResolvePath(fsImpl, filePath)

  if (isSymlink) {
    options?.onSymlinkTraverse?.(
      `Reading through symlink: ${filePath} -> ${resolvedPath}`,
    )
  }

  const encoding = detectEncodingForResolvedPath(resolvedPath, fsImpl)
  const raw = fsImpl.readFileSync(resolvedPath, { encoding })
  const lineEndings = detectLineEndingsForString(raw.slice(0, 4096))
  return {
    content: raw.replace(/\r\n/g, '\n'),
    encoding,
    lineEndings,
  }
}

export function readFileSync(filePath: string): string {
  return readFileSyncWithMetadata(filePath).content
}
