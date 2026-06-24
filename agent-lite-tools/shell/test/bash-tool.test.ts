import test from 'node:test'
import assert from 'node:assert/strict'
import { bashTool, createShellTools } from '../dist/index.js'

/** `exec` replaces the shell with sleep so `child.kill()` targets the blocking process (works on Git Bash / POSIX). */
const longRunning = 'exec sleep 999'

test('bashTool: name and inputSchema shape', () => {
  assert.equal(bashTool.name, 'Bash')
  assert.equal((bashTool.inputSchema as { required: string[] }).required[0], 'command')
})

test('createShellTools: returns both shell tools', () => {
  const tools = createShellTools()
  assert.equal(tools.bashTool.name, 'Bash')
  assert.equal(tools.powershellTool.name, 'PowerShell')
})

test('bashTool.execute: echo', async () => {
  const r = await bashTool.execute(
    { command: 'echo hi' },
    { cwd: process.cwd() },
  )
  assert.equal(r.exitCode, 0)
  assert.equal(r.interrupted, false)
  assert.match(r.stdout, /hi/)
})

test('bashTool.execute: non-zero exit', async () => {
  const r = await bashTool.execute(
    { command: 'node -e "process.exit(7)"' },
    { cwd: process.cwd() },
  )
  assert.equal(r.exitCode, 7)
  assert.equal(r.interrupted, false)
})

test('bashTool.execute: timeout interrupts', async () => {
  const r = await bashTool.execute(
    {
      command: longRunning,
      timeout: 800,
    },
    { cwd: process.cwd() },
  )
  assert.equal(r.interrupted, true)
})

test('bashTool.execute: AbortSignal', async () => {
  const ac = new AbortController()
  const p = bashTool.execute(
    {
      command: longRunning,
      timeout: 60_000,
    },
    { cwd: process.cwd(), signal: ac.signal },
  )
  setTimeout(() => ac.abort(), 400)
  const r = await p
  assert.equal(r.interrupted, true)
})
