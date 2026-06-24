const ALLOWED_KEYS = new Set(['command', 'timeout', 'description'])

const DESCRIPTION_MAX_LEN = 2000

export function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool args must be a JSON object')
  }
  return value as Record<string, unknown>
}

export function assertOnlyAllowedKeys(o: Record<string, unknown>): void {
  for (const k of Object.keys(o)) {
    if (!ALLOWED_KEYS.has(k)) {
      throw new Error(
        `Unknown tool argument "${k}". Allowed: command, timeout, description.`,
      )
    }
  }
}

export function parseOptionalTimeout(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = parseInt(value, 10)
    if (!Number.isNaN(n) && String(n) === value.trim()) {
      return n
    }
    const f = parseFloat(value)
    if (!Number.isNaN(f)) {
      return f
    }
  }
  throw new Error('Invalid timeout: expected a finite number (milliseconds)')
}

export function parseOptionalDescription(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error('Invalid description: expected a string')
  }
  if (value.length > DESCRIPTION_MAX_LEN) {
    throw new Error(
      `Invalid description: exceeds max length (${DESCRIPTION_MAX_LEN})`,
    )
  }
  return value
}
