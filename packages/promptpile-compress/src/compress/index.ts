import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { findStagingDir, STAGING_DIR } from '../restore/scanner';
import { inspectArchiveSet } from '../restore/inspection';
import {
  recoverWithLockHeld,
  restoreArchivedTurnsWithLockHeld,
} from '../restore';
import {
  acquireDirectoryLifecycleLock,
  removeDirectoryLifecycleLockFiles,
  releaseDirectoryLifecycleLock,
  withDirectoryLifecycleLock,
} from '../lifecycle/lock';
import { archiveStateInvalid, lifecycleError } from '../lifecycle/errors';
import { resolveLifecycleDirectory } from '../lifecycle/directory';
import {
  cloneCompressionExecution,
  inspectCompressionLifecycleState,
  resolveCompressionExecution,
} from './live-state';
import type {
  CompressionLifecycleInspection,
  ResolvedCompressionExecution,
} from './live-state';
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
import {
  estimateTextTokens,
  estimateTotalTokens,
} from './tokenizer';
import { createBudgetReport } from './budget';
import type {
  CompressionManifest,
  CompressionDecisionReport,
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

const SUMMARY_TEMP_FILE = '.summary.md';
const orchestratorQueues = new Map<string, Promise<void>>();
interface OrchestratorInvocation {
  active: boolean;
}
const activeOrchestratorInvocation = new AsyncLocalStorage<OrchestratorInvocation>();

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
  const invocation: OrchestratorInvocation = { active: true };
  try {
    return await activeOrchestratorInvocation.run(invocation, callback);
  } finally {
    invocation.active = false;
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
    retryable =
      (error as { retryable?: boolean } | undefined)?.retryable ??
      taggedCode === 'SUMMARY_PROVIDER_FAILED';
  } else if (typeof code === 'string') {
    classified = 'IO_ERROR';
    retryable = ['EBUSY', 'EAGAIN', 'EMFILE', 'ENFILE'].includes(code);
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
  const message =
    classified === 'LIFECYCLE_LOCKED' && !retryable
      ? 'The automatic lifecycle is non-reentrant.'
      : safeMessages[classified];
  return { code: classified, message, retryable };
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
  hook: LifecycleMutationHook | undefined,
  progress: FreshCommitProgress
): Promise<string> => {
  const staging = path.join(directory, STAGING_DIR);
  const archivePath = path.join(directory, `[${summaryIdx}]system.md.archive`);
  await runLifecycleMutation(
    hook,
    { point: 'commit_archive', sourcePath: staging, targetPath: archivePath },
    async () => {
      await fs.rename(staging, archivePath);
      progress.state = 'archive_published';
      progress.summaryIdx = summaryIdx;
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
  progress.state = 'complete';
  return archivePath;
};

interface FreshCommitProgress {
  state: 'not_started' | 'archive_published' | 'complete';
  summaryIdx?: number;
}

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
  execution: ResolvedCompressionExecution,
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
      cloneCompressionExecution(execution, {
        dryRun: false,
        mutationHook: undefined,
      }),
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

const compressCurrentConversationWithLockHeld = async (
  execution: ResolvedCompressionExecution,
  directory: string,
  internal: {
    planOnly?: boolean;
    lifecycleDetails?: Pick<CompressResult, 'recoveryActions' | 'archivesRestored'>;
    progress?: FreshCommitProgress;
  } = {}
): Promise<CompressResult> => {
  const planOnly = execution.dryRun || internal.planOnly === true;
  const { contextBudget, keepRecent, strategyKind, tokenizer } = execution;

  const lifecycleDetails = internal.lifecycleDetails ?? {
    recoveryActions: [],
    archivesRestored: 0,
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

  const { keep, archive } = execution.selector.selectTurns(turns, {
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

  const summaryGenerator = execution.summaryGenerator;
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
    execution.mutationHook
  );
  const archivePath = await commitStaging(
    directory,
    summaryIdx,
    execution.mutationHook,
    internal.progress ?? { state: 'not_started' }
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

const compressDirectoryWithLockHeld = async (
  execution: ResolvedCompressionExecution,
  directory: string,
  internal: { planOnly?: boolean } = {}
): Promise<CompressResult> => {
  const dryRun = execution.dryRun;
  const recoveryActions = await recoverWithLockHeld(directory, {
    dryRun,
    mutationHook: execution.mutationHook,
  });
  const archiveSet = await inspectArchiveSet(directory);
  if (archiveSet.state === 'invalid') throw archiveStateInvalid(archiveSet.reason);
  const archivesToRestore = archiveSet.state === 'valid' ? archiveSet.archives.length : 0;
  if (dryRun && (recoveryActions.length > 0 || archivesToRestore > 0)) {
    return simulateLifecycleDryRun(
      execution,
      directory,
      recoveryActions,
      archivesToRestore
    );
  }
  let archivesRestored = 0;
  if (archivesToRestore > 0) {
    const restored = await restoreArchivedTurnsWithLockHeld(
      { directory, mutationHook: execution.mutationHook },
      directory
    );
    archivesRestored = restored.archivesRestored ?? 0;
  }
  return compressCurrentConversationWithLockHeld(execution, directory, {
    planOnly: internal.planOnly,
    lifecycleDetails: {
      recoveryActions: recoveryActions.map((action) => action.detail),
      archivesRestored,
    },
  });
};

export async function compressDirectory(
  options: CompressOptions
): Promise<CompressResult> {
  const requestedDirectory = options.directory;
  const execution = resolveCompressionExecution(options);
  const directory = await resolveLifecycleDirectory(requestedDirectory);
  return withDirectoryLifecycleLock(directory, 'compress', () =>
    compressDirectoryWithLockHeld(execution, directory)
  );
}

const automaticSkipResult = (
  execution: ResolvedCompressionExecution,
  current: Extract<
    CompressionLifecycleInspection,
    { state: 'healthy_plain' | 'healthy_compacted' }
  >,
  reason: 'no_turns_to_compress' | 'below_threshold',
  recoveryActions: string[],
  archivesRestored: number
): CompressResult => {
  const empty = reason === 'no_turns_to_compress';
  const tokens = empty ? 0 : current.live.tokens;
  return {
    compressed: false,
    skipReason: reason,
    turnsArchived: 0,
    turnsKept: empty ? 0 : current.live.turns.length,
    tokensBefore: tokens,
    tokensAfter: tokens,
    compressibleTokens: empty
      ? 0
      : estimateTotalTokens(current.live.turns.filter((turn) => !turn.isSystemTurn)),
    budget: createBudgetReport(
      execution.contextBudget,
      execution.tokenizer,
      tokens,
      tokens,
      0
    ),
    recoveryActions,
    archivesRestored,
    selection: {
      archivedTurnIndices: [],
      keptTurnIndices: empty ? [] : current.live.turns.map((turn) => turn.idx),
    },
  };
};

const decisionFor = (
  current: Extract<
    CompressionLifecycleInspection,
    { state: 'healthy_plain' | 'healthy_compacted' }
  >
): CompressionDecisionReport => {
  const base = {
    liveTokens: current.live.tokens,
    triggerTokens: current.live.triggerTokens,
  };
  if (current.state === 'healthy_plain' && current.live.turns.length === 0) {
    return {
      ...base,
      liveState: 'healthy_plain',
      triggerReached: current.live.triggerReached,
      action: 'skip',
      reason: 'no_turns_to_compress',
    };
  }
  if (!current.live.triggerReached) {
    return {
      ...base,
      liveState: current.state,
      triggerReached: false,
      action: 'skip',
      reason: 'below_threshold',
    };
  }
  return current.state === 'healthy_plain'
    ? { ...base, liveState: 'healthy_plain', triggerReached: true, action: 'evaluate_current' }
    : {
        ...base,
        liveState: 'healthy_compacted',
        triggerReached: true,
        action: 'restore_then_evaluate',
      };
};

const commitFact = (
  progress: FreshCommitProgress,
  lifecycleCompleted: boolean,
  compression: CompressResult | undefined
): CompressionOperationReport['commit'] => {
  if (progress.state === 'archive_published') {
    return { state: 'incomplete', summaryIdx: progress.summaryIdx! };
  }
  if (progress.state === 'complete') {
    return { state: 'committed', summaryIdx: progress.summaryIdx! };
  }
  if (lifecycleCompleted && compression) return { state: 'skipped' };
  return { state: 'not_started' };
};

/** Automatic lifecycle: coordinate first, then decide exclusively from lock-held state. */
export async function runCompressionBeforeCompletion<T>(
  options: CompressionLifecycleOptions<T>
): Promise<CompressionLifecycleResult<T>> {
  let directory: string;
  let execution: ResolvedCompressionExecution;
  let completionCallback: CompressionLifecycleOptions<T>['completion'];
  try {
    if (activeOrchestratorInvocation.getStore()?.active) {
      throw lifecycleError(
        'LIFECYCLE_LOCKED',
        'nested automatic lifecycle invocation is not allowed'
      );
    }
    const requestedDirectory = options.compression.directory;
    completionCallback = options.completion;
    execution = cloneCompressionExecution(
      resolveCompressionExecution(options.compression),
      { dryRun: false }
    );
    directory = await resolveLifecycleDirectory(requestedDirectory);
  } catch (error) {
    return {
      ok: false,
      report: {
        version: 2,
        operation: 'compress-before-completion',
        status: 'failed',
        phases: [],
        recoveryActions: [],
        archivesRestored: 0,
        commit: { state: 'not_started' },
        error: classifyLifecycleError(error),
      },
    };
  }
  return serializeOrchestratorPhase(directory, async () => {
    const phases: OperationPhaseReport[] = [];
    const report: CompressionOperationReport = {
      version: 2,
      operation: 'compress-before-completion',
      status: 'failed',
      phases,
      recoveryActions: [],
      archivesRestored: 0,
      commit: { state: 'not_started' },
    };
    const progress: FreshCommitProgress = { state: 'not_started' };
    let lock: Awaited<ReturnType<typeof acquireDirectoryLifecycleLock>>;
    const acquireStarted = Date.now();
    try {
      lock = await acquireDirectoryLifecycleLock(directory, 'compress');
      phases.push({
        phase: 'acquire_exclusive',
        status: 'completed',
        durationMs: Date.now() - acquireStarted,
      });
    } catch (error) {
      phases.push({
        phase: 'acquire_exclusive',
        status: 'failed',
        durationMs: Date.now() - acquireStarted,
      });
      phases.push(
        { phase: 'maintain_context', status: 'skipped', durationMs: 0 },
        { phase: 'release_exclusive', status: 'skipped', durationMs: 0 },
        { phase: 'completion', status: 'skipped', durationMs: 0 }
      );
      report.error = classifyLifecycleError(error);
      return { ok: false, report };
    }

    let compression: CompressResult | undefined;
    let maintainError: unknown;
    let lifecycleCompleted = false;
    const maintainStarted = Date.now();
    try {
      let current = await inspectCompressionLifecycleState(directory, execution);
      if (current.state === 'invalid') throw archiveStateInvalid(current.reason);
      if (current.state === 'recovery_required') {
        if (current.reason === 'staging_recovery') {
          const actions = await recoverWithLockHeld(directory, {
            mutationHook: execution.mutationHook,
          });
          report.recoveryActions.push(...actions.map((action) => action.detail));
        } else {
          const restored = await restoreArchivedTurnsWithLockHeld(
            { directory, mutationHook: execution.mutationHook },
            directory
          );
          report.archivesRestored += restored.archivesRestored ?? 0;
        }
        current = await inspectCompressionLifecycleState(directory, execution);
        if (current.state !== 'healthy_plain') {
          throw archiveStateInvalid('recovery_did_not_normalize');
        }
      }

      report.decision = decisionFor(current);
      if (report.decision.action === 'skip') {
        compression = automaticSkipResult(
          execution,
          current,
          report.decision.reason,
          report.recoveryActions,
          report.archivesRestored
        );
        report.budget = compression.budget;
      } else {
        if (report.decision.action === 'restore_then_evaluate') {
          const restored = await restoreArchivedTurnsWithLockHeld(
            { directory, mutationHook: execution.mutationHook },
            directory
          );
          report.archivesRestored += restored.archivesRestored ?? 0;
        }
        compression = await compressCurrentConversationWithLockHeld(
          execution,
          directory,
          {
            lifecycleDetails: {
              recoveryActions: report.recoveryActions,
              archivesRestored: report.archivesRestored,
            },
            progress,
          }
        );
        report.selection = compression.selection;
        report.budget = compression.budget;
      }
      lifecycleCompleted = true;
      phases.push({
        phase: 'maintain_context',
        status: 'completed',
        durationMs: Date.now() - maintainStarted,
      });
    } catch (error) {
      maintainError = error;
      phases.push({
        phase: 'maintain_context',
        status: 'failed',
        durationMs: Date.now() - maintainStarted,
      });
    }

    const releaseStarted = Date.now();
    let releaseError: unknown;
    try {
      await releaseDirectoryLifecycleLock(lock);
      phases.push({
        phase: 'release_exclusive',
        status: 'completed',
        durationMs: Date.now() - releaseStarted,
      });
    } catch (error) {
      releaseError = error;
      phases.push({
        phase: 'release_exclusive',
        status: 'failed',
        durationMs: Date.now() - releaseStarted,
      });
    }
    report.commit = commitFact(progress, lifecycleCompleted, compression);
    if (maintainError || releaseError) {
      report.error = classifyLifecycleError(maintainError ?? releaseError);
      phases.push({ phase: 'completion', status: 'skipped', durationMs: 0 });
      return { ok: false, report };
    }

    if (!compression) throw new Error('automatic lifecycle completed without a result');

    const completionStarted = Date.now();
    try {
      const completion = await completionCallback(compression);
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
  CompressionCommitReport,
  CompressionDecisionReport,
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
