import { accessSync, constants as fsConstants, existsSync } from 'fs'
import { execFileSync } from 'child_process'
import { join } from 'path'

function isExecutable(shellPath: string): boolean {
  try {
    accessSync(shellPath, fsConstants.X_OK)
    return true
  } catch {
    try {
      execFileSync(shellPath, ['--version'], { timeout: 1000, stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }
}

function isWslBashStub(p: string): boolean {
  const n = p.replace(/\//g, '\\').toLowerCase()
  return (
    n.endsWith('system32\\bash.exe') ||
    n.endsWith('sysnative\\bash.exe') ||
    n.includes('windows\\system32\\bash')
  )
}

function tryWhereBashWindows(): string | null {
  if (process.platform !== 'win32') {
    return null
  }
  /** Prefer Git Bash before `where bash` — first hit is often WSL's System32 stub and hangs or misbehaves. */
  const gitCandidates = [
    process.env.GIT_INSTALL_ROOT
      ? join(process.env.GIT_INSTALL_ROOT, 'bin', 'bash.exe')
      : '',
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
    join(
      process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      'Git',
      'bin',
      'bash.exe',
    ),
  ].filter(Boolean)
  for (const c of gitCandidates) {
    if (existsSync(c) && isExecutable(c)) {
      return c
    }
  }
  try {
    const out = execFileSync('where', ['bash'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
    })
    const lines = out
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
    for (const p of lines) {
      if (isWslBashStub(p)) {
        continue
      }
      if (existsSync(p) && isExecutable(p)) {
        return p
      }
    }
  } catch {
    /* ignore */
  }
  return null
}

/**
 * Resolves a bash or zsh binary for `bash -lc` style execution (simplified vs Claude Shell.ts).
 */
export async function resolveBashExecutable(): Promise<string> {
  const shellOverride = process.env.CLAUDE_CODE_SHELL
  if (shellOverride) {
    const supported =
      shellOverride.includes('bash') || shellOverride.includes('zsh')
    if (supported && existsSync(shellOverride) && isExecutable(shellOverride)) {
      return shellOverride
    }
  }

  const envShell = process.env.SHELL
  const envOk =
    envShell &&
    (envShell.includes('bash') || envShell.includes('zsh')) &&
    existsSync(envShell) &&
    isExecutable(envShell)
  if (envOk && envShell) {
    return envShell
  }

  const dirs = ['/bin', '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']
  const preferBash = envShell?.includes('bash')
  const order = preferBash ? (['bash', 'zsh'] as const) : (['zsh', 'bash'] as const)
  const paths: string[] = []
  for (const name of order) {
    for (const d of dirs) {
      paths.push(join(d, name))
    }
  }
  const found = paths.find(p => existsSync(p) && isExecutable(p))
  if (found) {
    return found
  }

  const win = tryWhereBashWindows()
  if (win) {
    return win
  }

  throw new Error(
    'No suitable bash/zsh found. Set CLAUDE_CODE_SHELL to a bash or zsh path, install Git for Windows (bash), or use a POSIX environment.',
  )
}
