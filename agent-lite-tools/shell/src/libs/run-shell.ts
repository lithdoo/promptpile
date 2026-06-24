import { execFile, spawn } from 'child_process'
import { resolveBashExecutable } from './bash-invocation'
import { resolvePowerShellExecutable } from './powershell-invocation'

export type ShellRunKind = 'bash' | 'powershell'

export type ShellRunResult = {
  stdout: string
  stderr: string
  /** Process exit code when known; may be null if killed before code was available */
  exitCode: number | null
  interrupted: boolean
}

const MAX_OUTPUT_BYTES = 512 * 1024

function shapeStdout(s: string): string {
  return s.replace(/^(\s*\n)+/, '').trimEnd()
}

function shapeStderr(s: string): string {
  return s.trimEnd()
}

function truncateUtf8ByBytes(s: string, maxBytes: number): { text: string; truncated: boolean } {
  let out = ''
  let bytes = 0
  for (const ch of s) {
    const b = Buffer.byteLength(ch, 'utf8')
    if (bytes + b > maxBytes) {
      return { text: out, truncated: true }
    }
    out += ch
    bytes += b
  }
  return { text: s, truncated: false }
}

export type RunShellOptions = {
  kind: ShellRunKind
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * Spawn bash (`-lc`) or PowerShell (`-NoProfile -NonInteractive -Command`), collect stdout/stderr until exit, timeout, or abort.
 */
export async function runShell(opts: RunShellOptions): Promise<ShellRunResult> {
  if (opts.signal?.aborted) {
    throw new Error('Shell command aborted before start')
  }

  let executable: string
  let spawnArgs: string[]
  if (opts.kind === 'bash') {
    executable = await resolveBashExecutable()
    spawnArgs = ['-lc', opts.command]
  } else {
    const ps = await resolvePowerShellExecutable()
    if (!ps) {
      throw new Error('PowerShell is not available on this system')
    }
    executable = ps
    spawnArgs = ['-NoProfile', '-NonInteractive', '-Command', opts.command]
  }

  return await new Promise<ShellRunResult>((resolve, reject) => {
    const child = spawn(executable, spawnArgs, {
      cwd: opts.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    let interrupted = false
    let settled = false
    /** On Windows, `close` may report null exit code; `exit` carries the real code. */
    let exitFromExitEvent: number | null | undefined

    const timer = setTimeout(() => {
      interrupted = true
      try {
        if (process.platform === 'win32') {
          child.kill()
          child.stdout?.destroy()
          child.stderr?.destroy()
          const pid = child.pid
          if (pid !== undefined) {
            execFile(
              'taskkill',
              ['/PID', String(pid), '/F', '/T'],
              { windowsHide: true, timeout: 10_000 },
              () => {
                /* fire-and-forget; do not block the event loop */
              },
            )
          }
        } else {
          child.kill('SIGTERM')
          child.stdout?.destroy()
          child.stderr?.destroy()
        }
      } catch {
        /* ignore */
      }
    }, opts.timeoutMs)

    const onAbort = (): void => {
      interrupted = true
      try {
        if (process.platform === 'win32') {
          child.kill()
          child.stdout?.destroy()
          child.stderr?.destroy()
          const pid = child.pid
          if (pid !== undefined) {
            execFile(
              'taskkill',
              ['/PID', String(pid), '/F', '/T'],
              { windowsHide: true, timeout: 10_000 },
              () => {},
            )
          }
        } else {
          child.kill('SIGTERM')
          child.stdout?.destroy()
          child.stderr?.destroy()
        }
      } catch {
        /* ignore */
      }
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    const cleanup = (): void => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }

    const finalize = (exitCode: number | null, interruptedFinal: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      const o1 = truncateUtf8ByBytes(stdout, MAX_OUTPUT_BYTES)
      const e1 = truncateUtf8ByBytes(stderr, MAX_OUTPUT_BYTES)
      let err = shapeStderr(e1.text)
      if (o1.truncated) {
        err += (err ? '\n' : '') + `[shell: stdout truncated at ${MAX_OUTPUT_BYTES} bytes]`
      }
      if (e1.truncated) {
        err += (err ? '\n' : '') + `[shell: stderr truncated at ${MAX_OUTPUT_BYTES} bytes]`
      }
      resolve({
        stdout: shapeStdout(o1.text),
        stderr: err,
        exitCode,
        interrupted: interruptedFinal,
      })
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c: string) => {
      stdout += c
    })
    child.stderr.on('data', (c: string) => {
      stderr += c
    })

    child.on('error', err => {
      if (!settled) {
        settled = true
        cleanup()
        reject(err)
      }
    })

    child.on('exit', code => {
      exitFromExitEvent = code
    })

    child.on('close', (code, killSignal) => {
      const interruptedFinal = interrupted || Boolean(killSignal)
      const effective =
        code === null || code === undefined
          ? exitFromExitEvent !== undefined
            ? exitFromExitEvent
            : null
          : code
      finalize(effective === undefined ? null : effective, interruptedFinal)
    })
  })
}
