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
  /** Cached during scanning to avoid rereading artifacts for tokenization/providers. */
  content?: string;
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

export interface TokenizerAdapter {
  readonly id: string;
  readonly model: string;
  readonly kind: 'exact' | 'heuristic-fallback';
  readonly messageOverheadTokens: number;
  countText(content: string): number;
  dispose?(): void;
}

export interface ContextBudgetOptions {
  modelContextTokens?: number;
  reservedOutputTokens?: number;
  systemToolOverheadTokens?: number;
  targetLiveHistoryTokens?: number;
  summaryOutputTokens?: number;
  safetyMarginTokens?: number;
}

export interface ContextBudgetReport {
  mode: 'context-budget' | 'legacy-threshold';
  /** Whether summaryTokens is measured output or a planning upper bound. */
  summaryTokenBasis: 'actual' | 'upper-bound';
  tokenizer: Pick<TokenizerAdapter, 'id' | 'model' | 'kind'>;
  modelContextTokens?: number;
  reservedOutputTokens: number;
  systemToolOverheadTokens: number;
  targetLiveHistoryTokens: number;
  summaryOutputLimitTokens: number;
  safetyMarginTokens: number;
  triggerTokens: number;
  tokensBefore: number;
  keptHistoryTokens: number;
  summaryTokens: number;
  totalPlannedTokens: number;
  remainingContextTokens?: number;
}

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
  /** Context-aware replacement for threshold. Cannot be combined with threshold. */
  budget?: ContextBudgetOptions;
  /** Defaults to the explicit heuristic fallback adapter. */
  tokenizer?: TokenizerAdapter;
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
  /** Kept live tokens plus the actual summary or dry-run summary upper bound. */
  tokensAfter: number;
  /** Estimated tokens across non-system turns eligible for selection. */
  compressibleTokens?: number;
  summaryIdx?: number;
  archivePath?: string;
  skipReason?: CompressSkipReason;
  dryRunPlan?: CompressDryRunPlan;
  budget: ContextBudgetReport;
  recoveryActions: string[];
  archivesRestored: number;
  selection: {
    archivedTurnIndices: number[];
    keptTurnIndices: number[];
  };
}

export type LifecycleErrorCode =
  | 'LIFECYCLE_LOCKED'
  | 'CONVERSATION_CHANGED'
  | 'SUMMARY_PROVIDER_FAILED'
  | 'BUDGET_INVALID_OR_EXCEEDED'
  | 'ARCHIVE_STATE_INVALID'
  | 'INVALID_OPTIONS'
  | 'IO_ERROR'
  | 'COMPLETION_FAILED'
  | 'UNKNOWN';

export interface OperationPhaseReport {
  phase:
    | 'acquire_exclusive'
    | 'maintain_context'
    | 'release_exclusive'
    | 'completion';
  status: 'completed' | 'failed' | 'skipped';
  durationMs: number;
}

interface CompressionDecisionBase {
  liveTokens: number;
  triggerTokens: number;
}

export type CompressionDecisionReport =
  | (CompressionDecisionBase & {
      liveState: 'healthy_plain';
      triggerReached: boolean;
      action: 'skip';
      reason: 'no_turns_to_compress';
    })
  | (CompressionDecisionBase & {
      liveState: 'healthy_plain' | 'healthy_compacted';
      triggerReached: false;
      action: 'skip';
      reason: 'below_threshold';
    })
  | (CompressionDecisionBase & {
      liveState: 'healthy_plain';
      triggerReached: true;
      action: 'evaluate_current';
    })
  | (CompressionDecisionBase & {
      liveState: 'healthy_compacted';
      triggerReached: true;
      action: 'restore_then_evaluate';
    });

export type CompressionCommitReport =
  | { state: 'not_started' }
  | { state: 'skipped' }
  | { state: 'incomplete'; summaryIdx: number }
  | { state: 'committed'; summaryIdx: number };

export interface CompressionOperationReport {
  version: 2;
  operation: 'compress-before-completion';
  status: 'completed' | 'failed';
  phases: OperationPhaseReport[];
  decision?: CompressionDecisionReport;
  recoveryActions: string[];
  archivesRestored: number;
  selection?: CompressResult['selection'];
  budget?: ContextBudgetReport;
  commit: CompressionCommitReport;
  error?: {
    code: LifecycleErrorCode;
    message: string;
    retryable: boolean;
  };
}

export type CompressionLifecycleResult<T> =
  | {
      ok: true;
      compression: CompressResult;
      completion: T;
      report: CompressionOperationReport;
    }
  | { ok: false; report: CompressionOperationReport };

export interface CompressionLifecycleOptions<T> {
  compression: Omit<CompressOptions, 'dryRun'>;
  completion: (compression: CompressResult) => Promise<T>;
}

export interface CompressionManifest {
  version: 1;
  compressedAt: string;
  strategy: CompressStrategyKind;
  summaryKind: SummaryKind;
  summaryProvider?: string;
  tokenizer: Pick<TokenizerAdapter, 'id' | 'model' | 'kind'>;
  budget: ContextBudgetReport;
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
    options: { keepRecent: number; maxKeptTokens?: number }
  ): { keep: Turn[]; archive: Turn[] };
}

export interface SummaryGenerator {
  readonly kind: SummaryKind;
  readonly providerId?: string;
  generateSummary(
    archive: Turn[],
    options: { tokenizer: TokenizerAdapter; maxOutputTokens: number }
  ): Promise<string>;
}
