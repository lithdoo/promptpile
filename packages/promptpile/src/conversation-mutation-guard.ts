import {
  ConversationConflictError,
  ConversationTargetCollisionError
} from './conversation-conflict';
import {
  ConversationFingerprintError,
  fingerprintConversationDirectory
} from './conversation-fingerprint';
import {
  allocateConversationMutationIndex,
  type ConversationMutationKind
} from './conversation-index';
import {
  withConversationMutationClaim,
  type ConversationClaimDependencies
} from './conversation-mutation-claim';
import { scanDirectory } from './file-handler';

export interface ConversationMutationPrecondition {
  expectedFingerprint?: string;
  expectedNextIndex?: number;
}

export interface ConversationMutationBaseline {
  fingerprint?: string;
  nextIndex?: number;
}

export interface VerifiedConversationMutationState {
  nextIndex: number;
  fingerprint?: string;
}

export interface ConversationMutationGuardDependencies {
  claim?: ConversationClaimDependencies;
}

export const hasConversationMutationPrecondition = (
  precondition: ConversationMutationPrecondition
): boolean => precondition.expectedFingerprint !== undefined ||
  precondition.expectedNextIndex !== undefined;

const observeMutationState = async (
  directory: string,
  mutationKind: ConversationMutationKind,
  includeFingerprint: boolean
): Promise<VerifiedConversationMutationState> => {
  const files = scanDirectory(directory);
  const nextIndex = allocateConversationMutationIndex(directory, files, mutationKind);
  if (!includeFingerprint) return { nextIndex };
  try {
    const result = await fingerprintConversationDirectory(directory);
    return { nextIndex, fingerprint: result.fingerprint };
  } catch (error) {
    if (error instanceof ConversationFingerprintError && error.code === 'unstable_observation') {
      throw new ConversationConflictError(
        'state_unstable',
        'Conversation state could not be observed stably'
      );
    }
    throw error;
  }
};

export const checkConversationMutationPrecondition = async (
  directory: string,
  mutationKind: ConversationMutationKind,
  precondition: ConversationMutationPrecondition
): Promise<VerifiedConversationMutationState> => {
  const state = await observeMutationState(
    directory,
    mutationKind,
    precondition.expectedFingerprint !== undefined
  );
  if (
    precondition.expectedFingerprint !== undefined &&
    state.fingerprint !== precondition.expectedFingerprint
  ) {
    throw new ConversationConflictError(
      'fingerprint_mismatch',
      'Conversation fingerprint no longer matches the expected state',
      {
        expectedFingerprint: precondition.expectedFingerprint,
        actualFingerprint: state.fingerprint
      }
    );
  }
  if (
    precondition.expectedNextIndex !== undefined &&
    state.nextIndex !== precondition.expectedNextIndex
  ) {
    throw new ConversationConflictError(
      'next_index_mismatch',
      'Conversation next mutation index no longer matches the expected value',
      {
        expectedNextIndex: precondition.expectedNextIndex,
        actualNextIndex: state.nextIndex
      }
    );
  }
  return state;
};

/** Cheap fail-fast check only; callers must still use commitConversationMutation. */
export const preflightConversationMutation = checkConversationMutationPrecondition;

export const deriveConversationMutationBaseline = async (
  directory: string,
  mutationKind: ConversationMutationKind,
  requested: ConversationMutationPrecondition
): Promise<ConversationMutationBaseline> => {
  const state = await observeMutationState(
    directory,
    mutationKind,
    requested.expectedFingerprint !== undefined
  );
  return {
    fingerprint: requested.expectedFingerprint === undefined ? undefined : state.fingerprint,
    nextIndex: requested.expectedNextIndex === undefined ? undefined : state.nextIndex
  };
};

export const commitConversationMutation = async <T>(options: {
  directory: string;
  mutationKind: ConversationMutationKind;
  precondition: ConversationMutationPrecondition;
  mutate: (state: VerifiedConversationMutationState) => T | Promise<T>;
  deriveFor?: ConversationMutationKind;
  dependencies?: ConversationMutationGuardDependencies;
}): Promise<{ value: T; baseline?: ConversationMutationBaseline }> =>
  withConversationMutationClaim(
    options.directory,
    options.mutationKind,
    async () => {
      const state = await checkConversationMutationPrecondition(
        options.directory,
        options.mutationKind,
        options.precondition
      );
      let value: T;
      try {
        value = await options.mutate(state);
      } catch (error) {
        if (error instanceof ConversationTargetCollisionError) {
          throw new ConversationConflictError(
            'target_collision',
            'Conversation mutation target already exists',
            { targetPath: error.targetPath }
          );
        }
        throw error;
      }
      const baseline = options.deriveFor === undefined
        ? undefined
        : await deriveConversationMutationBaseline(
            options.directory,
            options.deriveFor,
            options.precondition
          );
      return { value, baseline };
    },
    options.dependencies?.claim
  );
