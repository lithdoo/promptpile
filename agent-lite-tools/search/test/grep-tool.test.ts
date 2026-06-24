import assert from 'node:assert'
import { mkdtemp, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { test } from 'node:test'
import { createSearchTools } from '../dist/index.js'
import { rgAvailable } from './rg-skip'

test('grepTool files_with_matches', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'grep-fw-'))
  await writeFile(join(root, 'a.txt'), 'needle here\n', 'utf8')
  const tools = createSearchTools()
  const out = await tools.grepTool.execute(
    { pattern: 'needle', output_mode: 'files_with_matches' },
    { cwd: root },
  )
  assert.strictEqual(out.mode, 'files_with_matches')
  assert.ok(out.numFiles >= 1)
  assert.ok(out.filenames.some(f => f.replace(/\\/g, '/').endsWith('a.txt')))
})

test('grepTool content mode with -i', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'grep-co-'))
  await writeFile(join(root, 'b.txt'), 'FooBar\n', 'utf8')
  const tools = createSearchTools()
  const out = await tools.grepTool.execute(
    { pattern: 'foo', output_mode: 'content', '-i': true, head_limit: 10 },
    { cwd: root },
  )
  assert.strictEqual(out.mode, 'content')
  assert.ok((out.content || '').toLowerCase().includes('foobar'))
})

test('grepTool count mode', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'grep-ct-'))
  await writeFile(join(root, 'c.txt'), 'x\nx\n', 'utf8')
  const tools = createSearchTools()
  const out = await tools.grepTool.execute(
    { pattern: 'x', output_mode: 'count', path: root },
    { cwd: root },
  )
  assert.strictEqual(out.mode, 'count')
  assert.ok((out.numMatches ?? 0) >= 1)
})

test('grepTool pattern starting with dash uses -e', async t => {
  if (!(await rgAvailable())) {
    t.skip('rg not on PATH')
    return
  }
  const root = await mkdtemp(join(tmpdir(), 'grep-dash-'))
  await writeFile(join(root, 'd.txt'), '-edge\n', 'utf8')
  const tools = createSearchTools()
  const out = await tools.grepTool.execute(
    { pattern: '-edge', output_mode: 'files_with_matches' },
    { cwd: root },
  )
  assert.ok(out.filenames.length >= 1)
})
