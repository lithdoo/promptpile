import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { readFileInRange, FileTooLargeError } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-'))
}

test('readFileInRange: full file, line counts, no trailing newline', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'a\nb\nc', 'utf8')
  const r = await readFileInRange(fp, 0, undefined, undefined)
  assert.equal(r.content, 'a\nb\nc')
  assert.equal(r.lineCount, 3)
  assert.equal(r.totalLines, 3)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRange: CRLF normalized in content', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'crlf.txt')
  fs.writeFileSync(fp, 'x\r\ny\r\n', 'utf8')
  const r = await readFileInRange(fp, 0, undefined, undefined)
  assert.equal(r.content, 'x\ny\n')
  assert.equal(r.totalLines, 3)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRange: UTF-8 BOM stripped', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'bom.txt')
  const bom = Buffer.from([0xef, 0xbb, 0xbf])
  fs.writeFileSync(fp, Buffer.concat([bom, Buffer.from('hello\n', 'utf8')]))
  const r = await readFileInRange(fp, 0, undefined, undefined)
  assert.equal(r.content, 'hello\n')
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRange: offset and limit (0-based line offset)', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'lines.txt')
  fs.writeFileSync(fp, 'L0\nL1\nL2\nL3\n', 'utf8')
  const r = await readFileInRange(fp, 1, 2, undefined)
  assert.equal(r.content, 'L1\nL2')
  assert.equal(r.lineCount, 2)
  assert.equal(r.totalLines, 5)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRange: FileTooLargeError when file exceeds maxBytes', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'big.txt')
  fs.writeFileSync(fp, 'x'.repeat(200), 'utf8')
  await assert.rejects(
    () => readFileInRange(fp, 0, undefined, 100),
    (e: unknown) => e instanceof FileTooLargeError,
  )
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRange: truncateOnByteLimit caps output', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 't.txt')
  fs.writeFileSync(fp, 'short\nlines\nhere\n', 'utf8')
  const r = await readFileInRange(fp, 0, 10, 12, undefined, {
    truncateOnByteLimit: true,
  })
  assert.equal(r.truncatedByBytes, true)
  assert.ok(r.content.length > 0)
  fs.rmSync(dir, { recursive: true })
})

test('readFileInRange: EISDIR for directory path', async () => {
  const dir = tmpDir()
  await assert.rejects(
    () => readFileInRange(dir, 0, undefined, undefined),
    /EISDIR/,
  )
  fs.rmSync(dir, { recursive: true })
})
