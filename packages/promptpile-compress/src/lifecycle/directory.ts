import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { lifecycleError } from './errors';

/** Resolve one canonical physical identity for queueing, locking and mutation. */
export const resolveLifecycleDirectory = async (
  directory: string
): Promise<string> => {
  const requested = path.resolve(directory);
  let canonical: string;
  try {
    canonical = await fs.realpath(requested);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw lifecycleError('IO_ERROR', `目录不存在: ${requested}`);
    }
    throw error;
  }

  const stat = await fs.stat(canonical);
  if (!stat.isDirectory()) {
    throw lifecycleError('IO_ERROR', `路径不是目录: ${canonical}`);
  }
  await fs.access(canonical, constants.R_OK | constants.W_OK);
  return canonical;
};
