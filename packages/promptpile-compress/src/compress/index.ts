import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findArchiveDirs,
  findStagingDir,
  STAGING_DIR,
} from '../restore/scanner';
import { recover, restoreArchivedTurns } from '../restore';
import { scanTurns } from './scanner';
import { createStrategy } from './strategy';
import { estimateTextTokens, estimateTotalTokens } from './tokenizer';
import type {
  CompressionManifest,
  CompressOptions,
  CompressResult,
  CompressStrategyKind,
  Turn,
} from './types';

const DEFAULT_THRESHOLD = 32_000;
const DEFAULT_KEEP_RECENT = 4;
const DEFAULT_STRATEGY: CompressStrategyKind = 'sliding-window';
const SUMMARY_TEMP_FILE = '.summary.md';

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

const atomicWrite = async (targetPath: string, content: string): Promise<void> => {
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  const handle = await fs.open(tempPath, 'w');
  try {
    await handle.writeFile(content, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tempPath, targetPath);
};

const assertNoArchiveConflict = async (
  directory: string,
  summaryIdx: number
): Promise<void> => {
  const archivePath = path.join(directory, `[${summaryIdx}]system.md.archive`);
  if (await pathExists(archivePath)) {
    throw new Error(`归档目录已存在，拒绝覆盖: ${archivePath}`);
  }
};

const writeJson = async (targetPath: string, value: unknown): Promise<void> => {
  await atomicWrite(targetPath, `${JSON.stringify(value, null, 2)}\n`);
};

const prepareStaging = async (
  directory: string,
  archiveTurns: Turn[],
  summary: string,
  summaryIdx: number,
  strategy: CompressStrategyKind,
  originalTokenCount: number,
  compressedTokenCount: number
): Promise<string> => {
  const existingStaging = await findStagingDir(directory);
  if (existingStaging) {
    throw new Error(`staging 已存在: ${existingStaging}`);
  }
  await assertNoArchiveConflict(directory, summaryIdx);

  const staging = path.join(directory, STAGING_DIR);
  await fs.mkdir(staging);

  for (const turn of archiveTurns.sort((a, b) => a.idx - b.idx)) {
    for (const file of turn.files) {
      await fs.rename(path.join(directory, file.name), path.join(staging, file.name));
    }
  }

  const manifest: CompressionManifest = {
    version: 1,
    compressedAt: new Date().toISOString(),
    strategy,
    originalTokenCount,
    compressedTokenCount,
    archivedTurnIndices: archiveTurns.map((turn) => turn.idx).sort((a, b) => a - b),
  };
  await writeJson(path.join(staging, 'compression.json'), manifest);
  await atomicWrite(path.join(staging, SUMMARY_TEMP_FILE), summary);

  return staging;
};

const commitStaging = async (
  directory: string,
  summaryIdx: number
): Promise<string> => {
  const staging = path.join(directory, STAGING_DIR);
  const archivePath = path.join(directory, `[${summaryIdx}]system.md.archive`);
  await fs.rename(staging, archivePath);
  const summary = await fs.readFile(path.join(archivePath, SUMMARY_TEMP_FILE), 'utf8');
  await atomicWrite(path.join(directory, `[${summaryIdx}]system.md`), summary);
  return archivePath;
};

export const compressDirectory = async (
  options: CompressOptions
): Promise<CompressResult> => {
  const directory = await assertDirectory(options.directory);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const strategyKind = options.strategy ?? DEFAULT_STRATEGY;
  const dryRun = options.dryRun === true;

  if (!Number.isInteger(threshold) || threshold < 0) {
    throw new Error(`threshold 必须是非负整数: ${threshold}`);
  }
  if (!Number.isInteger(keepRecent) || keepRecent < 0) {
    throw new Error(`keepRecent 必须是非负整数: ${keepRecent}`);
  }

  const recoveryActions = await recover(directory, { dryRun });
  if (dryRun && recoveryActions.length > 0) {
    return {
      compressed: false,
      skipReason: 'dry_run',
      turnsArchived: 0,
      turnsKept: 0,
      tokensBefore: 0,
      tokensAfter: 0,
    };
  }

  const archives = await findArchiveDirs(directory);
  if (archives.length > 0) {
    if (dryRun) {
      return {
        compressed: false,
        skipReason: 'dry_run',
        turnsArchived: 0,
        turnsKept: 0,
        tokensBefore: 0,
        tokensAfter: 0,
      };
    }
    await restoreArchivedTurns({ directory });
  }

  const turns = await scanTurns(directory);
  if (turns.length === 0) {
    return {
      compressed: false,
      skipReason: 'no_turns_to_compress',
      turnsArchived: 0,
      turnsKept: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      compressibleTokens: 0,
    };
  }

  const tokensBefore = estimateTotalTokens(turns);
  const compressibleTokens = estimateTotalTokens(
    turns.filter((turn) => !turn.isSystemTurn)
  );

  if (tokensBefore < threshold) {
    return {
      compressed: false,
      skipReason: 'below_threshold',
      turnsArchived: 0,
      turnsKept: turns.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressibleTokens,
    };
  }

  if (compressibleTokens <= 0) {
    return {
      compressed: false,
      skipReason: 'no_turns_to_compress',
      turnsArchived: 0,
      turnsKept: turns.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressibleTokens,
    };
  }

  const strategy = createStrategy(strategyKind);
  const { keep, archive } = strategy.selectTurns(turns, { keepRecent });
  if (archive.length === 0) {
    return {
      compressed: false,
      skipReason: 'no_turns_to_compress',
      turnsArchived: 0,
      turnsKept: keep.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressibleTokens,
    };
  }

  const summary = await strategy.generateSummary(archive);
  const summaryIdx = Math.max(...archive.map((turn) => turn.idx));
  const summaryTokens = estimateTextTokens(summary) + 30;
  const tokensAfter = estimateTotalTokens(keep) + summaryTokens;

  if (dryRun) {
    return {
      compressed: false,
      skipReason: 'dry_run',
      turnsArchived: archive.length,
      turnsKept: keep.length,
      tokensBefore,
      tokensAfter,
      compressibleTokens,
      summaryIdx,
    };
  }

  await prepareStaging(
    directory,
    archive,
    summary,
    summaryIdx,
    strategyKind,
    tokensBefore,
    summaryTokens
  );
  const archivePath = await commitStaging(directory, summaryIdx);

  return {
    compressed: true,
    turnsArchived: archive.length,
    turnsKept: keep.length,
    tokensBefore,
    tokensAfter,
    compressibleTokens,
    summaryIdx,
    archivePath,
  };
};

export type { CompressOptions, CompressResult } from './types';
