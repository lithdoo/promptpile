export const CONVERSATION_CONFLICT_EXIT_CODE = 3;

export type ConversationConflictKind =
  | 'claim_busy'
  | 'fingerprint_mismatch'
  | 'next_index_mismatch'
  | 'state_unstable'
  | 'target_collision';

export interface ConversationConflictDetails {
  expectedFingerprint?: string;
  actualFingerprint?: string;
  expectedNextIndex?: number;
  actualNextIndex?: number;
  claimPath?: string;
  targetPath?: string;
}

export class ConversationConflictError extends Error {
  readonly code = 'conversation_conflict';
  readonly kind: ConversationConflictKind;
  readonly details: ConversationConflictDetails;

  constructor(
    kind: ConversationConflictKind,
    message: string,
    details: ConversationConflictDetails = {}
  ) {
    super(message);
    this.name = 'ConversationConflictError';
    this.kind = kind;
    this.details = details;
  }
}

/** Internal writer signal; the OCC guard maps it to target_collision. */
export class ConversationTargetCollisionError extends Error {
  readonly code = 'conversation_target_collision';
  readonly targetPath: string;

  constructor(targetPath: string) {
    super(`Conversation mutation target already exists: ${targetPath}`);
    this.name = 'ConversationTargetCollisionError';
    this.targetPath = targetPath;
  }
}

export const isConversationConflictError = (
  error: unknown
): error is ConversationConflictError => error instanceof ConversationConflictError;

export const formatConversationConflict = (error: ConversationConflictError): string => {
  const fields = [`kind=${error.kind}`];
  if (error.details.expectedFingerprint !== undefined) {
    fields.push(`expectedFingerprint=${error.details.expectedFingerprint}`);
  }
  if (error.details.actualFingerprint !== undefined) {
    fields.push(`actualFingerprint=${error.details.actualFingerprint}`);
  }
  if (error.details.expectedNextIndex !== undefined) {
    fields.push(`expectedNextIndex=${error.details.expectedNextIndex}`);
  }
  if (error.details.actualNextIndex !== undefined) {
    fields.push(`actualNextIndex=${error.details.actualNextIndex}`);
  }
  if (error.details.claimPath !== undefined) fields.push(`claimPath=${error.details.claimPath}`);
  if (error.details.targetPath !== undefined) fields.push(`targetPath=${error.details.targetPath}`);
  return `Conversation conflict: ${fields.join(' ')}: ${error.message}`;
};
