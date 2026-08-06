import { createReadStream } from 'node:fs';
import { ArchiveDomainError } from './contracts';
import type {
  ArchiveArtifactMatch,
  ArchiveSearchBackend,
  ArchiveSearchBackendEvent,
  ArchiveSearchSafetyLimits,
  BackendSearchOptions,
  SearchableArtifact,
} from './search-domain';

export const DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS: Readonly<ArchiveSearchSafetyLimits> =
  Object.freeze({
    timeoutMs: 10_000,
    maxConcurrentFiles: 4,
    maxMatchesPerTurn: 100,
    maxTotalMatches: 1_000,
    maxSnippetCharacters: 500,
    maxLineCharacters: 100_000,
  });

interface FileSearchResult {
  matches: ArchiveArtifactMatch[];
  lineTruncated: boolean;
  matchTruncated: boolean;
}

const timeoutError = (): ArchiveDomainError =>
  new ArchiveDomainError('SEARCH_TIMEOUT', 'archive search timed out');

const assertNotAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw timeoutError();
};

const snippetFor = (
  line: string,
  matchIndex: number,
  maxCharacters: number
): string => {
  if (line.length <= maxCharacters) return line;
  const start = Math.max(
    0,
    Math.min(
      matchIndex - Math.floor(maxCharacters / 3),
      line.length - maxCharacters
    )
  );
  return line.slice(start, start + maxCharacters);
};

const searchFile = async (
  artifact: SearchableArtifact,
  options: BackendSearchOptions
): Promise<FileSearchResult> => {
  const { signal, safetyLimits } = options;
  const normalizedQuery = options.caseSensitive
    ? options.query
    : options.query.toLowerCase();
  const matches: ArchiveArtifactMatch[] = [];
  let line = '';
  let lineNumber = 1;
  let lineOverflow = false;
  let lineTruncated = false;
  let matchTruncated = false;

  const processLine = (): boolean => {
    assertNotAborted(signal);
    const content = line.endsWith('\r') ? line.slice(0, -1) : line;
    const comparable = options.caseSensitive ? content : content.toLowerCase();
    const matchIndex = comparable.indexOf(normalizedQuery);
    if (matchIndex >= 0) {
      matches.push({
        archiveIdx: artifact.archiveIdx,
        turnIdx: artifact.turnIdx,
        role: artifact.role,
        fileKind: artifact.fileKind,
        sourceFile: artifact.name,
        snippet: snippetFor(
          content,
          matchIndex,
          safetyLimits.maxSnippetCharacters
        ),
        line: lineNumber,
      });
    }
    if (lineOverflow) lineTruncated = true;
    line = '';
    lineOverflow = false;
    lineNumber += 1;
    return matches.length > safetyLimits.maxMatchesPerTurn;
  };

  try {
    const stream = createReadStream(artifact.path, {
      encoding: 'utf8',
      signal,
    });
    chunks: for await (const chunk of stream) {
      assertNotAborted(signal);
      const text = String(chunk);
      let start = 0;
      while (start < text.length) {
        const newline = text.indexOf('\n', start);
        const end = newline === -1 ? text.length : newline;
        const segment = text.slice(start, end);
        const remaining = safetyLimits.maxLineCharacters - line.length;
        if (remaining > 0) line += segment.slice(0, remaining);
        if (segment.length > remaining) lineOverflow = true;
        if (newline === -1) break;
        if (processLine()) {
          matchTruncated = true;
          break chunks;
        }
        start = newline + 1;
      }
      if (matches.length > safetyLimits.maxMatchesPerTurn) break;
    }
    if (
      (line.length > 0 || lineOverflow) &&
      matches.length <= safetyLimits.maxMatchesPerTurn
    ) {
      processLine();
    }
  } catch (error) {
    if (signal?.aborted) throw timeoutError();
    if (error instanceof ArchiveDomainError) throw error;
    throw new ArchiveDomainError(
      'IO_ERROR',
      `cannot search archived artifact: ${artifact.path}`,
      { cause: error }
    );
  }
  return { matches, lineTruncated, matchTruncated };
};

export class NodeLiteralSearchBackend implements ArchiveSearchBackend {
  async *search(
    artifacts: SearchableArtifact[],
    options: BackendSearchOptions
  ): AsyncIterable<ArchiveSearchBackendEvent> {
    assertNotAborted(options.signal);
    let yielded = 0;
    let emittedTruncation = false;
    const concurrency = Math.max(
      1,
      Math.floor(options.safetyLimits.maxConcurrentFiles)
    );

    for (let offset = 0; offset < artifacts.length; offset += concurrency) {
      assertNotAborted(options.signal);
      const batch = artifacts.slice(offset, offset + concurrency);
      const results = await Promise.all(
        batch.map((artifact) => searchFile(artifact, options))
      );
      for (const result of results) {
        if (result.lineTruncated && !emittedTruncation) {
          emittedTruncation = true;
          yield { type: 'truncated', reason: 'line_limit' };
        }
        for (const match of result.matches) {
          if (yielded >= options.safetyLimits.maxMatchesPerTurn) {
            yield { type: 'truncated', reason: 'match_limit' };
            return;
          }
          yielded += 1;
          yield { type: 'match', match };
        }
        if (result.matchTruncated) {
          yield { type: 'truncated', reason: 'match_limit' };
          return;
        }
      }
    }
  }
}
