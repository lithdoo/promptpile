import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatFileSize } from '../dist/index.js'

test('formatFileSize: zero bytes', () => {
  assert.equal(formatFileSize(0), '0 bytes')
})

test('formatFileSize: sub-KB as bytes', () => {
  assert.equal(formatFileSize(512), '512 bytes')
})

test('formatFileSize: kilobytes', () => {
  assert.equal(formatFileSize(1536), '1.5KB')
})

test('formatFileSize: megabytes', () => {
  assert.equal(formatFileSize(3 * 1024 * 1024), '3MB')
})
