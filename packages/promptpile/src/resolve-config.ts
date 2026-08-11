import fs from 'fs';
import path from 'path';
import type { Config } from './types';
import { parseCli } from './cli';
import {
  loadLlmApiProfilesFile,
  loadPromptpileTomlTable,
  loadTomlConfigFile,
  type ParsedTomlConfig
} from './toml-config';
import { coerceExtraBodyValue, type ExtraBody } from './llm-extra-body';
import {
  coerceTemperatureValue,
  DEFAULT_TEMPERATURE,
  parseTemperatureInput
} from './llm-sampling';
import { parseOutputPileFd, parseOutputPileFormat, type OutputPileFormat } from './output-pile';
import { parseMissingToolResultsPolicy } from './tool-result-policy';

/** Pre-merge shape: booleans use undefined = “本层未写”. */
interface FlatLayer {
  inputDirectories?: string[];
  outputDirectory?: string;
  model?: string;
  apiKey?: string;
  apiKeyEnvName?: string;
  apiBaseUrl?: string;
  output?: string;
  outputPileFile?: string;
  outputPileFd?: number;
  outputPileFormat?: OutputPileFormat;
  quiet?: boolean;
  continueMode?: boolean;
  inputMode?: boolean;
  toolsFileConfig?: string;
  afterHookConfig?: string;
  toolChoice?: string;
  insertFiles?: string;
  appendFiles?: string;
  disableTool?: boolean;
  temperature?: number;
  extraBody?: ExtraBody;
  missingToolResults?: Config['missingToolResults'];
}

const trim = (v: string | undefined): string | undefined => {
  if (v === undefined) {
    return undefined;
  }
  const t = v.trim();
  return t === '' ? undefined : t;
};

const getStr = (r: Record<string, unknown>, key: string): string | undefined => {
  const v = r[key];
  if (typeof v === 'string') {
    return trim(v);
  }
  if (typeof v === 'number' || typeof v === 'boolean') {
    return trim(String(v));
  }
  return undefined;
};

const getNum = (r: Record<string, unknown>, key: string): number | undefined => {
  const v = r[key];
  if (v === undefined) {
    return undefined;
  }
  return coerceTemperatureValue(v);
};

const getBool = (r: Record<string, unknown>, key: string): boolean | undefined => {
  const v = r[key];
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'string') {
    const normalized = v.trim().toLowerCase();
    if (normalized === '') return undefined;
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
  }
  return undefined;
};

const getNonEmptyStringArray = (
  record: Record<string, unknown>,
  key: string
): string[] | undefined => {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${key} must be a non-empty array of non-empty strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`${key}[${index}] must be a non-empty string`);
    }
    return item.trim();
  });
};

const buildTomlLayer = (
  runtimeParsed: ParsedTomlConfig,
  profiles: ParsedTomlConfig['llmApis'],
  selectedProfileName: string | undefined
): FlatLayer => {
  const p = runtimeParsed.promptpile;
  const out: FlatLayer = {};
  if (
    Object.prototype.hasOwnProperty.call(p, 'dirs') &&
    Object.prototype.hasOwnProperty.call(p, 'dir')
  ) {
    throw new Error('promptpile.dirs and promptpile.dir cannot be used together');
  }
  const dirs = getNonEmptyStringArray(p, 'dirs');
  if (dirs !== undefined) {
    out.inputDirectories = dirs;
  }
  const dir = getStr(p, 'dir');
  if (dir !== undefined) {
    out.inputDirectories = [dir];
  }
  if (Object.prototype.hasOwnProperty.call(p, 'output_dir')) {
    const outputDirectory = p.output_dir;
    if (typeof outputDirectory !== 'string' || outputDirectory.trim() === '') {
      throw new Error('output_dir must be a non-empty string');
    }
    out.outputDirectory = outputDirectory.trim();
  }
  const outv = p.output;
  if (typeof outv === 'string') {
    const t = trim(outv);
    if (t !== undefined) {
      out.output = t;
    }
  }
  const outputPileFile = getStr(p, 'output_pile_file') ?? getStr(p, 'output_pipe');
  if (outputPileFile !== undefined) {
    out.outputPileFile = outputPileFile;
  }
  out.outputPileFd = parseOutputPileFd(p.output_pile_fd);
  out.outputPileFormat = parseOutputPileFormat(p.output_pile_format ?? p.output_pipe_format);
  const qb = getBool(p, 'quiet');
  if (qb !== undefined) {
    out.quiet = qb;
  }
  const ah = getStr(p, 'after_hook');
  if (ah !== undefined) {
    out.afterHookConfig = ah;
  }
  const tc = getStr(p, 'tool_choice');
  if (tc !== undefined) {
    out.toolChoice = tc;
  }
  const tf = getStr(p, 'tools_file');
  if (tf !== undefined) {
    out.toolsFileConfig = tf;
  }
  const dt = getBool(p, 'disable_tool');
  if (dt !== undefined) {
    out.disableTool = dt;
  }
  const cm = getBool(p, 'continue');
  if (cm !== undefined) {
    out.continueMode = cm;
  }
  const im = getBool(p, 'input');
  if (im !== undefined) {
    out.inputMode = im;
  }
  const ins = getStr(p, 'insert_files');
  if (ins !== undefined) {
    out.insertFiles = ins;
  }
  const app = getStr(p, 'append_files');
  if (app !== undefined) {
    out.appendFiles = app;
  }
  out.missingToolResults = parseMissingToolResultsPolicy(p.missing_tool_results);

  let model = getStr(p, 'llm_api_model');
  let baseUrl = getStr(p, 'llm_api_base_url');
  let apiKey = getStr(p, 'llm_api_key');
  let apiKeyEnv = getStr(p, 'llm_api_key_env');
  let temperature = getNum(p, 'llm_api_temperature');
  let extraBody =
    p.llm_api_extra_body !== undefined
      ? coerceExtraBodyValue(p.llm_api_extra_body)
      : undefined;
  if (selectedProfileName) {
    const prof = profiles.find(
      x => x.name.toLowerCase() === selectedProfileName.toLowerCase()
    );
    if (prof) {
      model = model ?? trim(prof.model);
      baseUrl = baseUrl ?? trim(prof.base_url);
      apiKey = apiKey ?? trim(prof.api_key);
      apiKeyEnv = apiKeyEnv ?? trim(prof.api_key_env);
      temperature = temperature ?? prof.temperature;
      extraBody = extraBody ?? prof.extra_body;
    }
  }
  if (model !== undefined) {
    out.model = model;
  }
  if (baseUrl !== undefined) {
    out.apiBaseUrl = baseUrl;
  }
  if (apiKey !== undefined) {
    out.apiKey = apiKey;
  }
  if (apiKeyEnv !== undefined) {
    out.apiKeyEnvName = apiKeyEnv;
  }
  if (temperature !== undefined) {
    out.temperature = temperature;
  }
  if (extraBody !== undefined) {
    out.extraBody = extraBody;
  }
  return out;
};

const pickStr = (
  cli: string | undefined,
  toml: string | undefined,
  fallback?: string
): string => trim(cli) ?? trim(toml) ?? trim(fallback) ?? '';

const pickOptStr = (
  cli: string | undefined,
  toml: string | undefined
): string | undefined => trim(cli) ?? trim(toml);

const pickNum = (
  cli: number | undefined,
  toml: number | undefined,
  fallback: number
): number => cli ?? toml ?? fallback;

const pickOptNum = (
  cli: number | undefined,
  toml: number | undefined
): number | undefined => cli ?? toml;

const pickRecord = (
  cli: ExtraBody | undefined,
  toml: ExtraBody | undefined
): ExtraBody | undefined => cli ?? toml;

const pickBool = (
  cli: boolean | undefined,
  toml: boolean | undefined,
  def: boolean
): boolean => cli ?? toml ?? def;

const mapCliToFlat = (cli: Partial<Config>): FlatLayer => ({
  inputDirectories: cli.inputDirectories,
  outputDirectory: trim(cli.outputDirectory),
  model: trim(cli.model),
  apiKey: trim(cli.apiKey),
  apiBaseUrl: trim(cli.apiBaseUrl),
  output: trim(cli.output),
  outputPileFile: trim(cli.outputPileFile),
  outputPileFd: cli.outputPileFd,
  outputPileFormat: cli.outputPileFormat,
  quiet: cli.quiet,
  continueMode: cli.continueMode,
  inputMode: cli.inputMode,
  toolChoice: trim(cli.toolChoice),
  disableTool: cli.disableTool,
  temperature: cli.temperature,
  extraBody: cli.extraBody,
  missingToolResults: cli.missingToolResults
});

export const resolveConfig = (cwd: string, argv: string[]): Config => {
  let cliPartial: Partial<Config>;
  let configPath: string | undefined;
  let llmConfigPath: string | undefined;
  let explicitLlmApiName: string | undefined;
  let explicitApiKeyEnvName: string | undefined;
  try {
    const parsed = parseCli(argv);
    configPath = parsed.configPath;
    llmConfigPath = parsed.llmConfigPath;
    explicitLlmApiName = parsed.llmApiName;
    explicitApiKeyEnvName = parsed.apiKeyEnvName;
    cliPartial = parsed.options;
  } catch (e) {
    console.error('Error: Invalid CLI options:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  if (cliPartial.apiKey !== undefined && explicitApiKeyEnvName !== undefined) {
    console.error('Error: --api-key and --api-key-env cannot be used together');
    process.exit(1);
  }

  const resolveExistingConfigPath = (rawPath: string, label: string): string => {
    const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
    if (!fs.existsSync(abs)) {
      console.error(`Error: ${label} file not found: ${abs}`);
      process.exit(1);
    }
    return abs;
  };

  let runtimeParsed: ParsedTomlConfig = { promptpile: {}, llmApis: [] };
  if (configPath) {
    const abs = resolveExistingConfigPath(configPath, 'config');
    try {
      runtimeParsed = llmConfigPath
        ? { promptpile: loadPromptpileTomlTable(abs), llmApis: [] }
        : loadTomlConfigFile(abs);
    } catch (e) {
      console.error(`Error: failed to parse TOML config: ${abs}`, e);
      process.exit(1);
    }
  }

  let profiles = runtimeParsed.llmApis;
  if (llmConfigPath) {
    const abs = resolveExistingConfigPath(llmConfigPath, 'LLM config');
    try {
      profiles = loadLlmApiProfilesFile(abs);
    } catch (e) {
      console.error(`Error: failed to parse LLM config file: ${abs}`, e);
      process.exit(1);
    }
  }

  const configuredProfileName = getStr(runtimeParsed.promptpile, 'llm_api');
  const selectedProfileName = explicitLlmApiName ?? configuredProfileName;
  if (
    explicitLlmApiName !== undefined &&
    !profiles.some(
      profile => profile.name.toLowerCase() === explicitLlmApiName!.toLowerCase()
    )
  ) {
    console.error(`Error: LLM API profile not found: ${explicitLlmApiName}`);
    process.exit(1);
  }

  const tomlLayer = buildTomlLayer(runtimeParsed, profiles, selectedProfileName);
  const cliLayer = mapCliToFlat(cliPartial);

  // Preserve the established CLI diagnostic precedence: an explicitly named
  // missing key source is reported before conversation-directory preflight.
  if (explicitApiKeyEnvName !== undefined) {
    const value = trim(process.env[explicitApiKeyEnvName]);
    if (value === undefined) {
      console.error(
        `Error: API key environment variable is not set or empty: ${explicitApiKeyEnvName}`
      );
      process.exit(1);
    }
  }

  const explicitOutputDirectory = pickOptStr(
    cliLayer.outputDirectory,
    tomlLayer.outputDirectory
  );
  const configuredDirectories =
    cliLayer.inputDirectories && cliLayer.inputDirectories.length > 0
      ? cliLayer.inputDirectories
      : tomlLayer.inputDirectories;
  const selectedDirectories =
    configuredDirectories ?? (explicitOutputDirectory === undefined ? ['./messages'] : []);
  const seenDirectoryIdentities = new Set<string>();
  let inputDirectories: string[] = [];
  for (const rawDirectory of selectedDirectories) {
    const candidate = path.isAbsolute(rawDirectory)
      ? path.normalize(rawDirectory)
      : path.resolve(cwd, rawDirectory);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      throw new Error(`conversation input directory does not exist: ${candidate}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`conversation input path is not a directory: ${candidate}`);
    }
    const canonical = fs.realpathSync(candidate);
    const identity = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    if (seenDirectoryIdentities.has(identity)) continue;
    seenDirectoryIdentities.add(identity);
    inputDirectories.push(canonical);
  }

  let resolvedExplicitOutputDirectory: string | undefined;
  if (explicitOutputDirectory !== undefined) {
    const candidate = path.isAbsolute(explicitOutputDirectory)
      ? path.normalize(explicitOutputDirectory)
      : path.resolve(cwd, explicitOutputDirectory);
    try {
      fs.mkdirSync(candidate, { recursive: true });
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) {
        throw new Error('path is not a directory');
      }
      fs.accessSync(candidate, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      throw new Error(`cannot create, scan, or write conversation output directory: ${candidate}${detail}`);
    }
    resolvedExplicitOutputDirectory = fs.realpathSync(candidate);
    const outputIdentity = process.platform === 'win32'
      ? resolvedExplicitOutputDirectory.toLowerCase()
      : resolvedExplicitOutputDirectory;
    inputDirectories = inputDirectories.filter(directory => {
      const identity = process.platform === 'win32' ? directory.toLowerCase() : directory;
      return identity !== outputIdentity;
    });
    inputDirectories.push(resolvedExplicitOutputDirectory);
  }

  if (inputDirectories.length === 0) {
    throw new Error('at least one conversation input directory is required');
  }
  const requestedContinueMode = pickBool(
    cliLayer.continueMode,
    tomlLayer.continueMode,
    false
  );
  const requestedInputMode = pickBool(
    cliLayer.inputMode,
    tomlLayer.inputMode,
    false
  );
  if (
    (cliPartial.expectedOutputFingerprint !== undefined ||
      cliPartial.expectedOutputNextIndex !== undefined) &&
    !requestedContinueMode &&
    !requestedInputMode
  ) {
    throw new Error(
      '--expect-output-fingerprint/--expected-output-next-index require --input or --continue'
    );
  }
  if (
    inputDirectories.length > 1 &&
    (requestedContinueMode || requestedInputMode) &&
    resolvedExplicitOutputDirectory === undefined
  ) {
    throw new Error(
      'multiple conversation input directories cannot be used with --continue or --input without --output-dir'
    );
  }
  const resolvedDirAbs = inputDirectories[inputDirectories.length - 1];
  const outputDirectory =
    resolvedExplicitOutputDirectory ??
    (requestedContinueMode || requestedInputMode ? resolvedDirAbs : undefined);
  if (outputDirectory !== undefined && resolvedExplicitOutputDirectory === undefined) {
    try {
      fs.accessSync(outputDirectory, fs.constants.R_OK | fs.constants.W_OK);
    } catch (error) {
      const detail = error instanceof Error ? `: ${error.message}` : '';
      throw new Error(
        `cannot scan or write conversation output directory: ${outputDirectory}${detail}`
      );
    }
  }

  const model = pickStr(
    cliLayer.model,
    tomlLayer.model,
    'gpt-3.5-turbo'
  );
  const apiBaseUrl = pickStr(
    cliLayer.apiBaseUrl,
    tomlLayer.apiBaseUrl,
    'https://api.openai.com/v1'
  );

  let apiKey: string;
  if (explicitApiKeyEnvName !== undefined) {
    const value = trim(process.env[explicitApiKeyEnvName]);
    if (value === undefined) {
      console.error(
        `Error: API key environment variable is not set or empty: ${explicitApiKeyEnvName}`
      );
      process.exit(1);
    }
    apiKey = value;
  } else {
    const apiKeyDirect = pickOptStr(
      cliLayer.apiKey,
      tomlLayer.apiKey,
    );
    const apiKeyEnvName = pickOptStr(
      undefined,
      tomlLayer.apiKeyEnvName,
    );
    apiKey = apiKeyDirect ?? '';
    if (apiKey === '' && apiKeyEnvName !== undefined) {
      apiKey = trim(process.env[apiKeyEnvName]) ?? '';
    }
  }

  const output = pickOptStr(
    cliLayer.output,
    tomlLayer.output,
  );

  const outputPileFile = pickOptStr(
    cliLayer.outputPileFile,
    tomlLayer.outputPileFile,
  );

  const outputPileFd = pickOptNum(
    cliLayer.outputPileFd,
    tomlLayer.outputPileFd,
  );

  const outputPileSource =
    cliLayer.outputPileFile !== undefined || cliLayer.outputPileFd !== undefined
      ? { layer: cliLayer, source: 'cli' as const }
      : tomlLayer.outputPileFile !== undefined || tomlLayer.outputPileFd !== undefined
        ? { layer: tomlLayer, source: 'toml' as const }
        : undefined;
  const outputPileTarget = outputPileSource === undefined
    ? undefined
    : outputPileSource.layer.outputPileFd !== undefined
      ? {
          kind: 'fd' as const,
          fd: outputPileSource.layer.outputPileFd,
          source: outputPileSource.source,
          shadowedFile: outputPileSource.layer.outputPileFile
        }
      : {
          kind: 'file' as const,
          path: outputPileSource.layer.outputPileFile!,
          source: outputPileSource.source
        };

  const outputPileFormat = pickOptStr(
    cliLayer.outputPileFormat,
    tomlLayer.outputPileFormat,
  ) as OutputPileFormat | undefined;

  const quiet = pickBool(
    cliLayer.quiet,
    tomlLayer.quiet,
    false
  );

  const continueMode = requestedContinueMode;

  const inputMode = requestedInputMode;

  const disableTool = pickBool(
    cliLayer.disableTool,
    tomlLayer.disableTool,
    false
  );

  const toolsFileConfig = pickOptStr(
    undefined,
    tomlLayer.toolsFileConfig,
  );

  const afterHookConfig = pickOptStr(
    undefined,
    tomlLayer.afterHookConfig,
  );

  const allowDefaultAfterHook = cliPartial.allowDefaultAfterHook === true;

  const toolChoice = pickOptStr(
    cliLayer.toolChoice,
    tomlLayer.toolChoice,
  );

  const insertFilesMerged = pickOptStr(
    cliPartial.insertFilesCli,
    tomlLayer.insertFiles,
  );

  const appendFilesMerged = pickOptStr(
    cliPartial.appendFilesCli,
    tomlLayer.appendFiles,
  );

  const temperature = pickNum(
    cliLayer.temperature,
    tomlLayer.temperature,
    DEFAULT_TEMPERATURE
  );

  const extraBody = pickRecord(
    cliLayer.extraBody,
    tomlLayer.extraBody,
  );

  const missingToolResults =
    cliLayer.missingToolResults ?? tomlLayer.missingToolResults ?? 'warn';

  const conversationIo = {
    inputDirectories,
    outputDirectory,
    anchorDirectory: resolvedDirAbs
  };

  return {
    conversationIo,
    // Compatibility aliases for callers consuming the pre-layered Config shape.
    inputDirectories,
    directory: resolvedDirAbs,
    outputDirectory,
    model,
    apiKey,
    apiBaseUrl,
    temperature,
    extraBody,
    continueMode,
    inputMode,
    expectedOutputFingerprint: cliPartial.expectedOutputFingerprint,
    expectedOutputNextIndex: cliPartial.expectedOutputNextIndex,
    output,
    outputPileFile,
    outputPileFd,
    outputPileTarget,
    outputPileFormat,
    quiet,
    toolsFileCli: cliPartial.toolsFileCli,
    toolsFileConfig,
    insertFilesCli: insertFilesMerged,
    appendFilesCli: appendFilesMerged,
    afterHookCli: cliPartial.afterHookCli,
    afterHookConfig,
    allowDefaultAfterHook,
    toolChoice,
    missingToolResults,
    disableTool
  };
};
