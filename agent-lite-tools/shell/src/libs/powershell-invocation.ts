import { existsSync } from 'fs'
import { execFileSync } from 'child_process'

function which(cmd: string): string | null {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('where', [cmd], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      const line = out.split(/\r?\n/).map(l => l.trim()).find(Boolean)
      return line && existsSync(line) ? line : null
    }
    const out = execFileSync('which', [cmd], {
      encoding: 'utf8',
      timeout: 5000,
    }).trim()
    return out || null
  } catch {
    return null
  }
}

/**
 * Prefers `pwsh`, then `powershell` (aligned with Claude `findPowerShell` intent; no snap special-case in MVP).
 */
export async function resolvePowerShellExecutable(): Promise<string | null> {
  return (
    which('pwsh') ??
    which('pwsh.exe') ??
    which('powershell') ??
    which('powershell.exe')
  )
}
