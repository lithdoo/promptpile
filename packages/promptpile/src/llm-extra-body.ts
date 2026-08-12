export type ExtraBody = Record<string, unknown>;

/** Request fields whose semantics are owned exclusively by Promptpile. */
export const RESERVED_CHAT_COMPLETION_REQUEST_KEYS = [
  'model',
  'messages',
  'stream',
  'temperature',
  'tools',
  'tool_choice'
] as const;

const RESERVED_CHAT_COMPLETION_REQUEST_KEY_SET = new Set<string>(
  RESERVED_CHAT_COMPLETION_REQUEST_KEYS
);

export const validateExtraBodyReservedKeys = (extraBody: ExtraBody): void => {
  for (const key of Object.keys(extraBody)) {
    if (RESERVED_CHAT_COMPLETION_REQUEST_KEY_SET.has(key)) {
      throw new Error(`extra_body must not override reserved request field: ${key}`);
    }
  }
};

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
  const result = parsed as ExtraBody;
  validateExtraBodyReservedKeys(result);
  return result;
};

/** Read a TOML inline table as extra_body without cross-type coercion. */
export const coerceExtraBodyValue = (v: unknown): ExtraBody | undefined => {
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const result = v as ExtraBody;
    validateExtraBodyReservedKeys(result);
    return result;
  }
  throw new Error('extra_body must be a TOML table');
};
