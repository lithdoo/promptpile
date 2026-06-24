import assert from 'node:assert'
import { mkdtemp, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import { createSearchTools } from '../dist/index.js'
import { rgAvailable } from './rg-skip'

test('globTool execute', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'glob-tool-'))
  await mkdir(join(root, 'sub'), { recursive: true })
  await writeFile(join(root, 'sub', 'z.ts'), '', 'utf8')
  const tools = createSearchTools()
  const out = await tools.globTool.execute({ pattern: '**/*.ts' }, { cwd: root })
  assert.strictEqual(out.truncated, false)
  assert.ok(out.numFiles >= 1)
  assert.ok(out.filenames.some(f => f.replace(/\\/g, '/').includes('sub/z.ts')))
})
