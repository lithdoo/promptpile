#!/usr/bin/env node
import { parseCli } from './cli';
import { appendUserFromTerminal } from './append-user-message';
import { readUserInputFromTerminal } from './read-user-input';
import { reactDebugLog } from './react-debug-log';
import {
  PromptpileReactRuntime,
  type ReactPhaseCompletedFact,
  type ReactPhaseStartedFact,
  type ReactRuntimeObserver
} from './react-runtime';
import { getPromptpileSpawnConfig, type PromptpileSpawnConfig } from './promptpile-invoker';
import { resolveReactConfig } from './resolve-react-config';
import type { ReactSessionContext, ResolvedReactConfig } from './types';
import { ReactEventWriterV1 } from './react-event-writer';
import { cleanupReactSessionWork, createReactSessionWork } from './react-session-work';

const MAX_STEP_EXHAUSTED_MESSAGE =
  'React reached max_step while Check still requested continuation.';

type ReactSessionPolicyResult = 'proceed' | 'max_step_exhausted';

async function runOneReactSession(
  runtime: PromptpileReactRuntime,
  config: ResolvedReactConfig
): Promise<ReactSessionPolicyResult> {
  reactDebugLog('session start maxStep=', String(runtime.maxStep));
  while (runtime.stopReason === 'running') await runtime.nextStep();
  if (runtime.stopReason === 'max_step' && config.maxStepPolicy === 'error') {
    reactDebugLog('session end stopReason=', runtime.stopReason);
    return 'max_step_exhausted';
  }
  await runtime.finalAnswer();
  reactDebugLog('session end stopReason=', runtime.stopReason);
  return 'proceed';
}

const createStreamObserver = (writer: ReactEventWriterV1): ReactRuntimeObserver => ({
  phaseStarted: async (fact: ReactPhaseStartedFact) => {
    if (fact.phase === 'final') {
      await writer.emit({ type: 'phase.started', phase: 'final', steps_completed: fact.stepsCompleted });
    } else {
      await writer.emit({ type: 'phase.started', phase: fact.phase, step_index: fact.stepIndex });
    }
  },
  phaseCompleted: async (fact: ReactPhaseCompletedFact) => {
    if (fact.phase === 'final') {
      await writer.emit({ type: 'phase.completed', phase: 'final', steps_completed: fact.stepsCompleted });
    } else if (fact.phase === 'check') {
      await writer.emit({ type: 'phase.completed', phase: 'check', step_index: fact.stepIndex, continue: fact.continue });
    } else {
      await writer.emit({ type: 'phase.completed', phase: fact.phase, step_index: fact.stepIndex });
    }
  },
  finalDelta: content => writer.emit({ type: 'final.delta', content })
});

async function runStreamJsonSession(
  config: ResolvedReactConfig,
  spawn: PromptpileSpawnConfig,
  session: ReactSessionContext
): Promise<boolean> {
  const writer = new ReactEventWriterV1();
  await writer.emit({ type: 'session.started', max_steps: config.maxStep });
  const runtime = new PromptpileReactRuntime(config, session, spawn, createStreamObserver(writer));
  const policyResult = await runOneReactSession(runtime, config);

  if (policyResult === 'max_step_exhausted') {
    if (writer.isWritable()) {
      await writer.emit({
        type: 'session.failed',
        phase: 'check',
        steps_completed: runtime.currentStep,
        error: { code: 'max_step_exhausted', message: MAX_STEP_EXHAUSTED_MESSAGE }
      });
    }
    process.exitCode = 1;
    return false;
  }

  if (runtime.stopReason === 'error') {
    const failure = runtime.failure ?? {
      phase: 'startup' as const,
      code: 'internal_error' as const,
      message: 'React session failed'
    };
    if (writer.isWritable()) {
      await writer.emit({
        type: 'session.failed',
        phase: failure.phase,
        steps_completed: runtime.currentStep,
        error: { code: failure.code, message: failure.message }
      });
    }
    process.exitCode = 1;
    return false;
  }

  if (runtime.stopReason === 'running') {
    throw new Error('React session ended without a terminal runtime state');
  }

  await writer.emit({
    type: 'session.completed',
    stop_reason: runtime.stopReason,
    steps_completed: runtime.currentStep,
    final: runtime.finalResult ?? { status: 'skipped' }
  });
  process.exitCode = 0;
  return true;
}

async function runResolvedSession(config: ResolvedReactConfig, spawn: PromptpileSpawnConfig): Promise<void> {
  const session = createReactSessionWork(config);
  let succeeded = false;
  try {
    if (config.outputFormat === 'stream-json') {
      succeeded = await runStreamJsonSession(config, spawn, session);
      return;
    }
    const runtime = new PromptpileReactRuntime(config, session, spawn);
    const policyResult = await runOneReactSession(runtime, config);
    if (policyResult === 'max_step_exhausted') {
      console.error(MAX_STEP_EXHAUSTED_MESSAGE);
      process.exitCode = 1;
      return;
    }
    succeeded = runtime.stopReason !== 'error';
    process.exitCode = succeeded ? 0 : 1;
  } finally {
    cleanupReactSessionWork({ session, succeeded });
  }
}

async function main(): Promise<void> {
  parseCli();
  const config = resolveReactConfig(process.cwd(), process.argv);
  const spawn = getPromptpileSpawnConfig();

  if (config.inputMode) {
    await runInputMode(config, spawn);
    return;
  }
  await runResolvedSession(config, spawn);
}

async function runInputMode(config: ResolvedReactConfig, spawn: PromptpileSpawnConfig): Promise<void> {
  const userContent = await readUserInputFromTerminal();
  if (!userContent) {
    console.error('Error: Empty input. Nothing was written.');
    process.exitCode = 1;
    return;
  }
  try {
    await appendUserFromTerminal(spawn, config.userWritableAbs, userContent, config.cwd);
    reactDebugLog('input userAppended');
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }
  await runResolvedSession(config, spawn);
}

main().catch(error => {
  console.error('Error:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
