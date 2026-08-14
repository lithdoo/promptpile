import { inspectArchiveSet, inspectStagingState } from '../restore/inspection';
import type { InvalidLifecycleReason } from '../restore/inspection';
import { lifecycleError } from '../lifecycle/errors';
import { scanTurns } from './scanner';
import { resolveContextBudget } from './budget';
import { assertTokenizerAdapter, estimateTotalTokens, heuristicTokenizer } from './tokenizer';
import { createTurnSelector } from './strategy';
import { createSummaryGenerator } from './summary';
import type { CompressOptions, TokenizerAdapter, Turn } from './types';

export interface LiveSnapshot {
  turns: Turn[];
  tokens: number;
  triggerTokens: number;
  triggerReached: boolean;
}

export interface InspectedArchive {
  idx: number;
  path: string;
}

export type CompressionLifecycleInspection =
  | { state: 'healthy_plain'; live: LiveSnapshot }
  | {
      state: 'healthy_compacted';
      live: LiveSnapshot;
      archives: InspectedArchive[];
    }
  | { state: 'recovery_required'; reason: 'staging_recovery' }
  | {
      state: 'recovery_required';
      reason: 'archive_recovery';
      archives: InspectedArchive[];
    }
  | { state: 'invalid'; reason: InvalidLifecycleReason };

export interface ResolvedCompressionRequest {
  tokenizer: TokenizerAdapter;
  triggerTokens: number;
}

export const resolveCompressionRequest = (
  options: CompressOptions
): ResolvedCompressionRequest => {
  const tokenizer = options.tokenizer ?? heuristicTokenizer;
  assertTokenizerAdapter(tokenizer);
  const keepRecent = options.keepRecent ?? 4;
  if (!Number.isInteger(keepRecent) || keepRecent < 0) {
    throw new Error(`keepRecent must be a non-negative integer: ${keepRecent}`);
  }
  try {
    createTurnSelector(options.strategy ?? 'sliding-window');
    createSummaryGenerator(options.summary);
  } catch (error) {
    throw lifecycleError(
      'INVALID_OPTIONS',
      error instanceof Error ? error.message : String(error)
    );
  }
  return { tokenizer, triggerTokens: resolveContextBudget(options).triggerTokens };
};

export const inspectCompressionLifecycleState = async (
  directory: string,
  resolved: ResolvedCompressionRequest
): Promise<CompressionLifecycleInspection> => {
  const staging = await inspectStagingState(directory);
  const archiveSet = await inspectArchiveSet(directory);
  if (staging.state === 'invalid' && staging.reason === 'staging_path_invalid') {
    return staging;
  }
  if (archiveSet.state === 'invalid') return archiveSet;
  if (archiveSet.state === 'valid' && staging.state !== 'absent') {
    return { state: 'invalid', reason: 'staging_archive_conflict' };
  }
  if (staging.state === 'invalid') return staging;
  if (staging.state === 'recoverable') {
    return { state: 'recovery_required', reason: 'staging_recovery' };
  }
  if (archiveSet.state === 'valid' && !archiveSet.allSummariesPresent) {
    return {
      state: 'recovery_required',
      reason: 'archive_recovery',
      archives: archiveSet.archives.map(({ archive }) => ({
        idx: archive.idx,
        path: archive.path,
      })),
    };
  }

  const turns = await scanTurns(directory, resolved.tokenizer);
  const tokens = estimateTotalTokens(turns);
  const live: LiveSnapshot = {
    turns,
    tokens,
    triggerTokens: resolved.triggerTokens,
    triggerReached: tokens >= resolved.triggerTokens,
  };
  return archiveSet.state === 'valid'
    ? {
        state: 'healthy_compacted',
        live,
        archives: archiveSet.archives.map(({ archive }) => ({
          idx: archive.idx,
          path: archive.path,
        })),
      }
    : { state: 'healthy_plain', live };
};
