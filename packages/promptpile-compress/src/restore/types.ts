import type { LifecycleMutationHook } from '../lifecycle/mutation';

export interface CompressionMetadata {
  version: 1;
  archivedTurnIndices: number[];
}

export interface ArchiveDir {
  idx: number;
  name: string;
  path: string;
}

export interface RecoveryAction {
  kind: 'rollback_staging';
  detail: string;
}

export interface RestoreOptions {
  directory: string;
  dryRun?: boolean;
  /** Experimental fault-injection/observability boundary for lifecycle writes. */
  mutationHook?: LifecycleMutationHook;
}

export interface RecoveryOptions {
  dryRun?: boolean;
  mutationHook?: LifecycleMutationHook;
}

export type RestoreResult =
  | {
      restored: true;
      turnsRestored: number;
      archivesRestored: number;
      summaryIndices: number[];
      archivePaths: string[];
      recoveryActions: RecoveryAction[];
    }
  | {
      restored: false;
      skipReason: 'no_archive_found' | 'dry_run' | 'rolled_back_staging';
      turnsRestored?: number;
      archivesRestored?: number;
      recoveryActions: RecoveryAction[];
    };
