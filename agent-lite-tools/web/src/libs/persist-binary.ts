import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP_DIR_NAME = 'agent-lite-webfetch'

function extensionForMime(contentType: string): string {
  const normalized = contentType.split(';')[0].trim().toLowerCase()
  if (normalized === 'application/pdf') return '.pdf'
  if (normalized === 'image/png') return '.png'
  if (normalized === 'image/jpeg') return '.jpg'
  if (normalized === 'image/webp') return '.webp'
  if (normalized === 'image/gif') return '.gif'
  if (normalized === 'application/json') return '.json'
  if (normalized === 'application/zip') return '.zip'
  return '.bin'
}

export type PersistBinaryResult = {
  persistedPath: string
  persistedSize: number
  persistedMimeType: string
}

export async function persistBinaryToTmp(
  buffer: Buffer,
  contentType: string,
): Promise<PersistBinaryResult> {
  const dir = path.join(os.tmpdir(), TMP_DIR_NAME)
  await fs.promises.mkdir(dir, { recursive: true })
  const ext = extensionForMime(contentType)
  const name = `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`
  const filePath = path.join(dir, name)
  await fs.promises.writeFile(filePath, buffer)
  return {
    persistedPath: filePath,
    persistedSize: buffer.length,
    persistedMimeType: contentType || 'application/octet-stream',
  }
}
