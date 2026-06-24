import { execFile } from 'child_process'
import { promisify } from 'util'
import { getRgPath } from '../dist/index.js'

const execFileAsync = promisify(execFile)

/**
 * True when `@vscode/ripgrep` is installed and `rg --version` succeeds for the bundled binary.
 */
export async function rgAvailable(): Promise<boolean> {
  try {
    const p = getRgPath()
    await execFileAsync(p, ['--version'], { timeout: 15_000, windowsHide: true })
    return true
  } catch {
    return false
  }
}
