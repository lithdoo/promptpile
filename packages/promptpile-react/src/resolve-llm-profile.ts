import type { ExtraBody } from 'promptpile/dist/llm-extra-body';
import type { LlmApiProfile } from 'promptpile/dist/toml-config';
import { DEFAULT_TEMPERATURE } from 'promptpile/dist/llm-sampling';
import type { PhaseLlmConfig } from './types';
import { trim } from './merge-utils';

export interface LlmProfileOverrides {
  profileName?: string;
  model?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  apiBaseUrl?: string;
  temperature?: number;
  extraBody?: ExtraBody;
}

const DEFAULT_MODEL = 'gpt-3.5-turbo';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const resolveApiKey = (
  direct?: string,
  envName?: string,
  profile?: LlmApiProfile
): string => {
  const envFromOverride = trim(envName);
  if (envFromOverride !== undefined) {
    const fromEnv = trim(process.env[envFromOverride]);
    if (fromEnv !== undefined) {
      return fromEnv;
    }
  }
  const directKey = trim(direct);
  if (directKey !== undefined) {
    return directKey;
  }
  if (profile !== undefined) {
    const profEnv = trim(profile.api_key_env);
    if (profEnv !== undefined) {
      const fromProfEnv = trim(process.env[profEnv]);
      if (fromProfEnv !== undefined) {
        return fromProfEnv;
      }
    }
    const profKey = trim(profile.api_key);
    if (profKey !== undefined) {
      return profKey;
    }
  }
  return '';
};

export const resolveLlmProfile = (
  llmApis: LlmApiProfile[],
  overrides: LlmProfileOverrides
): PhaseLlmConfig => {
  const profileName = trim(overrides.profileName);
  const prof =
    profileName !== undefined
      ? llmApis.find((x) => x.name.toLowerCase() === profileName.toLowerCase())
      : undefined;

  const model =
    trim(overrides.model) ??
    trim(prof?.model) ??
    DEFAULT_MODEL;

  const apiBaseUrl =
    trim(overrides.apiBaseUrl) ??
    trim(prof?.base_url) ??
    DEFAULT_BASE_URL;

  const apiKey = resolveApiKey(
    overrides.apiKey,
    overrides.apiKeyEnv ?? trim(prof?.api_key_env),
    prof
  );

  const temperature = overrides.temperature ?? prof?.temperature ?? DEFAULT_TEMPERATURE;
  const extraBody = overrides.extraBody ?? prof?.extra_body;

  return { model, apiKey, apiBaseUrl, temperature, extraBody };
};

export const applyCliLlmOverrides = (
  phase: PhaseLlmConfig,
  cli: {
    model?: string;
    apiKey?: string;
    apiBaseUrl?: string;
    temperature?: number;
    extraBody?: ExtraBody;
  }
): PhaseLlmConfig => ({
  model: trim(cli.model) ?? phase.model,
  apiKey: trim(cli.apiKey) ?? phase.apiKey,
  apiBaseUrl: trim(cli.apiBaseUrl) ?? phase.apiBaseUrl,
  temperature: cli.temperature ?? phase.temperature,
  extraBody: cli.extraBody ?? phase.extraBody
});
