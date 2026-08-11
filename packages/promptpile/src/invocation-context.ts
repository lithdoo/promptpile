export const INVOCATION_ID_MAX_LENGTH = 128;

const INVOCATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const INVALID_INVOCATION_ID_MESSAGE =
  'invalid invocation id: expected 1-128 characters matching [A-Za-z0-9._:-]';

/** External correlation label for one root completion invocation. */
export type InvocationId = string;

/** The single immutable invocation-correlation fact consumed by runtime stages. */
export interface ResolvedInvocationContextV1 {
  readonly id: InvocationId | null;
}

/** Validate without trimming so the caller-provided value is preserved exactly. */
export const parseInvocationId = (value: unknown): InvocationId | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !INVOCATION_ID_PATTERN.test(value)) {
    throw new Error(INVALID_INVOCATION_ID_MESSAGE);
  }
  return value;
};

export const resolveInvocationContext = (
  id: InvocationId | undefined
): ResolvedInvocationContextV1 => Object.freeze({ id: id ?? null });
