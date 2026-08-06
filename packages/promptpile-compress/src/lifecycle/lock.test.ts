import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  LIFECYCLE_LOCK_FILE,
  withDirectoryLifecycleLock,
} from './lock';

const makeRoot = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-lock-'));

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

      await assert.rejects(
        withDirectoryLifecycleLock(root, 'restore', async () => undefined),
        /lifecycle mutation 已被锁定/
      );

      release();
      await first;
      assert.equal(fs.existsSync(path.join(root, LIFECYCLE_LOCK_FILE)), false);
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
      assert.equal(fs.existsSync(path.join(root, LIFECYCLE_LOCK_FILE)), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers a valid lock owned by a dead process on this host', async () => {
    const root = makeRoot();
    const lockPath = path.join(root, LIFECYCLE_LOCK_FILE);
    try {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          version: 1,
          ownerId: 'dead-owner',
          pid: 2_147_483_647,
          hostname: os.hostname(),
          operation: 'compress',
          createdAt: '2026-08-06T00:00:00.000Z',
        })
      );

      const result = await withDirectoryLifecycleLock(
        root,
        'restore',
        async () => 'recovered'
      );
      assert.equal(result, 'recovered');
      assert.equal(fs.existsSync(lockPath), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed for malformed lock metadata', async () => {
    const root = makeRoot();
    const lockPath = path.join(root, LIFECYCLE_LOCK_FILE);
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

  it('rejects non-positive lock PIDs without probing a process group', async () => {
    const root = makeRoot();
    const lockPath = path.join(root, LIFECYCLE_LOCK_FILE);
    try {
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          version: 1,
          ownerId: 'invalid-owner',
          pid: -1,
          hostname: os.hostname(),
          operation: 'compress',
          createdAt: '2026-08-06T00:00:00.000Z',
        })
      );
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
