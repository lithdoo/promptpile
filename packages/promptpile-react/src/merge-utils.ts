import { coerceExtraBodyValue, type ExtraBody } from 'promptpile/dist/llm-extra-body';
import { coerceTemperatureValue } from 'promptpile/dist/llm-sampling';

export const trim = (v: string | undefined): string | undefined => {
  if (v === undefined) {
    return undefined;
  }
  const t = v.trim();
  return t === '' ? undefined : t;
};

export const getStr = (r: Record<string, unknown>, key: string): string | undefined => {
  const v = r[key];
  if (typeof v === 'string') {
    return trim(v);
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return trim(String(v));
  }
  return undefined;
};

export const getBool = (r: Record<string, unknown>, key: string): boolean | undefined => {
  const v = r[key];
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (normalized === '') return undefined;
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return undefined;
};

export const getNum = (r: Record<string, unknown>, key: string): number | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  return coerceTemperatureValue(v);
};

export const getExtraBody = (r: Record<string, unknown>, key: string): ExtraBody | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  return coerceExtraBodyValue(v);
};

export const getInt = (r: Record<string, unknown>, key: string): number | undefined => {
  const v = r[key];
  if (typeof v === 'number' && Number.isInteger(v)) {
    return v;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') {
      return undefined;
    }
    const n = Number(s);
    if (Number.isInteger(n)) {
      return n;
    }
  }
  return undefined;
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

export const pickNum = (
  ...values: (number | undefined)[]
): number | undefined => {
  for (const v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
};

export const pickRecord = (
  ...values: (ExtraBody | undefined)[]
): ExtraBody | undefined => {
  for (const v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return undefined;
};
