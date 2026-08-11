import { Command } from 'commander';
import { parseExtraBodyInput } from './llm-extra-body';
import { parseTemperatureInput } from './llm-sampling';
import { parseOutputPileFd, parseOutputPileFormat } from './output-pile';
import { Config } from './types';
import { parseMissingToolResultsPolicy } from './tool-result-policy';
import { parseConversationFingerprintTokenV1 } from './conversation-fingerprint';
import { parseExpectedConversationIndex } from './conversation-index';
import {
  registerConversationCommand,
  type AppendUserOptions,
  type FingerprintConversationOptions,
  type InspectConversationOptions
} from './conversation-command';
import { parseAfterHookFailureMode } from './after-hook-policy';
import { parseInvocationId } from './invocation-context';

/** Result of {@link parseCli}; `configPath` is raw path from argv (resolve against cwd in resolve-config). */
export interface CliParseResult {
  /** Raw path from argv; resolve against cwd where used. */
  configPath?: string;
  /** Raw profile-database path from argv; resolve against cwd where used. */
  llmConfigPath?: string;
  /** Explicitly selected LLM profile name. */
  llmApiName?: string;
  /** Explicit environment-variable name used as the API key source. */
  apiKeyEnvName?: string;
  options: Partial<Config>;
}

export interface PromptpileCommandHandlers {
  completion: () => void | Promise<void>;
  appendUser: (options: AppendUserOptions) => void | Promise<void>;
  inspectConversation: (options: InspectConversationOptions) => void | Promise<void>;
  fingerprintConversation: (
    options: FingerprintConversationOptions
  ) => void | Promise<void>;
}

export const buildProgram = (handlers?: PromptpileCommandHandlers): Command => {
  const program = new Command();
  const collectDirectory = (value: string, previous: string[]): string[] => [
    ...previous,
    value
  ];
  program
    .name('promptpile')
    .description('Assemble message files and call Chat Completions APIs')
    .version('1.0.0')
    .enablePositionalOptions()
    .option('--config <path>', 'TOML config file path (relative to cwd)')
    .option('--llm-config <path>', 'TOML file used only as the [[llm_api]] profile database')
    .option('--llm-api <name>', 'Select a named [[llm_api]] profile')
    .option(
      '-d, --directory <path>',
      'Conversation input directory; repeat to add ordered layers',
      collectDirectory,
      []
    )
    .option('--output-dir <path>', 'Unique writable Conversation directory')
    .option('-m, --model <model>', 'AI model to use')
    .option('-k, --api-key <key>', 'AI API key')
    .option('--api-key-env <name>', 'Read the AI API key from this environment variable')
    .option('-b, --api-base-url <url>', 'AI API base URL')
    .option(
      '--invocation-id <id>',
      'External completion correlation ID (1-128 restricted ASCII characters)',
      parseInvocationId
    )
    .option(
      '--temperature <n>',
      'Sampling temperature (0–2); overrides llm_api_temperature / [[llm_api]] profile (default 0.8 if unset)'
    )
    .option(
      '--extra-body <json>',
      'Extra JSON object merged into Chat Completions request body; overrides llm_api_extra_body / [[llm_api]] profile'
    )
    .option('-o, --output <path>', 'Output file path for AI response')
    .option('--receipt <path>', 'Atomically write Completion Receipt v1 after success')
    .option('--output-pile-file <path>', 'Write streamed assistant output to this file/pipe path')
    .option('--output-pile-fd <fd>', 'Write streamed assistant output to an inherited file descriptor')
    .option('--output-pile-format <format>', 'Output pile format: text | json (default: text)')
    .option('--output-pipe <path>', 'Deprecated alias of --output-pile-file')
    .option('--output-pipe-format <format>', 'Deprecated alias of --output-pile-format')
    .option('-q, --quiet', 'Disable normal stdout logs and response output')
    .option('-i, --input', 'Read user input from terminal and append as next user message')
    .option('-c, --continue', 'Append assistant reply to next message file')
    .option(
      '--expect-output-fingerprint <token>',
      'Require the current writable output Conversation Fingerprint v1 token',
      parseConversationFingerprintTokenV1
    )
    .option(
      '--expected-output-next-index <idx>',
      'Require the next writable output Conversation mutation index',
      parseExpectedConversationIndex
    )
    .option(
      '--insert-files <paths>',
      'Prepend messages from sidecar files before scanned messages; paths separated by |; each file must be {name}.{role}.md (relative to cwd)'
    )
    .option(
      '--append-files <paths>',
      'Append messages from sidecar files after scanned messages; paths separated by |; each file must be {name}.{role}.md (relative to cwd)'
    )
    .option(
      '--tools-file <path>',
      'Load tools from this .toml file only (supports extends; relative paths resolve from cwd). Required unless --disable-tool.'
    )
    .option(
      '--after-hook-path <path>',
      'Run this script file after success (relative paths resolve from cwd)'
    )
    .option(
      '--allow-default-after-hook',
      'Allow discovery of a default .after-hook script at the conversation anchor'
    )
    .option(
      '--after-hook-failure <mode>',
      'After-hook failure policy: warn | error (default: warn)',
      parseAfterHookFailureMode
    )
    .option(
      '--tool-choice <value>',
      'OpenAI tool_choice when tools are sent: none | auto | required | function:<name> (default: auto if unset)'
    )
    .option(
      '--disable-tool',
      'Do not load or send tools: skip --tools-file'
    )
    .option(
      '--missing-tool-results <policy>',
      'Handle missing tool results: warn | error | ignore (default: warn)'
    );

  program.hook('preAction', (_thisCommand, actionCommand) => {
    if (actionCommand === program) return;
    if (program.getOptionValue('invocationId') !== undefined) {
      throw new Error('--invocation-id is only valid for root completion');
    }
    if (program.getOptionValue('receipt') !== undefined) {
      throw new Error('--receipt is only valid for root completion');
    }
  });

  registerConversationCommand(program, {
    appendUser: handlers?.appendUser,
    inspectConversation: handlers?.inspectConversation,
    fingerprintConversation: handlers?.fingerprintConversation
  });
  // Keep the root command as the backwards-compatible default completion path.
  // parseCli builds the same tree without executing completion side effects.
  program.action(handlers?.completion ?? (() => undefined));
  return program;
};

/** Parse and dispatch the public CLI command tree. */
export const runCli = async (
  argv: string[],
  handlers: PromptpileCommandHandlers
): Promise<void> => {
  await buildProgram(handlers).parseAsync(argv, { from: 'node' });
};

export const parseCli = (argv: string[]): CliParseResult => {
  const program = buildProgram();
  program.parse(argv, { from: 'node' });
  const options = program.opts() as {
    config?: string;
    llmConfig?: string;
    llmApi?: string;
    directory?: string[];
    outputDir?: string;
    model?: string;
    apiKey?: string;
    apiKeyEnv?: string;
    apiBaseUrl?: string;
    invocationId?: string;
    output?: string;
    receipt?: string;
    outputPileFile?: string;
    outputPileFd?: string;
    outputPileFormat?: string;
    outputPipe?: string;
    outputPipeFormat?: string;
    quiet?: boolean;
    continue?: boolean;
    input?: boolean;
    expectOutputFingerprint?: string;
    expectedOutputNextIndex?: number;
    toolsFile?: string;
    afterHookPath?: string;
    afterHookFailure?: string;
    allowDefaultAfterHook?: boolean;
    toolChoice?: string;
    insertFiles?: string;
    appendFiles?: string;
    temperature?: string;
    extraBody?: string;
    disableTool?: boolean;
    missingToolResults?: string;
  };

  const trimOpt = (value: string | undefined): string | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  };
  const outputPileFile = trimOpt(options.outputPileFile) ?? trimOpt(options.outputPipe);
  const outputPileFd = parseOutputPileFd(options.outputPileFd);
  const outputPileFormat = parseOutputPileFormat(
    options.outputPileFormat ?? options.outputPipeFormat
  );

  const configPath = trimOpt(options.config);
  const llmConfigPath = trimOpt(options.llmConfig);
  const llmApiName = trimOpt(options.llmApi);
  const apiKeyEnvName = trimOpt(options.apiKeyEnv);
  const rawReceipt = options.receipt;
  const receipt = trimOpt(rawReceipt);
  if (rawReceipt !== undefined && receipt === undefined) {
    throw new Error('--receipt value must not be empty');
  }

  const rawToolsFile = options.toolsFile as string | undefined;
  const toolsFileCli =
    typeof rawToolsFile === 'string' && rawToolsFile.trim() !== ''
      ? rawToolsFile.trim()
      : undefined;
  const rawHook = options.afterHookPath as string | undefined;
  const afterHookCli =
    typeof rawHook === 'string' && rawHook.trim() !== '' ? rawHook.trim() : undefined;
  const rawToolChoice = options.toolChoice as string | undefined;
  const toolChoiceCli =
    typeof rawToolChoice === 'string' && rawToolChoice.trim() !== ''
      ? rawToolChoice.trim()
      : undefined;
  const rawInsertFiles = options.insertFiles as string | undefined;
  const insertFilesCli =
    typeof rawInsertFiles === 'string' && rawInsertFiles.trim() !== ''
      ? rawInsertFiles.trim()
      : undefined;
  const rawAppendFiles = options.appendFiles as string | undefined;
  const appendFilesCli =
    typeof rawAppendFiles === 'string' && rawAppendFiles.trim() !== ''
      ? rawAppendFiles.trim()
      : undefined;
  const rawTemperature = options.temperature as string | undefined;
  let temperature: number | undefined;
  if (typeof rawTemperature === 'string' && rawTemperature.trim() !== '') {
    temperature = parseTemperatureInput(rawTemperature.trim());
  }
  const rawExtraBody = options.extraBody as string | undefined;
  let extraBody: Record<string, unknown> | undefined;
  if (typeof rawExtraBody === 'string' && rawExtraBody.trim() !== '') {
    extraBody = parseExtraBodyInput(rawExtraBody.trim());
  }
  const missingToolResults = parseMissingToolResultsPolicy(options.missingToolResults);

  const inputDirectories = options.directory?.map((value, index) => {
    const directory = value.trim();
    if (directory === '') {
      throw new Error(`--directory value at position ${index + 1} must not be empty`);
    }
    return directory;
  });
  const rawOutputDirectory = options.outputDir;
  const outputDirectory = trimOpt(rawOutputDirectory);
  if (rawOutputDirectory !== undefined && outputDirectory === undefined) {
    throw new Error('--output-dir value must not be empty');
  }

  return {
    configPath,
    llmConfigPath,
    llmApiName,
    apiKeyEnvName,
    options: {
      inputDirectories:
        inputDirectories && inputDirectories.length > 0 ? inputDirectories : undefined,
      outputDirectory,
      model: options.model,
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl,
      invocationId: options.invocationId,
      output: options.output,
      receipt,
      outputPileFile,
      outputPileFd,
      outputPileFormat,
      quiet: options.quiet as boolean | undefined,
      continueMode: options.continue === true ? true : undefined,
      inputMode: options.input === true ? true : undefined,
      expectedOutputFingerprint: options.expectOutputFingerprint,
      expectedOutputNextIndex: options.expectedOutputNextIndex,
      toolsFileCli,
      insertFilesCli,
      appendFilesCli,
      afterHookCli,
      afterHookFailure: parseAfterHookFailureMode(options.afterHookFailure),
      allowDefaultAfterHook:
        options.allowDefaultAfterHook === true ? true : undefined,
      toolChoice: toolChoiceCli,
      temperature,
      extraBody,
      missingToolResults,
      disableTool: options.disableTool === true ? true : undefined
    }
  };
};
