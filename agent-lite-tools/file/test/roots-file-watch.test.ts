import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createFileTools } from '../dist/index.js'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'a-tools-roots-file-'))
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('setRootsFile: loads roots file and allows relative paths', async () => {
  const base = tmpDir()
  const project = path.join(base, 'project')
  fs.mkdirSync(project, { recursive: true })
  const rootsFile = path.join(base, 'roots.txt')
  fs.writeFileSync(rootsFile, './project\n', 'utf8')

  const tools = createFileTools()
  await tools.setRootsFile(rootsFile)

  const inside = path.join(project, 'a.txt')
  fs.writeFileSync(inside, 'ok\n', 'utf8')
  const r = (await tools.readFileTool.execute({ file_path: inside }, {})) as {
    content: string
  }
  assert.equal(r.content, 'ok\n')

  await tools.dispose()
  fs.rmSync(base, { recursive: true })
})

test('setRoots + setRootsFile: permissions are unioned', async () => {
  const manual = tmpDir()
  const fromFile = tmpDir()
  const rootsConfigDir = tmpDir()
  const rootsFile = path.join(rootsConfigDir, 'roots.txt')
  fs.writeFileSync(rootsFile, `${fromFile}\n`, 'utf8')

  const tools = createFileTools({ roots: [manual] })
  await tools.setRootsFile(rootsFile)

  const manualFile = path.join(manual, 'm.txt')
  const fileFile = path.join(fromFile, 'f.txt')
  fs.writeFileSync(manualFile, 'm\n', 'utf8')
  fs.writeFileSync(fileFile, 'f\n', 'utf8')

  await tools.readFileTool.execute({ file_path: manualFile }, {})
  await tools.readFileTool.execute({ file_path: fileFile }, {})

  await tools.dispose()
  fs.rmSync(manual, { recursive: true })
  fs.rmSync(fromFile, { recursive: true })
  fs.rmSync(rootsConfigDir, { recursive: true })
})

test('roots file watcher: change, unlink, add update permissions', async () => {
  const r1 = tmpDir()
  const r2 = tmpDir()
  const cfg = tmpDir()
  const rootsFile = path.join(cfg, 'roots.txt')
  fs.writeFileSync(rootsFile, `${r1}\n`, 'utf8')

  const tools = createFileTools()
  await tools.setRootsFile(rootsFile)

  const file1 = path.join(r1, 'x.txt')
  const file2 = path.join(r2, 'y.txt')
  fs.writeFileSync(file1, 'x\n', 'utf8')
  fs.writeFileSync(file2, 'y\n', 'utf8')

  await tools.readFileTool.execute({ file_path: file1 }, {})
  await assert.rejects(
    () => tools.readFileTool.execute({ file_path: file2 }, {}),
    /outside configured roots/,
  )

  fs.writeFileSync(rootsFile, `${r2}\n`, 'utf8')
  await sleep(350)
  await assert.rejects(
    () => tools.readFileTool.execute({ file_path: file1 }, {}),
    /outside configured roots/,
  )
  await tools.readFileTool.execute({ file_path: file2 }, {})

  fs.rmSync(rootsFile, { force: true })
  await sleep(350)
  await assert.rejects(
    () => tools.readFileTool.execute({ file_path: file2 }, {}),
    /no roots configured/,
  )

  fs.writeFileSync(rootsFile, `${r1}\n`, 'utf8')
  await sleep(350)
  await tools.readFileTool.execute({ file_path: file1 }, {})

  await tools.dispose()
  fs.rmSync(r1, { recursive: true })
  fs.rmSync(r2, { recursive: true })
  fs.rmSync(cfg, { recursive: true })
})

test('dispose: watcher stops reacting after disposal', async () => {
  const allowed = tmpDir()
  const blocked = tmpDir()
  const cfg = tmpDir()
  const rootsFile = path.join(cfg, 'roots.txt')
  fs.writeFileSync(rootsFile, `${allowed}\n`, 'utf8')

  const tools = createFileTools()
  await tools.setRootsFile(rootsFile)
  await tools.dispose()

  fs.writeFileSync(rootsFile, `${blocked}\n`, 'utf8')
  await sleep(350)

  const allowedFile = path.join(allowed, 'a.txt')
  fs.writeFileSync(allowedFile, 'a\n', 'utf8')
  await tools.readFileTool.execute({ file_path: allowedFile }, {})

  const blockedFile = path.join(blocked, 'b.txt')
  fs.writeFileSync(blockedFile, 'b\n', 'utf8')
  await assert.rejects(
    () => tools.readFileTool.execute({ file_path: blockedFile }, {}),
    /outside configured roots/,
  )

  fs.rmSync(allowed, { recursive: true })
  fs.rmSync(blocked, { recursive: true })
  fs.rmSync(cfg, { recursive: true })
})

