import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  writeTextFile,
  readFileInRange,
  setStateFromReadInRange,
  getFileModificationTime,
  FILE_NOT_READ_YET_ERROR,
  FILE_MODIFIED_SINCE_READ_ERROR,
} from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-wr-'))
}

test('writeTextFile: create new file and update readFileState', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'new.txt')
  const state = new Map()
  const r = writeTextFile(fp, 'hello', { readFileState: state })
  assert.equal(r.kind, 'create')
  assert.equal(r.previousContent, null)
  assert.equal(fs.readFileSync(fp, 'utf8'), 'hello')
  const e = state.get(r.filePath)
  assert.ok(e)
  assert.equal((e as { content: string }).content, 'hello')
  assert.equal(
    (e as { timestamp: number }).timestamp,
    getFileModificationTime(r.filePath),
  )
  fs.rmSync(dir, { recursive: true })
})

test('writeTextFile: update after full read via setStateFromReadInRange', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'v1\n', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })

  const w = writeTextFile(fp, 'v2\n', { readFileState: state })
  assert.equal(w.kind, 'update')
  assert.equal(w.previousContent, 'v1\n')
  assert.equal(fs.readFileSync(fp, 'utf8'), 'v2\n')
  assert.equal(state.get(path.resolve(fp))!.content, 'v2\n')
  fs.rmSync(dir, { recursive: true })
})

test('writeTextFile: rejects if existing file never read', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'x.txt')
  fs.writeFileSync(fp, 'a\n', 'utf8')
  const state = new Map()
  assert.throws(
    () => writeTextFile(fp, 'b\n', { readFileState: state }),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_NOT_READ_YET_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})

test('writeTextFile: rejects if read was partial (line slice)', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'l0\nl1\nl2\n', 'utf8')
  const range = await readFileInRange(fp, 0, 1, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: 1,
  })
  assert.throws(
    () => writeTextFile(fp, 'x\n', { readFileState: state }),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_NOT_READ_YET_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})

test('writeTextFile: rejects when file changed on disk after read (mtime)', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'v1\n', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })
  fs.appendFileSync(fp, 'extern\n', 'utf8')
  assert.throws(
    () => writeTextFile(fp, 'hacked\n', { readFileState: state }),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_MODIFIED_SINCE_READ_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})
