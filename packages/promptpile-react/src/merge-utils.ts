export const trim = (v: string | undefined): string | undefined => {
  if (v === undefined) {
    return undefined;
  }
  const t = v.trim();
  return t === '' ? undefined : t;
};

export const getStr = (r: Record<string, unknown>, key: string): string | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'string') {
    const value = trim(v);
    if (value !== undefined) {
      return value;
    }
    throw new Error(`${key} must be a non-empty string`);
  }
  throw new Error(`${key} must be a string`);
};

export const getBool = (r: Record<string, unknown>, key: string): boolean | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'boolean') {
    return v;
  }
  throw new Error(`${key} must be a boolean`);
};

export const getRawCliValue = (
  r: Record<string, unknown>,
  key: string
): string | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`${key} must be a finite number`);
  }
  return String(v);
};

export const getJsonCliValue = (
  r: Record<string, unknown>,
  key: string
): string | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) {
    throw new Error(`${key} must be a TOML table`);
  }
  return JSON.stringify(v);
};

export const getInt = (r: Record<string, unknown>, key: string): number | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isInteger(v)) {
    throw new Error(`${key} must be an integer`);
  }
  return v;
};

export const pickStr = (
  ...values: (string | undefined)[]
): string | undefined => {
  for (const v of values) {
    const t = trim(v);
    if (t !== undefined) {
      return t;
    }
  }
  return undefined;
};

export const pickBool = (
  ...values: (boolean | undefined)[]
): boolean | undefined => {
  for (const v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
};

export const pickInt = (
  ...values: (number | undefined)[]
): number | undefined => {
  for (const v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
};
