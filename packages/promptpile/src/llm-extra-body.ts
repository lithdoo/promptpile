export type ExtraBody = Record<string, unknown>;

/**
 * Parse extra_body from CLI/env JSON string. Empty/undefined → undefined (caller omits from body).
 * @throws Error if non-empty but invalid JSON or not a plain object.
 */
export const parseExtraBodyInput = (raw: string | undefined): ExtraBody | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const s = raw.trim();
  if (s === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    throw new Error(`Invalid extra_body JSON: "${raw}"`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      `extra_body must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
    );
  }
  return parsed as ExtraBody;
};

/** Coerce TOML inline table or JSON string to extra_body, or undefined. */
export const coerceExtraBodyValue = (v: unknown): ExtraBody | undefined => {
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'string') {
    return parseExtraBodyInput(v);
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as ExtraBody;
  }
  throw new Error('extra_body must be a TOML table or JSON object string');
};
