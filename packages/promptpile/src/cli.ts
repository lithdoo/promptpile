import { Command } from 'commander';
import { parseExtraBodyInput } from './llm-extra-body';
import { parseTemperatureInput } from './llm-sampling';
import { parseOutputPileFd, parseOutputPileFormat } from './output-pile';
import { Config } from './types';
import { parseMissingToolResultsPolicy } from './tool-result-policy';

/** Result of {@link parseCli}; `configPath` is raw path from argv (resolve against cwd in resolve-config). */
export interface CliParseResult {
  /** Raw path from argv; resolve against cwd where used. */
  configPath?: string;
  options: Partial<Config>;
}

const buildProgram = (): Command => {
  const program = new Command();
  program
    .name('promptpile')
    .description('Assemble message files and call Chat Completions APIs')
    .version('1.0.0')
    .option('--config <path>', 'TOML config file path (relative to cwd)')
    .option('-d, --directory <path>', 'Directory to scan for files')
    .option('-m, --model <model>', 'AI model to use')
    .option('-k, --api-key <key>', 'AI API key')
    .option('-b, --api-base-url <url>', 'AI API base URL')
    .option(
      '--temperature <n>',
      'Sampling temperature (0–2); overrides llm_api_temperature / [[llm_api]] profile (default 0.8 if unset)'
    )
    .option(
      '--extra-body <json>',
      'Extra JSON object merged into Chat Completions request body; overrides llm_api_extra_body / [[llm_api]] profile'
    )
    .option('-o, --output <path>', 'Output file path for AI response')
    .option('--output-pile-file <path>', 'Write streamed assistant output to this file/pipe path')
    .option('--output-pile-fd <fd>', 'Write streamed assistant output to an inherited file descriptor')
    .option('--output-pile-format <format>', 'Output pile format: text | json (default: text)')
    .option('--output-pipe <path>', 'Deprecated alias of --output-pile-file')
    .option('--output-pipe-format <format>', 'Deprecated alias of --output-pile-format')
    .option('-q, --quiet', 'Disable normal stdout logs and response output')
    .option('-i, --input', 'Read user input from terminal and append as next user message')
    .option('-c, --continue', 'Append assistant reply to next message file')
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
      'Allow discovery of a default .after-hook script in the scan directory'
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
    )
  return program;
};

export const parseCli = (argv: string[]): CliParseResult => {
  const program = buildProgram();
  program.parse(argv, { from: 'node' });
  const options = program.opts() as {
    config?: string;
    directory?: string;
    model?: string;
    apiKey?: string;
    apiBaseUrl?: string;
    output?: string;
    outputPileFile?: string;
    outputPileFd?: string;
    outputPileFormat?: string;
    outputPipe?: string;
    outputPipeFormat?: string;
    quiet?: boolean;
    continue?: boolean;
    input?: boolean;
    toolsFile?: string;
    afterHookPath?: string;
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

  const rawConfig = options.config as string | undefined;
  let configPath: string | undefined;
  if (typeof rawConfig === 'string' && rawConfig.trim() !== '') {
    configPath = rawConfig.trim();
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

  return {
    configPath,
    options: {
      directory: options.directory,
      model: options.model,
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl,
      output: options.output,
      outputPileFile,
      outputPileFd,
      outputPileFormat,
      quiet: options.quiet as boolean | undefined,
      continueMode: options.continue === true ? true : undefined,
      inputMode: options.input === true ? true : undefined,
      toolsFileCli,
      insertFilesCli,
      appendFilesCli,
      afterHookCli,
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
