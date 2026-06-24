import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createFileTools } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-fet-'))
}

test('edit tool: name and requires readFileState', async () => {
  const dir = tmpDir()
  const { editFileTool } = createFileTools({ roots: [dir] })
  assert.equal(editFileTool.name, 'Edit')
  const fp = path.join(dir, 'n.txt')
  await assert.rejects(
    () =>
      editFileTool.execute(
        { file_path: fp, old_string: 'a', new_string: 'b' },
        {},
      ),
    (e: unknown) =>
      e instanceof Error && e.message.includes('requires context.readFileState'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('edit tool: read + edit with shared readFileState', async () => {
  const dir = tmpDir()
  const { readFileTool, editFileTool } = createFileTools({ roots: [dir] })
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'old\n', 'utf8')
  const readFileState = new Map()
  const cwd = dir
  await readFileTool.execute(
    { file_path: 'a.txt' },
    { readFileState, cwd },
  )
  const w = await editFileTool.execute(
    { file_path: 'a.txt', old_string: 'old', new_string: 'new' },
    { readFileState, cwd },
  )
  assert.equal(w.kind, 'update')
  assert.equal(fs.readFileSync(fp, 'utf8'), 'new\n')
  const keys = [...readFileState.keys()]
  assert.equal(readFileState.get(keys[0])!.content, 'new\n')
  fs.rmSync(dir, { recursive: true })
})

test('edit tool: missing file_path or strings', async () => {
  const dir = tmpDir()
  const { editFileTool } = createFileTools({ roots: [dir] })
  const readFileState = new Map()
  await assert.rejects(
    () => editFileTool.execute({ old_string: 'a', new_string: 'b' }, { readFileState }),
    /Missing file_path/,
  )
  const fp = path.join(dir, 'x.txt')
  await assert.rejects(
    () => editFileTool.execute({ file_path: fp, new_string: 'b' }, { readFileState }),
    /Missing old_string/,
  )
  await assert.rejects(
    () => editFileTool.execute({ file_path: fp, old_string: 'a' }, { readFileState }),
    /Missing new_string/,
  )
  fs.rmSync(dir, { recursive: true })
})

test('edit tool: denies paths outside configured roots', async () => {
  const allowed = tmpDir()
  const blocked = tmpDir()
  const blockedFile = path.join(blocked, 'a.txt')
  fs.writeFileSync(blockedFile, 'old\n', 'utf8')

  const tools = createFileTools({ roots: [allowed] })
  const readFileState = new Map()

  await assert.rejects(
    () =>
      tools.editFileTool.execute(
        { file_path: blockedFile, old_string: 'old', new_string: 'new' },
        { readFileState },
      ),
    /outside configured roots/,
  )

  fs.rmSync(allowed, { recursive: true })
  fs.rmSync(blocked, { recursive: true })
})
