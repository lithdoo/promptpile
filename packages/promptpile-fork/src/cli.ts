import { ForkError, asForkError } from './errors';
import { executeConversationFork, type ForkOptions } from './operation';
import type { ForkReport } from './types';

type Format = 'text' | 'json';
interface CliOptions extends ForkOptions { format: Format; }

const usage = `Usage: promptpile-fork --source <dir> --target <dir> --through-index <n> [--dry-run] [--format text|json]\n\n` +
  `Create a byte-exact physical Conversation prefix snapshot.\n\n` +
  `Options:\n` +
  `  --source <dir>        Source physical Conversation directory\n` +
  `  --target <dir>        New target directory (must not exist)\n` +
  `  --through-index <n>   Inclusive Conversation index cutoff\n` +
  `  --dry-run             Validate and report without filesystem mutation\n` +
  `  --format text|json    Output format (default: text)\n` +
  `  --help                Show this help\n`;

const valueAfter = (argv: readonly string[], index: number, flag: string): string => {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new ForkError('invalid_arguments', `${flag} requires a value`);
  return value;
};

export function parseCli(argv: readonly string[]): CliOptions | { help: true } {
  let source: string | undefined;
  let target: string | undefined;
  let throughIndex: number | undefined;
  let dryRun = false;
  let format: Format = 'text';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help') return { help: true };
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--source') { if (source !== undefined) throw new ForkError('invalid_arguments', '--source may be supplied only once'); source = valueAfter(argv, index++, arg); continue; }
    if (arg === '--target') { if (target !== undefined) throw new ForkError('invalid_arguments', '--target may be supplied only once'); target = valueAfter(argv, index++, arg); continue; }
    if (arg === '--through-index') {
      if (throughIndex !== undefined) throw new ForkError('invalid_arguments', '--through-index may be supplied only once');
      const raw = valueAfter(argv, index++, arg);
      if (!/^\d+$/.test(raw)) throw new ForkError('invalid_arguments', '--through-index must be a non-negative safe integer');
      throughIndex = Number(raw);
      if (!Number.isSafeInteger(throughIndex)) throw new ForkError('invalid_arguments', '--through-index must be a non-negative safe integer');
      continue;
    }
    if (arg === '--format') {
      const raw = valueAfter(argv, index++, arg);
      if (raw !== 'text' && raw !== 'json') throw new ForkError('invalid_arguments', '--format must be text or json');
      format = raw;
      continue;
    }
    throw new ForkError('invalid_arguments', `unknown argument: ${arg}`);
  }
  if (source === undefined || target === undefined || throughIndex === undefined) {
    throw new ForkError('invalid_arguments', '--source, --target, and --through-index are required');
  }
  return { source, target, throughIndex, dryRun, format };
}

const formatText = (report: ForkReport): string => [
  `status: ${report.status}`,
  `target: ${report.target}`,
  `through index: ${report.throughIndex}`,
  `artifact count: ${report.artifactCount}`,
  `selected prefix fingerprint: ${report.sourcePrefixFingerprint}`,
  ''
].join('\n');

export async function runCli(
  argv: readonly string[],
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream } = process
): Promise<number> {
  let requestedFormat: Format = 'text';
  try {
    const parsed = parseCli(argv);
    if ('help' in parsed) { io.stdout.write(usage); return 0; }
    requestedFormat = parsed.format;
    const report = await executeConversationFork(parsed, {
      onWarning: message => io.stderr.write(`promptpile-fork: warning: ${message}\n`)
    });
    io.stdout.write(parsed.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatText(report));
    return 0;
  } catch (unknownError) {
    const error = asForkError(unknownError);
    if (requestedFormat === 'json' || argv.some((value, index) => value === '--format' && argv[index + 1] === 'json')) {
      io.stdout.write(`${JSON.stringify({ schemaVersion: 1, operation: 'conversation_fork', status: 'failed', code: error.code, message: error.message }, null, 2)}\n`);
    } else {
      io.stderr.write(`promptpile-fork: ${error.code}: ${error.message}\n`);
    }
    return 1;
  }
}
