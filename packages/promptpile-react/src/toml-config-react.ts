import fs from 'fs';
import toml from '@iarna/toml';
import {
  getBool,
  getInt,
  getJsonCliValue,
  getRawCliValue,
  getStr
} from './merge-utils';
import type { MaxStepPolicy } from './types';

export interface ReactTomlLayers {
  promptpile: Record<string, unknown>;
  promptpileReact: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const SHARED_KEYS = new Set([
  'dirs', 'dir', 'output_dir', 'quiet', 'after_hook', 'tools_file',
  'continue', 'input', 'llm_api', 'llm_api_temperature', 'llm_api_extra_body'
]);

const REACT_ONLY_KEYS = new Set([
  'max_step', 'max_step_policy', 'observe_carryover', 'work_root', 'thought_prompt', 'observe_prompt', 'check_prompt', 'final_prompt',
  ...['thought', 'observe', 'check', 'final'].flatMap(phase => [
    `${phase}_llm_api`, `${phase}_llm_api_key`, `${phase}_llm_api_key_env`,
    `${phase}_llm_api_model`, `${phase}_llm_api_base_url`,
    `${phase}_llm_api_temperature`, `${phase}_llm_api_extra_body`
  ])
]);

const tableOrEmpty = (doc: Record<string, unknown>, key: string): Record<string, unknown> => {
  const value = doc[key];
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error(`[${key}] must be a TOML table`);
  }
  return value;
};

export const loadReactTomlConfig = (absPath: string): ReactTomlLayers => {
  const raw = fs.readFileSync(absPath, 'utf8');
  const doc = toml.parse(raw) as Record<string, unknown>;
  const promptpile = tableOrEmpty(doc, 'promptpile');
  const promptpileReact = tableOrEmpty(doc, 'promptpile-react');
  for (const key of Object.keys(promptpileReact)) {
    if (!SHARED_KEYS.has(key) && !REACT_ONLY_KEYS.has(key)) {
      throw new Error(`unknown [promptpile-react] key: ${key}`);
    }
  }
  return {
    promptpile,
    promptpileReact
  };
};

/** Shared orchestration keys from a TOML table (promptpile or promptpile-react). */
export interface SharedTomlLayer {
  inputDirectories?: string[];
  outputDirectory?: string;
  quiet?: boolean;
  afterHook?: string;
  toolsFile?: string;
  continueMode?: boolean;
  inputMode?: boolean;
  defaultLlmApi?: string;
  llmApiTemperature?: string;
  llmApiExtraBody?: string;
}

const getNonEmptyStringArray = (
  table: Record<string, unknown>,
  key: string
): string[] | undefined => {
  const value = table[key];
  if (value === undefined) {
    return undefined;
  }
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

export const buildSharedTomlLayer = (
  table: Record<string, unknown>
): SharedTomlLayer => {
  if (
    Object.prototype.hasOwnProperty.call(table, 'dirs') &&
    Object.prototype.hasOwnProperty.call(table, 'dir')
  ) {
    throw new Error('dirs and dir cannot be used together');
  }

  const dirs = getNonEmptyStringArray(table, 'dirs');
  const dir = getStr(table, 'dir');
  let outputDirectory: string | undefined;
  if (Object.prototype.hasOwnProperty.call(table, 'output_dir')) {
    const rawOutputDirectory = table.output_dir;
    if (typeof rawOutputDirectory !== 'string' || rawOutputDirectory.trim() === '') {
      throw new Error('output_dir must be a non-empty string');
    }
    outputDirectory = rawOutputDirectory.trim();
  }

  return {
    inputDirectories: dirs ?? (dir === undefined ? undefined : [dir]),
    outputDirectory,
    quiet: getBool(table, 'quiet'),
    afterHook: getStr(table, 'after_hook'),
    toolsFile: getStr(table, 'tools_file'),
    continueMode: getBool(table, 'continue'),
    inputMode: getBool(table, 'input'),
    defaultLlmApi: getStr(table, 'llm_api'),
    llmApiTemperature: getRawCliValue(table, 'llm_api_temperature'),
    llmApiExtraBody: getJsonCliValue(table, 'llm_api_extra_body')
  };
};

export interface ReactOnlyTomlLayer {
  maxStep?: number;
  maxStepPolicy?: MaxStepPolicy;
  observeCarryover?: number;
  workRoot?: string;
  thoughtPrompt?: string;
  observePrompt?: string;
  checkPrompt?: string;
  finalPrompt?: string;
  thoughtLlmApi?: string;
  observeLlmApi?: string;
  checkLlmApi?: string;
  finalLlmApi?: string;
  thoughtLlmApiKey?: string;
  thoughtLlmApiKeyEnv?: string;
  thoughtLlmApiModel?: string;
  thoughtLlmApiBaseUrl?: string;
  observeLlmApiKey?: string;
  observeLlmApiKeyEnv?: string;
  observeLlmApiModel?: string;
  observeLlmApiBaseUrl?: string;
  checkLlmApiKey?: string;
  checkLlmApiKeyEnv?: string;
  checkLlmApiModel?: string;
  checkLlmApiBaseUrl?: string;
  finalLlmApiKey?: string;
  finalLlmApiKeyEnv?: string;
  finalLlmApiModel?: string;
  finalLlmApiBaseUrl?: string;
  thoughtLlmApiTemperature?: string;
  observeLlmApiTemperature?: string;
  checkLlmApiTemperature?: string;
  finalLlmApiTemperature?: string;
  thoughtLlmApiExtraBody?: string;
  observeLlmApiExtraBody?: string;
  checkLlmApiExtraBody?: string;
  finalLlmApiExtraBody?: string;
}

const getMaxStepPolicy = (
  table: Record<string, unknown>
): MaxStepPolicy | undefined => {
  const value = getStr(table, 'max_step_policy');
  if (value === undefined || value === 'final' || value === 'error') return value;
  throw new Error('max_step_policy must be final or error');
};

export const buildReactOnlyTomlLayer = (table: Record<string, unknown>): ReactOnlyTomlLayer => ({
  maxStep: getInt(table, 'max_step'),
  maxStepPolicy: getMaxStepPolicy(table),
  observeCarryover: getInt(table, 'observe_carryover'),
  workRoot: getStr(table, 'work_root'),
  thoughtPrompt: getStr(table, 'thought_prompt'),
  observePrompt: getStr(table, 'observe_prompt'),
  checkPrompt: getStr(table, 'check_prompt'),
  finalPrompt: getStr(table, 'final_prompt'),
  thoughtLlmApi: getStr(table, 'thought_llm_api'),
  observeLlmApi: getStr(table, 'observe_llm_api'),
  checkLlmApi: getStr(table, 'check_llm_api'),
  finalLlmApi: getStr(table, 'final_llm_api'),
  thoughtLlmApiKey: getStr(table, 'thought_llm_api_key'),
  thoughtLlmApiKeyEnv: getStr(table, 'thought_llm_api_key_env'),
  thoughtLlmApiModel: getStr(table, 'thought_llm_api_model'),
  thoughtLlmApiBaseUrl: getStr(table, 'thought_llm_api_base_url'),
  observeLlmApiKey: getStr(table, 'observe_llm_api_key'),
  observeLlmApiKeyEnv: getStr(table, 'observe_llm_api_key_env'),
  observeLlmApiModel: getStr(table, 'observe_llm_api_model'),
  observeLlmApiBaseUrl: getStr(table, 'observe_llm_api_base_url'),
  checkLlmApiKey: getStr(table, 'check_llm_api_key'),
  checkLlmApiKeyEnv: getStr(table, 'check_llm_api_key_env'),
  checkLlmApiModel: getStr(table, 'check_llm_api_model'),
  checkLlmApiBaseUrl: getStr(table, 'check_llm_api_base_url'),
  finalLlmApiKey: getStr(table, 'final_llm_api_key'),
  finalLlmApiKeyEnv: getStr(table, 'final_llm_api_key_env'),
  finalLlmApiModel: getStr(table, 'final_llm_api_model'),
  finalLlmApiBaseUrl: getStr(table, 'final_llm_api_base_url'),
  thoughtLlmApiTemperature: getRawCliValue(table, 'thought_llm_api_temperature'),
  observeLlmApiTemperature: getRawCliValue(table, 'observe_llm_api_temperature'),
  checkLlmApiTemperature: getRawCliValue(table, 'check_llm_api_temperature'),
  finalLlmApiTemperature: getRawCliValue(table, 'final_llm_api_temperature'),
  thoughtLlmApiExtraBody: getJsonCliValue(table, 'thought_llm_api_extra_body'),
  observeLlmApiExtraBody: getJsonCliValue(table, 'observe_llm_api_extra_body'),
  checkLlmApiExtraBody: getJsonCliValue(table, 'check_llm_api_extra_body'),
  finalLlmApiExtraBody: getJsonCliValue(table, 'final_llm_api_extra_body')
});
