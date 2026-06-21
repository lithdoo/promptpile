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

export const loadTomlConfigFile = (absPath: string): ParsedTomlConfig => {
  const raw = fs.readFileSync(absPath, 'utf8');
  const doc = toml.parse(raw) as Record<string, unknown>;
  const promptpile = isRecord(doc.promptpile) ? doc.promptpile : {};
  const rawApis = doc.llm_api;
  const llmApis: LlmApiProfile[] = [];
  if (Array.isArray(rawApis)) {
    for (const row of rawApis) {
      if (!isRecord(row)) {
        continue;
      }
      const name = row.name;
      if (typeof name !== 'string' || name.trim() === '') {
        continue;
      }
      const profTemp =
        row.temperature !== undefined ? coerceTemperatureValue(row.temperature) : undefined;
      const profExtraBody =
        row.extra_body !== undefined ? coerceExtraBodyValue(row.extra_body) : undefined;
      llmApis.push({
        name: name.trim(),
        model: typeof row.model === 'string' ? row.model : undefined,
        base_url: typeof row.base_url === 'string' ? row.base_url : undefined,
        api_key: typeof row.api_key === 'string' ? row.api_key : undefined,
        api_key_env: typeof row.api_key_env === 'string' ? row.api_key_env : undefined,
        temperature: profTemp,
        extra_body: profExtraBody
      });
    }
  }
  return { promptpile, llmApis };
};
