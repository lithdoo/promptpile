import { execFile, type ExecFileException } from 'child_process'
import { getRgPath } from './resolve-rg-path'

function stdoutToString(stdout: unknown): string {
  if (stdout === undefined || stdout === null) {
    return ''
  }
  if (typeof stdout === 'string') {
    return stdout
  }
  if (Buffer.isBuffer(stdout)) {
    return stdout.toString('utf8')
  }
  return String(stdout)
}

export class RipgrepTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RipgrepTimeoutError'
  }
}

export type RunRipgrepOptions = {
  cwd: string
  signal?: AbortSignal
  timeoutMs?: number
  maxBuffer?: number
}

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BUFFER = 20_000_000

function splitLines(stdout: string): string[] {
  const s = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!s) {
    return []
  }
  const lines = s.split('\n')
  if (lines.length && lines[lines.length - 1] === '') {
    lines.pop()
  }
  return lines
}

/**
 * Run ripgrep with given args; the executable is from `@vscode/ripgrep` (`rgPath`), not PATH.
 * Last path argument is `searchRoot` (search root), matching Claude's contract.
 * Exit code 0 and 1 are both success (1 = no matches).
 */
export function runRipgrep(
  args: string[],
  searchRoot: string,
  options: RunRipgrepOptions,
): Promise<string[]> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER
  const fullArgs = [...args, searchRoot]
  const rgExecutable = getRgPath()

  if (options.signal?.aborted) {
    return Promise.reject(new Error('Search aborted before start'))
  }

  return new Promise((resolve, reject) => {
    const child = execFile(
      rgExecutable,
      fullArgs,
      {
        cwd: searchRoot,
        maxBuffer,
        timeout: timeoutMs,
        signal: options.signal,
        killSignal: process.platform === 'win32' ? undefined : 'SIGKILL',
        windowsHide: true,
      },
      (err, stdout) => {
        const outStr = stdoutToString(stdout)
        if (!err) {
          resolve(splitLines(outStr))
          return
        }
        const ex = err as ExecFileException & { stdout?: string | Buffer }
        if (ex.code === 1) {
          const s = outStr || stdoutToString(ex.stdout)
          resolve(splitLines(s))
          return
        }
        if (ex.killed || ex.signal === 'SIGTERM' || ex.signal === 'SIGKILL') {
          reject(
            new RipgrepTimeoutError(
              ex.signal
                ? `ripgrep was killed (${ex.signal})`
                : 'ripgrep timed out or was killed',
            ),
          )
          return
        }
        if (ex.code === 'ABORT_ERR' || options.signal?.aborted) {
          reject(new Error('Search aborted'))
          return
        }
        reject(err)
      },
    )
  })
}
