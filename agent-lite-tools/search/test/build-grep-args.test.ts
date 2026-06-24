import assert from 'node:assert'
import { test } from 'node:test'
import { buildGrepArgs } from '../dist/index.js'

test('buildGrepArgs includes pattern and VCS exclusions', () => {
  const args = buildGrepArgs({ pattern: 'foo' })
  assert(args.includes('foo'))
  assert(args.includes('--hidden'))
  assert(args.join('\n').includes('!.git'))
})

test('buildGrepArgs uses -e for pattern starting with dash', () => {
  const args = buildGrepArgs({ pattern: '-foo' })
  assert.deepStrictEqual(args.slice(-2), ['-e', '-foo'])
})

test('buildGrepArgs maps output_mode to rg flags', () => {
  assert(buildGrepArgs({ pattern: 'x', output_mode: 'files_with_matches' }).includes('-l'))
  assert(buildGrepArgs({ pattern: 'x', output_mode: 'count' }).includes('-c'))
  assert(!buildGrepArgs({ pattern: 'x', output_mode: 'content' }).includes('-l'))
})

test('buildGrepArgs adds ignore globs', () => {
  const args = buildGrepArgs({
    pattern: 'a',
    ignoreGlobs: ['**/node_modules/**'],
  })
  assert(args.includes('!**/node_modules/**'))
})
