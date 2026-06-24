import test from 'node:test'
import assert from 'node:assert/strict'
import { powershellTool } from '../dist/index.js'

test(
  'powershellTool: Write-Output on Windows',
  { skip: process.platform !== 'win32' },
  async () => {
    const r = await powershellTool.execute(
      { command: 'Write-Output 42' },
      { cwd: process.cwd() },
    )
    assert.equal(r.exitCode, 0)
    assert.equal(r.interrupted, false)
    assert.match(r.stdout, /42/)
  },
)

test(
  'powershellTool: throws on non-Windows',
  { skip: process.platform === 'win32' },
  async () => {
    await assert.rejects(
      () =>
        powershellTool.execute({ command: '1' }, { cwd: process.cwd() }),
      /only supported on Windows/,
    )
  },
)
