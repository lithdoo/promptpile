import { CHECK_DECISION_TOOL_NAME } from './check-decision-tool';
import type { ReactPhase, ReactSessionContext, ResolvedReactConfig } from './types';

const appendLlm = (
  argv: string[],
  configPath: string | undefined,
  llm: ResolvedReactConfig['phases'][ReactPhase]
): void => {
  if (configPath !== undefined) {
    argv.push('--llm-config', configPath);
  }
  if (llm.profileName !== undefined) {
    argv.push('--llm-api', llm.profileName);
  }
  if (llm.modelOverride !== undefined) {
    argv.push('-m', llm.modelOverride);
  }
  if (llm.apiKeyOverride !== undefined) {
    argv.push('-k', llm.apiKeyOverride);
  } else if (llm.apiKeyEnvOverride !== undefined) {
    argv.push('--api-key-env', llm.apiKeyEnvOverride);
  }
  if (llm.apiBaseUrlOverride !== undefined) {
    argv.push('-b', llm.apiBaseUrlOverride);
  }
  if (llm.temperatureOverride !== undefined) {
    argv.push('--temperature', llm.temperatureOverride);
  }
  if (llm.extraBodyOverride !== undefined) {
    argv.push('--extra-body', llm.extraBodyOverride);
  }
};

export interface BuildPhaseArgvOptions {
  /** Override every Conversation directory (Check uses one empty temporary directory). */
  directoryOverride?: string;
  session?: ReactSessionContext;
}

export interface PhaseConversationRouting {
  directories: string[];
  outputDirectory?: string;
  continueMode: boolean;
}

export const resolvePhaseConversationRouting = (
  phase: ReactPhase,
  config: ResolvedReactConfig,
  options?: BuildPhaseArgvOptions
): PhaseConversationRouting => {
  if (options?.directoryOverride !== undefined) {
    return { directories: [options.directoryOverride], continueMode: false };
  }
  const session = options?.session;
  if (session === undefined) {
    throw new Error(`React session context is required for ${phase}`);
  }
  if (phase === 'thought') {
    return {
      directories: config.authoritativeReadLayersAbs,
      outputDirectory: session.workDirectoryAbs,
      continueMode: true
    };
  }
  if (phase === 'observe') {
    return {
      directories: [...config.authoritativeReadLayersAbs, session.workDirectoryAbs],
      continueMode: false
    };
  }
  if (phase === 'final') {
    return {
      directories: config.authoritativeReadLayersAbs,
      outputDirectory: config.continueMode ? config.userWritableAbs : undefined,
      continueMode: config.continueMode
    };
  }
  throw new Error('Check requires an isolated directory override');
};

/**
 * Base argv per ReAct phase (profile-only config plus explicit overrides).
 * Callers append --insert-files / Observe temp paths after this.
 */
export const buildPhaseArgv = (
  phase: ReactPhase,
  config: ResolvedReactConfig,
  options?: BuildPhaseArgvOptions
): string[] => {
  const routing = resolvePhaseConversationRouting(phase, config, options);
  const argv: string[] = [];
  for (const directory of routing.directories) {
    argv.push('-d', directory);
  }
  if (routing.outputDirectory !== undefined) {
    argv.push('--output-dir', routing.outputDirectory);
  }
  const llm = config.phases[phase];
  appendLlm(argv, config.configPath, llm);

  if (config.quiet) {
    argv.push('-q');
  }

  if (phase === 'thought') {
    if (config.toolsFileForCli !== undefined) {
      argv.push('--tools-file', config.toolsFileForCli);
    }
    if (config.afterHookForCli !== undefined) {
      argv.push('--after-hook-path', config.afterHookForCli);
    }
  }

  if (phase === 'observe' || phase === 'final') {
    argv.push('--disable-tool');
  }

  if (phase === 'check') {
    argv.push('--tool-choice', `function:${CHECK_DECISION_TOOL_NAME}`);
  }

  if (routing.continueMode) {
    argv.push('-c');
  }

  return argv;
};
