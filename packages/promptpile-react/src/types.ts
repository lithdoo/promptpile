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
  /** Parent directory for session-owned internal Conversation directories. */
  workRoot?: string;
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
  observeCarryover?: number;
  outputFormat?: ReactOutputFormat;
}

export type ReactOutputFormat = 'terminal' | 'stream-json';

export interface ResolvedReactConfig {
  cwd: string;
  configPath?: string;
  /** Ordered input layers passed to Promptpile before its output layer. */
  inputDirectoriesAbs: string[];
  /** Explicit writable Conversation directory, when configured. */
  outputDirectoryAbs?: string;
  /** Compatibility conversation anchor: output directory, otherwise final input layer. */
  directoryAbs: string;
  /** Canonical user-visible layers, including the writable session layer exactly once at the end. */
  authoritativeReadLayersAbs: string[];
  /** User-visible mutation target for append-user and persisted Final. */
  userWritableAbs: string;
  /** Optional configured parent for session-owned work directories. */
  configuredWorkRootAbs?: string;
  quiet: boolean;
  inputMode: boolean;
  continueMode: boolean;
  maxStep: number;
  /** Maximum recent persisted Observe turns kept in the active work Conversation. */
  observeCarryover: number;
  outputFormat: ReactOutputFormat;
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

export interface ReactSessionContext {
  sessionId: string;
  workRootAbs: string;
  workDirectoryAbs: string;
}
