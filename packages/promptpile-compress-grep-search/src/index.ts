import fs from 'node:fs/promises';
import path from 'node:path';

const ARCHIVE_PATTERN = /^\[(\d+)\]system\.md\.archive$/;
const MESSAGE_PATTERN = /^\[(\d+)\](.+?)\.(md|json)$/i;
const ASSISTANT_SIDECAR_PATTERN =
  /^\[(\d+)\]assistant\.(calls|result)\.jsonl$/i;
const ASSISTANT_EXTRA_PATTERN = /^\[(\d+)\]assistant\.extra\.json$/i;

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
  fileKind: 'message' | 'calls' | 'result' | 'extra';
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

const readManifest = async (
  archivePath: string,
  archiveIdx: number
): Promise<number[]> => {
  const manifestPath = path.join(archivePath, 'compression.json');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `invalid Archive Protocol manifest: ${manifestPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`invalid Archive Protocol manifest: ${manifestPath}`);
  }
  const record = parsed as Record<string, unknown>;
  const indices = record.archivedTurnIndices;
  if (
    record.version !== 1 ||
    !Array.isArray(indices) ||
    indices.length === 0 ||
    !indices.every((idx) => Number.isInteger(idx) && (idx as number) >= 0)
  ) {
    throw new Error(`invalid Archive Protocol manifest: ${manifestPath}`);
  }
  const unique = [...new Set(indices as number[])];
  if (
    unique.length !== indices.length ||
    Math.max(...unique) !== archiveIdx
  ) {
    throw new Error(`invalid Archive Protocol indices: ${manifestPath}`);
  }
  return unique.sort((a, b) => a - b);
};

export const discoverArchives = async (
  directory: string
): Promise<ArchiveDescriptor[]> => {
  const resolved = path.resolve(directory);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
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
        throw new Error(`duplicate archived turn index: ${turnIdx}`);
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
      fileKind: sidecar[2].toLowerCase() as 'calls' | 'result',
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
    role: message[2].toLowerCase(),
    fileKind: 'message',
  };
};

export const readArchivedTurn = async (
  directory: string,
  turnIdx: number,
  options: ReadArchivedTurnOptions = {}
): Promise<ArchivedTurn | null> => {
  if (!Number.isInteger(turnIdx) || turnIdx < 0) {
    throw new Error(`turnIdx must be a non-negative integer: ${turnIdx}`);
  }
  const archives = await discoverArchives(directory);
  const archive = archives.find((candidate) =>
    candidate.archivedTurnIndices.includes(turnIdx)
  );
  if (!archive) return null;

  const entries = await fs.readdir(archive.path, { withFileTypes: true });
  const descriptors = entries
    .filter((entry) => entry.isFile())
    .map((entry) => parseArtifact(archive.path, entry.name))
    .filter(
      (artifact): artifact is Omit<ArchivedArtifact, 'content'> =>
        artifact !== null &&
        artifact.turnIdx === turnIdx &&
        (options.includeToolResults !== false || artifact.fileKind !== 'result')
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  if (descriptors.length === 0) {
    throw new Error(`archive declares turn ${turnIdx} but contains no artifacts`);
  }
  const artifacts = await Promise.all(
    descriptors.map(async (artifact) => ({
      ...artifact,
      content: await fs.readFile(artifact.path, 'utf8'),
    }))
  );
  return { idx: turnIdx, archiveIdx: archive.idx, artifacts };
};
