import assert from 'node:assert'
import { mkdtemp, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import { runRipgrep } from '../dist/index.js'
import { rgAvailable } from './rg-skip'

test('runRipgrep returns lines', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'rg-lite-'))
  await writeFile(join(root, 'f.txt'), 'hello world\n', 'utf8')
  const lines = await runRipgrep(['--files', '--glob', '*.txt'], root, {
    cwd: root,
    timeoutMs: 10_000,
  })
  assert.ok(lines.some(l => l.includes('f.txt') || l.endsWith('f.txt')))
})
