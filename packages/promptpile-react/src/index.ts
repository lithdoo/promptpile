#!/usr/bin/env node
import { parseCli } from './cli';
import { appendUserFromTerminal } from './append-user-message';
import { readUserInputFromTerminal } from './read-user-input';
import { reactDebugLog } from './react-debug-log';
import { PromptpileReactRuntime } from './react-runtime';
import {
  getPromptpileSpawnConfig,
  type PromptpileSpawnConfig
} from './promptpile-invoker';
import { resolveReactConfig } from './resolve-react-config';
import type { ResolvedReactConfig } from './types';

async function runOneReactSession(runtime: PromptpileReactRuntime): Promise<void> {
  reactDebugLog('session start maxStep=', String(runtime.maxStep));
  while (runtime.stopReason === 'running') {
    await runtime.nextStep();
  }

  await runtime.finalAnswer();
  reactDebugLog('session end stopReason=', runtime.stopReason);
}

async function main(): Promise<void> {
  parseCli();
  const config = resolveReactConfig(process.cwd(), process.argv);

  if (config.inputMode) {
    await runInputMode(config, getPromptpileSpawnConfig());
    return;
  }

  const runtime = new PromptpileReactRuntime(config);
  await runOneReactSession(runtime);
  process.exitCode = runtime.stopReason === 'error' ? 1 : 0;
}

async function runInputMode(
  config: ResolvedReactConfig,
  spawn: PromptpileSpawnConfig
): Promise<void> {
  const userContent = await readUserInputFromTerminal();
  if (!userContent) {
    console.error('Error: Empty input. Nothing was written.');
    process.exitCode = 1;
    return;
  }

  try {
    await appendUserFromTerminal(
      spawn,
      config.outputDirectoryAbs ?? config.directoryAbs,
      userContent,
      config.cwd
    );
    reactDebugLog('input userAppended');
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
    return;
  }

  const runtime = new PromptpileReactRuntime(config, spawn);
  await runOneReactSession(runtime);

  process.exitCode = runtime.stopReason === 'error' ? 1 : 0;
}

main().catch((e) => {
  console.error('Error:', e);
  process.exitCode = 1;
});
