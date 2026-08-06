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

export interface CompressOptions {
  directory: string;
  threshold?: number;
  keepRecent?: number;
  strategy?: CompressStrategyKind;
  dryRun?: boolean;
}

export type CompressSkipReason =
  | 'below_threshold'
  | 'no_turns_to_compress'
  | 'dry_run';

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
}

export interface CompressionManifest {
  version: 1;
  compressedAt: string;
  strategy: CompressStrategyKind;
  /** Estimated tokens across all live turns before compression. */
  liveTokenCountBefore: number;
  /** Estimated tokens for the generated summary message only. */
  summaryTokenCount: number;
  /** Estimated tokens across kept live turns plus the new summary. */
  liveTokenCountAfter: number;
  archivedTurnIndices: number[];
}

export interface CompressStrategy {
  readonly kind: CompressStrategyKind;

  selectTurns(
    turns: Turn[],
    options: { keepRecent: number }
  ): { keep: Turn[]; archive: Turn[] };

  generateSummary(archive: Turn[]): Promise<string>;
}
