import fs from 'node:fs/promises';
import path from 'node:path';
import { ForkError } from './errors';
import type { ResolvedForkPaths } from './types';

const exists = async (candidate: string): Promise<boolean> => {
  try { await fs.lstat(candidate); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

const identity = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value;
const within = (parent: string, child: string): boolean => {
  const relative = path.relative(identity(parent), identity(child));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

export async function resolveForkPaths(sourceInput: string, targetInput: string): Promise<ResolvedForkPaths> {
  let source: string;
  try {
    source = await fs.realpath(path.resolve(sourceInput));
    if (!(await fs.stat(source)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new ForkError('invalid_source', `source is not a readable directory: ${sourceInput}`, error);
  }

  const requestedTarget = path.resolve(targetInput);
  const targetBasename = path.basename(requestedTarget);
  let targetParent: string;
  try {
    targetParent = await fs.realpath(path.dirname(requestedTarget));
    if (!(await fs.stat(targetParent)).isDirectory()) throw new Error('not a directory');
  } catch (error) {
    throw new ForkError('invalid_target_parent', `target parent is not a readable directory: ${path.dirname(requestedTarget)}`, error);
  }
  const target = path.join(targetParent, targetBasename);
  if (within(source, target) || within(target, source)) {
    throw new ForkError('path_overlap', 'source and target must not be equal or contain one another');
  }
  try {
    if (await exists(target)) throw new ForkError('target_exists', `target already exists: ${target}`);
  } catch (error) {
    if (error instanceof ForkError) throw error;
    throw new ForkError('target_exists', `unable to prove target absence: ${target}`, error);
  }
  return { source, target, targetParent, targetBasename, canonicalTargetIdentity: identity(target) };
}

export async function requireTargetAbsent(target: string): Promise<void> {
  try {
    if (await exists(target)) throw new ForkError('target_exists', `target already exists: ${target}`);
  } catch (error) {
    if (error instanceof ForkError) throw error;
    throw new ForkError('target_exists', `unable to prove target absence: ${target}`, error);
  }
}
