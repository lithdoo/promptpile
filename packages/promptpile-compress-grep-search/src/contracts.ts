export type ArchiveErrorCode =
  | 'NO_ARCHIVE'
  | 'TURN_NOT_FOUND'
  | 'INVALID_ARCHIVE'
  | 'INVALID_QUERY'
  | 'SEARCH_TIMEOUT'
  | 'IO_ERROR';

export const ARCHIVE_READ_DEFAULTS = {
  includeToolResults: true,
} as const;

export const ARCHIVE_SEARCH_DEFAULTS = {
  limit: 20,
  includeToolResults: false,
  caseSensitive: false,
} as const;

export interface ToolResultFlags {
  includeToolResults?: boolean;
  noToolResults?: boolean;
}

export class ArchiveDomainError extends Error {
  readonly code: ArchiveErrorCode;

  constructor(code: ArchiveErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ArchiveDomainError';
    this.code = code;
  }
}

const resolveToolResults = (
  flags: ToolResultFlags,
  defaultValue: boolean
): boolean => {
  if (flags.includeToolResults && flags.noToolResults) {
    throw new ArchiveDomainError(
      'INVALID_QUERY',
      '--include-tool-results and --no-tool-results are mutually exclusive'
    );
  }
  if (flags.includeToolResults) return true;
  if (flags.noToolResults) return false;
  return defaultValue;
};

export const resolveSearchToolResults = (flags: ToolResultFlags): boolean =>
  resolveToolResults(flags, ARCHIVE_SEARCH_DEFAULTS.includeToolResults);

export const resolveReadToolResults = (flags: ToolResultFlags): boolean =>
  resolveToolResults(flags, ARCHIVE_READ_DEFAULTS.includeToolResults);

export interface ArchiveJsonSuccess<T> {
  ok: true;
  data: T;
}

export interface ArchiveJsonFailure {
  ok: false;
  error: {
    code: ArchiveErrorCode;
    message: string;
  };
}

export type ArchiveJsonEnvelope<T> =
  | ArchiveJsonSuccess<T>
  | ArchiveJsonFailure;

export const archiveJsonSuccess = <T>(data: T): ArchiveJsonSuccess<T> => ({
  ok: true,
  data,
});

export const archiveJsonFailure = (
  error: ArchiveDomainError
): ArchiveJsonFailure => ({
  ok: false,
  error: {
    code: error.code,
    message: error.message,
  },
});

export const archiveExitCode = (code: ArchiveErrorCode): number => {
  switch (code) {
    case 'INVALID_QUERY':
      return 2;
    case 'NO_ARCHIVE':
    case 'TURN_NOT_FOUND':
      return 3;
    case 'INVALID_ARCHIVE':
      return 4;
    case 'SEARCH_TIMEOUT':
      return 124;
    case 'IO_ERROR':
      return 1;
  }
};
