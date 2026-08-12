import type { AfterHookFailureMode, AfterHookObservationV1 } from './after-hook-policy';
import { atomicWriteFileSync } from './atomic-file';
import type { CompletionArtifactLedger } from './completion-artifact-ledger';
import type { CompletionUsage } from './types';
import type { ResolvedInvocationContextV1 } from './invocation-context';
import type {
  CompletionReceiptHookV1,
  CompletionReceiptV1
} from 'promptpile-protocol/receipt';

export type { CompletionReceiptHookV1, CompletionReceiptV1 } from 'promptpile-protocol/receipt';

export const buildCompletionReceiptHookV1 = (
  observation: AfterHookObservationV1,
  failureMode: AfterHookFailureMode
): CompletionReceiptHookV1 => {
  const successful = observation.status === 'skipped' || observation.status === 'succeeded';
  if (!successful && failureMode === 'error') {
    throw new Error('cannot build a completed receipt from a fatal after-hook decision');
  }

  switch (observation.status) {
    case 'skipped':
      return { status: observation.status, failureMode, reason: observation.reason };
    case 'invalid_explicit':
      return { status: observation.status, failureMode: 'warn', attempted: observation.attempted, reason: observation.reason };
    case 'succeeded':
      return { status: observation.status, failureMode, path: observation.path, exitCode: observation.exitCode };
    case 'spawn_failed':
      return { status: observation.status, failureMode: 'warn', path: observation.path, errorCode: observation.errorCode };
    case 'exited_nonzero':
      return { status: observation.status, failureMode: 'warn', path: observation.path, exitCode: observation.exitCode };
    case 'signaled':
      return { status: observation.status, failureMode: 'warn', path: observation.path, signal: observation.signal };
  }
};

export const buildCompletionReceiptV1 = (options: {
  invocation: ResolvedInvocationContextV1;
  ledger: CompletionArtifactLedger;
  model: string;
  finishReason?: string;
  usage?: CompletionUsage;
  hook: CompletionReceiptHookV1;
}): CompletionReceiptV1 => {
  const { ledger } = options;
  return {
    schemaVersion: 1,
    status: 'completed',
    invocationId: options.invocation.id,
    artifacts: {
      assistant: ledger.find('conversation', 'body')?.absolutePath ?? null,
      calls: ledger.find('conversation', 'calls')?.absolutePath ?? null,
      extra: ledger.find('conversation', 'extra')?.absolutePath ?? null,
      mainOutput: ledger.find('main', 'body')?.absolutePath ?? null,
      mainCalls: ledger.find('main', 'calls')?.absolutePath ?? null,
      mainExtra: ledger.find('main', 'extra')?.absolutePath ?? null
    },
    model: options.model,
    finishReason: options.finishReason ?? null,
    usage: options.usage ?? null,
    hook: options.hook
  };
};

/** Atomically publish the receipt only after every referenced artifact exists. */
export const commitCompletionReceiptV1 = (options: {
  targetPath: string;
  receipt: CompletionReceiptV1;
  ledger: CompletionArtifactLedger;
}): void => {
  // Resolve the ledger's predictable failure before the Receipt becomes externally visible.
  // This check, publication, and record operation form one synchronous, await-free section.
  if (options.ledger.find('receipt', 'receipt')) {
    throw new Error('duplicate completion artifact ledger key: receipt/receipt');
  }
  atomicWriteFileSync(options.targetPath, `${JSON.stringify(options.receipt, null, 2)}\n`);
  options.ledger.record({ namespace: 'receipt', kind: 'receipt', absolutePath: options.targetPath });
};
