import fs from 'fs';
import path from 'path';
import { validateCompletionReceiptV1 } from './completion-receipt';
import { sameDirectory } from './react-path-identity';
import type { ReactSessionContext } from './types';

export const finalInvocationId = (session: ReactSessionContext): string =>
  `${session.sessionId}-final`;

export const finalReceiptPath = (session: ReactSessionContext): string =>
  path.join(session.workDirectoryAbs, 'final-receipt.json');

export const validateFinalReceipt = (options: {
  receiptPath: string;
  expectedInvocationId: string;
  userWritableAbs: string;
}): void => {
  const receipt = validateCompletionReceiptV1(options);
  const assistant = receipt.assistant;
  if (assistant !== null) {
    const assistantParent = fs.realpathSync(path.dirname(assistant));
    const expectedParent = fs.realpathSync(options.userWritableAbs);
    if (!sameDirectory(assistantParent, expectedParent)) {
      throw new Error('Final assistant artifact is outside the user writable directory');
    }
  }
};
