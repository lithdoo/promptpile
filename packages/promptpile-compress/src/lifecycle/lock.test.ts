import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, type ChildProcess } from 'node:child_process';
import { describe, it } from 'node:test';
import {
  isLifecycleLockFileName,
  LIFECYCLE_LOCK_FILE,
  LIFECYCLE_LOCK_PREFIX,
  withDirectoryLifecycleLock,
} from './lock';

interface ChildMessage {
  type: 'entered' | 'completed' | 'error';
  pid: number;
  message?: string;
}

const makeRoot = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-lock-'));

const listLocks = (root: string): string[] =>
  fs.readdirSync(root).filter(isLifecycleLockFileName).sort();

const uniqueLockPath = (
  root: string,
  ownerId: string,
  pid = 2_147_483_647,
  hostname = os.hostname()
): string => {
  const host = Buffer.from(hostname, 'utf8').toString('base64url');
  return path.join(root, `${LIFECYCLE_LOCK_PREFIX}${host}.${pid}.${ownerId}`);
};

const writeLock = (
  lockPath: string,
  values: Partial<{
    ownerId: string;
    pid: number;
    hostname: string;
    operation: 'compress' | 'restore' | 'recover';
  }> = {}
): void => {
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      version: 1,
      ownerId: values.ownerId ?? 'test-owner',
      pid: values.pid ?? process.pid,
      hostname: values.hostname ?? os.hostname(),
      operation: values.operation ?? 'compress',
      createdAt: '2026-08-06T00:00:00.000Z',
    })
  );
};

const waitForMessage = (child: ChildProcess): Promise<ChildMessage> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`timed out waiting for child ${child.pid}`)),
      10_000
    );
    child.once('message', (message) => {
      clearTimeout(timeout);
      resolve(message as ChildMessage);
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });

describe('directory lifecycle lock', () => {
  it('allows one cooperating writer and rejects another', async () => {
    const root = makeRoot();
    let entered!: () => void;
    let release!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      const first = withDirectoryLifecycleLock(root, 'compress', async () => {
        entered();
        await releasePromise;
      });
      await enteredPromise;
      assert.equal(listLocks(root).length, 1);

      await assert.rejects(
        withDirectoryLifecycleLock(root, 'restore', async () => undefined),
        /lifecycle mutation 已被锁定/
      );

      release();
      await first;
      assert.deepEqual(listLocks(root), []);
    } finally {
      release();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not let a nested public operation bypass the lock', async () => {
    const root = makeRoot();
    try {
      const result = await withDirectoryLifecycleLock(root, 'compress', async () => {
        await assert.rejects(
          withDirectoryLifecycleLock(root, 'recover', async () => 'nested'),
          /lifecycle mutation 已被锁定/
        );
        return 'outer';
      });
      assert.equal(result, 'outer');
      assert.deepEqual(listLocks(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers an immutable unique lock owned by a dead local process', async () => {
    const root = makeRoot();
    const stalePath = uniqueLockPath(root, 'dead-owner');
    try {
      writeLock(stalePath, {
        ownerId: 'dead-owner',
        pid: 2_147_483_647,
      });

      const result = await withDirectoryLifecycleLock(
        root,
        'restore',
        async () => 'recovered'
      );
      assert.equal(result, 'recovered');
      assert.deepEqual(listLocks(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets exactly one process enter while both clean the same stale lock', async () => {
    const root = makeRoot();
    const stalePath = uniqueLockPath(root, 'contended-dead-owner');
    const helper = path.join(__dirname, 'lock-child.js');
    const children = [
      fork(helper, [root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }),
      fork(helper, [root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] }),
    ];
    try {
      writeLock(stalePath, {
        ownerId: 'contended-dead-owner',
        pid: 2_147_483_647,
      });
      const messages = children.map(waitForMessage);
      children.forEach((child) => child.send('start'));
      const firstMessages = await Promise.all(messages);
      assert.equal(
        firstMessages.filter(({ type }) => type === 'entered').length,
        1
      );
      assert.equal(
        firstMessages.filter(({ type }) => type === 'error').length,
        1
      );
      assert.match(
        firstMessages.find(({ type }) => type === 'error')?.message ?? '',
        /lifecycle mutation 已被锁定/
      );
      const activeLocks = listLocks(root);
      assert.equal(activeLocks.length, 1);
      assert.notEqual(activeLocks[0], path.basename(stalePath));

      const winnerIndex = firstMessages.findIndex(
        ({ type }) => type === 'entered'
      );
      const completed = waitForMessage(children[winnerIndex]);
      children[winnerIndex].send('release');
      assert.equal((await completed).type, 'completed');
      assert.deepEqual(listLocks(root), []);
    } finally {
      children.forEach((child) => {
        child.send('release');
        child.kill();
      });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps a legacy fixed lock as a fail-closed compatibility blocker', async () => {
    const root = makeRoot();
    const lockPath = path.join(root, LIFECYCLE_LOCK_FILE);
    try {
      writeLock(lockPath, {
        ownerId: 'legacy-dead-owner',
        pid: 2_147_483_647,
      });
      await assert.rejects(
        withDirectoryLifecycleLock(root, 'restore', async () => undefined),
        /lifecycle mutation 已被锁定/
      );
      assert.equal(fs.existsSync(lockPath), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('never automatically removes a lock owned by another host', async () => {
    const root = makeRoot();
    const hostname = 'remote-host.example';
    const lockPath = uniqueLockPath(
      root,
      'remote-owner',
      2_147_483_647,
      hostname
    );
    try {
      writeLock(lockPath, {
        ownerId: 'remote-owner',
        pid: 2_147_483_647,
        hostname,
      });
      await assert.rejects(
        withDirectoryLifecycleLock(root, 'restore', async () => undefined),
        /lifecycle mutation 已被锁定/
      );
      assert.equal(fs.existsSync(lockPath), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed for malformed lock metadata', async () => {
    const root = makeRoot();
    const lockPath = uniqueLockPath(root, 'broken-owner');
    try {
      fs.writeFileSync(lockPath, '{broken');
      await assert.rejects(
        withDirectoryLifecycleLock(root, 'compress', async () => undefined),
        /拒绝自动删除/
      );
      assert.equal(fs.existsSync(lockPath), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a unique filename does not match its metadata', async () => {
    const root = makeRoot();
    const lockPath = uniqueLockPath(root, 'filename-owner');
    try {
      writeLock(lockPath, {
        ownerId: 'different-owner',
        pid: 2_147_483_647,
      });
      await assert.rejects(
        withDirectoryLifecycleLock(root, 'compress', async () => undefined),
        /文件名与 metadata 不一致/
      );
      assert.equal(fs.existsSync(lockPath), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects non-positive lock PIDs without probing a process group', async () => {
    const root = makeRoot();
    const lockPath = uniqueLockPath(root, 'invalid-owner', -1);
    try {
      writeLock(lockPath, { ownerId: 'invalid-owner', pid: -1 });
      await assert.rejects(
        withDirectoryLifecycleLock(root, 'restore', async () => undefined),
        /metadata 无效/
      );
      assert.equal(fs.existsSync(lockPath), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
