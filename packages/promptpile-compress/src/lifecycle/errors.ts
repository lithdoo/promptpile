import type { LifecycleErrorCode } from '../compress/types';

export interface TaggedLifecycleError extends Error {
  lifecycleErrorCode: LifecycleErrorCode;
  retryable?: boolean;
}

export const lifecycleError = (
  code: LifecycleErrorCode,
  message: string,
  retryable = false
): TaggedLifecycleError => {
  const error = new Error(message) as TaggedLifecycleError;
  error.lifecycleErrorCode = code;
  error.retryable = retryable;
  return error;
};

export const archiveStateInvalid = (reason: string): TaggedLifecycleError =>
  lifecycleError('ARCHIVE_STATE_INVALID', `archive lifecycle state invalid: ${reason}`);
