export type ForkErrorCode =
  | 'invalid_arguments'
  | 'invalid_source'
  | 'invalid_target_parent'
  | 'path_overlap'
  | 'target_exists'
  | 'target_claimed'
  | 'artifact_unreadable'
  | 'source_unstable'
  | 'staging_create_failed'
  | 'staging_write_failed'
  | 'staging_verify_failed'
  | 'publication_failed';

export class ForkError extends Error {
  readonly code: ForkErrorCode;
  readonly cause?: unknown;

  constructor(code: ForkErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ForkError';
    this.code = code;
    this.cause = cause;
  }
}

export const asForkError = (error: unknown): ForkError => error instanceof ForkError
  ? error
  : new ForkError('invalid_arguments', error instanceof Error ? error.message : 'unknown failure', error);
