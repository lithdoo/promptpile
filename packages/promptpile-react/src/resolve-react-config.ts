import fs from 'fs';
import path from 'path';
import { loadReactPromptsFromConfig } from './load-react-prompts';
import { pickBool, pickInt, pickNum, pickRecord, pickStr } from './merge-utils';
import { parseReactCli } from './cli';
import { applyCliLlmOverrides, resolveLlmProfile } from './resolve-llm-profile';
import {
  buildReactOnlyTomlLayer,
  buildSharedTomlLayer,
  loadReactTomlConfig,
  type ReactOnlyTomlLayer,
  type SharedTomlLayer
} from './toml-config-react';
import type { PhaseLlmConfig, ResolvedReactConfig, ReactCliOverrides } from './types';

const resolveScanRelative = (scanAbs: string, rel: string | undefined): string | undefined => {
  if (rel === undefined) {
    return undefined;
  }
  return path.isAbsolute(rel) ? rel : path.resolve(scanAbs, rel);
};

const resolveCwdRelative = (cwd: string, rel: string | undefined): string | undefined => {
  if (rel === undefined) {
    return undefined;
  }
  return path.isAbsolute(rel) ? rel : path.resolve(cwd, rel);
};

const mergePhaseLlm = (
  llmApis: ReturnType<typeof loadReactTomlConfig>['llmApis'],
  defaultProfile: string | undefined,
  phase: {
    profileName?: string;
    key?: string;
    keyEnv?: string;
    model?: string;
    baseUrl?: string;
    temperature?: number;
    extraBody?: Record<string, unknown>;
  },
  cli: ReactCliOverrides,
  shared: {
    tomlTemperature?: number;
    tomlExtraBody?: Record<string, unknown>;
  }
): PhaseLlmConfig => {
  const temperatureOverride = pickNum(
    phase.temperature,
    shared.tomlTemperature
  );
  const extraBodyOverride = pickRecord(
    phase.extraBody,
    shared.tomlExtraBody
  );
  const base = resolveLlmProfile(llmApis, {
    profileName: phase.profileName ?? defaultProfile,
    model: phase.model,
    apiKey: phase.key,
    apiKeyEnv: phase.keyEnv,
    apiBaseUrl: phase.baseUrl,
    temperature: temperatureOverride,
    extraBody: extraBodyOverride
  });
  return applyCliLlmOverrides(base, cli);
};

export const resolveReactConfig = (cwd: string, argv: string[]): ResolvedReactConfig => {
  let cli: ReactCliOverrides;
  try {
    cli = parseReactCli(argv);
  } catch (e) {
    console.error('Error: Invalid CLI options:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  let llmApis: ReturnType<typeof loadReactTomlConfig>['llmApis'] = [];
  let sharedTomlReact: SharedTomlLayer = {};
  let sharedTomlPile: SharedTomlLayer = {};
  let reactToml: ReactOnlyTomlLayer = {};
  let configPathAbs: string | undefined;

  if (cli.configPath !== undefined) {
    configPathAbs = path.isAbsolute(cli.configPath)
      ? cli.configPath
      : path.resolve(cwd, cli.configPath);
    if (!fs.existsSync(configPathAbs)) {
      console.error(`Error: config file not found: ${configPathAbs}`);
      process.exit(1);
    }
    try {
      const loaded = loadReactTomlConfig(configPathAbs);
      llmApis = loaded.llmApis;
      sharedTomlPile = buildSharedTomlLayer(loaded.promptpile);
      sharedTomlReact = buildSharedTomlLayer(loaded.promptpileReact);
      reactToml = buildReactOnlyTomlLayer(loaded.promptpileReact);
    } catch (e) {
      console.error(`Error: failed to parse TOML config: ${configPathAbs}`, e);
      process.exit(1);
    }
  }

  const directoryRel = pickStr(
    cli.directory,
    sharedTomlReact.directory,
    sharedTomlPile.directory,
    './message'
  )!;
  const directoryAbs = path.isAbsolute(directoryRel)
    ? directoryRel
    : path.resolve(cwd, directoryRel);

  const quiet = pickBool(
    cli.quiet,
    sharedTomlReact.quiet,
    sharedTomlPile.quiet,
    false
  )!;

  const inputMode = pickBool(
    cli.inputMode,
    sharedTomlReact.inputMode,
    sharedTomlPile.inputMode,
    false
  )!;

  const continueMode = pickBool(
    cli.continueMode,
    sharedTomlReact.continueMode,
    sharedTomlPile.continueMode,
    false
  )!;

  const maxStep =
    pickInt(
      cli.maxStep,
      reactToml.maxStep
    ) ?? Number.POSITIVE_INFINITY;

  const toolsRel = pickStr(
    cli.toolsFile,
    sharedTomlReact.toolsFile,
    sharedTomlPile.toolsFile,
  );

  let toolsFileForCli: string | undefined;
  if (cli.toolsFile !== undefined) {
    toolsFileForCli = resolveCwdRelative(cwd, cli.toolsFile);
  } else if (toolsRel !== undefined) {
    toolsFileForCli = resolveScanRelative(directoryAbs, toolsRel);
  }

  const afterHookRel = pickStr(
    cli.afterHookPath,
    sharedTomlReact.afterHook,
    sharedTomlPile.afterHook,
  );

  let afterHookForCli: string | undefined;
  if (cli.afterHookPath !== undefined) {
    afterHookForCli = resolveCwdRelative(cwd, cli.afterHookPath);
  } else if (afterHookRel !== undefined) {
    afterHookForCli = resolveScanRelative(directoryAbs, afterHookRel);
  }

  const defaultProfile = pickStr(
    sharedTomlReact.defaultLlmApi,
    sharedTomlPile.defaultLlmApi,
  );

  const sharedLlm = {
    tomlTemperature: sharedTomlReact.llmApiTemperature ?? sharedTomlPile.llmApiTemperature,
    tomlExtraBody: sharedTomlReact.llmApiExtraBody ?? sharedTomlPile.llmApiExtraBody
  };

  const thought = mergePhaseLlm(
    llmApis,
    defaultProfile,
    {
      profileName: reactToml.thoughtLlmApi,
      key: reactToml.thoughtLlmApiKey,
      keyEnv: reactToml.thoughtLlmApiKeyEnv,
      model: reactToml.thoughtLlmApiModel,
      baseUrl: reactToml.thoughtLlmApiBaseUrl,
      temperature: reactToml.thoughtLlmApiTemperature,
      extraBody: reactToml.thoughtLlmApiExtraBody
    },
    cli,
    sharedLlm
  );
  const observe = mergePhaseLlm(
    llmApis,
    defaultProfile,
    {
      profileName: reactToml.observeLlmApi,
      key: reactToml.observeLlmApiKey,
      keyEnv: reactToml.observeLlmApiKeyEnv,
      model: reactToml.observeLlmApiModel,
      baseUrl: reactToml.observeLlmApiBaseUrl,
      temperature: reactToml.observeLlmApiTemperature,
      extraBody: reactToml.observeLlmApiExtraBody
    },
    cli,
    sharedLlm
  );
  const check = mergePhaseLlm(
    llmApis,
    defaultProfile,
    {
      profileName: reactToml.checkLlmApi,
      key: reactToml.checkLlmApiKey,
      keyEnv: reactToml.checkLlmApiKeyEnv,
      model: reactToml.checkLlmApiModel,
      baseUrl: reactToml.checkLlmApiBaseUrl,
      temperature: reactToml.checkLlmApiTemperature,
      extraBody: reactToml.checkLlmApiExtraBody
    },
    cli,
    sharedLlm
  );
  const finalPhase = mergePhaseLlm(
    llmApis,
    defaultProfile,
    {
      profileName: reactToml.finalLlmApi,
      key: reactToml.finalLlmApiKey,
      keyEnv: reactToml.finalLlmApiKeyEnv,
      model: reactToml.finalLlmApiModel,
      baseUrl: reactToml.finalLlmApiBaseUrl,
      temperature: reactToml.finalLlmApiTemperature,
      extraBody: reactToml.finalLlmApiExtraBody
    },
    cli,
    sharedLlm
  );

  const promptPaths = {
    thought: reactToml.thoughtPrompt,
    observe: reactToml.observePrompt,
    check: reactToml.checkPrompt,
    final: reactToml.finalPrompt
  };

  const prompts = loadReactPromptsFromConfig(directoryAbs, promptPaths);

  return {
    cwd,
    configPath: configPathAbs,
    directoryAbs,
    quiet,
    inputMode,
    continueMode,
    maxStep,
    toolsFileForCli,
    afterHookForCli,
    phases: { thought, observe, check, final: finalPhase },
    prompts
  };
};
