import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { createSearchTools } from '../dist/index.js'
import { rgAvailable } from './rg-skip'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(assertion: () => Promise<void>, attempts = 10, delayMs = 120) {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      await assertion()
      return
    } catch (err) {
      lastErr = err
      await sleep(delayMs)
    }
  }
  throw lastErr
}

test('setIgnoreRules excludes matches', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'search-ignore-rules-'))
  try {
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist', 'a.ts'), 'x\n', 'utf8')
    await writeFile(join(root, 'src.ts'), 'x\n', 'utf8')

    const tools = createSearchTools()
    tools.setIgnoreRules(['dist/**'])
    const out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
    assert.ok(out.filenames.some(f => f.endsWith('src.ts')))
    assert.ok(!out.filenames.some(f => f.includes('dist')))
    await tools.dispose()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('setIgnoreFile watches change/unlink/add and unions with manual rules', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'search-ignore-file-'))
  const tools = createSearchTools({ ignoreRules: ['tmp/**'] })
  try {
    await mkdir(join(root, 'gen'), { recursive: true })
    await mkdir(join(root, 'tmp'), { recursive: true })
    await writeFile(join(root, 'gen', 'a.ts'), 'x\n', 'utf8')
    await writeFile(join(root, 'tmp', 'b.ts'), 'x\n', 'utf8')
    await writeFile(join(root, 'keep.ts'), 'x\n', 'utf8')

    const ignoreFile = join(root, '.search-ignore')
    await writeFile(ignoreFile, 'gen/**\n', 'utf8')

    await tools.setIgnoreFile(ignoreFile)

    let out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
    assert.ok(!out.filenames.some(f => f.includes('gen/')))
    assert.ok(!out.filenames.some(f => f.includes('tmp/')))
    assert.ok(out.filenames.some(f => f.endsWith('keep.ts')))

    await writeFile(ignoreFile, '', 'utf8')
    await waitFor(async () => {
      const sources = tools.getIgnoreSources()
      assert.equal(sources.file.length, 0)
      out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
      assert.ok(!out.filenames.some(f => f.includes('tmp/')))
    })

    await rm(ignoreFile, { force: true })
    await waitFor(async () => {
      const sources = tools.getIgnoreSources()
      assert.equal(sources.file.length, 0)
      out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
      assert.ok(!out.filenames.some(f => f.includes('tmp/')))
    })

    await writeFile(ignoreFile, 'gen/**\n', 'utf8')
    await waitFor(async () => {
      const sources = tools.getIgnoreSources()
      assert.ok(sources.file.some(p => p.includes('gen')))
      out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
      assert.ok(!out.filenames.some(f => f.includes('gen/')))
    })

    await tools.dispose()
    await writeFile(ignoreFile, '', 'utf8')
    await sleep(350)
    out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
    assert.ok(!out.filenames.some(f => f.includes('tmp/')))
    assert.ok(!out.filenames.some(f => f.includes('gen/')))
  } finally {
    await tools.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
