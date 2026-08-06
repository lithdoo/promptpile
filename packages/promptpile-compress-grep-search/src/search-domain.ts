import {
  ARCHIVE_SEARCH_DEFAULTS,
  ArchiveDomainError,
} from './contracts';

export type ArchiveArtifactFileKind =
  | 'message'
  | 'calls'
  | 'result'
  | 'extra';

export interface ArchiveSearchMatch {
  role: string;
  fileKind: ArchiveArtifactFileKind;
  sourceFile: string;
  snippet: string;
  line?: number;
}

export interface ArchiveArtifactMatch extends ArchiveSearchMatch {
  archiveIdx: number;
  turnIdx: number;
}

export interface ArchiveSearchResult {
  turnIdx: number;
  archiveIdx: number;
  matches: ArchiveSearchMatch[];
}

export interface ArchiveSearchOptions {
  query: string;
  limit?: number;
  roles?: string[];
  includeToolResults?: boolean;
  caseSensitive?: boolean;
}

export interface ResolvedArchiveSearchOptions {
  query: string;
  limit: number;
  roles: string[];
  includeToolResults: boolean;
  caseSensitive: boolean;
}

export interface ArchiveSearchResponse {
  results: ArchiveSearchResult[];
  truncated: boolean;
}

export interface SearchableArtifact {
  archiveIdx: number;
  turnIdx: number;
  role: string;
  fileKind: ArchiveArtifactFileKind;
  name: string;
  path: string;
}

export interface SearchableArtifactOptions {
  roles?: string[];
  includeToolResults?: boolean;
}

export interface ArchiveSearchSafetyLimits {
  timeoutMs: number;
  maxMatchesPerTurn: number;
  maxTotalMatches: number;
  maxSnippetCharacters: number;
  maxLineCharacters: number;
}

export interface BackendSearchOptions {
  query: string;
  caseSensitive: boolean;
  safetyLimits: ArchiveSearchSafetyLimits;
  signal?: AbortSignal;
}

export interface ArchiveSearchBackend {
  search(
    artifacts: SearchableArtifact[],
    options: BackendSearchOptions
  ): AsyncIterable<ArchiveArtifactMatch>;
}

const validateRoles = (roles: string[] | undefined): string[] => {
  if (roles === undefined || roles.length === 0) return [];
  if (roles.some((role) => typeof role !== 'string' || role.length === 0)) {
    throw new ArchiveDomainError(
      'INVALID_QUERY',
      'roles must contain non-empty case-sensitive role names'
    );
  }
  return [...new Set(roles)];
};

export const resolveArchiveSearchOptions = (
  options: ArchiveSearchOptions
): ResolvedArchiveSearchOptions => {
  if (typeof options.query !== 'string' || options.query.trim().length === 0) {
    throw new ArchiveDomainError(
      'INVALID_QUERY',
      'query must contain non-whitespace literal text'
    );
  }
  const limit = options.limit ?? ARCHIVE_SEARCH_DEFAULTS.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ArchiveDomainError(
      'INVALID_QUERY',
      `limit must be an integer from 1 to 100: ${String(limit)}`
    );
  }
  return {
    query: options.query,
    limit,
    roles: validateRoles(options.roles),
    includeToolResults:
      options.includeToolResults ??
      ARCHIVE_SEARCH_DEFAULTS.includeToolResults,
    caseSensitive:
      options.caseSensitive ?? ARCHIVE_SEARCH_DEFAULTS.caseSensitive,
  };
};

export const resolveSearchableArtifactOptions = (
  options: SearchableArtifactOptions = {}
): Required<SearchableArtifactOptions> => ({
  roles: validateRoles(options.roles),
  includeToolResults:
    options.includeToolResults ?? ARCHIVE_SEARCH_DEFAULTS.includeToolResults,
});
