import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';

const temporaryPathFor = (targetPath: string): string => {
  const suffix = `${process.pid}-${randomBytes(6).toString('hex')}`;
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.tmp-${suffix}`);
};

/** Atomically replace one UTF-8 file using a temporary file in the same directory. */
export function atomicWriteUtf8FileSync(targetPath: string, content: string): void {
  const resolved = path.resolve(targetPath);
  const temporaryPath = temporaryPathFor(resolved);
  let fd: number | undefined;

  try {
    fd = fs.openSync(temporaryPath, 'wx', 0o600);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporaryPath, resolved);

    try {
      const directoryFd = fs.openSync(path.dirname(resolved), 'r');
      try {
        fs.fsyncSync(directoryFd);
      } finally {
        fs.closeSync(directoryFd);
      }
    } catch {
      // Some platforms/filesystems cannot fsync directory handles.
    }
  } catch (error) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Preserve the original error.
      }
    }
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not exist or may already have been renamed.
    }
    throw error;
  }
}
