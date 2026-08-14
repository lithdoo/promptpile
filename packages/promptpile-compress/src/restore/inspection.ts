import fs from 'node:fs/promises';
import path from 'node:path';
import { classifyConversationArtifactNameV1 } from 'promptpile-protocol/conversation';
import type { ArchiveDir, CompressionMetadata } from './types';
import { STAGING_DIR } from './scanner';

const ARCHIVE_DIR_PATTERN = /^\[(\d+)\]system\.md\.archive$/;

export type InvalidLifecycleReason =
  | 'staging_path_invalid'
  | 'staging_archive_conflict'
  | 'staging_target_conflict'
  | 'archive_path_invalid'
  | 'archive_metadata_invalid'
  | 'archive_set_conflict'
  | 'archive_target_conflict'
  | 'archive_summary_path_invalid';

export type LifecycleFailureReason =
  | InvalidLifecycleReason
  | 'recovery_did_not_normalize';

export interface PreparedArchive {
  archive: ArchiveDir;
  metadata: CompressionMetadata;
  messageFiles: string[];
  summaryPresent: boolean;
}

export type StagingInspection =
  | { state: 'absent' }
  | { state: 'recoverable'; path: string; messageFiles: string[] }
  | { state: 'invalid'; reason: 'staging_path_invalid' | 'staging_target_conflict' };

export type ArchiveSetInspection =
  | { state: 'absent' }
  | { state: 'valid'; archives: PreparedArchive[]; allSummariesPresent: boolean }
  | {
      state: 'invalid';
      reason:
        | 'archive_path_invalid'
        | 'archive_metadata_invalid'
        | 'archive_set_conflict'
        | 'archive_target_conflict'
        | 'archive_summary_path_invalid';
    };

const exists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.lstat(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

const listMessageFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        classifyConversationArtifactNameV1(entry.name) !== undefined
    )
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
};

const readMetadata = async (
  archive: ArchiveDir
): Promise<CompressionMetadata | undefined> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await fs.readFile(path.join(archive.path, 'compression.json'), 'utf8')
    );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.archivedTurnIndices)) {
    return undefined;
  }
  const indices = record.archivedTurnIndices;
  if (
    indices.length === 0 ||
    !indices.every((value) => Number.isInteger(value) && (value as number) >= 0) ||
    new Set(indices).size !== indices.length
  ) {
    return undefined;
  }
  const archivedTurnIndices = indices as number[];
  if (Math.max(...archivedTurnIndices) !== archive.idx) return undefined;
  return { version: 1, archivedTurnIndices: [...archivedTurnIndices] };
};

export const inspectStagingState = async (
  directory: string
): Promise<StagingInspection> => {
  const stagingPath = path.join(directory, STAGING_DIR);
  let stat;
  try {
    stat = await fs.lstat(stagingPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    return { state: 'invalid', reason: 'staging_path_invalid' };
  }
  const messageFiles = await listMessageFiles(stagingPath);
  for (const fileName of messageFiles) {
    if (await exists(path.join(directory, fileName))) {
      return { state: 'invalid', reason: 'staging_target_conflict' };
    }
  }
  return { state: 'recoverable', path: stagingPath, messageFiles };
};

export const inspectArchiveSet = async (
  directory: string
): Promise<ArchiveSetInspection> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const archives: ArchiveDir[] = [];
  for (const entry of entries) {
    const match = entry.name.match(ARCHIVE_DIR_PATTERN);
    if (!match) continue;
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      return { state: 'invalid', reason: 'archive_path_invalid' };
    }
    archives.push({
      idx: Number.parseInt(match[1], 10),
      name: entry.name,
      path: path.join(directory, entry.name),
    });
  }
  if (archives.length === 0) return { state: 'absent' };
  archives.sort((a, b) => b.idx - a.idx || a.name.localeCompare(b.name));

  const prepared: PreparedArchive[] = [];
  for (const archive of archives) {
    const metadata = await readMetadata(archive);
    if (!metadata) return { state: 'invalid', reason: 'archive_metadata_invalid' };
    const messageFiles = await listMessageFiles(archive.path);
    const declaredIndices = new Set(metadata.archivedTurnIndices);
    if (
      messageFiles.some((fileName) => {
        const artifact = classifyConversationArtifactNameV1(fileName);
        return artifact === undefined || !declaredIndices.has(artifact.idx);
      })
    ) {
      return { state: 'invalid', reason: 'archive_metadata_invalid' };
    }
    const summaryPath = path.join(directory, `[${archive.idx}]system.md`);
    let summaryPresent = false;
    try {
      const summaryStat = await fs.lstat(summaryPath);
      if (!summaryStat.isFile() || summaryStat.isSymbolicLink()) {
        return { state: 'invalid', reason: 'archive_summary_path_invalid' };
      }
      summaryPresent = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    prepared.push({ archive, metadata, messageFiles, summaryPresent });
  }

  const indices = new Set<number>();
  const files = new Set<string>();
  for (const item of prepared) {
    for (const idx of item.metadata.archivedTurnIndices) {
      if (indices.has(idx)) return { state: 'invalid', reason: 'archive_set_conflict' };
      indices.add(idx);
    }
    for (const fileName of item.messageFiles) {
      if (files.has(fileName)) return { state: 'invalid', reason: 'archive_set_conflict' };
      files.add(fileName);
    }
  }
  for (const fileName of files) {
    if (await exists(path.join(directory, fileName))) {
      return { state: 'invalid', reason: 'archive_target_conflict' };
    }
  }
  return {
    state: 'valid',
    archives: prepared,
    allSummariesPresent: prepared.every((item) => item.summaryPresent),
  };
};
