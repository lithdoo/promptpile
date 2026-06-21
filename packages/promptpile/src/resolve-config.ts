import fs from 'fs';
import path from 'path';
import type { Config } from './types';
import { parseCli } from './cli';
import { loadTomlConfigFile, type ParsedTomlConfig } from './toml-config';
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
  directory?: string;
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

const buildTomlLayer = (parsed: ParsedTomlConfig): FlatLayer => {
  const p = parsed.promptpile;
  const out: FlatLayer = {};
  const dir = getStr(p, 'dir');
  if (dir !== undefined) {
    out.directory = dir;
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

  const profileName = getStr(p, 'llm_api');
  let model = getStr(p, 'llm_api_model');
  let baseUrl = getStr(p, 'llm_api_base_url');
  let apiKey = getStr(p, 'llm_api_key');
  let apiKeyEnv = getStr(p, 'llm_api_key_env');
  let temperature = getNum(p, 'llm_api_temperature');
  let extraBody =
    p.llm_api_extra_body !== undefined
      ? coerceExtraBodyValue(p.llm_api_extra_body)
      : undefined;
  if (profileName) {
    const prof = parsed.llmApis.find(
      x => x.name.toLowerCase() === profileName!.toLowerCase()
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
  directory: trim(cli.directory),
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
  try {
    const parsed = parseCli(argv);
    configPath = parsed.configPath;
    cliPartial = parsed.options;
  } catch (e) {
    console.error('Error: Invalid CLI options:', e instanceof Error ? e.message : e);
    process.exit(1);
  }

  const rawConfigPath = configPath;

  let tomlParsed: ParsedTomlConfig = { promptpile: {}, llmApis: [] };
  if (rawConfigPath !== undefined && rawConfigPath !== '') {
    const abs = path.isAbsolute(rawConfigPath)
      ? rawConfigPath
      : path.resolve(cwd, rawConfigPath);
    if (!fs.existsSync(abs)) {
      console.error(`Error: config file not found: ${abs}`);
      process.exit(1);
    }
    try {
      tomlParsed = loadTomlConfigFile(abs);
    } catch (e) {
      console.error(`Error: failed to parse TOML config: ${abs}`, e);
      process.exit(1);
    }
  }

  const tomlLayer = buildTomlLayer(tomlParsed);
  const cliLayer = mapCliToFlat(cliPartial);

  const directory = pickStr(
    cliLayer.directory,
    tomlLayer.directory,
    './messages'
  );
  const resolvedDirAbs = path.isAbsolute(directory) ? directory : path.resolve(cwd, directory);

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

  const apiKeyDirect = pickOptStr(
    cliLayer.apiKey,
    tomlLayer.apiKey,
  );
  const apiKeyEnvName = pickOptStr(
    undefined,
    tomlLayer.apiKeyEnvName,
  );
  let apiKey = apiKeyDirect ?? '';
  if (apiKey === '' && apiKeyEnvName !== undefined) {
    apiKey = trim(process.env[apiKeyEnvName]) ?? '';
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

  const outputPileFormat = pickOptStr(
    cliLayer.outputPileFormat,
    tomlLayer.outputPileFormat,
  ) as OutputPileFormat | undefined;

  const quiet = pickBool(
    cliLayer.quiet,
    tomlLayer.quiet,
    false
  );

  const continueMode = pickBool(
    cliLayer.continueMode,
    tomlLayer.continueMode,
    false
  );

  const inputMode = pickBool(
    cliLayer.inputMode,
    tomlLayer.inputMode,
    false
  );

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

  return {
    directory: resolvedDirAbs,
    model,
    apiKey,
    apiBaseUrl,
    temperature,
    extraBody,
    continueMode,
    inputMode,
    output,
    outputPileFile,
    outputPileFd,
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
