import { test } from 'node:test'
import assert from 'node:assert/strict'

import { defaultFileReadSyncFs, safeResolvePath } from '../dist/index.js'

test('safeResolvePath: UNC // prefix returns without fs access', () => {
  const p = '//unc/share/file.txt'
  const r = safeResolvePath(defaultFileReadSyncFs, p)
  assert.equal(r.resolvedPath, p)
  assert.equal(r.isSymlink, false)
  assert.equal(r.isCanonical, false)
})

test('safeResolvePath: UNC backslash prefix returns without fs access', () => {
  const p = '\\\\unc\\share\\file.txt'
  const r = safeResolvePath(defaultFileReadSyncFs, p)
  assert.equal(r.resolvedPath, p)
  assert.equal(r.isSymlink, false)
  assert.equal(r.isCanonical, false)
})
