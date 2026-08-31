import fs from 'fs';
import path from 'path';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ARTIFACT_KEYS = [
  'assistant',
  'calls',
  'extra',
  'mainOutput',
  'mainCalls',
  'mainExtra'
] as const;

export interface ValidatedCompletionReceiptV1 {
  assistant: string | null;
  calls: string | null;
  extra: string | null;
  mainOutput: string | null;
  mainCalls: string | null;
  mainExtra: string | null;
}

/** Validate Promptpile's atomic Completion Receipt and every declared artifact path. */
export const validateCompletionReceiptV1 = (options: {
  receiptPath: string;
  expectedInvocationId: string;
}): ValidatedCompletionReceiptV1 => {
  if (!fs.existsSync(options.receiptPath)) throw new Error('Completion Receipt is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(options.receiptPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Completion Receipt is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error('Completion Receipt must be an object');
  if (parsed.schemaVersion !== 1 || parsed.status !== 'completed') {
    throw new Error('Completion Receipt has an unsupported schema or status');
  }
  if (parsed.invocationId !== options.expectedInvocationId) {
    throw new Error('Completion Receipt invocationId does not match this invocation');
  }
  if (!isRecord(parsed.artifacts)) throw new Error('Completion Receipt artifacts must be an object');
  const result = {} as Record<(typeof ARTIFACT_KEYS)[number], string | null>;
  for (const kind of ARTIFACT_KEYS) {
    if (!(kind in parsed.artifacts)) {
      throw new Error(`Completion Receipt artifact field is missing: ${kind}`);
    }
    const value = parsed.artifacts[kind];
    if (value !== null && (typeof value !== 'string' || !path.isAbsolute(value) || !fs.existsSync(value))) {
      throw new Error(`Completion Receipt artifact is invalid: ${kind}`);
    }
    result[kind] = value as string | null;
  }
  return result;
};
