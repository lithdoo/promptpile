import test from 'node:test'
import assert from 'node:assert/strict'
import { runShell } from '../dist/index.js'

test('runShell bash: echo', async () => {
  const r = await runShell({
    kind: 'bash',
    command: 'echo ok',
    cwd: process.cwd(),
    timeoutMs: 10_000,
  })
  assert.equal(r.exitCode, 0)
  assert.equal(r.interrupted, false)
  assert.match(r.stdout, /ok/)
})

test(
  'runShell powershell on non-Windows: throws if pwsh missing or succeeds',
  { skip: process.platform === 'win32' },
  async () => {
    try {
      const r = await runShell({
        kind: 'powershell',
        command: '1',
        cwd: process.cwd(),
        timeoutMs: 5000,
      })
      assert.equal(typeof r.exitCode, 'number')
    } catch (e) {
      assert.ok(
        e instanceof Error &&
          (e.message.includes('not available') ||
            e.message.includes('PowerShell')),
      )
    }
  },
)
