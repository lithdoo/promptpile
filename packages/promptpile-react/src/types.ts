import type { ReactPromptTexts } from './load-react-prompts';

export interface PhaseLlmSelection {
  profileName?: string;
  modelOverride?: string;
  apiKeyOverride?: string;
  apiKeyEnvOverride?: string;
  apiBaseUrlOverride?: string;
  /** Raw CLI value; Promptpile owns validation and defaults. */
  temperatureOverride?: string;
  /** Raw JSON CLI value; Promptpile owns validation. */
  extraBodyOverride?: string;
}

/** CLI overrides (highest merge priority). */
export interface ReactCliOverrides {
  configPath?: string;
  directory?: string;
  model?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  temperature?: string;
  extraBody?: string;
  quiet?: boolean;
  toolsFile?: string;
  afterHookPath?: string;
  inputMode?: boolean;
  continueMode?: boolean;
  maxStep?: number;
}

export interface ResolvedReactConfig {
  cwd: string;
  configPath?: string;
  directoryAbs: string;
  quiet: boolean;
  inputMode: boolean;
  continueMode: boolean;
  maxStep: number;
  toolsFileForCli?: string;
  afterHookForCli?: string;
  phases: {
    thought: PhaseLlmSelection;
    observe: PhaseLlmSelection;
    check: PhaseLlmSelection;
    final: PhaseLlmSelection;
  };
  prompts: ReactPromptTexts;
}

export type ReactPhase = 'thought' | 'observe' | 'check' | 'final';
