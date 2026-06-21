#!/usr/bin/env node
import { parseCli } from './cli';
import { appendUserFromTerminal } from './append-user-message';
import { readUserInputFromTerminal } from './read-user-input';
import { reactDebugLog } from './react-debug-log';
import { PromptpileReactRuntime } from './react-runtime';
import { resolveReactConfig } from './resolve-react-config';
import type { ResolvedReactConfig } from './types';

async function runOneReactSession(runtime: PromptpileReactRuntime): Promise<void> {
  reactDebugLog(
    'session start maxStep=',
    Number.isFinite(runtime.maxStep) ? String(runtime.maxStep) : 'Infinity'
  );
  if (Number.isFinite(runtime.maxStep)) {
    while (runtime.stopReason === 'running') {
      await runtime.nextStep();
    }
  } else if (runtime.stopReason === 'running') {
    await runtime.nextStep();
  }

  await runtime.finalAnswer();
  reactDebugLog('session end stopReason=', runtime.stopReason);
}

async function main(): Promise<void> {
  parseCli();
  const config = resolveReactConfig(process.cwd(), process.argv);

  if (config.inputMode) {
    await runInputMode(config);
    return;
  }

  const runtime = new PromptpileReactRuntime(config);
  await runOneReactSession(runtime);
  process.exitCode = runtime.stopReason === 'error' ? 1 : 0;
}

async function runInputMode(config: ResolvedReactConfig): Promise<void> {
  const processRound = async (): Promise<boolean> => {
    const userContent = await readUserInputFromTerminal();
    if (!userContent) {
      console.error('Error: Empty input. Nothing was written.');
      process.exitCode = 1;
      return false;
    }

    try {
      appendUserFromTerminal(config.directoryAbs, userContent);
      reactDebugLog('inputRound userAppended');
    } catch (e) {
      console.error('Error:', e instanceof Error ? e.message : e);
      process.exitCode = 1;
      return false;
    }

    const runtime = new PromptpileReactRuntime(config);
    await runOneReactSession(runtime);

    if (runtime.stopReason === 'error') {
      process.exitCode = 1;
      return false;
    }

    process.exitCode = 0;
    return true;
  };

  if (!config.continueMode) {
    await processRound();
    return;
  }

  while (true) {
    const ok = await processRound();
    if (!ok) {
      return;
    }
  }
}

main().catch((e) => {
  console.error('Error:', e);
  process.exitCode = 1;
});
