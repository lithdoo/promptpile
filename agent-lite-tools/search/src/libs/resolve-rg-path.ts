import { existsSync } from 'fs'

let cached: string | null = null

/**
 * Path to the ripgrep binary from [`@vscode/ripgrep`](https://www.npmjs.com/package/@vscode/ripgrep) (not PATH).
 * Cached after first successful resolve.
 */
export function getRgPath(): string {
  if (cached !== null) {
    return cached
  }
  let mod: { rgPath?: string }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('@vscode/ripgrep') as { rgPath?: string }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Cannot load @vscode/ripgrep: ${msg}. Run npm install in the package that depends on @agent-tool-lite/search so postinstall can download the ripgrep binary.`,
    )
  }
  const p = mod.rgPath
  if (typeof p !== 'string' || p.trim() === '') {
    throw new Error(
      'Invalid @vscode/ripgrep: missing rgPath. Reinstall dependencies (npm install) so the ripgrep postinstall step completes.',
    )
  }
  if (!existsSync(p)) {
    throw new Error(
      `ripgrep binary not found at rgPath: ${p}. Reinstall @vscode/ripgrep (npm install).`,
    )
  }
  cached = p
  return cached
}
