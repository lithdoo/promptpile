import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';

const tempPathFor = (targetPath: string): string => {
  const dir = path.dirname(targetPath);
  const base = path.basename(targetPath);
  const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
  return path.join(dir, `.${base}.tmp-${suffix}`);
};

/** Atomically replace a file using a synced temporary file in the same directory. */
export const atomicWriteFileSync = (targetPath: string, content: string): void => {
  const resolved = path.resolve(targetPath);
  const tempPath = tempPathFor(resolved);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tempPath, resolved);
    try {
      const dirFd = fs.openSync(path.dirname(resolved), 'r');
      try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    } catch {
      // Some platforms/filesystems do not allow syncing directory handles.
    }
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve original error */ }
    }
    try { fs.unlinkSync(tempPath); } catch { /* temp may not exist */ }
    throw error;
  }
};
