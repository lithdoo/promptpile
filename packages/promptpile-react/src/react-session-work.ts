import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { ReactSessionContext, ResolvedReactConfig } from './types';
import {
  canonicalizeProspectivePath,
  isSameOrAncestor,
  pathsOverlap,
  sameDirectory
} from './react-path-identity';

const MARKER_NAME = '.promptpile-react-session.json';

interface SessionMarkerV1 {
  version: 1;
  session_id: string;
  created_by: 'promptpile-react';
}

const markerFor = (sessionId: string): SessionMarkerV1 => ({
  version: 1,
  session_id: sessionId,
  created_by: 'promptpile-react'
});

const markerMatches = (candidate: unknown, sessionId: string): boolean => {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false;
  const marker = candidate as Record<string, unknown>;
  return marker.version === 1 &&
    marker.session_id === sessionId &&
    marker.created_by === 'promptpile-react';
};

const removeFreshDirectoryQuietly = (directory: string): void => {
  try {
    fs.rmSync(directory, { recursive: true, force: true });
  } catch {
    // Creation failure remains primary.
  }
};

export const createReactSessionWork = (config: ResolvedReactConfig): ReactSessionContext => {
  const requestedRoot = config.configuredWorkRootAbs ?? os.tmpdir();
  const prospectiveRoot = canonicalizeProspectivePath(requestedRoot);
  for (const layer of config.authoritativeReadLayersAbs) {
    const canonicalLayer = canonicalizeProspectivePath(layer);
    if (isSameOrAncestor(canonicalLayer, prospectiveRoot)) {
      throw new Error(`React work root is equal to or inside authoritative layer: ${layer}`);
    }
  }
  fs.mkdirSync(requestedRoot, { recursive: true });
  const workRootAbs = fs.realpathSync(requestedRoot);
  for (const layer of config.authoritativeReadLayersAbs) {
    const canonicalLayer = canonicalizeProspectivePath(layer);
    if (isSameOrAncestor(canonicalLayer, workRootAbs)) {
      throw new Error(`React work root is equal to or inside authoritative layer: ${layer}`);
    }
  }

  const created = fs.mkdtempSync(path.join(workRootAbs, 'promptpile-react-session-'));
  const workDirectoryAbs = fs.realpathSync(created);
  const sessionId = randomBytes(16).toString('hex');
  try {
    if (!isSameOrAncestor(workRootAbs, workDirectoryAbs) || sameDirectory(workRootAbs, workDirectoryAbs)) {
      throw new Error('created React session directory escaped its work root');
    }
    const conflict = config.authoritativeReadLayersAbs.find(layer =>
      pathsOverlap(canonicalizeProspectivePath(layer), workDirectoryAbs)
    );
    if (conflict !== undefined) {
      throw new Error(`React session directory overlaps authoritative layer: ${conflict}`);
    }
    fs.writeFileSync(
      path.join(workDirectoryAbs, MARKER_NAME),
      `${JSON.stringify(markerFor(sessionId), null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    return { sessionId, workRootAbs, workDirectoryAbs };
  } catch (error) {
    removeFreshDirectoryQuietly(workDirectoryAbs);
    throw error;
  }
};

export const cleanupReactSessionWork = (options: {
  session: ReactSessionContext;
  succeeded: boolean;
  debug?: boolean;
}): void => {
  const { session, succeeded } = options;
  const debug = options.debug ?? process.env.PROMPTPILE_REACT_DEBUG === '1';
  if (!succeeded && debug) {
    console.error(`promptpile-react: preserved failed session work: ${session.workDirectoryAbs}`);
    return;
  }
  try {
    const actualRoot = fs.realpathSync(session.workRootAbs);
    const actualSession = fs.realpathSync(session.workDirectoryAbs);
    if (
      sameDirectory(actualRoot, actualSession) ||
      !isSameOrAncestor(actualRoot, actualSession) ||
      !sameDirectory(actualSession, session.workDirectoryAbs)
    ) {
      throw new Error('session cleanup target identity validation failed');
    }
    const markerPath = path.join(actualSession, MARKER_NAME);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8')) as unknown;
    if (!markerMatches(marker, session.sessionId)) {
      throw new Error('session ownership marker does not match');
    }
    fs.rmSync(actualSession, { recursive: true, force: false });
  } catch (error) {
    console.error(
      `promptpile-react: warning: failed to clean session work ${session.workDirectoryAbs}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};
