import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import {
  editTextFile,
  findActualString,
  readFileInRange,
  setStateFromReadInRange,
  FILE_MODIFIED_SINCE_READ_ERROR,
  FILE_NOT_READ_YET_ERROR,
  FILE_DOES_NOT_EXIST_ERROR,
  FILE_EDIT_CREATE_EXISTS_ERROR,
  FILE_EDIT_NOTEBOOK_ERROR,
  FILE_EDIT_SAME_STRING_ERROR,
} from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-ed-'))
}

test('findActualString: matches curly quotes in file when model uses straight', () => {
  const s = 'Say \u2018hello\u2019'
  const found = findActualString(s, "'hello'")
  assert.ok(found)
  assert.equal(found, '\u2018hello\u2019')
})

test('editTextFile: rejects old_string same as new_string', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  const state = new Map()
  assert.throws(
    () =>
      editTextFile(fp, { old_string: 'x', new_string: 'x' }, { readFileState: state }),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_EDIT_SAME_STRING_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: .ipynb path rejected', () => {
  const state = new Map()
  const ipynb = path.join(tmpDir(), 'n.ipynb')
  try {
    assert.throws(
      () =>
        editTextFile(
          ipynb,
          { old_string: 'a', new_string: 'b' },
          { readFileState: state },
        ),
      (e: unknown) =>
        e instanceof Error && e.message === FILE_EDIT_NOTEBOOK_ERROR,
    )
  } finally {
    try {
      fs.rmSync(path.dirname(ipynb), { recursive: true })
    } catch {
      // ignore
    }
  }
})

test('editTextFile: missing file and non-empty old_string', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'missing.txt')
  const state = new Map()
  assert.throws(
    () =>
      editTextFile(fp, { old_string: 'a', new_string: 'b' }, { readFileState: state }),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_DOES_NOT_EXIST_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: create file with empty old_string', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'new.txt')
  const state = new Map()
  const r = editTextFile(
    fp,
    { old_string: '', new_string: 'body\n' },
    { readFileState: state },
  )
  assert.equal(r.kind, 'create')
  assert.equal(fs.readFileSync(fp, 'utf8'), 'body\n')
  assert.equal(state.get(r.filePath)!.content, 'body\n')
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: empty old_string on existing non-empty file', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'x', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })
  assert.throws(
    () =>
      editTextFile(fp, { old_string: '', new_string: 'nope' }, { readFileState: state }),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_EDIT_CREATE_EXISTS_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: rejects existing file never read', () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'e.txt')
  fs.writeFileSync(fp, 'ab\n', 'utf8')
  const state = new Map()
  assert.throws(
    () => editTextFile(fp, { old_string: 'a', new_string: 'z' }, { readFileState: state }),
    (e: unknown) => e instanceof Error && e.message === FILE_NOT_READ_YET_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: update after full read', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'e.txt')
  fs.writeFileSync(fp, 'one\ntwo\n', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })
  const r = editTextFile(
    fp,
    { old_string: 'one', new_string: '1' },
    { readFileState: state },
  )
  assert.equal(r.kind, 'update')
  assert.equal(r.actualOldString, 'one')
  assert.equal(fs.readFileSync(fp, 'utf8'), '1\ntwo\n')
  assert.equal(state.get(path.resolve(fp))!.content, '1\ntwo\n')
  assert.ok(Array.isArray(r.structuredPatch))
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: replace_all', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'm.txt')
  fs.writeFileSync(fp, 'a|a|', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })
  editTextFile(
    fp,
    { old_string: 'a', new_string: 'Z', replace_all: true },
    { readFileState: state },
  )
  assert.equal(fs.readFileSync(fp, 'utf8'), 'Z|Z|')
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: multiple matches without replace_all', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'm2.txt')
  fs.writeFileSync(fp, 'xx', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })
  assert.throws(
    () =>
      editTextFile(
        fp,
        { old_string: 'x', new_string: 'y', replace_all: false },
        { readFileState: state },
      ),
    (e: unknown) =>
      e instanceof Error && (e as Error).message.includes('Found 2 matches'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('editTextFile: rejects when content changed on disk after read (mtime)', async () => {
  const dir = tmpDir()
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'v1\n', 'utf8')
  const range = await readFileInRange(fp, 0, undefined, undefined)
  const state = new Map()
  setStateFromReadInRange(state, path.resolve(fp), range, {
    offsetLines: 0,
    maxLines: undefined,
  })
  fs.appendFileSync(fp, 'x', 'utf8')
  assert.throws(
    () =>
      editTextFile(
        fp,
        { old_string: 'v1', new_string: 'z' },
        { readFileState: state },
      ),
    (e: unknown) =>
      e instanceof Error && e.message === FILE_MODIFIED_SINCE_READ_ERROR,
  )
  fs.rmSync(dir, { recursive: true })
})
