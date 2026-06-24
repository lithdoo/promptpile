/** Treat empty string as unset so defaults apply (matches Claude glob env behavior). */
export function isEnvTruthy(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw === '') {
    return defaultValue
  }
  const v = raw.trim().toLowerCase()
  if (['0', 'false', 'no', 'off'].includes(v)) {
    return false
  }
  if (['1', 'true', 'yes', 'on'].includes(v)) {
    return true
  }
  return defaultValue
}
