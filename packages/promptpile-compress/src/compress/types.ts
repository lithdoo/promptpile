import type { LifecycleMutationHook } from '../lifecycle/mutation';

export type MessageRole = string;
export type MessageExtension = 'md' | 'json' | 'jsonl';
export type MessageFileKind = 'message' | 'calls' | 'result' | 'extra';

export interface ScannedFile {
  name: string;
  path: string;
  idx: number;
  role: MessageRole;
  extension: MessageExtension;
  fileKind: MessageFileKind;
}

export interface Turn {
  idx: number;
  files: ScannedFile[];
  estimatedTokens: number;
  isSystemTurn: boolean;
  hasToolCalls: boolean;
}

export type CompressStrategyKind = 'sliding-window';
export type SummaryKind = 'archive-pointer' | 'semantic';

export interface SemanticSummaryItem {
  text: string;
  sourceTurnIndices: number[];
}

export interface SemanticSummaryDocument {
  version: 1;
  goal: SemanticSummaryItem[];
  stableFacts: SemanticSummaryItem[];
  constraints: SemanticSummaryItem[];
  decisions: SemanticSummaryItem[];
  importantToolFindings: SemanticSummaryItem[];
  completedWork: SemanticSummaryItem[];
  unresolvedWork: SemanticSummaryItem[];
  failedApproaches: SemanticSummaryItem[];
  nextActions: SemanticSummaryItem[];
}

export interface SemanticSummaryArtifact {
  name: string;
  role: MessageRole;
  extension: MessageExtension;
  fileKind: MessageFileKind;
  content: string;
}

export interface SemanticSummaryTurn {
  idx: number;
  estimatedTokens: number;
  hasToolCalls: boolean;
  artifacts: SemanticSummaryArtifact[];
}

export interface SemanticSummaryRequest {
  version: 1;
  turns: SemanticSummaryTurn[];
  budget: {
    estimatedInputTokens: number;
    maxInputTokens: number;
    maxOutputTokens: number;
  };
}

export interface SemanticSummaryProvider {
  readonly id: string;
  summarize(
    request: SemanticSummaryRequest,
    signal: AbortSignal
  ): Promise<unknown>;
}

export type SummaryOptions =
  | { kind?: 'archive-pointer' }
  | {
      kind: 'semantic';
      provider: SemanticSummaryProvider;
      maxInputTokens?: number;
      maxOutputTokens?: number;
      timeoutMs?: number;
    };

export interface CompressOptions {
  directory: string;
  threshold?: number;
  keepRecent?: number;
  strategy?: CompressStrategyKind;
  /** Defaults to a deterministic archive pointer and never performs I/O. */
  summary?: SummaryOptions;
  dryRun?: boolean;
  /** Experimental fault-injection/observability boundary for lifecycle writes. */
  mutationHook?: LifecycleMutationHook;
}

export type CompressSkipReason =
  | 'below_threshold'
  | 'no_turns_to_compress'
  | 'dry_run';

export interface CompressDryRunPlan {
  recoveryActions: string[];
  archivesToRestore: number;
  outcome: 'compressed' | 'below_threshold' | 'no_turns_to_compress';
}

export interface CompressResult {
  compressed: boolean;
  turnsArchived: number;
  turnsKept: number;
  /** Estimated tokens across all live turns before compression. */
  tokensBefore: number;
  /** Estimated tokens across kept live turns plus the new summary. */
  tokensAfter: number;
  /** Estimated tokens across non-system turns eligible for selection. */
  compressibleTokens?: number;
  summaryIdx?: number;
  archivePath?: string;
  skipReason?: CompressSkipReason;
  dryRunPlan?: CompressDryRunPlan;
}

export interface CompressionManifest {
  version: 1;
  compressedAt: string;
  strategy: CompressStrategyKind;
  summaryKind: SummaryKind;
  summaryProvider?: string;
  /** Estimated tokens across all live turns before compression. */
  liveTokenCountBefore: number;
  /** Estimated tokens for the generated summary message only. */
  summaryTokenCount: number;
  /** Estimated tokens across kept live turns plus the new summary. */
  liveTokenCountAfter: number;
  archivedTurnIndices: number[];
}

export interface TurnSelector {
  readonly kind: CompressStrategyKind;

  selectTurns(
    turns: Turn[],
    options: { keepRecent: number }
  ): { keep: Turn[]; archive: Turn[] };
}

export interface SummaryGenerator {
  readonly kind: SummaryKind;
  readonly providerId?: string;
  generateSummary(archive: Turn[]): Promise<string>;
}
