/** Mirrors Claude Code `src/utils/timeouts.ts` defaults and env keys. */

const DEFAULT_TIMEOUT_MS = 120_000 // 2 minutes
const MAX_TIMEOUT_MS = 600_000 // 10 minutes

type EnvLike = Record<string, string | undefined>

export function getDefaultBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_DEFAULT_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_TIMEOUT_MS
}

export function getMaxBashTimeoutMs(env: EnvLike = process.env): number {
  const envValue = env.BASH_MAX_TIMEOUT_MS
  if (envValue) {
    const parsed = parseInt(envValue, 10)
    if (!isNaN(parsed) && parsed > 0) {
      return Math.max(parsed, getDefaultBashTimeoutMs(env))
    }
  }
  return Math.max(MAX_TIMEOUT_MS, getDefaultBashTimeoutMs(env))
}

export function clampTimeoutMs(
  timeout: number | undefined,
  env: EnvLike = process.env,
): number {
  const def = getDefaultBashTimeoutMs(env)
  const max = getMaxBashTimeoutMs(env)
  if (timeout === undefined || Number.isNaN(timeout)) {
    return def
  }
  const t = Math.floor(timeout)
  if (t < 1) {
    return 1
  }
  return Math.min(t, max)
}
