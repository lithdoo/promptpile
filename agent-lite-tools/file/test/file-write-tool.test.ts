import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

import { createFileTools } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-fwt-'))
}

test('write tool: name and requires readFileState', async () => {
  const dir = tmpDir()
  const { writeFileTool } = createFileTools({ roots: [dir] })
  assert.equal(writeFileTool.name, 'Write')
  const fp = path.join(dir, 'n.txt')
  await assert.rejects(
    () => writeFileTool.execute({ file_path: fp, content: 'a' }, {}),
    (e: unknown) =>
      e instanceof Error && e.message.includes('requires context.readFileState'),
  )
  fs.rmSync(dir, { recursive: true })
})

test('write tool: read + write with shared readFileState', async () => {
  const dir = tmpDir()
  const { readFileTool, writeFileTool } = createFileTools({ roots: [dir] })
  const fp = path.join(dir, 'a.txt')
  fs.writeFileSync(fp, 'old\n', 'utf8')
  const readFileState = new Map()
  const cwd = dir
  await readFileTool.execute(
    { file_path: 'a.txt' },
    { readFileState, cwd },
  )
  const w = (await writeFileTool.execute(
    { file_path: 'a.txt', content: 'new\n' },
    { readFileState, cwd },
  )) as { kind: string; previousContent: string }
  assert.equal(w.kind, 'update')
  assert.equal(w.previousContent, 'old\n')
  assert.equal(fs.readFileSync(fp, 'utf8'), 'new\n')
  const keys = [...readFileState.keys()]
  assert.equal(keys.length, 1)
  assert.equal(readFileState.get(keys[0])!.content, 'new\n')
  fs.rmSync(dir, { recursive: true })
})

test('write tool: missing file_path or content', async () => {
  const dir = tmpDir()
  const { writeFileTool } = createFileTools({ roots: [dir] })
  const readFileState = new Map()
  await assert.rejects(
    () => writeFileTool.execute({ content: 'a' }, { readFileState }),
    /Missing file_path/,
  )
  const fp = path.join(dir, 'x.txt')
  await assert.rejects(
    () => writeFileTool.execute({ file_path: fp }, { readFileState }),
    /Missing content/,
  )
  fs.rmSync(dir, { recursive: true })
})

test('write tool: setRoots updates authorization at runtime', async () => {
  const allowed = tmpDir()
  const nextAllowed = tmpDir()
  const fileA = path.join(allowed, 'a.txt')
  const fileB = path.join(nextAllowed, 'b.txt')
  fs.writeFileSync(fileA, 'a\n', 'utf8')
  fs.writeFileSync(fileB, 'b\n', 'utf8')

  const readFileState = new Map()
  const tools = createFileTools({ roots: [allowed] })
  await tools.readFileTool.execute({ file_path: fileA }, { readFileState })
  await tools.writeFileTool.execute(
    { file_path: fileA, content: 'a2\n' },
    { readFileState },
  )

  tools.setRoots([nextAllowed])
  await assert.rejects(
    () =>
      tools.writeFileTool.execute(
        { file_path: fileA, content: 'a3\n' },
        { readFileState },
      ),
    /outside configured roots/,
  )

  await tools.readFileTool.execute({ file_path: fileB }, { readFileState })
  await tools.writeFileTool.execute(
    { file_path: fileB, content: 'b2\n' },
    { readFileState },
  )

  fs.rmSync(allowed, { recursive: true })
  fs.rmSync(nextAllowed, { recursive: true })
})
