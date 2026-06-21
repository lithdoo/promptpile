import fs from 'fs';
import toml from '@iarna/toml';
import type { LlmApiProfile } from 'promptpile/dist/toml-config';
import { loadTomlConfigFile } from 'promptpile/dist/toml-config';
import { getBool, getExtraBody, getInt, getNum, getStr } from './merge-utils';

export interface ReactTomlLayers {
  llmApis: LlmApiProfile[];
  promptpile: Record<string, unknown>;
  promptpileReact: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const loadReactTomlConfig = (absPath: string): ReactTomlLayers => {
  const raw = fs.readFileSync(absPath, 'utf8');
  const doc = toml.parse(raw) as Record<string, unknown>;
  const base = loadTomlConfigFile(absPath);
  const promptpileReact = isRecord(doc['promptpile-react']) ? doc['promptpile-react'] : {};
  return {
    llmApis: base.llmApis,
    promptpile: base.promptpile,
    promptpileReact
  };
};

/** Shared orchestration keys from a TOML table (promptpile or promptpile-react). */
export interface SharedTomlLayer {
  directory?: string;
  quiet?: boolean;
  afterHook?: string;
  toolsFile?: string;
  continueMode?: boolean;
  inputMode?: boolean;
  defaultLlmApi?: string;
  llmApiTemperature?: number;
  llmApiExtraBody?: Record<string, unknown>;
}

export const buildSharedTomlLayer = (table: Record<string, unknown>): SharedTomlLayer => ({
  directory: getStr(table, 'dir'),
  quiet: getBool(table, 'quiet'),
  afterHook: getStr(table, 'after_hook'),
  toolsFile: getStr(table, 'tools_file'),
  continueMode: getBool(table, 'continue'),
  inputMode: getBool(table, 'input'),
  defaultLlmApi: getStr(table, 'llm_api'),
  llmApiTemperature: getNum(table, 'llm_api_temperature'),
  llmApiExtraBody: getExtraBody(table, 'llm_api_extra_body')
});

export interface ReactOnlyTomlLayer {
  maxStep?: number;
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
  thoughtLlmApiTemperature?: number;
  observeLlmApiTemperature?: number;
  checkLlmApiTemperature?: number;
  finalLlmApiTemperature?: number;
  thoughtLlmApiExtraBody?: Record<string, unknown>;
  observeLlmApiExtraBody?: Record<string, unknown>;
  checkLlmApiExtraBody?: Record<string, unknown>;
  finalLlmApiExtraBody?: Record<string, unknown>;
}

export const buildReactOnlyTomlLayer = (table: Record<string, unknown>): ReactOnlyTomlLayer => ({
  maxStep: getInt(table, 'max_step'),
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
  thoughtLlmApiTemperature: getNum(table, 'thought_llm_api_temperature'),
  observeLlmApiTemperature: getNum(table, 'observe_llm_api_temperature'),
  checkLlmApiTemperature: getNum(table, 'check_llm_api_temperature'),
  finalLlmApiTemperature: getNum(table, 'final_llm_api_temperature'),
  thoughtLlmApiExtraBody: getExtraBody(table, 'thought_llm_api_extra_body'),
  observeLlmApiExtraBody: getExtraBody(table, 'observe_llm_api_extra_body'),
  checkLlmApiExtraBody: getExtraBody(table, 'check_llm_api_extra_body'),
  finalLlmApiExtraBody: getExtraBody(table, 'final_llm_api_extra_body')
});
