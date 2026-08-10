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
  /** Ordered Conversation input layers supplied by repeated -d/--directory. */
  inputDirectories?: string[];
  /** Unique writable Conversation directory. */
  outputDirectory?: string;
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
  /** Ordered input layers passed to Promptpile before its output layer. */
  inputDirectoriesAbs: string[];
  /** Explicit writable Conversation directory, when configured. */
  outputDirectoryAbs?: string;
  /** Compatibility conversation anchor: output directory, otherwise final input layer. */
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
