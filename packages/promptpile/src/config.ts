import { DEFAULT_TEMPERATURE } from './llm-sampling';
import { Config } from './types';

/**
 * @deprecated Prefer {@link resolveConfig} in resolve-config.ts; kept for callers that merge manually.
 */
export const loadConfig = (options: Partial<Config>): Config => {
  const selectedInputs = options.inputDirectories ?? [options.directory ?? './messages'];
  const inputDirectories = options.outputDirectory === undefined
    ? selectedInputs
    : [
        ...selectedInputs.filter(directory => directory !== options.outputDirectory),
        options.outputDirectory
      ];
  const directory = inputDirectories[inputDirectories.length - 1] ?? './messages';
  return {
    inputDirectories,
    directory,
    outputDirectory: options.outputDirectory,
    model: options.model ?? 'gpt-3.5-turbo',
    apiKey: options.apiKey ?? '',
    apiBaseUrl: options.apiBaseUrl ?? 'https://api.openai.com/v1',
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    extraBody: options.extraBody,
    continueMode: options.continueMode ?? false,
    inputMode: options.inputMode ?? false,
    output: options.output,
    outputPileFile: options.outputPileFile,
    outputPileFd: options.outputPileFd,
    outputPileFormat: options.outputPileFormat,
    quiet: options.quiet ?? false,
    toolsFileCli: options.toolsFileCli,
    toolsFileConfig: options.toolsFileConfig,
    insertFilesCli: options.insertFilesCli,
    appendFilesCli: options.appendFilesCli,
    afterHookCli: options.afterHookCli,
    afterHookConfig: options.afterHookConfig,
    allowDefaultAfterHook: options.allowDefaultAfterHook ?? false,
    toolChoice: options.toolChoice,
    missingToolResults: options.missingToolResults ?? 'warn',
    disableTool: options.disableTool ?? false
  };
};
