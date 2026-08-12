import { ForkError } from './errors';
import { acquireTargetClaim, releaseTargetClaim, type TargetClaim } from './claim';
import { observeStablePrefix, sameObservations } from './observation';
import { requireTargetAbsent, resolveForkPaths } from './paths';
import { cleanupStaging, copyBaselineToStaging, createStaging, verifyStaging } from './staging';
import type { ForkReport } from './types';
import fs from 'node:fs/promises';

export interface ForkOptions {
  source: string;
  target: string;
  throughIndex: number;
  dryRun: boolean;
}

export interface ForkExecutionHooks {
  afterBaseline?: () => void | Promise<void>;
  beforeStagingCreate?: () => void | Promise<void>;
  afterStagingCreate?: (staging: string) => void | Promise<void>;
  afterEachCopy?: (relativePath: string) => void | Promise<void>;
  afterStagingVerify?: () => void | Promise<void>;
  afterSourceReobserve?: () => void | Promise<void>;
  beforePublish?: () => void | Promise<void>;
  afterPublish?: () => void | Promise<void>;
  beforeClaimCleanup?: () => void | Promise<void>;
}

export interface ForkExecutionDependencies {
  hooks?: ForkExecutionHooks;
  onWarning?: (message: string) => void;
  rename?: (source: string, target: string) => Promise<void>;
}

const safeTotalBytes = (value: bigint): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ForkError('invalid_arguments', 'selected artifact total bytes exceed the JSON v1 safe integer range');
  }
  return Number(value);
};

export async function planConversationFork(options: ForkOptions): Promise<ForkReport> {
  const resolved = await resolveForkPaths(options.source, options.target);
  const observation = await observeStablePrefix(resolved.source, options.throughIndex);
  return {
    schemaVersion: 1,
    operation: 'conversation_fork',
    status: 'planned',
    source: resolved.source,
    target: resolved.target,
    throughIndex: options.throughIndex,
    artifactCount: observation.records.length,
    totalBytes: safeTotalBytes(observation.totalBytes),
    sourcePrefixFingerprint: observation.sourcePrefixFingerprint
  };
}

const completedReport = (
  planned: ForkReport
): ForkReport => ({ ...planned, status: 'completed' });

export async function executeConversationFork(
  options: ForkOptions,
  dependencies: ForkExecutionDependencies = {}
): Promise<ForkReport> {
  if (options.dryRun) return planConversationFork(options);
  const resolved = await resolveForkPaths(options.source, options.target);
  let claim: TargetClaim | undefined;
  let staging: string | undefined;
  let published = false;
  let report: ForkReport | undefined;
  let primary: unknown;
  try {
    claim = await acquireTargetClaim(resolved);
    const baseline = await observeStablePrefix(resolved.source, options.throughIndex);
    await dependencies.hooks?.afterBaseline?.();
    report = {
      schemaVersion: 1,
      operation: 'conversation_fork',
      status: 'planned',
      source: resolved.source,
      target: resolved.target,
      throughIndex: options.throughIndex,
      artifactCount: baseline.records.length,
      totalBytes: safeTotalBytes(baseline.totalBytes),
      sourcePrefixFingerprint: baseline.sourcePrefixFingerprint
    };
    await dependencies.hooks?.beforeStagingCreate?.();
    staging = await createStaging(resolved);
    await dependencies.hooks?.afterStagingCreate?.(staging);
    await copyBaselineToStaging(baseline, staging, dependencies.hooks?.afterEachCopy);
    try {
      await verifyStaging(staging, options.throughIndex, baseline);
    } catch (stagingError) {
      const currentSource = await observeStablePrefix(resolved.source, options.throughIndex);
      if (!sameObservations(baseline, currentSource)) {
        throw new ForkError('source_unstable', 'selected Conversation prefix changed during fork', stagingError);
      }
      throw stagingError;
    }
    await dependencies.hooks?.afterStagingVerify?.();
    const finalSource = await observeStablePrefix(resolved.source, options.throughIndex);
    await dependencies.hooks?.afterSourceReobserve?.();
    if (!sameObservations(baseline, finalSource)) {
      throw new ForkError('source_unstable', 'selected Conversation prefix changed during fork');
    }
    await requireTargetAbsent(resolved.target);
    await dependencies.hooks?.beforePublish?.();
    try { await (dependencies.rename ?? fs.rename)(staging, resolved.target); } catch (error) {
      throw new ForkError('publication_failed', `unable to publish target: ${resolved.target}`, error);
    }
    published = true;
    staging = undefined;
    try { await dependencies.hooks?.afterPublish?.(); } catch (error) {
      dependencies.onWarning?.(`post-publication diagnostic failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } catch (error) {
    primary = error;
  }

  if (!published && staging !== undefined) {
    try { await cleanupStaging(staging); } catch (error) {
      dependencies.onWarning?.(`staging cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (claim !== undefined) {
    let cleanupAllowed = true;
    try { await dependencies.hooks?.beforeClaimCleanup?.(); } catch (error) {
      cleanupAllowed = false;
      dependencies.onWarning?.(`claim cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (cleanupAllowed) {
      try { await releaseTargetClaim(claim); } catch (error) {
        dependencies.onWarning?.(`claim cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (published) return completedReport(report!);
  throw primary;
}
