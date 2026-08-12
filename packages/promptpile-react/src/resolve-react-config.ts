import fs from 'fs';
import path from 'path';
import { loadReactPromptsFromConfig } from './load-react-prompts';
import { pickBool, pickInt, pickStr } from './merge-utils';
import { parseReactCli } from './cli';
import {
  buildReactOnlyTomlLayer,
  buildSharedTomlLayer,
  loadReactTomlConfig,
  type ReactOnlyTomlLayer,
  type SharedTomlLayer
} from './toml-config-react';
import type { PhaseLlmSelection, ResolvedReactConfig, ReactCliOverrides } from './types';

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

const directoryIdentity = (directory: string): string =>
  process.platform === 'win32' ? directory.toLowerCase() : directory;

const canonicalizeExistingPath = (candidate: string): string => {
  try {
    return fs.realpathSync(candidate);
  } catch {
    // Promptpile remains the owner of input-directory existence/type diagnostics.
    return candidate;
  }
};

const mergePhaseLlm = (
  defaultProfile: string | undefined,
  phase: {
    profileName?: string;
    key?: string;
    keyEnv?: string;
    model?: string;
    baseUrl?: string;
    temperature?: string;
    extraBody?: string;
  },
  cli: ReactCliOverrides,
  shared: {
    tomlTemperature?: string;
    tomlExtraBody?: string;
  }
): PhaseLlmSelection => {
  const apiKeyOverride = pickStr(cli.apiKey, phase.key);
  return {
    profileName: pickStr(phase.profileName, defaultProfile),
    modelOverride: pickStr(cli.model, phase.model),
    apiKeyOverride,
    apiKeyEnvOverride:
      apiKeyOverride === undefined ? pickStr(phase.keyEnv) : undefined,
    apiBaseUrlOverride: pickStr(cli.apiBaseUrl, phase.baseUrl),
    temperatureOverride: pickStr(
      cli.temperature,
      phase.temperature,
      shared.tomlTemperature
    ),
    extraBodyOverride: pickStr(
      cli.extraBody,
      phase.extraBody,
      shared.tomlExtraBody
    )
  };
};

export const resolveReactConfig = (cwd: string, argv: string[]): ResolvedReactConfig => {
  let cli: ReactCliOverrides;
  try {
    cli = parseReactCli(argv);
  } catch (e) {
    console.error('Error: Invalid CLI options:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

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
      sharedTomlPile = buildSharedTomlLayer(loaded.promptpile);
      sharedTomlReact = buildSharedTomlLayer(loaded.promptpileReact);
      reactToml = buildReactOnlyTomlLayer(loaded.promptpileReact);
    } catch (e) {
      console.error(`Error: failed to parse TOML config: ${configPathAbs}`, e);
      process.exit(1);
    }
  }

  const outputDirectoryRel = pickStr(
    cli.outputDirectory,
    sharedTomlReact.outputDirectory,
    sharedTomlPile.outputDirectory
  );
  const configuredInputDirectories =
    cli.inputDirectories ??
    sharedTomlReact.inputDirectories ??
    sharedTomlPile.inputDirectories;
  // Match Promptpile: an explicit output by itself is the sole effective input;
  // the legacy default is synthesized only when neither side is configured.
  const inputDirectoriesRel =
    configuredInputDirectories ?? (outputDirectoryRel === undefined ? ['./message'] : []);
  const inputDirectoryCandidates = inputDirectoriesRel.map(directory =>
    path.isAbsolute(directory) ? path.normalize(directory) : path.resolve(cwd, directory)
  );
  let outputDirectoryAbs = outputDirectoryRel === undefined
    ? undefined
    : path.isAbsolute(outputDirectoryRel)
      ? path.normalize(outputDirectoryRel)
      : path.resolve(cwd, outputDirectoryRel);

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

  if (outputDirectoryAbs !== undefined) {
    try {
      fs.mkdirSync(outputDirectoryAbs, { recursive: true });
      const stat = fs.statSync(outputDirectoryAbs);
      if (!stat.isDirectory()) {
        throw new Error('path is not a directory');
      }
      fs.accessSync(outputDirectoryAbs, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      console.error(
        `Error: cannot create, scan, or write conversation output directory: ${outputDirectoryAbs}${detail}`
      );
      process.exit(1);
    }
    outputDirectoryAbs = fs.realpathSync(outputDirectoryAbs);
  }

  const outputIdentity = outputDirectoryAbs === undefined
    ? undefined
    : directoryIdentity(outputDirectoryAbs);
  const seenInputIdentities = new Set<string>();
  const inputDirectoriesAbs: string[] = [];
  for (const candidate of inputDirectoryCandidates) {
    const canonical = canonicalizeExistingPath(candidate);
    const identity = directoryIdentity(canonical);
    if (identity === outputIdentity || seenInputIdentities.has(identity)) {
      continue;
    }
    seenInputIdentities.add(identity);
    inputDirectoriesAbs.push(canonical);
  }

  if (
    inputDirectoriesAbs.length > 1 &&
    (continueMode || inputMode) &&
    outputDirectoryAbs === undefined
  ) {
    console.error(
      'Error: multiple conversation input directories cannot be used with --continue or --input without --output-dir'
    );
    process.exit(1);
  }

  const directoryAbs = outputDirectoryAbs ?? inputDirectoriesAbs[inputDirectoriesAbs.length - 1];

  const maxStep =
    pickInt(
      cli.maxStep,
      reactToml.maxStep
    ) ?? 1;
  if (maxStep < 1) {
    console.error('Error: max_step must be a positive integer');
    process.exit(1);
  }

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
    inputDirectoriesAbs,
    outputDirectoryAbs,
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
