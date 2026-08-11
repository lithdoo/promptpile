import { DEFAULT_TEMPERATURE } from './llm-sampling';
import { Config } from './types';

/**
 * @deprecated Prefer {@link resolveConfig} in resolve-config.ts; kept for callers that merge manually.
 */
export const loadConfig = (options: Partial<Config>): Config => {
  const selectedInputs = options.conversationIo?.inputDirectories
    ?? options.inputDirectories
    ?? [options.conversationIo?.anchorDirectory ?? options.directory ?? './messages'];
  const outputDirectory = options.conversationIo?.outputDirectory ?? options.outputDirectory;
  const inputDirectories = outputDirectory === undefined
    ? selectedInputs
    : [
        ...selectedInputs.filter(directory => directory !== outputDirectory),
        outputDirectory
      ];
  const anchorDirectory = options.conversationIo?.anchorDirectory
    ?? inputDirectories[inputDirectories.length - 1]
    ?? './messages';
  return {
    conversationIo: {
      inputDirectories,
      outputDirectory,
      anchorDirectory
    },
    // Compatibility aliases for callers consuming the pre-layered Config shape.
    inputDirectories,
    directory: anchorDirectory,
    outputDirectory,
    model: options.model ?? 'gpt-3.5-turbo',
    apiKey: options.apiKey ?? '',
    apiBaseUrl: options.apiBaseUrl ?? 'https://api.openai.com/v1',
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
    extraBody: options.extraBody,
    continueMode: options.continueMode ?? false,
    inputMode: options.inputMode ?? false,
    expectedOutputFingerprint: options.expectedOutputFingerprint,
    expectedOutputNextIndex: options.expectedOutputNextIndex,
    output: options.output,
    outputPileFile: options.outputPileFile,
    outputPileFd: options.outputPileFd,
    outputPileTarget: options.outputPileTarget ?? (
      options.outputPileFd !== undefined
        ? { kind: 'fd', fd: options.outputPileFd, source: 'cli', shadowedFile: options.outputPileFile }
        : options.outputPileFile !== undefined
          ? { kind: 'file', path: options.outputPileFile, source: 'cli' }
          : undefined
    ),
    outputPileFormat: options.outputPileFormat,
    quiet: options.quiet ?? false,
    toolsFileCli: options.toolsFileCli,
    toolsFileConfig: options.toolsFileConfig,
    insertFilesCli: options.insertFilesCli,
    appendFilesCli: options.appendFilesCli,
    afterHookCli: options.afterHookCli,
    afterHookConfig: options.afterHookConfig,
    afterHookFailure: options.afterHookFailure ?? 'warn',
    allowDefaultAfterHook: options.allowDefaultAfterHook ?? false,
    toolChoice: options.toolChoice,
    missingToolResults: options.missingToolResults ?? 'warn',
    disableTool: options.disableTool ?? false
  };
};
