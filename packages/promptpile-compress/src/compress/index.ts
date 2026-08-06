import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  findArchiveDirs,
  findStagingDir,
  STAGING_DIR,
} from '../restore/scanner';
import {
  recoverWithLockHeld,
  restoreArchivedTurnsWithLockHeld,
} from '../restore';
import {
  removeDirectoryLifecycleLockFiles,
  withDirectoryLifecycleLock,
} from '../lifecycle/lock';
import {
  assertConversationGeneration,
  captureConversationGeneration,
  scanTurns,
} from './scanner';
import { runLifecycleMutation } from '../lifecycle/mutation';
import type {
  LifecycleMutationHook,
  LifecycleMutationPoint,
} from '../lifecycle/mutation';
import { createTurnSelector } from './strategy';
import { createSummaryGenerator } from './summary';
import {
  estimateTextTokens,
  estimateTotalTokens,
  heuristicTokenizer,
  assertTokenizerAdapter,
} from './tokenizer';
import { createBudgetReport, resolveContextBudget } from './budget';
import type {
  CompressionManifest,
  CompressionLifecycleOptions,
  CompressionLifecycleResult,
  CompressionOperationReport,
  CompressOptions,
  CompressResult,
  CompressStrategyKind,
  ContextBudgetReport,
  LifecycleErrorCode,
  OperationPhaseReport,
  SummaryKind,
  TokenizerAdapter,
  Turn,
} from './types';

const DEFAULT_KEEP_RECENT = 4;
const DEFAULT_STRATEGY: CompressStrategyKind = 'sliding-window';
const SUMMARY_TEMP_FILE = '.summary.md';
const orchestratorQueues = new Map<string, Promise<void>>();

const serializeOrchestratorPhase = async <T>(
  directory: string,
  callback: () => Promise<T>
): Promise<T> => {
  const previous = orchestratorQueues.get(directory) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  orchestratorQueues.set(directory, tail);
  await previous.catch(() => undefined);
  try {
    return await callback();
  } finally {
    release();
    if (orchestratorQueues.get(directory) === tail) {
      orchestratorQueues.delete(directory);
    }
  }
};

const classifyLifecycleError = (
  error: unknown,
  completionPhase = false
): CompressionOperationReport['error'] => {
  if (completionPhase) {
    return {
      code: 'COMPLETION_FAILED',
      message: 'Completion failed after the lifecycle phase was released.',
      retryable: false,
    };
  }
  const raw = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const taggedCode = (
    error as { lifecycleErrorCode?: LifecycleErrorCode } | undefined
  )?.lifecycleErrorCode;
  let classified: LifecycleErrorCode = 'UNKNOWN';
  let retryable = false;
  if (taggedCode) {
    classified = taggedCode;
    retryable = taggedCode === 'SUMMARY_PROVIDER_FAILED';
  } else if (/lifecycle.*lock|生命周期.*锁|已被锁定/i.test(raw)) {
    classified = 'LIFECYCLE_LOCKED';
    retryable = true;
  } else if (/规划期间发生变化|conversation.*changed/i.test(raw)) {
    classified = 'CONVERSATION_CHANGED';
    retryable = true;
  } else if (/semantic summary|provider/i.test(raw)) {
    classified = 'SUMMARY_PROVIDER_FAILED';
    retryable = true;
  } else if (/budget|token count|tokenizer|context capacity/i.test(raw)) {
    classified = 'BUDGET_INVALID_OR_EXCEEDED';
  } else if (/archive|归档|staging|compression\.json/i.test(raw)) {
    classified = 'ARCHIVE_STATE_INVALID';
  } else if (/must be|不能与|不支持|invalid|非负整数/i.test(raw)) {
    classified = 'INVALID_OPTIONS';
  } else if (typeof code === 'string') {
    classified = 'IO_ERROR';
    retryable = ['EBUSY', 'EAGAIN', 'EMFILE', 'ENFILE'].includes(code);
  }
  const safeMessages: Record<LifecycleErrorCode, string> = {
    LIFECYCLE_LOCKED: 'The conversation lifecycle is busy; retry later.',
    CONVERSATION_CHANGED: 'The conversation changed during planning; retry.',
    SUMMARY_PROVIDER_FAILED: 'The semantic summary provider failed.',
    BUDGET_INVALID_OR_EXCEEDED: 'The context budget is invalid or exceeded.',
    ARCHIVE_STATE_INVALID: 'The archive lifecycle state requires attention.',
    INVALID_OPTIONS: 'The lifecycle options are invalid.',
    IO_ERROR: 'A filesystem operation failed.',
    COMPLETION_FAILED: 'Completion failed after lifecycle release.',
    UNKNOWN: 'The lifecycle operation failed.',
  };
  return { code: classified, message: safeMessages[classified], retryable };
};

const planOutcome = (
  result: CompressResult
): NonNullable<CompressionOperationReport['plan']>['outcome'] => {
  if (result.dryRunPlan) return result.dryRunPlan.outcome;
  if (
    result.skipReason === 'below_threshold' ||
    result.skipReason === 'no_turns_to_compress'
  ) {
    return result.skipReason;
  }
  return 'compressed';
};

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

const syncDirectory = async (directory: string): Promise<void> => {
  if (process.platform === 'win32') {
    return;
  }
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const atomicWrite = async (
  targetPath: string,
  content: string,
  hook: LifecycleMutationHook | undefined,
  point: LifecycleMutationPoint
): Promise<void> => {
  const tempPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  let committed = false;
  try {
    handle = await fs.open(tempPath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;

    await hook?.({ point, phase: 'before', targetPath });
    await fs.rename(tempPath, targetPath);
    committed = true;
    await syncDirectory(path.dirname(targetPath));
    await hook?.({ point, phase: 'after', targetPath });
  } finally {
    await handle?.close().catch(() => undefined);
    if (!committed) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
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

const writeJson = async (
  targetPath: string,
  value: unknown,
  hook: LifecycleMutationHook | undefined
): Promise<void> => {
  await atomicWrite(
    targetPath,
    `${JSON.stringify(value, null, 2)}\n`,
    hook,
    'write_manifest'
  );
};

const prepareStaging = async (
  directory: string,
  archiveTurns: Turn[],
  summary: string,
  summaryIdx: number,
  strategy: CompressStrategyKind,
  summaryKind: SummaryKind,
  summaryProvider: string | undefined,
  tokenizer: TokenizerAdapter,
  budget: ContextBudgetReport,
  liveTokenCountBefore: number,
  summaryTokenCount: number,
  liveTokenCountAfter: number,
  expectedGeneration: string,
  hook: LifecycleMutationHook | undefined
): Promise<string> => {
  const existingStaging = await findStagingDir(directory);
  if (existingStaging) {
    throw new Error(`staging 已存在: ${existingStaging}`);
  }
  await assertNoArchiveConflict(directory, summaryIdx);

  const staging = path.join(directory, STAGING_DIR);
  await runLifecycleMutation(
    hook,
    { point: 'create_staging', targetPath: staging },
    async () => {
      await assertConversationGeneration(directory, expectedGeneration);
      await fs.mkdir(staging);
    }
  );

  for (const turn of archiveTurns.sort((a, b) => a.idx - b.idx)) {
    for (const file of turn.files) {
      const sourcePath = path.join(directory, file.name);
      const targetPath = path.join(staging, file.name);
      await runLifecycleMutation(
        hook,
        { point: 'move_to_staging', sourcePath, targetPath },
        () => fs.rename(sourcePath, targetPath)
      );
    }
  }

  const manifest: CompressionManifest = {
    version: 1,
    compressedAt: new Date().toISOString(),
    strategy,
    summaryKind,
    ...(summaryProvider ? { summaryProvider } : {}),
    tokenizer: {
      id: tokenizer.id,
      model: tokenizer.model,
      kind: tokenizer.kind,
    },
    budget,
    liveTokenCountBefore,
    summaryTokenCount,
    liveTokenCountAfter,
    archivedTurnIndices: archiveTurns.map((turn) => turn.idx).sort((a, b) => a - b),
  };
  await writeJson(path.join(staging, 'compression.json'), manifest, hook);
  await atomicWrite(
    path.join(staging, SUMMARY_TEMP_FILE),
    summary,
    hook,
    'write_staged_summary'
  );

  return staging;
};

const commitStaging = async (
  directory: string,
  summaryIdx: number,
  hook: LifecycleMutationHook | undefined
): Promise<string> => {
  const staging = path.join(directory, STAGING_DIR);
  const archivePath = path.join(directory, `[${summaryIdx}]system.md.archive`);
  await runLifecycleMutation(
    hook,
    { point: 'commit_archive', sourcePath: staging, targetPath: archivePath },
    async () => {
      await fs.rename(staging, archivePath);
      await syncDirectory(directory);
    }
  );
  const summary = await fs.readFile(path.join(archivePath, SUMMARY_TEMP_FILE), 'utf8');
  await atomicWrite(
    path.join(directory, `[${summaryIdx}]system.md`),
    summary,
    hook,
    'write_live_summary'
  );
  return archivePath;
};

const toPlannedOutcome = (
  result: CompressResult
): 'compressed' | 'below_threshold' | 'no_turns_to_compress' => {
  if (result.dryRunPlan) {
    return result.dryRunPlan.outcome;
  }
  if (result.compressed) {
    return 'compressed';
  }
  if (
    result.skipReason === 'below_threshold' ||
    result.skipReason === 'no_turns_to_compress'
  ) {
    return result.skipReason;
  }
  throw new Error(`dry-run simulation 返回了意外状态: ${result.skipReason}`);
};

const simulateLifecycleDryRun = async (
  options: CompressOptions,
  directory: string,
  recoveryActions: Array<{ detail: string }>,
  archivesToRestore: number
): Promise<CompressResult> => {
  const simulationRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'promptpile-compress-dry-run-')
  );
  const simulationDirectory = path.join(simulationRoot, 'conversation');
  try {
    const generation = await captureConversationGeneration(directory);
    await fs.cp(directory, simulationDirectory, { recursive: true });
    await assertConversationGeneration(directory, generation);
    await removeDirectoryLifecycleLockFiles(simulationDirectory);

    const simulated = await compressDirectoryWithLockHeld(
      {
        ...options,
        directory: simulationDirectory,
        dryRun: false,
        mutationHook: undefined,
      },
      simulationDirectory,
      { planOnly: true }
    );

    return {
      compressed: false,
      skipReason: 'dry_run',
      turnsArchived: simulated.turnsArchived,
      turnsKept: simulated.turnsKept,
      tokensBefore: simulated.tokensBefore,
      tokensAfter: simulated.tokensAfter,
      compressibleTokens: simulated.compressibleTokens,
      summaryIdx: simulated.summaryIdx,
      budget: simulated.budget,
      recoveryActions: recoveryActions.map((action) => action.detail),
      archivesRestored: archivesToRestore,
      selection: simulated.selection,
      dryRunPlan: {
        recoveryActions: recoveryActions.map((action) => action.detail),
        archivesToRestore,
        outcome: toPlannedOutcome(simulated),
      },
    };
  } finally {
    await fs.rm(simulationRoot, { recursive: true, force: true });
  }
};

const compressDirectoryWithLockHeld = async (
  options: CompressOptions,
  directory: string,
  internal: { planOnly?: boolean } = {}
): Promise<CompressResult> => {
  const keepRecent = options.keepRecent ?? DEFAULT_KEEP_RECENT;
  const strategyKind = options.strategy ?? DEFAULT_STRATEGY;
  const dryRun = options.dryRun === true;
  const planOnly = dryRun || internal.planOnly === true;
  const tokenizer = options.tokenizer ?? heuristicTokenizer;
  assertTokenizerAdapter(tokenizer);
  const contextBudget = resolveContextBudget(options);

  if (!Number.isInteger(keepRecent) || keepRecent < 0) {
    throw new Error(`keepRecent 必须是非负整数: ${keepRecent}`);
  }

  const recoveryActions = await recoverWithLockHeld(directory, {
    dryRun,
    mutationHook: options.mutationHook,
  });

  const archives = await findArchiveDirs(directory);
  if (dryRun && (recoveryActions.length > 0 || archives.length > 0)) {
    return simulateLifecycleDryRun(
      options,
      directory,
      recoveryActions,
      archives.length
    );
  }
  if (archives.length > 0) {
    await restoreArchivedTurnsWithLockHeld(
      {
        directory,
        mutationHook: options.mutationHook,
      },
      directory
    );
  }
  const lifecycleDetails = {
    recoveryActions: recoveryActions.map((action) => action.detail),
    archivesRestored: archives.length,
  };

  const generation = await captureConversationGeneration(directory);
  const turns = await scanTurns(directory, tokenizer);
  await assertConversationGeneration(directory, generation);
  if (turns.length === 0) {
    return {
      compressed: false,
      skipReason: 'no_turns_to_compress',
      turnsArchived: 0,
      turnsKept: 0,
      tokensBefore: 0,
      tokensAfter: 0,
      compressibleTokens: 0,
      budget: createBudgetReport(contextBudget, tokenizer, 0, 0, 0),
      ...lifecycleDetails,
      selection: { archivedTurnIndices: [], keptTurnIndices: [] },
    };
  }

  const tokensBefore = estimateTotalTokens(turns);
  const compressibleTokens = estimateTotalTokens(
    turns.filter((turn) => !turn.isSystemTurn)
  );

  if (tokensBefore < contextBudget.triggerTokens) {
    return {
      compressed: false,
      skipReason: 'below_threshold',
      turnsArchived: 0,
      turnsKept: turns.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressibleTokens,
      budget: createBudgetReport(
        contextBudget,
        tokenizer,
        tokensBefore,
        tokensBefore,
        0
      ),
      ...lifecycleDetails,
      selection: {
        archivedTurnIndices: [],
        keptTurnIndices: turns.map((turn) => turn.idx),
      },
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
      budget: createBudgetReport(
        contextBudget,
        tokenizer,
        tokensBefore,
        tokensBefore,
        0
      ),
      ...lifecycleDetails,
      selection: {
        archivedTurnIndices: [],
        keptTurnIndices: turns.map((turn) => turn.idx),
      },
    };
  }

  const selector = createTurnSelector(strategyKind);
  const { keep, archive } = selector.selectTurns(turns, {
    keepRecent,
    maxKeptTokens: contextBudget.maxKeptTokens,
  });
  if (archive.length === 0) {
    return {
      compressed: false,
      skipReason: 'no_turns_to_compress',
      turnsArchived: 0,
      turnsKept: keep.length,
      tokensBefore,
      tokensAfter: tokensBefore,
      compressibleTokens,
      budget: createBudgetReport(
        contextBudget,
        tokenizer,
        tokensBefore,
        tokensBefore,
        0
      ),
      ...lifecycleDetails,
      selection: {
        archivedTurnIndices: [],
        keptTurnIndices: keep.map((turn) => turn.idx),
      },
    };
  }

  const summaryGenerator = createSummaryGenerator(options.summary);
  const summaryIdx = Math.max(...archive.map((turn) => turn.idx));
  const keptHistoryTokens = estimateTotalTokens(keep);

  if (planOnly) {
    const summaryTokens = contextBudget.summaryOutputLimitTokens;
    const tokensAfter = keptHistoryTokens + summaryTokens;
    const budgetReport = createBudgetReport(
      contextBudget,
      tokenizer,
      tokensBefore,
      keptHistoryTokens,
      summaryTokens,
      'upper-bound'
    );
    return {
      compressed: false,
      skipReason: 'dry_run',
      turnsArchived: archive.length,
      turnsKept: keep.length,
      tokensBefore,
      tokensAfter,
      compressibleTokens,
      summaryIdx,
      budget: budgetReport,
      ...lifecycleDetails,
      selection: {
        archivedTurnIndices: archive.map((turn) => turn.idx),
        keptTurnIndices: keep.map((turn) => turn.idx),
      },
      dryRunPlan: {
        recoveryActions: [],
        archivesToRestore: 0,
        outcome: 'compressed',
      },
    };
  }

  const summary = await summaryGenerator.generateSummary(archive, {
    tokenizer,
    maxOutputTokens: contextBudget.summaryOutputLimitTokens,
  });
  await assertConversationGeneration(directory, generation);
  const summaryTokens =
    estimateTextTokens(summary, tokenizer) + tokenizer.messageOverheadTokens;
  if (summaryTokens > contextBudget.summaryOutputLimitTokens) {
    throw new Error(
      `summary output exceeds context budget: ${summaryTokens} > ${contextBudget.summaryOutputLimitTokens}`
    );
  }
  const tokensAfter = keptHistoryTokens + summaryTokens;
  const budgetReport = createBudgetReport(
    contextBudget,
    tokenizer,
    tokensBefore,
    keptHistoryTokens,
    summaryTokens
  );

  await prepareStaging(
    directory,
    archive,
    summary,
    summaryIdx,
    strategyKind,
    summaryGenerator.kind,
    summaryGenerator.providerId,
    tokenizer,
    budgetReport,
    tokensBefore,
    summaryTokens,
    tokensAfter,
    generation,
    options.mutationHook
  );
  const archivePath = await commitStaging(
    directory,
    summaryIdx,
    options.mutationHook
  );

  return {
    compressed: true,
    turnsArchived: archive.length,
    turnsKept: keep.length,
    tokensBefore,
    tokensAfter,
    compressibleTokens,
    summaryIdx,
    archivePath,
    budget: budgetReport,
    ...lifecycleDetails,
    selection: {
      archivedTurnIndices: archive.map((turn) => turn.idx),
      keptTurnIndices: keep.map((turn) => turn.idx),
    },
  };
};

export async function compressDirectory(
  options: CompressOptions
): Promise<CompressResult> {
  const directory = await assertDirectory(options.directory);
  return withDirectoryLifecycleLock(directory, 'compress', () =>
    compressDirectoryWithLockHeld(options, directory)
  );
}

/**
 * Orchestrator boundary: plan, compress under the filesystem lock, release it,
 * then start completion. Calls through this API are serialized per directory.
 */
export async function runCompressionBeforeCompletion<T>(
  options: CompressionLifecycleOptions<T>
): Promise<CompressionLifecycleResult<T>> {
  let directory: string;
  try {
    directory = await assertDirectory(options.compression.directory);
  } catch {
    return {
      ok: false,
      report: {
        version: 1,
        operation: 'compress-before-completion',
        status: 'failed',
        phases: [
          { phase: 'estimate_plan', status: 'failed', durationMs: 0 },
        ],
        recoveryActions: [],
        selection: { archivedTurnIndices: [], keptTurnIndices: [] },
        commit: { state: 'not_started' },
        error: {
          code: 'IO_ERROR',
          message: 'The conversation directory is unavailable.',
          retryable: false,
        },
      },
    };
  }
  return serializeOrchestratorPhase(directory, async () => {
    const phases: OperationPhaseReport[] = [];
    const report: CompressionOperationReport = {
      version: 1,
      operation: 'compress-before-completion',
      status: 'failed',
      phases,
      recoveryActions: [],
      selection: { archivedTurnIndices: [], keptTurnIndices: [] },
      commit: { state: 'not_started' },
    };

    const planStarted = Date.now();
    try {
      const planned = await compressDirectory({
        ...options.compression,
        directory,
        dryRun: true,
        mutationHook: undefined,
      });
      phases.push({
        phase: 'estimate_plan',
        status: 'completed',
        durationMs: Date.now() - planStarted,
      });
      report.plan = {
        outcome: planOutcome(planned),
        selection: planned.selection,
        budget: planned.budget,
      };
      report.recoveryActions = planned.recoveryActions;
      report.selection = planned.selection;
      report.budget = planned.budget;
    } catch (error) {
      phases.push({
        phase: 'estimate_plan',
        status: 'failed',
        durationMs: Date.now() - planStarted,
      });
      report.error = classifyLifecycleError(error);
      return { ok: false, report };
    }

    let acquired = false;
    let compressionCompleted = false;
    let compression: CompressResult | undefined;
    const acquireStarted = Date.now();
    try {
      compression = await withDirectoryLifecycleLock(
        directory,
        'compress',
        async () => {
          acquired = true;
          phases.push({
            phase: 'acquire_exclusive',
            status: 'completed',
            durationMs: Date.now() - acquireStarted,
          });
          const compressStarted = Date.now();
          try {
            const result = await compressDirectoryWithLockHeld(
              {
                ...options.compression,
                directory,
                dryRun: false,
              },
              directory
            );
            compression = result;
            compressionCompleted = true;
            phases.push({
              phase: 'compress',
              status: 'completed',
              durationMs: Date.now() - compressStarted,
            });
            return result;
          } catch (error) {
            phases.push({
              phase: 'compress',
              status: 'failed',
              durationMs: Date.now() - compressStarted,
            });
            throw error;
          }
        }
      );
      phases.push({
        phase: 'release_exclusive',
        status: 'completed',
        durationMs: 0,
      });
    } catch (error) {
      if (!acquired) {
        phases.push({
          phase: 'acquire_exclusive',
          status: 'failed',
          durationMs: Date.now() - acquireStarted,
        });
      } else if (compressionCompleted) {
        phases.push({
          phase: 'release_exclusive',
          status: 'failed',
          durationMs: 0,
        });
      } else {
        phases.push({
          phase: 'release_exclusive',
          status: 'completed',
          durationMs: 0,
        });
      }
      report.error = classifyLifecycleError(error);
      if (compression) {
        report.recoveryActions = compression.recoveryActions;
        report.selection = compression.selection;
        report.budget = compression.budget;
        report.commit = compression.compressed
          ? {
              state: 'committed',
              ...(compression.summaryIdx !== undefined
                ? { summaryIdx: compression.summaryIdx }
                : {}),
            }
          : { state: 'skipped' };
      }
      return { ok: false, report };
    }

    report.recoveryActions = compression.recoveryActions;
    report.selection = compression.selection;
    report.budget = compression.budget;
    report.commit = compression.compressed
      ? {
          state: 'committed',
          ...(compression.summaryIdx !== undefined
            ? { summaryIdx: compression.summaryIdx }
            : {}),
        }
      : { state: 'skipped' };

    const completionStarted = Date.now();
    try {
      const completion = await options.completion(compression);
      phases.push({
        phase: 'completion',
        status: 'completed',
        durationMs: Date.now() - completionStarted,
      });
      report.status = 'completed';
      return { ok: true, compression, completion, report };
    } catch (error) {
      phases.push({
        phase: 'completion',
        status: 'failed',
        durationMs: Date.now() - completionStarted,
      });
      report.error = classifyLifecycleError(error, true);
      return { ok: false, report };
    }
  });
}

export type {
  CompressDryRunPlan,
  CompressionLifecycleOptions,
  CompressionLifecycleResult,
  CompressionOperationReport,
  CompressOptions,
  CompressResult,
  CompressSkipReason,
  ContextBudgetOptions,
  ContextBudgetReport,
  LifecycleErrorCode,
  OperationPhaseReport,
  SemanticSummaryArtifact,
  SemanticSummaryDocument,
  SemanticSummaryItem,
  SemanticSummaryProvider,
  SemanticSummaryRequest,
  SemanticSummaryTurn,
  SummaryKind,
  SummaryOptions,
  TokenizerAdapter,
} from './types';
export { createTiktokenTokenizer, heuristicTokenizer } from './tokenizer';
