import { parseArgs } from 'node:util';
import {
  ArchiveDomainError,
  archiveExitCode,
  archiveJsonFailure,
  archiveJsonSuccess,
  discoverArchives,
  readArchivedTurn,
  resolveReadToolResults,
  resolveSearchToolResults,
  searchArchive,
  type ArchivedTurn,
  type ArchiveDescriptor,
  type ArchiveSearchResponse,
} from './index';

export interface ArchiveCliIo {
  stdout: { write(content: string): unknown };
  stderr: { write(content: string): unknown };
}

type ArchiveCommand = 'list' | 'search' | 'read' | 'mcp';

interface ParsedArchiveCli {
  command: ArchiveCommand;
  directory: string;
  json: boolean;
  query?: string;
  turnIdx?: number;
  limit?: number;
  roles: string[];
  includeToolResults: boolean;
  caseSensitive: boolean;
}

const HELP = `Usage:
  promptpile-archive list -d <directory> [--json]
  promptpile-archive search -d <directory> <query> [options]
  promptpile-archive read -d <directory> <turnIdx> [options]
  promptpile-archive mcp -d <directory>

Options:
  -d, --directory <dir>     Conversation directory
  --limit <n>               Maximum returned turns (search; default 20)
  --role <role>             Case-sensitive role filter; repeatable (search)
  --include-tool-results    Include assistant result artifacts
  --no-tool-results         Exclude assistant result artifacts
  --case-sensitive          Use case-sensitive literal matching (search)
  --json                    Emit the stable machine JSON envelope
  -h, --help                Show help
`;

const invalidQuery = (message: string, cause?: unknown): ArchiveDomainError =>
  new ArchiveDomainError('INVALID_QUERY', message, { cause });

const ensureOnly = (
  command: ArchiveCommand,
  values: Record<string, unknown>,
  allowed: string[]
): void => {
  const allowedSet = new Set([...allowed, 'directory', 'json', 'help']);
  const unsupported = Object.entries(values)
    .filter(([name, value]) => value !== undefined && !allowedSet.has(name))
    .map(([name]) => `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`);
  if (unsupported.length > 0) {
    throw invalidQuery(
      `${command} does not support option${unsupported.length === 1 ? '' : 's'}: ${unsupported.join(', ')}`
    );
  }
};

const parseTurnIdx = (raw: string): number => {
  if (!/^\d+$/.test(raw)) {
    throw invalidQuery(`turnIdx must be a non-negative integer: ${raw}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw invalidQuery(`turnIdx must be a safe non-negative integer: ${raw}`);
  }
  return value;
};

const parseLimit = (raw: string | undefined): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw invalidQuery(`limit must be an integer from 1 to 100: ${raw}`);
  }
  return value;
};

const parseArchiveCli = (argv: string[]): ParsedArchiveCli | null => {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        directory: { type: 'string', short: 'd' },
        limit: { type: 'string' },
        role: { type: 'string', multiple: true },
        'include-tool-results': { type: 'boolean' },
        'no-tool-results': { type: 'boolean' },
        'case-sensitive': { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    throw invalidQuery(
      error instanceof Error ? error.message : 'invalid CLI arguments',
      error
    );
  }

  if (parsed.values.help) return null;
  const [rawCommand, ...positionals] = parsed.positionals;
  if (
    rawCommand !== 'list' &&
    rawCommand !== 'search' &&
    rawCommand !== 'read' &&
    rawCommand !== 'mcp'
  ) {
    throw invalidQuery(
      rawCommand
        ? `unknown command: ${rawCommand}`
        : 'command is required: list, search, read, or mcp'
    );
  }
  const command = rawCommand;
  const directory = parsed.values.directory?.trim();
  if (!directory) throw invalidQuery('--directory is required');

  const values = {
    directory: parsed.values.directory,
    limit: parsed.values.limit,
    role: parsed.values.role,
    includeToolResults: parsed.values['include-tool-results'],
    noToolResults: parsed.values['no-tool-results'],
    caseSensitive: parsed.values['case-sensitive'],
    json: parsed.values.json,
    help: parsed.values.help,
  };
  const toolFlags = {
    includeToolResults: parsed.values['include-tool-results'],
    noToolResults: parsed.values['no-tool-results'],
  };

  if (command === 'mcp') {
    ensureOnly(command, values, []);
    if (parsed.values.json) {
      throw invalidQuery('mcp does not support --json because stdout is reserved for MCP');
    }
    if (positionals.length !== 0) {
      throw invalidQuery('mcp does not accept positional arguments');
    }
    return {
      command,
      directory,
      json: false,
      roles: [],
      includeToolResults: false,
      caseSensitive: false,
    };
  }

  if (command === 'list') {
    ensureOnly(command, values, []);
    if (positionals.length !== 0) {
      throw invalidQuery('list does not accept positional arguments');
    }
    return {
      command,
      directory,
      json: parsed.values.json === true,
      roles: [],
      includeToolResults: false,
      caseSensitive: false,
    };
  }

  if (command === 'search') {
    ensureOnly(command, values, [
      'limit',
      'role',
      'includeToolResults',
      'noToolResults',
      'caseSensitive',
    ]);
    if (positionals.length !== 1) {
      throw invalidQuery('search requires exactly one query argument');
    }
    return {
      command,
      directory,
      json: parsed.values.json === true,
      query: positionals[0],
      limit: parseLimit(parsed.values.limit),
      roles: parsed.values.role ?? [],
      includeToolResults: resolveSearchToolResults(toolFlags),
      caseSensitive: parsed.values['case-sensitive'] === true,
    };
  }

  ensureOnly(command, values, [
    'includeToolResults',
    'noToolResults',
  ]);
  if (positionals.length !== 1) {
    throw invalidQuery('read requires exactly one turnIdx argument');
  }
  return {
    command,
    directory,
    json: parsed.values.json === true,
    turnIdx: parseTurnIdx(positionals[0]),
    roles: [],
    includeToolResults: resolveReadToolResults(toolFlags),
    caseSensitive: false,
  };
};

const formatList = (archives: ArchiveDescriptor[]): string =>
  archives
    .map(
      (archive) =>
        `Archive ${archive.idx}  ${archive.name}\n  Turns: ${archive.archivedTurnIndices.join(', ')}`
    )
    .join('\n\n');

const formatSearch = (response: ArchiveSearchResponse): string => {
  if (response.results.length === 0) return 'No archived turns matched.';
  const output = response.results.map((result) => {
    const matches = result.matches
      .map(
        (match) =>
          `  [${match.role}/${match.fileKind}] ${match.sourceFile}${match.line === undefined ? '' : `:${match.line}`}\n  ${match.snippet}`
      )
      .join('\n\n');
    return `Turn ${result.turnIdx} (Archive ${result.archiveIdx})\n${matches}`;
  });
  if (response.truncated) output.push('Results truncated.');
  return output.join('\n\n');
};

const formatRead = (turn: ArchivedTurn): string => {
  const sections = turn.artifacts.map(
    (artifact) =>
      `--- [${artifact.role}/${artifact.fileKind}] ${artifact.name} ---\n${artifact.content}`
  );
  return `Turn ${turn.idx} (Archive ${turn.archiveIdx})\n\n${sections.join('\n\n')}`;
};

const ensureNewline = (content: string): string =>
  content.endsWith('\n') ? content : `${content}\n`;

const unexpectedError = (error: unknown): ArchiveDomainError =>
  error instanceof ArchiveDomainError
    ? error
    : new ArchiveDomainError('IO_ERROR', 'unexpected archive CLI failure', {
        cause: error,
      });

export const runArchiveCli = async (
  argv: string[],
  io: ArchiveCliIo = process
): Promise<number> => {
  const jsonRequested = argv.includes('--json');
  try {
    const parsed = parseArchiveCli(argv);
    if (parsed === null) {
      io.stdout.write(HELP);
      return 0;
    }

    if (parsed.command === 'mcp') {
      const { startArchiveMcpServer } = await import('./mcp');
      await startArchiveMcpServer(parsed.directory);
      return 0;
    }

    let data: ArchiveDescriptor[] | ArchiveSearchResponse | ArchivedTurn;
    let human: string;
    if (parsed.command === 'list') {
      const archives = await discoverArchives(parsed.directory);
      if (archives.length === 0) {
        throw new ArchiveDomainError(
          'NO_ARCHIVE',
          `no Archive Protocol archive found in: ${parsed.directory}`
        );
      }
      data = archives;
      human = formatList(archives);
    } else if (parsed.command === 'search') {
      const response = await searchArchive(parsed.directory, {
        query: parsed.query ?? '',
        limit: parsed.limit,
        roles: parsed.roles,
        includeToolResults: parsed.includeToolResults,
        caseSensitive: parsed.caseSensitive,
      });
      data = response;
      human = formatSearch(response);
    } else {
      const turn = await readArchivedTurn(
        parsed.directory,
        parsed.turnIdx ?? -1,
        { includeToolResults: parsed.includeToolResults }
      );
      data = turn;
      human = formatRead(turn);
    }

    io.stdout.write(
      jsonRequested
        ? `${JSON.stringify(archiveJsonSuccess(data))}\n`
        : ensureNewline(human)
    );
    return 0;
  } catch (error) {
    const domainError = unexpectedError(error);
    io.stderr.write(
      jsonRequested
        ? `${JSON.stringify(archiveJsonFailure(domainError))}\n`
        : `Error [${domainError.code}]: ${domainError.message}\n`
    );
    return archiveExitCode(domainError.code);
  }
};
