import fs from 'fs';
import toml from '@iarna/toml';
import { coerceExtraBodyValue, type ExtraBody } from './llm-extra-body';
import { coerceTemperatureValue } from './llm-sampling';

export interface LlmApiProfile {
  name: string;
  model?: string;
  base_url?: string;
  api_key?: string;
  api_key_env?: string;
  temperature?: number;
  extra_body?: ExtraBody;
}

export interface ParsedTomlConfig {
  promptpile: Record<string, unknown>;
  llmApis: LlmApiProfile[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const loadTomlDocument = (absPath: string): Record<string, unknown> => {
  const raw = fs.readFileSync(absPath, 'utf8');
  return toml.parse(raw) as Record<string, unknown>;
};

const LLM_API_PROFILE_KEYS = new Set([
  'name', 'model', 'base_url', 'api_key', 'api_key_env', 'temperature', 'extra_body'
]);

const optionalProfileString = (
  row: Record<string, unknown>,
  key: string,
  profileName: string
): string | undefined => {
  const value = row[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`llm_api profile "${profileName}" field ${key} must be a non-empty string`);
  }
  return value.trim();
};

const parseLlmApis = (doc: Record<string, unknown>): LlmApiProfile[] => {
  const rawApis = doc.llm_api;
  const llmApis: LlmApiProfile[] = [];
  if (rawApis !== undefined && !Array.isArray(rawApis)) {
    throw new Error('llm_api must be an array of TOML tables ([[llm_api]])');
  }
  if (Array.isArray(rawApis)) {
    const normalizedNames = new Set<string>();
    for (const row of rawApis) {
      if (!isRecord(row)) {
        throw new Error('each [[llm_api]] entry must be a TOML table');
      }
      const name = row.name;
      if (typeof name !== 'string' || name.trim() === '') {
        throw new Error('each [[llm_api]] entry must have a non-empty string name');
      }
      const normalizedName = name.trim();
      const lookupName = normalizedName.toLowerCase();
      if (normalizedNames.has(lookupName)) {
        throw new Error(`duplicate case-insensitive llm_api profile name: ${normalizedName}`);
      }
      normalizedNames.add(lookupName);
      for (const key of Object.keys(row)) {
        if (!LLM_API_PROFILE_KEYS.has(key)) {
          throw new Error(`unknown [[llm_api]] key in profile "${normalizedName}": ${key}`);
        }
      }
      const profTemp =
        row.temperature !== undefined ? coerceTemperatureValue(row.temperature) : undefined;
      const profExtraBody =
        row.extra_body !== undefined ? coerceExtraBodyValue(row.extra_body) : undefined;
      llmApis.push({
        name: normalizedName,
        model: optionalProfileString(row, 'model', normalizedName),
        base_url: optionalProfileString(row, 'base_url', normalizedName),
        api_key: optionalProfileString(row, 'api_key', normalizedName),
        api_key_env: optionalProfileString(row, 'api_key_env', normalizedName),
        temperature: profTemp,
        extra_body: profExtraBody
      });
    }
  }
  return llmApis;
};

export const loadPromptpileTomlTable = (absPath: string): Record<string, unknown> => {
  const doc = loadTomlDocument(absPath);
  if (doc.promptpile === undefined) return {};
  if (!isRecord(doc.promptpile)) throw new Error('promptpile must be a TOML table ([promptpile])');
  return doc.promptpile;
};

export const loadLlmApiProfilesFile = (absPath: string): LlmApiProfile[] =>
  parseLlmApis(loadTomlDocument(absPath));

export const loadTomlConfigFile = (absPath: string): ParsedTomlConfig => {
  const doc = loadTomlDocument(absPath);
  if (doc.promptpile !== undefined && !isRecord(doc.promptpile)) {
    throw new Error('promptpile must be a TOML table ([promptpile])');
  }
  const promptpile = isRecord(doc.promptpile) ? doc.promptpile : {};
  const llmApis = parseLlmApis(doc);
  return { promptpile, llmApis };
};
