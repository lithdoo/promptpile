/**
 * Minimal fs surface for `safeResolvePath` and sync file reads (ported from
 * Claude Code `fsOperations.safeResolvePath` + default `readSync`).
 */
import * as fs from 'fs'
import type { Stats } from 'fs'

export type FileReadSyncFs = {
  lstatSync(path: string): Stats
  realpathSync(path: string): string
  readFileSync(path: string, options: { encoding: BufferEncoding }): string
  readSync(
    path: string,
    options: { length: number },
  ): { buffer: Buffer; bytesRead: number }
}

export function safeResolvePath(
  fsImpl: FileReadSyncFs,
  filePath: string,
): { resolvedPath: string; isSymlink: boolean; isCanonical: boolean } {
  if (filePath.startsWith('//') || filePath.startsWith('\\\\')) {
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }

  try {
    const stats = fsImpl.lstatSync(filePath)
    if (
      stats.isFIFO() ||
      stats.isSocket() ||
      stats.isCharacterDevice() ||
      stats.isBlockDevice()
    ) {
      return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
    }

    const resolvedPath = fsImpl.realpathSync(filePath)
    return {
      resolvedPath,
      isSymlink: resolvedPath !== filePath,
      isCanonical: true,
    }
  } catch {
    return { resolvedPath: filePath, isSymlink: false, isCanonical: false }
  }
}

function nodeReadSyncHead(
  fsPath: string,
  options: { length: number },
): { buffer: Buffer; bytesRead: number } {
  let fd: number | undefined
  try {
    fd = fs.openSync(fsPath, 'r')
    const buffer = Buffer.alloc(options.length)
    const bytesRead = fs.readSync(fd, buffer, 0, options.length, 0)
    return { buffer, bytesRead }
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

export const defaultFileReadSyncFs: FileReadSyncFs = {
  lstatSync: path => fs.lstatSync(path),
  realpathSync: path => fs.realpathSync(path),
  readFileSync: (path, options) => fs.readFileSync(path, options),
  readSync: nodeReadSyncHead,
}
