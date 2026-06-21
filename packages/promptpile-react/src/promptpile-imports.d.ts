declare module 'promptpile/dist/llm-sampling' {
  export const DEFAULT_TEMPERATURE: number;
  export function parseTemperatureInput(raw: string | undefined): number | undefined;
  export function coerceTemperatureValue(v: unknown): number | undefined;
}

declare module 'promptpile/dist/llm-extra-body' {
  export type ExtraBody = Record<string, unknown>;
  export function parseExtraBodyInput(raw: string | undefined): ExtraBody | undefined;
  export function coerceExtraBodyValue(v: unknown): ExtraBody | undefined;
}

declare module 'promptpile/dist/toml-config' {
  export interface LlmApiProfile {
    name: string;
    model?: string;
    base_url?: string;
    api_key?: string;
    api_key_env?: string;
    temperature?: number;
    extra_body?: Record<string, unknown>;
  }

  export interface ParsedTomlConfig {
    promptpile: Record<string, unknown>;
    llmApis: LlmApiProfile[];
  }

  export function loadTomlConfigFile(absPath: string): ParsedTomlConfig;
}
