import assert from 'node:assert'
import { mkdtemp, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import { extractGlobBaseDirectory, globFiles } from '../dist/index.js'
import { rgAvailable } from './rg-skip'

test('extractGlobBaseDirectory splits static prefix', () => {
  const r = extractGlobBaseDirectory('src/**/*.ts')
  assert.strictEqual(r.baseDir, 'src')
  assert.strictEqual(r.relativePattern, '**/*.ts')
})

test('globFiles lists ts files', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'glob-lite-'))
  await mkdir(join(root, 'a'), { recursive: true })
  await writeFile(join(root, 'a', 'x.ts'), '//x\n', 'utf8')
  await writeFile(join(root, 'b.js'), '//b\n', 'utf8')
  const { files, truncated } = await globFiles('**/*.ts', root, {
    limit: 100,
    offset: 0,
    signal: AbortSignal.timeout(30_000),
  })
  assert.strictEqual(truncated, false)
  assert.ok(files.some(f => f.replace(/\\/g, '/').endsWith('a/x.ts')))
  assert.ok(!files.some(f => f.replace(/\\/g, '/').endsWith('b.js')))
})
