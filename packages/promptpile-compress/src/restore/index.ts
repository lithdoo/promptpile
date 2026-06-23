import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findArchiveDirs,
  findStagingDir,
  listMessageFiles,
} from './scanner';
import type {
  ArchiveDir,
  CompressionMetadata,
  RecoveryAction,
  RestoreOptions,
  RestoreResult,
} from './types';

interface PreparedArchive {
  archive: ArchiveDir;
  metadata: CompressionMetadata;
  messageFiles: string[];
}

const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const assertDirectory = async (directory: string): Promise<string> => {
  const resolved = path.resolve(directory);
  let stat;
  try {
    stat = await fs.stat(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`目录不存在: ${resolved}`);
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new Error(`路径不是目录: ${resolved}`);
  }
  await fs.access(resolved, constants.R_OK | constants.W_OK);
  return resolved;
};

const readCompressionMetadata = async (
  archive: ArchiveDir
): Promise<CompressionMetadata> => {
  const metadataPath = path.join(archive.path, 'compression.json');
  let parsed: unknown;

  try {
    parsed = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`缺少 compression.json: ${metadataPath}`);
    }
    throw new Error(
      `无法读取 compression.json: ${metadataPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`compression.json 必须是对象: ${metadataPath}`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error(`不支持的 compression.json version: ${metadataPath}`);
  }
  if (!Array.isArray(record.archivedTurnIndices) || record.archivedTurnIndices.length === 0) {
    throw new Error(`archivedTurnIndices 必须是非空数组: ${metadataPath}`);
  }

  const indices = record.archivedTurnIndices;
  if (
    !indices.every(
      (value): value is number => Number.isInteger(value) && (value as number) >= 0
    )
  ) {
    throw new Error(`archivedTurnIndices 必须只包含非负整数: ${metadataPath}`);
  }
  if (new Set(indices).size !== indices.length) {
    throw new Error(`archivedTurnIndices 不能包含重复 idx: ${metadataPath}`);
  }
  const archivedTurnIndices = indices as number[];
  if (Math.max(...archivedTurnIndices) !== archive.idx) {
    throw new Error(
      `归档目录 idx 与 archivedTurnIndices 不一致: ${archive.name}`
    );
  }

  return {
    version: 1,
    archivedTurnIndices: [...archivedTurnIndices],
  };
};

const assertNoTargetConflicts = async (
  directory: string,
  fileNames: Iterable<string>
): Promise<void> => {
  const conflicts: string[] = [];
  for (const fileName of fileNames) {
    if (await pathExists(path.join(directory, fileName))) {
      conflicts.push(fileName);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`目标文件已存在，拒绝覆盖: ${conflicts.join(', ')}`);
  }
};

const prepareArchives = async (directory: string): Promise<PreparedArchive[]> => {
  const archives = await findArchiveDirs(directory);
  const prepared = await Promise.all(
    archives.map(async (archive) => ({
      archive,
      metadata: await readCompressionMetadata(archive),
      messageFiles: await listMessageFiles(archive.path),
    }))
  );

  const seenIndices = new Set<number>();
  const duplicateIndices = new Set<number>();
  const seenFiles = new Set<string>();
  const duplicateFiles = new Set<string>();

  for (const item of prepared) {
    for (const idx of item.metadata.archivedTurnIndices) {
      if (seenIndices.has(idx)) {
        duplicateIndices.add(idx);
      }
      seenIndices.add(idx);
    }
    for (const fileName of item.messageFiles) {
      if (seenFiles.has(fileName)) {
        duplicateFiles.add(fileName);
      }
      seenFiles.add(fileName);
    }
  }

  if (duplicateIndices.size > 0) {
    throw new Error(
      `多个归档包含重复 idx: ${[...duplicateIndices].sort((a, b) => a - b).join(', ')}`
    );
  }
  if (duplicateFiles.size > 0) {
    throw new Error(
      `多个归档包含重复消息文件: ${[...duplicateFiles].sort().join(', ')}`
    );
  }

  await assertNoTargetConflicts(directory, seenFiles);
  return prepared;
};

export const recover = async (
  directory: string,
  options: { dryRun?: boolean } = {}
): Promise<RecoveryAction[]> => {
  const resolved = await assertDirectory(directory);
  const stagingPath = await findStagingDir(resolved);
  if (!stagingPath) {
    return [];
  }

  const archives = await findArchiveDirs(resolved);
  if (archives.length > 0) {
    throw new Error('staging 与 archive 同时存在，状态有歧义，拒绝自动恢复');
  }

  const messageFiles = await listMessageFiles(stagingPath);
  await assertNoTargetConflicts(resolved, messageFiles);
  const actions: RecoveryAction[] =
    messageFiles.length > 0
      ? messageFiles.map((fileName) => ({
          kind: 'rollback_staging' as const,
          detail: fileName,
        }))
      : [{ kind: 'rollback_staging', detail: '清理空 staging' }];

  if (options.dryRun) {
    return actions;
  }

  for (const fileName of messageFiles) {
    await fs.rename(path.join(stagingPath, fileName), path.join(resolved, fileName));
  }
  if ((await listMessageFiles(stagingPath)).length > 0) {
    throw new Error(`staging 中仍有消息文件，拒绝删除: ${stagingPath}`);
  }
  await fs.rm(stagingPath, { recursive: true });
  return actions;
};

export const restoreArchivedTurns = async (
  options: RestoreOptions
): Promise<RestoreResult> => {
  const directory = await assertDirectory(options.directory);
  const recoveryActions = await recover(directory, { dryRun: options.dryRun });

  if (options.dryRun && recoveryActions.length > 0) {
    return {
      restored: false,
      skipReason: 'dry_run',
      recoveryActions,
    };
  }

  const prepared = await prepareArchives(directory);
  if (prepared.length === 0) {
    return {
      restored: false,
      skipReason: recoveryActions.length > 0 ? 'rolled_back_staging' : 'no_archive_found',
      recoveryActions,
    };
  }

  const allIndices = new Set<number>();
  for (const item of prepared) {
    for (const idx of item.metadata.archivedTurnIndices) {
      allIndices.add(idx);
    }
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
    try {
      await fs.unlink(summaryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  for (const item of prepared) {
    for (const fileName of item.messageFiles) {
      await fs.rename(
        path.join(item.archive.path, fileName),
        path.join(directory, fileName)
      );
    }
  }

  for (const item of prepared) {
    if ((await listMessageFiles(item.archive.path)).length > 0) {
      throw new Error(`归档中仍有消息文件，拒绝删除: ${item.archive.path}`);
    }
  }
  for (const item of prepared) {
    await fs.rm(item.archive.path, { recursive: true });
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

export type { RestoreOptions, RestoreResult } from './types';
