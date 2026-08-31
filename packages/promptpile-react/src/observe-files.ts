import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import { sameDirectory } from './react-path-identity';
import type { ReactSessionContext } from './types';

const ARCHIVE_DIRECTORY = '.observe_files';
const INDEX_NAME = 'index.json';
const ASSISTANT_BODY = /^\[(0|[1-9]\d*)\]assistant\.md$/;
const MESSAGE_BODY = /^\[(0|[1-9]\d*)\](?:assistant|user|system)\.md$/;
const FAMILY_SUFFIXES = [
  'assistant.md',
  'assistant.calls.jsonl',
  'assistant.extra.json',
  'assistant.result.jsonl'
] as const;

export interface ObserveFileIndexV1 {
  version: 1;
  indices: number[];
}

const archiveDirectoryFor = (session: ReactSessionContext): string =>
  path.join(session.workDirectoryAbs, ARCHIVE_DIRECTORY);

const indexPathFor = (session: ReactSessionContext): string =>
  path.join(archiveDirectoryFor(session), INDEX_NAME);

const bodyName = (index: number): string => `[${index}]assistant.md`;

const familyNames = (index: number): string[] =>
  FAMILY_SUFFIXES.map(suffix => `[${index}]${suffix}`);

const ensureArchiveDirectory = (session: ReactSessionContext): string => {
  const archive = archiveDirectoryFor(session);
  if (!fs.existsSync(archive)) fs.mkdirSync(archive);
  const stat = fs.lstatSync(archive);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Observe archive must be an ordinary directory');
  }
  const actualParent = fs.realpathSync(path.dirname(archive));
  const expectedParent = fs.realpathSync(session.workDirectoryAbs);
  if (!sameDirectory(actualParent, expectedParent)) {
    throw new Error('Observe archive is outside the session work directory');
  }
  return archive;
};

const assertOrdinaryFile = (candidate: string, label: string): void => {
  const stat = fs.lstatSync(candidate);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be an ordinary file`);
};

export const parseObserveFileIndexV1 = (value: unknown): ObserveFileIndexV1 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Observe index must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.indices)) {
    throw new Error('Observe index has an unsupported schema');
  }
  const indices: number[] = [];
  for (const item of record.indices) {
    if (!Number.isInteger(item) || (item as number) < 0) {
      throw new Error('Observe index entries must be non-negative integers');
    }
    const index = item as number;
    if (indices.length > 0 && index <= indices[indices.length - 1]) {
      throw new Error('Observe index entries must be unique and strictly ascending');
    }
    indices.push(index);
  }
  return { version: 1, indices };
};

export const readObserveFileIndex = (session: ReactSessionContext): ObserveFileIndexV1 => {
  const indexPath = indexPathFor(session);
  if (!fs.existsSync(indexPath)) return { version: 1, indices: [] };
  ensureArchiveDirectory(session);
  assertOrdinaryFile(indexPath, 'Observe index');
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Observe index is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parseObserveFileIndexV1(parsed);
};

const writeIndexAtomic = (session: ReactSessionContext, index: ObserveFileIndexV1): void => {
  const archiveDirectory = ensureArchiveDirectory(session);
  const target = indexPathFor(session);
  const temp = path.join(archiveDirectory, `.index-${process.pid}-${randomBytes(8).toString('hex')}.tmp`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(temp, 'wx');
    fs.writeFileSync(fd, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
  }
};

const parseDirectAssistantPath = (session: ReactSessionContext, assistantPath: string): number => {
  if (!path.isAbsolute(assistantPath) || !fs.existsSync(assistantPath)) {
    throw new Error('Persisted Observe assistant path is missing or not absolute');
  }
  assertOrdinaryFile(assistantPath, 'Persisted Observe assistant');
  const actualParent = fs.realpathSync(path.dirname(assistantPath));
  const expectedParent = fs.realpathSync(session.workDirectoryAbs);
  if (!sameDirectory(actualParent, expectedParent)) {
    throw new Error('Persisted Observe assistant is outside the session work directory');
  }
  const match = ASSISTANT_BODY.exec(path.basename(assistantPath));
  if (match === null) throw new Error('Persisted Observe assistant has an invalid basename');
  return Number(match[1]);
};

const activeIndices = (session: ReactSessionContext, registered: number[]): number[] =>
  registered.filter(index => fs.existsSync(path.join(session.workDirectoryAbs, bodyName(index))));

const maxRootMessageIndex = (session: ReactSessionContext): number => {
  let maximum = -1;
  for (const entry of fs.readdirSync(session.workDirectoryAbs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = MESSAGE_BODY.exec(entry.name);
    if (match !== null) maximum = Math.max(maximum, Number(match[1]));
  }
  return maximum;
};

const archiveObserveFamily = (
  session: ReactSessionContext,
  index: number,
  newestObserveIndex: number
): void => {
  if (index === newestObserveIndex) throw new Error('Newest Observe cannot be archived');
  const root = session.workDirectoryAbs;
  const archive = archiveDirectoryFor(session);
  const primary = path.join(root, bodyName(index));
  if (!fs.existsSync(primary)) throw new Error(`Active Observe body is missing: ${index}`);
  const sources = familyNames(index)
    .map(name => ({ name, source: path.join(root, name), destination: path.join(archive, name) }))
    .filter(item => fs.existsSync(item.source));
  for (const item of sources) {
    assertOrdinaryFile(item.source, `Observe artifact ${item.name}`);
    if (fs.existsSync(item.destination)) throw new Error(`Observe archive destination already exists: ${item.name}`);
  }
  const primaryName = bodyName(index);
  for (const item of sources.filter(item => item.name !== primaryName)) {
    fs.renameSync(item.source, item.destination);
  }
  const primaryItem = sources.find(item => item.name === primaryName);
  if (primaryItem === undefined) throw new Error(`Active Observe body is missing: ${index}`);
  fs.renameSync(primaryItem.source, primaryItem.destination);
};

export const verifyObserveRetentionInvariants = (options: {
  session: ReactSessionContext;
  carryover: number;
  newestObserveIndex: number;
}): void => {
  const { session, carryover, newestObserveIndex } = options;
  const registered = readObserveFileIndex(session).indices;
  const active = activeIndices(session, registered);
  if (active.length > carryover) throw new Error('Active Observe count exceeds carryover');
  if (!fs.existsSync(path.join(session.workDirectoryAbs, bodyName(newestObserveIndex)))) {
    throw new Error('Newest Observe is not active');
  }
  const archive = archiveDirectoryFor(session);
  for (const index of registered) {
    const rootExists = fs.existsSync(path.join(session.workDirectoryAbs, bodyName(index)));
    const archiveExists = fs.existsSync(path.join(archive, bodyName(index)));
    if (rootExists === archiveExists) {
      throw new Error(`Registered Observe must have exactly one primary location: ${index}`);
    }
  }
};

export const registerObserveAndPrune = (options: {
  session: ReactSessionContext;
  assistantPath: string;
  carryover: number;
}): number => {
  const { session, assistantPath, carryover } = options;
  if (!Number.isInteger(carryover) || carryover <= 0) {
    throw new Error('Observe carryover must be a positive integer when registering');
  }
  const newestObserveIndex = parseDirectAssistantPath(session, assistantPath);
  const current = readObserveFileIndex(session);
  const previous = current.indices.length === 0
    ? undefined
    : current.indices[current.indices.length - 1];
  if (previous !== undefined && newestObserveIndex <= previous) {
    throw new Error('Observe indices must be registered in strictly ascending order');
  }
  const beforeMaximum = maxRootMessageIndex(session);
  if (newestObserveIndex !== beforeMaximum) {
    throw new Error('New Observe must be the current Conversation maximum index');
  }
  const registered = [...current.indices, newestObserveIndex];
  writeIndexAtomic(session, { version: 1, indices: registered });

  const active = activeIndices(session, registered);
  while (active.length > carryover) {
    const oldest = active[0];
    archiveObserveFamily(session, oldest, newestObserveIndex);
    active.shift();
  }
  verifyObserveRetentionInvariants({ session, carryover, newestObserveIndex });
  if (maxRootMessageIndex(session) < beforeMaximum) {
    throw new Error('Observe pruning decreased the active Conversation maximum index');
  }
  return newestObserveIndex;
};
