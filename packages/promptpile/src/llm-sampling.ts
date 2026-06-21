export const DEFAULT_TEMPERATURE = 0.8;

const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;

/**
 * Parse temperature from CLI/env/TOML string. Empty/undefined → undefined (caller applies default).
 * @throws Error if non-empty but invalid or out of range.
 */
export const parseTemperatureInput = (raw: string | undefined): number | undefined => {
  if (raw === undefined) {
    return undefined;
  }
  const s = raw.trim();
  if (s === '') {
    return undefined;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid temperature: "${raw}". Expected a number between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}.`);
  }
  if (n < MIN_TEMPERATURE || n > MAX_TEMPERATURE) {
    throw new Error(`temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}, got ${n}`);
  }
  return n;
};

/** Coerce TOML number or validated string to temperature, or undefined. */
export const coerceTemperatureValue = (v: unknown): number | undefined => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < MIN_TEMPERATURE || v > MAX_TEMPERATURE) {
      throw new Error(
        `temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}, got ${v}`
      );
    }
    return v;
  }
  if (typeof v === 'string') {
    return parseTemperatureInput(v);
  }
  return undefined;
};
