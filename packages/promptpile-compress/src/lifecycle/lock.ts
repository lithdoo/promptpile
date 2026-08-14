import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Legacy fixed lock: recognized as a blocker but never automatically removed. */
export const LIFECYCLE_LOCK_FILE = '.promptpile-compress.lock';
export const LIFECYCLE_LOCK_PREFIX = `${LIFECYCLE_LOCK_FILE}.`;
const LIFECYCLE_LOCK_TEMP_PREFIX = '.promptpile-compress.lock-temp.';
const MAX_ACQUIRE_ATTEMPTS = 6;

export type LifecycleOperation = 'compress' | 'restore' | 'recover';

interface LifecycleLockMetadata {
  version: 1;
  ownerId: string;
  pid: number;
  hostname: string;
  operation: LifecycleOperation;
  createdAt: string;
}

export interface DirectoryLifecycleLock {
  name: string;
  lockPath: string;
  metadata: LifecycleLockMetadata;
  legacy: boolean;
}

export const isLifecycleLockFileName = (name: string): boolean =>
  name === LIFECYCLE_LOCK_FILE || name.startsWith(LIFECYCLE_LOCK_PREFIX);

const readLockMetadata = async (
  lockPath: string
): Promise<LifecycleLockMetadata | null> => {
  let content: string;
  try {
    content = await fs.readFile(lockPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
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
    record.ownerId.length === 0 ||
    !Number.isInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.hostname !== 'string' ||
    record.hostname.length === 0 ||
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

const isRecoverableStaleLock = (lock: DirectoryLifecycleLock): boolean =>
  !lock.legacy &&
  lock.metadata.hostname === os.hostname() &&
  !isLocalProcessAlive(lock.metadata.pid);

const syncDirectory = async (directory: string): Promise<void> => {
  if (process.platform === 'win32') return;
  const handle = await fs.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
};

const uniqueLockName = (metadata: LifecycleLockMetadata): string => {
  const host = Buffer.from(metadata.hostname, 'utf8').toString('base64url');
  return `${LIFECYCLE_LOCK_PREFIX}${host}.${metadata.pid}.${metadata.ownerId}`;
};

/** Publish only complete metadata: the temporary name is outside the lock glob. */
const publishLock = async (
  directory: string,
  operation: LifecycleOperation
): Promise<DirectoryLifecycleLock> => {
  const metadata: LifecycleLockMetadata = {
    version: 1,
    ownerId: randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    operation,
    createdAt: new Date().toISOString(),
  };
  const name = uniqueLockName(metadata);
  const lockPath = path.join(directory, name);
  const tempPath = path.join(
    directory,
    `${LIFECYCLE_LOCK_TEMP_PREFIX}${metadata.ownerId}`
  );

  let handle;
  let published = false;
  try {
    handle = await fs.open(tempPath, 'wx');
    await handle.writeFile(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.link(tempPath, lockPath);
    published = true;
    await fs.unlink(tempPath);
    await syncDirectory(directory);
    return { name, lockPath, metadata, legacy: false };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (published) {
      await fs.rm(lockPath, { force: true }).catch(() => undefined);
    }
    throw error;
  }
};

const scanLocks = async (directory: string): Promise<DirectoryLifecycleLock[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const locks: DirectoryLifecycleLock[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!isLifecycleLockFileName(entry.name)) continue;
    const lockPath = path.join(directory, entry.name);
    if (!entry.isFile()) {
      throw new Error(
        `lifecycle lock 不是普通文件，拒绝自动处理: ${lockPath}`
      );
    }
    const metadata = await readLockMetadata(lockPath);
    if (metadata === null) continue;
    const legacy = entry.name === LIFECYCLE_LOCK_FILE;
    if (!legacy && entry.name !== uniqueLockName(metadata)) {
      throw new Error(
        `lifecycle lock 文件名与 metadata 不一致，拒绝自动删除: ${lockPath}`
      );
    }
    locks.push({
      name: entry.name,
      lockPath,
      metadata,
      legacy,
    });
  }
  return locks;
};

const removeExactStaleLock = async (lock: DirectoryLifecycleLock): Promise<void> => {
  await fs.unlink(lock.lockPath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  });
};

/** Delete exact immutable stale paths, then decide only from a fresh scan. */
const findBlockersAfterCleanup = async (
  directory: string,
  own: DirectoryLifecycleLock
): Promise<DirectoryLifecycleLock[]> => {
  for (let pass = 0; pass < MAX_ACQUIRE_ATTEMPTS; pass += 1) {
    const locks = await scanLocks(directory);
    if (!locks.some((lock) => lock.lockPath === own.lockPath)) {
      throw new Error(`lifecycle lock owner 文件已消失: ${own.lockPath}`);
    }
    const stale = locks.filter(
      (lock) =>
        lock.lockPath !== own.lockPath && isRecoverableStaleLock(lock)
    );
    if (stale.length === 0) {
      return locks.filter((lock) => lock.lockPath !== own.lockPath);
    }
    await Promise.all(stale.map(removeExactStaleLock));
  }
  throw new Error('lifecycle stale lock cleanup 无法收敛，拒绝获取锁');
};

export const releaseDirectoryLifecycleLock = async (
  lock: DirectoryLifecycleLock
): Promise<void> => {
  const current = await readLockMetadata(lock.lockPath);
  if (current === null) return;
  if (current.ownerId !== lock.metadata.ownerId) {
    throw new Error(`lifecycle lock owner 已变化，拒绝删除: ${lock.lockPath}`);
  }
  await fs.unlink(lock.lockPath);
};

const waitForRetry = async (attempt: number): Promise<void> => {
  const delayMs = 5 + attempt * 5 + Math.floor(Math.random() * 20);
  await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
};

const acquireLock = async (
  directory: string,
  operation: LifecycleOperation
): Promise<DirectoryLifecycleLock> => {
  let lastBlocker: DirectoryLifecycleLock | undefined;
  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt += 1) {
    const own = await publishLock(directory, operation);
    try {
      const blockers = await findBlockersAfterCleanup(directory, own);
      if (blockers.length === 0) return own;
      lastBlocker = blockers[0];
    } catch (error) {
      await releaseDirectoryLifecycleLock(own).catch(() => undefined);
      throw error;
    }

    await releaseDirectoryLifecycleLock(own);
    if (attempt + 1 < MAX_ACQUIRE_ATTEMPTS) {
      await waitForRetry(attempt);
    }
  }

  if (lastBlocker) {
    throw new Error(
      `conversation lifecycle mutation 已被锁定: ${lastBlocker.lockPath} ` +
        `(operation=${lastBlocker.metadata.operation}, ` +
        `pid=${lastBlocker.metadata.pid}, ` +
        `host=${lastBlocker.metadata.hostname}, ` +
        `createdAt=${lastBlocker.metadata.createdAt})`
    );
  }
  throw new Error('无法获取 conversation lifecycle lock');
};

export const removeDirectoryLifecycleLockFiles = async (
  directory: string
): Promise<void> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  await Promise.all(
    entries
      .filter((entry) => entry.isFile() && isLifecycleLockFileName(entry.name))
      .map((entry) => fs.unlink(path.join(directory, entry.name)))
  );
};

export const acquireDirectoryLifecycleLock = async (
  directory: string,
  operation: LifecycleOperation
): Promise<DirectoryLifecycleLock> => acquireLock(await fs.realpath(directory), operation);

export const withDirectoryLifecycleLock = async <T>(
  directory: string,
  operation: LifecycleOperation,
  callback: () => Promise<T>
): Promise<T> => {
  const resolved = path.resolve(directory);
  const lock = await acquireDirectoryLifecycleLock(resolved, operation);
  try {
    return await callback();
  } finally {
    await releaseDirectoryLifecycleLock(lock);
  }
};
