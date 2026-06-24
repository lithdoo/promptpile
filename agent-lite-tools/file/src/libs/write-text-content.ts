import { writeFileSync } from 'fs'
import type { LineEndingType } from './file-read-sync'

/**
 * Text write with optional CRLF line endings; `LF` writes `content` as-is (Claude
 * `writeTextContent` with `endings === 'LF'`).
 */
export function writeTextContent(
  filePath: string,
  content: string,
  encoding: BufferEncoding,
  lineEndings: LineEndingType,
): void {
  let toWrite = content
  if (lineEndings === 'CRLF') {
    toWrite = content.replace(/\r\n/g, '\n').split('\n').join('\r\n')
  }
  writeFileSync(filePath, toWrite, { encoding })
}
