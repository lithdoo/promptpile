import fs from 'fs';
import path from 'path';

export const directoryIdentity = (candidate: string): string => {
  const normalized = path.normalize(candidate);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

/** Resolve symlinks in the nearest existing ancestor without creating the candidate. */
export const canonicalizeProspectivePath = (candidate: string): string => {
  let current = path.resolve(candidate);
  const tail: string[] = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    tail.unshift(path.basename(current));
    current = parent;
  }
  const canonicalAncestor = fs.existsSync(current) ? fs.realpathSync(current) : current;
  return path.normalize(path.join(canonicalAncestor, ...tail));
};

export const isSameOrAncestor = (parent: string, child: string): boolean => {
  const relative = path.relative(parent, child);
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
};

export const pathsOverlap = (a: string, b: string): boolean =>
  isSameOrAncestor(a, b) || isSameOrAncestor(b, a);

export const sameDirectory = (a: string, b: string): boolean =>
  directoryIdentity(a) === directoryIdentity(b);

/** Read-only preflight for a directory that may be created later. */
export const assertProspectiveDirectoryUsable = (candidate: string): void => {
  let current = path.resolve(candidate);
  if (fs.existsSync(current)) {
    if (!fs.statSync(current).isDirectory()) throw new Error('path is not a directory');
    fs.accessSync(current, fs.constants.R_OK | fs.constants.W_OK);
    return;
  }
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error('no existing ancestor');
    current = parent;
  }
  if (!fs.statSync(current).isDirectory()) throw new Error('existing ancestor is not a directory');
  fs.accessSync(current, fs.constants.R_OK | fs.constants.W_OK);
};
