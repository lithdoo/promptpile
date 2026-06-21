import { Command } from 'commander';
import { parseExtraBodyInput } from 'promptpile/dist/llm-extra-body';
import { parseTemperatureInput } from 'promptpile/dist/llm-sampling';
import type { ReactCliOverrides } from './types';

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

const buildProgram = (): Command => {
  const program = new Command();
  program
    .name('promptpile-react')
    .description('Agent loop around the `promptpile` CLI (React-style orchestration; subprocess only)')
    .version('1.0.0')
    .option('--config <path>', 'TOML config (relative to cwd); reads [promptpile-react] and shared keys')
    .option('-d, --directory <path>', 'Directory to scan for message files')
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
    .option('-c, --continue', 'Append assistant reply to message files (subprocesses append `-c` when set)')
    .option(
      '--tools-file <path>',
      'Tools .toml path (CLI relative cwd; overrides TOML path relative to scan directory)'
    )
    .option(
      '--after-hook-path <path>',
      'After-success hook for Thought phase only (CLI relative cwd)'
    )
    .option('--max-step <n>', 'Max successful ReAct iterations (this package only)');
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
    directory?: string;
    model?: string;
    apiKey?: string;
    apiBaseUrl?: string;
    quiet?: boolean;
    toolsFile?: string;
    afterHookPath?: string;
    input?: boolean;
    continue?: boolean;
    maxStep?: string;
    temperature?: string;
    extraBody?: string;
  };

  let temperature: number | undefined;
  const rawTemperature = o.temperature;
  if (typeof rawTemperature === 'string' && rawTemperature.trim() !== '') {
    temperature = parseTemperatureInput(rawTemperature.trim());
  }

  let extraBody: Record<string, unknown> | undefined;
  const rawExtraBody = o.extraBody;
  if (typeof rawExtraBody === 'string' && rawExtraBody.trim() !== '') {
    extraBody = parseExtraBodyInput(rawExtraBody.trim());
  }

  return {
    configPath: trimmed(o.config),
    directory: trimmed(o.directory),
    model: trimmed(o.model),
    apiKey: trimmed(o.apiKey),
    apiBaseUrl: trimmed(o.apiBaseUrl),
    quiet: o.quiet === true ? true : undefined,
    toolsFile: trimmed(o.toolsFile),
    afterHookPath: trimmed(o.afterHookPath),
    inputMode: o.input === true ? true : undefined,
    continueMode: o.continue === true ? true : undefined,
    maxStep: parseMaxStepCli(o.maxStep),
    temperature,
    extraBody
  };
};

export function parseCli(): void {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    buildProgram().help({ error: true });
  }
  parseReactCli(process.argv);
}
