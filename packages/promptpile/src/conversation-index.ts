import fs from 'fs';
import path from 'path';
import type { FileInfo } from './types';

export const MAX_CONVERSATION_INDEX = Number.MAX_SAFE_INTEGER;

export class ConversationIndexExhaustedError extends Error {
  readonly code = 'index_exhausted';

  constructor() {
    super(`Conversation index space is exhausted at ${MAX_CONVERSATION_INDEX}`);
    this.name = 'ConversationIndexExhaustedError';
  }
}

/** Parse the protocol's frozen non-negative safe-integer index domain. */
export const parseConversationIndex = (raw: string): number | undefined => {
  if (!/^\d+$/.test(raw)) return undefined;
  const index = Number(raw);
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
};

export const parseExpectedConversationIndex = (raw: string): number => {
  const parsed = parseConversationIndex(raw);
  if (parsed === undefined) {
    throw new Error(
      `expected next index must be a decimal integer from 0 to ${MAX_CONVERSATION_INDEX}`
    );
  }
  return parsed;
};

export type ConversationMutationKind = 'append_user' | 'continue_assistant';

const targetNames = (idx: number, kind: ConversationMutationKind): string[] =>
  kind === 'append_user'
    ? [`[${idx}]user.md`]
    : [
        `[${idx}]assistant.md`,
        `[${idx}]assistant.calls.jsonl`,
        `[${idx}]assistant.extra.json`,
        `[${idx}]assistant.result.jsonl`
      ];

/** The sole allocator used by both mutation guards and final writers. */
export const allocateConversationMutationIndex = (
  directory: string,
  files: readonly FileInfo[],
  kind: ConversationMutationKind
): number => {
  const maxIdx = files.reduce((max, file) => Math.max(max, file.idx), -1);
  if (maxIdx >= MAX_CONVERSATION_INDEX) throw new ConversationIndexExhaustedError();

  let idx = maxIdx + 1;
  while (targetNames(idx, kind).some(name => fs.existsSync(path.join(directory, name)))) {
    if (idx >= MAX_CONVERSATION_INDEX) throw new ConversationIndexExhaustedError();
    idx += 1;
  }
  return idx;
};
