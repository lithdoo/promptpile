import { CHECK_DECISION_TOOL_NAME } from './check-decision-tool';
import type { ReactPhase, ResolvedReactConfig } from './types';

const appendLlm = (
  argv: string[],
  llm: {
    model: string;
    apiKey: string;
    apiBaseUrl: string;
    temperature: number;
    extraBody?: Record<string, unknown>;
  }
): void => {
  argv.push('-m', llm.model);
  if (llm.apiKey !== '') {
    argv.push('-k', llm.apiKey);
  }
  argv.push('-b', llm.apiBaseUrl);
  argv.push('--temperature', String(llm.temperature));
  if (llm.extraBody !== undefined) {
    argv.push('--extra-body', JSON.stringify(llm.extraBody));
  }
};

export interface BuildPhaseArgvOptions {
  /** 覆盖 `-d` 扫描目录（check 阶段使用空临时目录）。 */
  directoryOverride?: string;
}

/**
 * Base argv per ReAct phase (no --config, no temp inject/tools/output).
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
  appendLlm(argv, llm);

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
