import { inspectArchiveSet, inspectStagingState } from '../restore/inspection';
import type { InvalidLifecycleReason } from '../restore/inspection';
import { lifecycleError } from '../lifecycle/errors';
import { scanTurns } from './scanner';
import { resolveContextBudget } from './budget';
import type { ResolvedContextBudget } from './budget';
import { assertTokenizerAdapter, estimateTotalTokens, heuristicTokenizer } from './tokenizer';
import { createTurnSelector } from './strategy';
import { createSummaryGenerator } from './summary';
import type { LifecycleMutationHook } from '../lifecycle/mutation';
import type {
  CompressOptions,
  CompressStrategyKind,
  SemanticSummaryProvider,
  SummaryOptions,
  SummaryGenerator,
  TokenizerAdapter,
  Turn,
  TurnSelector,
} from './types';

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

export interface ResolvedCompressionExecution {
  readonly tokenizer: TokenizerAdapter;
  readonly contextBudget: Readonly<ResolvedContextBudget>;
  readonly keepRecent: number;
  readonly strategyKind: CompressStrategyKind;
  readonly selector: TurnSelector;
  readonly summaryGenerator: SummaryGenerator;
  readonly mutationHook?: LifecycleMutationHook;
  readonly dryRun: boolean;
}

const snapshotTokenizer = (source: TokenizerAdapter): TokenizerAdapter => {
  const countText = source.countText.bind(source);
  const dispose = source.dispose?.bind(source);
  return Object.freeze({
    id: source.id,
    model: source.model,
    kind: source.kind,
    messageOverheadTokens: source.messageOverheadTokens,
    countText,
    ...(dispose ? { dispose } : {}),
  });
};

const snapshotSemanticProvider = (
  source: SemanticSummaryProvider
): SemanticSummaryProvider => {
  if (!source || typeof source.summarize !== 'function') {
    throw new Error('semantic summary requires a provider');
  }
  if (typeof source.id !== 'string' || source.id.trim().length === 0) {
    throw new Error('semantic summary provider id must be non-empty');
  }
  const summarize = source.summarize.bind(source);
  return Object.freeze({ id: source.id, summarize });
};

const snapshotSummaryOptions = (
  source: SummaryOptions | undefined
): SummaryOptions | undefined => {
  if (!source) return undefined;
  if (source.kind === 'semantic') {
    return Object.freeze({
      ...source,
      provider: snapshotSemanticProvider(source.provider),
    });
  }
  return Object.freeze({ ...source });
};

export const resolveCompressionExecution = (
  options: CompressOptions
): ResolvedCompressionExecution => {
  let summary: SummaryOptions | undefined;
  try {
    summary = snapshotSummaryOptions(options.summary);
  } catch (error) {
    throw lifecycleError(
      'INVALID_OPTIONS',
      error instanceof Error ? error.message : String(error)
    );
  }
  const normalized: CompressOptions = {
    ...options,
    ...(options.budget ? { budget: { ...options.budget } } : {}),
    ...(summary ? { summary } : {}),
  };
  const sourceTokenizer = normalized.tokenizer ?? heuristicTokenizer;
  assertTokenizerAdapter(sourceTokenizer);
  const tokenizer = snapshotTokenizer(sourceTokenizer);
  const keepRecent = normalized.keepRecent ?? 4;
  if (!Number.isInteger(keepRecent) || keepRecent < 0) {
    throw new Error(`keepRecent must be a non-negative integer: ${keepRecent}`);
  }
  const strategyKind = normalized.strategy ?? 'sliding-window';
  let selector: TurnSelector;
  let summaryGenerator: SummaryGenerator;
  try {
    selector = createTurnSelector(strategyKind);
    summaryGenerator = createSummaryGenerator(normalized.summary);
  } catch (error) {
    throw lifecycleError(
      'INVALID_OPTIONS',
      error instanceof Error ? error.message : String(error)
    );
  }
  return Object.freeze({
    tokenizer,
    contextBudget: Object.freeze(resolveContextBudget(normalized)),
    keepRecent,
    strategyKind,
    selector,
    summaryGenerator,
    mutationHook: normalized.mutationHook,
    dryRun: normalized.dryRun === true,
  });
};

export const cloneCompressionExecution = (
  execution: ResolvedCompressionExecution,
  overrides: Partial<
    Pick<ResolvedCompressionExecution, 'dryRun' | 'mutationHook'>
  >
): ResolvedCompressionExecution => Object.freeze({ ...execution, ...overrides });

export const inspectCompressionLifecycleState = async (
  directory: string,
  execution: ResolvedCompressionExecution
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

  const turns = await scanTurns(directory, execution.tokenizer);
  const tokens = estimateTotalTokens(turns);
  const live: LiveSnapshot = {
    turns,
    tokens,
    triggerTokens: execution.contextBudget.triggerTokens,
    triggerReached: tokens >= execution.contextBudget.triggerTokens,
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
