import fs from 'node:fs/promises';
import path from 'node:path';
import { ARCHIVE_READ_DEFAULTS, ArchiveDomainError } from './contracts';
import {
  DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS,
  NodeLiteralSearchBackend,
} from './node-literal-search';
import {
  resolveArchiveSearchOptions,
  resolveSearchableArtifactOptions,
  type ArchiveSearchMatch,
  type ArchiveSearchOptions,
  type ArchiveSearchResponse,
  type ArchiveArtifactFileKind,
  type SearchableArtifact,
  type SearchableArtifactOptions,
} from './search-domain';

export {
  ARCHIVE_READ_DEFAULTS,
  ARCHIVE_SEARCH_DEFAULTS,
  ArchiveDomainError,
  archiveExitCode,
  archiveJsonFailure,
  archiveJsonSuccess,
  resolveReadToolResults,
  resolveSearchToolResults,
  type ArchiveErrorCode,
  type ArchiveJsonEnvelope,
  type ArchiveJsonFailure,
  type ArchiveJsonSuccess,
  type ToolResultFlags,
} from './contracts';
export {
  resolveArchiveSearchOptions,
  resolveSearchableArtifactOptions,
  type ArchiveArtifactMatch,
  type ArchiveArtifactFileKind,
  type ArchiveSearchBackend,
  type ArchiveSearchMatch,
  type ArchiveSearchOptions,
  type ArchiveSearchResponse,
  type ArchiveSearchResult,
  type ArchiveSearchSafetyLimits,
  type BackendSearchOptions,
  type ResolvedArchiveSearchOptions,
  type SearchableArtifact,
  type SearchableArtifactOptions,
} from './search-domain';

const ARCHIVE_PATTERN = /^\[(\d+)\]system\.md\.archive$/;
const MESSAGE_PATTERN = /^\[(\d+)\](.+?)\.(md|json)$/;
const ASSISTANT_SIDECAR_PATTERN =
  /^\[(\d+)\]assistant\.(calls|result)\.jsonl$/;
const ASSISTANT_EXTRA_PATTERN = /^\[(\d+)\]assistant\.extra\.json$/;

export interface ArchiveDescriptor {
  idx: number;
  name: string;
  path: string;
  archivedTurnIndices: number[];
}

export interface ArchivedArtifact {
  name: string;
  path: string;
  turnIdx: number;
  role: string;
  fileKind: ArchiveArtifactFileKind;
  content: string;
}

export interface ArchivedTurn {
  idx: number;
  archiveIdx: number;
  artifacts: ArchivedArtifact[];
}

export interface ReadArchivedTurnOptions {
  includeToolResults?: boolean;
}

const ioError = (message: string, cause: unknown): ArchiveDomainError =>
  new ArchiveDomainError('IO_ERROR', message, { cause });

const invalidArchive = (
  message: string,
  cause?: unknown
): ArchiveDomainError =>
  new ArchiveDomainError('INVALID_ARCHIVE', message, { cause });

const readManifest = async (
  archivePath: string,
  archiveIdx: number
): Promise<number[]> => {
  const manifestPath = path.join(archivePath, 'compression.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw invalidArchive(
      `invalid Archive Protocol manifest: ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidArchive(`invalid Archive Protocol manifest: ${manifestPath}`);
  }
  const record = parsed as Record<string, unknown>;
  const indices = record.archivedTurnIndices;
  if (
    record.version !== 1 ||
    !Array.isArray(indices) ||
    indices.length === 0 ||
    !indices.every((idx) => Number.isInteger(idx) && (idx as number) >= 0)
  ) {
    throw invalidArchive(`invalid Archive Protocol manifest: ${manifestPath}`);
  }
  const unique = [...new Set(indices as number[])];
  if (
    unique.length !== indices.length ||
    Math.max(...unique) !== archiveIdx
  ) {
    throw invalidArchive(`invalid Archive Protocol indices: ${manifestPath}`);
  }
  return unique.sort((a, b) => a - b);
};

export const discoverArchives = async (
  directory: string
): Promise<ArchiveDescriptor[]> => {
  const resolved = path.resolve(directory);
  let entries;
  try {
    entries = await fs.readdir(resolved, { withFileTypes: true });
  } catch (error) {
    throw ioError(`cannot read conversation directory: ${resolved}`, error);
  }
  const archives: ArchiveDescriptor[] = [];
  const allIndices = new Set<number>();
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const match = entry.name.match(ARCHIVE_PATTERN);
    if (!match || !entry.isDirectory()) continue;
    const idx = Number.parseInt(match[1], 10);
    const archivePath = path.join(resolved, entry.name);
    const archivedTurnIndices = await readManifest(archivePath, idx);
    for (const turnIdx of archivedTurnIndices) {
      if (allIndices.has(turnIdx)) {
        throw invalidArchive(`duplicate archived turn index: ${turnIdx}`);
      }
      allIndices.add(turnIdx);
    }
    archives.push({
      idx,
      name: entry.name,
      path: archivePath,
      archivedTurnIndices,
    });
  }
  return archives.sort((a, b) => b.idx - a.idx);
};

const artifactOrder = (
  artifact: Omit<ArchivedArtifact, 'content'>
): number => {
  if (artifact.fileKind === 'message') {
    return artifact.role === 'assistant' ? 1 : 0;
  }
  if (artifact.fileKind === 'calls') return 2;
  if (artifact.fileKind === 'extra') return 3;
  return 4;
};

const compareArtifacts = (
  a: Omit<ArchivedArtifact, 'content'>,
  b: Omit<ArchivedArtifact, 'content'>
): number =>
  artifactOrder(a) - artifactOrder(b) ||
  a.role.localeCompare(b.role) ||
  a.name.localeCompare(b.name);

const compareSearchableArtifacts = (
  a: SearchableArtifact,
  b: SearchableArtifact
): number =>
  b.turnIdx - a.turnIdx ||
  b.archiveIdx - a.archiveIdx ||
  compareArtifacts(a, b);

const parseArtifact = (
  archivePath: string,
  name: string
): Omit<ArchivedArtifact, 'content'> | null => {
  const sidecar = name.match(ASSISTANT_SIDECAR_PATTERN);
  if (sidecar) {
    return {
      name,
      path: path.join(archivePath, name),
      turnIdx: Number.parseInt(sidecar[1], 10),
      role: 'assistant',
      fileKind: sidecar[2] as 'calls' | 'result',
    };
  }
  const extra = name.match(ASSISTANT_EXTRA_PATTERN);
  if (extra) {
    return {
      name,
      path: path.join(archivePath, name),
      turnIdx: Number.parseInt(extra[1], 10),
      role: 'assistant',
      fileKind: 'extra',
    };
  }
  const message = name.match(MESSAGE_PATTERN);
  if (!message) return null;
  return {
    name,
    path: path.join(archivePath, name),
    turnIdx: Number.parseInt(message[1], 10),
    role: message[2],
    fileKind: 'message',
  };
};

export const readArchivedTurn = async (
  directory: string,
  turnIdx: number,
  options: ReadArchivedTurnOptions = {}
): Promise<ArchivedTurn> => {
  if (!Number.isInteger(turnIdx) || turnIdx < 0) {
    throw new ArchiveDomainError(
      'INVALID_QUERY',
      `turnIdx must be a non-negative integer: ${turnIdx}`
    );
  }
  const archives = await discoverArchives(directory);
  if (archives.length === 0) {
    throw new ArchiveDomainError(
      'NO_ARCHIVE',
      `no Archive Protocol archive found in: ${path.resolve(directory)}`
    );
  }
  const archive = archives.find((candidate) =>
    candidate.archivedTurnIndices.includes(turnIdx)
  );
  if (!archive) {
    throw new ArchiveDomainError(
      'TURN_NOT_FOUND',
      `archived turn not found: ${turnIdx}`
    );
  }

  let entries;
  try {
    entries = await fs.readdir(archive.path, { withFileTypes: true });
  } catch (error) {
    throw ioError(`cannot read archive directory: ${archive.path}`, error);
  }
  const descriptors = entries
    .filter((entry) => entry.isFile())
    .map((entry) => parseArtifact(archive.path, entry.name))
    .filter(
      (artifact): artifact is Omit<ArchivedArtifact, 'content'> =>
        artifact !== null &&
        artifact.turnIdx === turnIdx &&
        ((options.includeToolResults ??
          ARCHIVE_READ_DEFAULTS.includeToolResults) ||
          artifact.fileKind !== 'result')
    )
    .sort(compareArtifacts);
  if (descriptors.length === 0) {
    throw invalidArchive(
      `archive declares turn ${turnIdx} but contains no artifacts`
    );
  }
  let artifacts: ArchivedArtifact[];
  try {
    artifacts = await Promise.all(
      descriptors.map(async (artifact) => ({
        ...artifact,
        content: await fs.readFile(artifact.path, 'utf8'),
      }))
    );
  } catch (error) {
    throw ioError(`cannot read archived turn: ${turnIdx}`, error);
  }
  return { idx: turnIdx, archiveIdx: archive.idx, artifacts };
};

export const enumerateSearchableArtifacts = async (
  directory: string,
  options: SearchableArtifactOptions = {}
): Promise<SearchableArtifact[]> => {
  const resolvedOptions = resolveSearchableArtifactOptions(options);
  const roleFilter = new Set(resolvedOptions.roles);
  const archives = await discoverArchives(directory);
  if (archives.length === 0) {
    throw new ArchiveDomainError(
      'NO_ARCHIVE',
      `no Archive Protocol archive found in: ${path.resolve(directory)}`
    );
  }

  const searchable: SearchableArtifact[] = [];
  for (const archive of archives) {
    let entries;
    try {
      entries = await fs.readdir(archive.path, { withFileTypes: true });
    } catch (error) {
      throw ioError(`cannot read archive directory: ${archive.path}`, error);
    }
    const declared = new Set(archive.archivedTurnIndices);
    const artifacts = entries
      .filter((entry) => entry.isFile())
      .map((entry) => parseArtifact(archive.path, entry.name))
      .filter(
        (artifact): artifact is Omit<ArchivedArtifact, 'content'> =>
          artifact !== null && declared.has(artifact.turnIdx)
      );

    const turnsWithArtifacts = new Set(
      artifacts.map((artifact) => artifact.turnIdx)
    );
    const missingTurn = archive.archivedTurnIndices.find(
      (turnIdx) => !turnsWithArtifacts.has(turnIdx)
    );
    if (missingTurn !== undefined) {
      throw invalidArchive(
        `archive declares turn ${missingTurn} but contains no artifacts`
      );
    }

    searchable.push(
      ...artifacts
        .filter(
          (artifact) =>
            (resolvedOptions.includeToolResults ||
              artifact.fileKind !== 'result') &&
            (roleFilter.size === 0 || roleFilter.has(artifact.role))
        )
        .map((artifact) => ({ ...artifact, archiveIdx: archive.idx }))
    );
  }
  return searchable.sort(compareSearchableArtifacts);
};

export const searchArchive = async (
  directory: string,
  options: ArchiveSearchOptions
): Promise<ArchiveSearchResponse> => {
  const resolved = resolveArchiveSearchOptions(options);
  const startedAt = Date.now();
  const artifacts = await enumerateSearchableArtifacts(directory, {
    roles: resolved.roles,
    includeToolResults: resolved.includeToolResults,
  });
  const remainingMs =
    DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS.timeoutMs -
    (Date.now() - startedAt);
  if (remainingMs <= 0) {
    throw new ArchiveDomainError('SEARCH_TIMEOUT', 'archive search timed out');
  }

  const groups: Array<{
    archiveIdx: number;
    turnIdx: number;
    artifacts: SearchableArtifact[];
  }> = [];
  for (const artifact of artifacts) {
    const current = groups[groups.length - 1];
    if (
      current &&
      current.archiveIdx === artifact.archiveIdx &&
      current.turnIdx === artifact.turnIdx
    ) {
      current.artifacts.push(artifact);
    } else {
      groups.push({
        archiveIdx: artifact.archiveIdx,
        turnIdx: artifact.turnIdx,
        artifacts: [artifact],
      });
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), remainingMs);
  const backend = new NodeLiteralSearchBackend();
  const results: ArchiveSearchResponse['results'] = [];
  let truncated = false;
  let totalMatches = 0;
  let safetyStop = false;

  try {
    for (const group of groups) {
      const matches: ArchiveSearchMatch[] = [];
      for await (const event of backend.search(group.artifacts, {
        query: resolved.query,
        caseSensitive: resolved.caseSensitive,
        safetyLimits: DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS,
        signal: controller.signal,
      })) {
        if (event.type === 'truncated') {
          truncated = true;
          continue;
        }
        if (
          totalMatches >=
          DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS.maxTotalMatches
        ) {
          truncated = true;
          safetyStop = true;
          break;
        }
        const { archiveIdx: _archiveIdx, turnIdx: _turnIdx, ...match } =
          event.match;
        matches.push(match);
        totalMatches += 1;
      }

      if (matches.length > 0) {
        if (results.length >= resolved.limit) {
          truncated = true;
          break;
        }
        results.push({
          turnIdx: group.turnIdx,
          archiveIdx: group.archiveIdx,
          matches,
        });
      }
      if (safetyStop) break;
    }
  } finally {
    clearTimeout(timeout);
  }

  return { results, truncated };
};
