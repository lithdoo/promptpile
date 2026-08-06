import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const LIFECYCLE_LOCK_FILE = '.promptpile-compress.lock';

export type LifecycleOperation = 'compress' | 'restore' | 'recover';

interface LifecycleLockMetadata {
  version: 1;
  ownerId: string;
  pid: number;
  hostname: string;
  operation: LifecycleOperation;
  createdAt: string;
}

const readLockMetadata = async (
  lockPath: string
): Promise<LifecycleLockMetadata | null> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw new Error(
      `lifecycle lock 无法解析，拒绝自动删除: ${lockPath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`lifecycle lock metadata 无效，拒绝自动删除: ${lockPath}`);
  }
  const record = parsed as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.ownerId !== 'string' ||
    !Number.isInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.hostname !== 'string' ||
    !['compress', 'restore', 'recover'].includes(String(record.operation)) ||
    typeof record.createdAt !== 'string'
  ) {
    throw new Error(`lifecycle lock metadata 无效，拒绝自动删除: ${lockPath}`);
  }

  return record as unknown as LifecycleLockMetadata;
};

const isLocalProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return false;
    }
    return true;
  }
};

const isRecoverableStaleLock = (metadata: LifecycleLockMetadata): boolean =>
  metadata.hostname === os.hostname() && !isLocalProcessAlive(metadata.pid);

const createLock = async (
  lockPath: string,
  operation: LifecycleOperation
): Promise<LifecycleLockMetadata> => {
  const metadata: LifecycleLockMetadata = {
    version: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    operation,
    createdAt: new Date().toISOString(),
  };

  let handle;
  try {
    handle = await fs.open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await handle.sync();
    return metadata;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      await handle?.close().catch(() => undefined);
      handle = undefined;
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
    throw error;
  } finally {
    await handle?.close();
  }
};

const acquireLock = async (
  directory: string,
  operation: LifecycleOperation
): Promise<{ lockPath: string; metadata: LifecycleLockMetadata }> => {
  const lockPath = path.join(directory, LIFECYCLE_LOCK_FILE);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return { lockPath, metadata: await createLock(lockPath, operation) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }

      const existing = await readLockMetadata(lockPath);
      if (existing === null) {
        continue;
      }
      if (isRecoverableStaleLock(existing)) {
        await fs.unlink(lockPath).catch((unlinkError) => {
          if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw unlinkError;
          }
        });
        continue;
      }

      throw new Error(
        `conversation lifecycle mutation 已被锁定: ${lockPath} ` +
          `(operation=${existing.operation}, pid=${existing.pid}, ` +
          `host=${existing.hostname}, createdAt=${existing.createdAt})`
      );
    }
  }

  throw new Error(`无法获取 conversation lifecycle lock: ${lockPath}`);
};

const releaseLock = async (
  lockPath: string,
  metadata: LifecycleLockMetadata
): Promise<void> => {
  const current = await readLockMetadata(lockPath);
  if (current === null) {
    return;
  }
  if (current.ownerId !== metadata.ownerId) {
    throw new Error(`lifecycle lock owner 已变化，拒绝删除: ${lockPath}`);
  }
  await fs.unlink(lockPath);
};

export const withDirectoryLifecycleLock = async <T>(
  directory: string,
  operation: LifecycleOperation,
  callback: () => Promise<T>
): Promise<T> => {
  const resolved = path.resolve(directory);
  const lock = await acquireLock(resolved, operation);
  try {
    return await callback();
  } finally {
    await releaseLock(lock.lockPath, lock.metadata);
  }
};
