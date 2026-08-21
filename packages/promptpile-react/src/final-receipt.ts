import fs from 'fs';
import path from 'path';
import { sameDirectory } from './react-path-identity';
import type { ReactSessionContext } from './types';

export const finalInvocationId = (session: ReactSessionContext): string =>
  `${session.sessionId}-final`;

export const finalReceiptPath = (session: ReactSessionContext): string =>
  path.join(session.workDirectoryAbs, 'final-receipt.json');

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

export const validateFinalReceipt = (options: {
  receiptPath: string;
  expectedInvocationId: string;
  userWritableAbs: string;
}): void => {
  if (!fs.existsSync(options.receiptPath)) throw new Error('Final Completion Receipt is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(options.receiptPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Final Completion Receipt is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(parsed)) throw new Error('Final Completion Receipt must be an object');
  if (parsed.schemaVersion !== 1 || parsed.status !== 'completed') {
    throw new Error('Final Completion Receipt has an unsupported schema or status');
  }
  if (parsed.invocationId !== options.expectedInvocationId) {
    throw new Error('Final Completion Receipt invocationId does not match this session');
  }
  if (!isRecord(parsed.artifacts)) throw new Error('Final Completion Receipt artifacts must be an object');
  for (const kind of ARTIFACT_KEYS) {
    if (!(kind in parsed.artifacts)) {
      throw new Error(`Final Completion Receipt artifact field is missing: ${kind}`);
    }
    const value = parsed.artifacts[kind];
    if (value === null) continue;
    if (typeof value !== 'string' || !path.isAbsolute(value) || !fs.existsSync(value)) {
      throw new Error(`Final Completion Receipt artifact is invalid: ${kind}`);
    }
  }
  const assistant = parsed.artifacts.assistant;
  if (assistant !== null) {
    if (typeof assistant !== 'string') throw new Error('Final assistant artifact path is invalid');
    const assistantParent = fs.realpathSync(path.dirname(assistant));
    const expectedParent = fs.realpathSync(options.userWritableAbs);
    if (!sameDirectory(assistantParent, expectedParent)) {
      throw new Error('Final assistant artifact is outside the user writable directory');
    }
  }
};
