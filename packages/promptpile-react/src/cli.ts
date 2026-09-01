import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import type { MaxStepPolicy, ReactCliOverrides, ReactOutputFormat } from './types';

const packageVersion = (): string => {
  const metadataPath = path.resolve(__dirname, '..', 'package.json');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as { version?: unknown };
  if (typeof metadata.version !== 'string' || metadata.version.trim() === '') {
    throw new Error(`Invalid package version metadata: ${metadataPath}`);
  }
  return metadata.version;
};

const trimmed = (v: unknown): string | undefined => {
  if (typeof v !== 'string') {
    return undefined;
  }
  const s = v.trim();
  return s === '' ? undefined : s;
};

const parseMaxStepCli = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const s = String(raw).trim();
  if (s === '') {
    return undefined;
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) {
    console.error('Error: --max-step must be a positive integer');
    process.exit(1);
  }
  return n;
};

const parseObserveCarryoverCli = (raw: unknown): number | undefined => {
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === '') return undefined;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) {
    console.error('Error: --observe-carryover must be a non-negative integer');
    process.exit(1);
  }
  return n;
};

const collectDirectory = (value: string, previous: string[]): string[] => [
  ...previous,
  value
];

const parseOutputFormat = (value: string): ReactOutputFormat => {
  if (value === 'terminal' || value === 'stream-json') return value;
  throw new Error('--output-format must be terminal or stream-json');
};

const parseMaxStepPolicy = (value: string): MaxStepPolicy => {
  if (value === 'final' || value === 'error') return value;
  throw new Error('--max-step-policy must be final or error');
};

const buildProgram = (): Command => {
  const program = new Command();
  program
    .name('promptpile-react')
    .description('Agent loop around the `promptpile` CLI (React-style orchestration; subprocess only)')
    .version(packageVersion())
    .option('--config <path>', 'TOML config (relative to cwd); reads [promptpile-react] and shared keys')
    .option(
      '-d, --directory <path>',
      'Conversation input directory; repeat to add ordered layers',
      collectDirectory,
      []
    )
    .option('--output-dir <path>', 'Unique writable Conversation directory')
    .option('--work-root <path>', 'Parent directory for session-owned internal Conversation state')
    .option('-m, --model <model>', 'Model ID (overrides all phases when set)')
    .option('-k, --api-key <key>', 'API key (overrides all phases when set)')
    .option('-b, --api-base-url <url>', 'API base URL (overrides all phases when set)')
    .option(
      '--temperature <n>',
      'Sampling temperature 0–2 (overrides all phases when set; default 0.8 if unset)'
    )
    .option(
      '--extra-body <json>',
      'Extra JSON object merged into request body (overrides all phases when set)'
    )
    .option('-q, --quiet', 'Quiet: less stdout from `promptpile` subprocesses')
    .option('-i, --input', 'Terminal user message → next user file (this package; not sent as `promptpile -i`)')
    .option('-c, --continue', 'Persist Final to the user Conversation; Thought always persists only to session work')
    .option(
      '--tools-file <path>',
      'Tools .toml path (CLI relative cwd; overrides TOML path relative to scan directory)'
    )
    .option(
      '--after-hook-path <path>',
      'After-success hook for Thought phase only (CLI relative cwd)'
    )
    .option('--max-step <n>', 'Max successful ReAct iterations (this package only)')
    .option(
      '--max-step-policy <policy>',
      'On max_step: run Final or fail (final | error)',
      parseMaxStepPolicy
    )
    .option('--observe-carryover <n>', 'Recent Observe turns retained in the active work Conversation')
    .option(
      '--output-format <format>',
      'Output format: terminal | stream-json',
      parseOutputFormat,
      'terminal'
    );
  return program;
};

const userArgvFromProcess = (argv: string[]): string[] => {
  if (argv.length >= 2 && !argv[0].startsWith('-')) {
    return argv.slice(2);
  }
  return argv;
};

/** Parse argv without requiring non-empty (used by tests and resolveReactConfig). */
export const parseReactCli = (argv: string[]): ReactCliOverrides => {
  const program = buildProgram();
  program.parse(userArgvFromProcess(argv), { from: 'user' });
  const o = program.opts() as {
    config?: string;
    directory?: string[];
    outputDir?: string;
    workRoot?: string;
    model?: string;
    apiKey?: string;
    apiBaseUrl?: string;
    quiet?: boolean;
    toolsFile?: string;
    afterHookPath?: string;
    input?: boolean;
    continue?: boolean;
    maxStep?: string;
    maxStepPolicy?: MaxStepPolicy;
    observeCarryover?: string;
    temperature?: string;
    extraBody?: string;
    outputFormat?: ReactOutputFormat;
  };

  const inputDirectories = o.directory?.map((value, index) => {
    const directory = value.trim();
    if (directory === '') {
      throw new Error(`--directory value at position ${index + 1} must not be empty`);
    }
    return directory;
  });
  const outputDirectory = trimmed(o.outputDir);
  if (o.outputDir !== undefined && outputDirectory === undefined) {
    throw new Error('--output-dir value must not be empty');
  }
  const workRoot = trimmed(o.workRoot);
  if (o.workRoot !== undefined && workRoot === undefined) {
    throw new Error('--work-root value must not be empty');
  }

  return {
    configPath: trimmed(o.config),
    inputDirectories:
      inputDirectories !== undefined && inputDirectories.length > 0
        ? inputDirectories
        : undefined,
    outputDirectory,
    workRoot,
    model: trimmed(o.model),
    apiKey: trimmed(o.apiKey),
    apiBaseUrl: trimmed(o.apiBaseUrl),
    quiet: o.quiet === true ? true : undefined,
    toolsFile: trimmed(o.toolsFile),
    afterHookPath: trimmed(o.afterHookPath),
    inputMode: o.input === true ? true : undefined,
    continueMode: o.continue === true ? true : undefined,
    maxStep: parseMaxStepCli(o.maxStep),
    maxStepPolicy: o.maxStepPolicy,
    observeCarryover: parseObserveCarryoverCli(o.observeCarryover),
    temperature: trimmed(o.temperature),
    extraBody: trimmed(o.extraBody),
    outputFormat: o.outputFormat ?? 'terminal'
  };
};

export function parseCli(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    buildProgram().help({ error: true });
  }
  parseReactCli(process.argv);
}
