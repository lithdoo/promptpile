import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assertOnlyAllowedKeys,
  expectRecord,
  parseOptionalTimeout,
} from '../dist/libs/parse-args.js'

test('expectRecord rejects non-object', () => {
  assert.throws(() => expectRecord(null), /JSON object/)
})

test('assertOnlyAllowedKeys rejects legacy Claude keys', () => {
  const o = expectRecord({
    command: 'echo',
    run_in_background: true,
  })
  assert.throws(() => assertOnlyAllowedKeys(o), /Unknown tool argument/)
})

test('parseOptionalTimeout accepts number and numeric string', () => {
  assert.equal(parseOptionalTimeout(5000), 5000)
  assert.equal(parseOptionalTimeout('3000'), 3000)
  assert.equal(parseOptionalTimeout(undefined), undefined)
})
