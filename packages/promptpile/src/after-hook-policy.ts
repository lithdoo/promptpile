import type { AfterHookExecutionResult, ResolveAfterHookResult } from './after-hook';

export type AfterHookFailureMode = 'warn' | 'error';

export const parseAfterHookFailureMode = (
  value: unknown
): AfterHookFailureMode | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('after-hook failure mode must be warn or error');
  }
  const normalized = value.trim();
  if (normalized === '') return undefined;
  if (normalized === 'warn' || normalized === 'error') return normalized;
  throw new Error(`invalid after-hook failure mode: ${value}`);
};

export interface ResolvedAfterHookPolicyV1 {
  failureMode: AfterHookFailureMode;
  resolution: ResolveAfterHookResult;
}

export type AfterHookObservationV1 =
  | { status: 'skipped'; reason: 'not_configured' | 'default_not_found' }
  | { status: 'invalid_explicit'; attempted: string; reason: string }
  | AfterHookExecutionResult;

export type AfterHookPolicyImpact = 'none' | 'warning' | 'error';

export interface AfterHookPolicyDecisionV1 {
  observation: AfterHookObservationV1;
  impact: AfterHookPolicyImpact;
}

type NonRunningAfterHookResolution = Exclude<ResolveAfterHookResult, { status: 'run' }>;
type ResolutionAfterHookObservation = Extract<
  AfterHookObservationV1,
  { status: 'skipped' | 'invalid_explicit' }
>;

export function observeAfterHookResolution(
  resolution: Extract<ResolveAfterHookResult, { status: 'run' }>
): undefined;
export function observeAfterHookResolution(
  resolution: NonRunningAfterHookResolution
): ResolutionAfterHookObservation;
export function observeAfterHookResolution(
  resolution: ResolveAfterHookResult
): ResolutionAfterHookObservation | undefined;
export function observeAfterHookResolution(
  resolution: ResolveAfterHookResult
): ResolutionAfterHookObservation | undefined {
  if (resolution.status === 'run') return undefined;
  if (resolution.status === 'skip') {
    return { status: 'skipped', reason: resolution.reason };
  }
  return {
    status: 'invalid_explicit',
    attempted: resolution.attempted,
    reason: resolution.reason
  };
}

export const evaluateAfterHookPolicy = (
  observation: AfterHookObservationV1,
  failureMode: AfterHookFailureMode
): AfterHookPolicyDecisionV1 => {
  const successful = observation.status === 'skipped' || observation.status === 'succeeded';
  return {
    observation,
    impact: successful ? 'none' : failureMode === 'warn' ? 'warning' : 'error'
  };
};

const appendStderrDiagnostic = (
  headline: string,
  observation: Extract<AfterHookExecutionResult, { status: 'exited_nonzero' | 'signaled' }>
): string => {
  const tail = observation.stderrTail.trimEnd();
  if (tail === '') return headline;
  const truncation = observation.stderrTruncated ? '\n[after-hook stderr truncated to last 64 KiB]' : '';
  return `${headline}\n${tail}${truncation}`;
};

export const formatAfterHookDiagnostic = (observation: AfterHookObservationV1): string => {
  switch (observation.status) {
    case 'skipped':
      return `after-hook skipped: ${observation.reason}`;
    case 'invalid_explicit':
      return `after-hook script is not executable as a regular file: ${observation.attempted} (${observation.reason})`;
    case 'succeeded':
      return `after-hook succeeded: ${observation.path}`;
    case 'spawn_failed':
      return `after-hook spawn failed: ${observation.path}: ${observation.message}`;
    case 'exited_nonzero':
      return appendStderrDiagnostic(
        `after-hook exited with code ${observation.exitCode}: ${observation.path}`,
        observation
      );
    case 'signaled':
      return appendStderrDiagnostic(
        `after-hook terminated by signal ${observation.signal}: ${observation.path}`,
        observation
      );
  }
};

export class AfterHookFailureError extends Error {
  readonly observation: AfterHookObservationV1;

  constructor(observation: AfterHookObservationV1) {
    super(formatAfterHookDiagnostic(observation));
    this.name = 'AfterHookFailureError';
    this.observation = observation;
  }
}
