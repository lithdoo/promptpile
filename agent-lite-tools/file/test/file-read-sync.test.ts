import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  readFileSyncWithMetadata,
  readFileSync,
  detectLineEndingsForString,
} from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-fs-'))
}

test('detectLineEndingsForString: CRLF wins when more CRLF', () => {
  assert.equal(detectLineEndingsForString('a\r\nb\r\nc\n'), 'CRLF')
})

test('readFileSyncWithMetadata: CRLF content normalized, lineEndings CRLF', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'x.txt')
  fs.writeFileSync(fp, 'a\r\nb\r\n', 'utf8')
  const meta = readFileSyncWithMetadata(fp)
  assert.equal(meta.content, 'a\nb\n')
  assert.equal(meta.lineEndings, 'CRLF')
  assert.equal(meta.encoding, 'utf8')
  fs.rmSync(dir, { recursive: true })
})

test('readFileSync: returns content only', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'y.txt')
  fs.writeFileSync(fp, 'ok\n', 'utf8')
  assert.equal(readFileSync(fp), 'ok\n')
  fs.rmSync(dir, { recursive: true })
})

test('readFileSyncWithMetadata: onSymlinkTraverse when symlink', () => {
  const dir = tmpDir()
  const target = path.join(dir, 'target.txt')
  const link = path.join(dir, 'link.txt')
  fs.writeFileSync(target, 'hi\n', 'utf8')
  try {
    fs.symlinkSync(target, link)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err && err.code === 'EPERM') {
      fs.rmSync(dir, { recursive: true })
      return
    }
    throw e
  }
  let msg = ''
  readFileSyncWithMetadata(link, {
    onSymlinkTraverse: m => {
      msg = m
    },
  })
  assert.match(msg, /Reading through symlink/)
  fs.rmSync(dir, { recursive: true })
})
