import fs from 'node:fs/promises';
import path from 'node:path';
import { withDirectoryLifecycleLock } from '../lifecycle/lock';
import { archiveStateInvalid } from '../lifecycle/errors';
import { resolveLifecycleDirectory } from '../lifecycle/directory';
import { runLifecycleMutation } from '../lifecycle/mutation';
import { inspectArchiveSet, inspectStagingState } from './inspection';
import { listMessageFiles } from './scanner';
import type { PreparedArchive } from './inspection';
import type {
  RecoveryAction,
  RecoveryOptions,
  RestoreOptions,
  RestoreResult,
} from './types';

export const recoverWithLockHeld = async (
  directory: string,
  options: RecoveryOptions = {}
): Promise<RecoveryAction[]> => {
  const staging = await inspectStagingState(directory);
  if (staging.state === 'absent') return [];
  if (staging.state === 'invalid' && staging.reason === 'staging_path_invalid') {
    throw archiveStateInvalid(staging.reason);
  }

  const archiveSet = await inspectArchiveSet(directory);
  if (archiveSet.state === 'invalid') throw archiveStateInvalid(archiveSet.reason);
  if (archiveSet.state === 'valid') {
    throw archiveStateInvalid('staging_archive_conflict');
  }
  if (staging.state === 'invalid') throw archiveStateInvalid(staging.reason);

  const actions: RecoveryAction[] =
    staging.messageFiles.length > 0
      ? staging.messageFiles.map((detail) => ({ kind: 'rollback_staging', detail }))
      : [{ kind: 'rollback_staging', detail: '清理空 staging' }];
  if (options.dryRun) return actions;

  for (const fileName of staging.messageFiles) {
    const sourcePath = path.join(staging.path, fileName);
    const targetPath = path.join(directory, fileName);
    await runLifecycleMutation(
      options.mutationHook,
      { point: 'rollback_staging_file', sourcePath, targetPath },
      () => fs.rename(sourcePath, targetPath)
    );
  }
  const afterMove = await inspectStagingState(directory);
  if (afterMove.state === 'invalid') throw archiveStateInvalid(afterMove.reason);
  if (afterMove.state === 'recoverable' && afterMove.messageFiles.length > 0) {
    throw archiveStateInvalid('recovery_did_not_normalize');
  }
  await runLifecycleMutation(
    options.mutationHook,
    { point: 'remove_staging', targetPath: staging.path },
    () => fs.rm(staging.path, { recursive: true })
  );
  return actions;
};

export const recover = async (
  directory: string,
  options: RecoveryOptions = {}
): Promise<RecoveryAction[]> => {
  const resolved = await resolveLifecycleDirectory(directory);
  return withDirectoryLifecycleLock(resolved, 'recover', () =>
    recoverWithLockHeld(resolved, options)
  );
};

const restorePreparedArchives = async (
  options: RestoreOptions,
  directory: string,
  prepared: PreparedArchive[],
  recoveryActions: RecoveryAction[] = []
): Promise<RestoreResult> => {
  const allIndices = new Set<number>();
  for (const item of prepared) {
    for (const idx of item.metadata.archivedTurnIndices) allIndices.add(idx);
  }
  if (options.dryRun) {
    return {
      restored: false,
      skipReason: 'dry_run',
      turnsRestored: allIndices.size,
      archivesRestored: prepared.length,
      recoveryActions,
    };
  }

  for (const item of prepared) {
    const summaryPath = path.join(directory, `[${item.archive.idx}]system.md`);
    await runLifecycleMutation(
      options.mutationHook,
      { point: 'delete_live_summary', targetPath: summaryPath },
      async () => {
        try {
          await fs.unlink(summaryPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    );
  }
  for (const item of prepared) {
    for (const fileName of item.messageFiles) {
      const sourcePath = path.join(item.archive.path, fileName);
      const targetPath = path.join(directory, fileName);
      await runLifecycleMutation(
        options.mutationHook,
        { point: 'restore_message', sourcePath, targetPath },
        () => fs.rename(sourcePath, targetPath)
      );
    }
  }
  for (const item of prepared) {
    if ((await listMessageFiles(item.archive.path)).length > 0) {
      throw archiveStateInvalid('archive_target_conflict');
    }
  }
  for (const item of prepared) {
    await runLifecycleMutation(
      options.mutationHook,
      { point: 'remove_archive', targetPath: item.archive.path },
      () => fs.rm(item.archive.path, { recursive: true })
    );
  }
  return {
    restored: true,
    turnsRestored: allIndices.size,
    archivesRestored: prepared.length,
    summaryIndices: prepared.map((item) => item.archive.idx),
    archivePaths: prepared.map((item) => item.archive.path),
    recoveryActions,
  };
};

/** Restore only. Callers own recovery policy before entering this function. */
export const restoreArchivedTurnsWithLockHeld = async (
  options: RestoreOptions,
  directory: string
): Promise<RestoreResult> => {
  const inspection = await inspectArchiveSet(directory);
  if (inspection.state === 'invalid') throw archiveStateInvalid(inspection.reason);
  if (inspection.state === 'absent') {
    return { restored: false, skipReason: 'no_archive_found', recoveryActions: [] };
  }
  return restorePreparedArchives(options, directory, inspection.archives);
};

export const restoreArchivedTurns = async (
  options: RestoreOptions
): Promise<RestoreResult> => {
  const directory = await resolveLifecycleDirectory(options.directory);
  return withDirectoryLifecycleLock(directory, 'restore', async () => {
    const recoveryActions = await recoverWithLockHeld(directory, {
      dryRun: options.dryRun,
      mutationHook: options.mutationHook,
    });
    if (options.dryRun && recoveryActions.length > 0) {
      return { restored: false, skipReason: 'dry_run', recoveryActions };
    }
    const result = await restoreArchivedTurnsWithLockHeld(options, directory);
    return { ...result, recoveryActions };
  });
};

export type { RecoveryOptions, RestoreOptions, RestoreResult } from './types';
