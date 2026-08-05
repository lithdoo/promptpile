import { CHECK_DECISION_TOOL_NAME } from './check-decision-tool';
import type { ReactPhase, ResolvedReactConfig } from './types';

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
  /** 覆盖 `-d` 扫描目录（check 阶段使用空临时目录）。 */
  directoryOverride?: string;
}

/**
 * Base argv per ReAct phase (profile-only config plus explicit overrides).
 * Callers append --insert-files / Observe temp paths after this.
 */
export const buildPhaseArgv = (
  phase: ReactPhase,
  config: ResolvedReactConfig,
  options?: BuildPhaseArgvOptions
): string[] => {
  const directory = options?.directoryOverride ?? config.directoryAbs;
  const argv: string[] = ['-d', directory];
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

  if (config.continueMode && (phase === 'thought' || phase === 'final')) {
    argv.push('-c');
  }

  return argv;
};
