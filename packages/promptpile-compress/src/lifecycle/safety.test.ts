import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory } from '../compress';
import { recover, restoreArchivedTurns } from '../restore';
import { STAGING_DIR } from '../restore/scanner';
import { LIFECYCLE_LOCK_FILE } from './lock';
import type {
  LifecycleMutationHook,
  LifecycleMutationPoint,
} from './mutation';

const makeRoot = (): string =>
  fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-safety-'));

const writeConversation = (root: string): void => {
  fs.writeFileSync(path.join(root, '[0]system.md'), 'system');
  fs.writeFileSync(path.join(root, '[1]user.md'), 'first question');
  fs.writeFileSync(path.join(root, '[2]assistant.md'), 'first answer');
  fs.writeFileSync(path.join(root, '[3]user.md'), 'latest question');
};

const failOnce = (
  point: LifecycleMutationPoint,
  phase: 'before' | 'after'
): LifecycleMutationHook => {
  let failed = false;
  return (event) => {
    if (!failed && event.point === point && event.phase === phase) {
      failed = true;
      throw new Error(`injected failure: ${point}:${phase}`);
    }
  };
};

const listFilesRecursively = (root: string): string[] => {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        files.push(absolute);
      }
    }
  };
  walk(root);
  return files;
};

describe('lifecycle mutation safety', () => {
  it('rejects a cooperating restore while compress holds the directory lock', async () => {
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
      writeConversation(root);
      const first = compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
        mutationHook: async (event) => {
          if (event.point === 'create_staging' && event.phase === 'before') {
            entered();
            await releasePromise;
          }
        },
      });
      await enteredPromise;

      await assert.rejects(
        restoreArchivedTurns({ directory: root }),
        /lifecycle mutation 已被锁定/
      );

      release();
      const result = await first;
      assert.equal(result.compressed, true);
      assert.equal(fs.existsSync(path.join(root, LIFECYCLE_LOCK_FILE)), false);
    } finally {
      release();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects commit when conversation content changes after planning', async () => {
    const root = makeRoot();
    try {
      writeConversation(root);
      await assert.rejects(
        compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
          mutationHook: (event) => {
            if (event.point === 'create_staging' && event.phase === 'before') {
              fs.writeFileSync(path.join(root, '[99]user.md'), 'concurrent write');
            }
          },
        }),
        /conversation 在 compression 规划期间发生变化/
      );

      assert.equal(fs.existsSync(path.join(root, STAGING_DIR)), false);
      assert.equal(fs.existsSync(path.join(root, '[1]user.md')), true);
      assert.equal(fs.existsSync(path.join(root, '[2]assistant.md')), true);
      assert.equal(fs.existsSync(path.join(root, '[99]user.md')), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  const compressFaults: Array<{
    point: LifecycleMutationPoint;
    phase: 'before' | 'after';
  }> = [
    { point: 'create_staging', phase: 'before' },
    { point: 'move_to_staging', phase: 'after' },
    { point: 'write_manifest', phase: 'before' },
    { point: 'write_staged_summary', phase: 'before' },
    { point: 'commit_archive', phase: 'after' },
    { point: 'write_live_summary', phase: 'after' },
  ];

  for (const fault of compressFaults) {
    it(`recovers compress after ${fault.point}:${fault.phase}`, async () => {
      const root = makeRoot();
      try {
        writeConversation(root);
        await assert.rejects(
          compressDirectory({
            directory: root,
            threshold: 0,
            keepRecent: 1,
            mutationHook: failOnce(fault.point, fault.phase),
          }),
          /injected failure/
        );

        assert.equal(
          listFilesRecursively(root).some((file) => file.includes('.tmp-')),
          false
        );

        const retry = await compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
        });
        assert.equal(retry.compressed, true);
        assert.equal(fs.existsSync(path.join(root, '[2]system.md.archive')), true);
        assert.equal(fs.existsSync(path.join(root, '[2]system.md')), true);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  const restoreFaults: Array<{
    point: LifecycleMutationPoint;
    phase: 'before' | 'after';
  }> = [
    { point: 'delete_live_summary', phase: 'after' },
    { point: 'restore_message', phase: 'after' },
    { point: 'remove_archive', phase: 'before' },
  ];

  for (const fault of restoreFaults) {
    it(`retries restore after ${fault.point}:${fault.phase}`, async () => {
      const root = makeRoot();
      try {
        writeConversation(root);
        await compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
        });

        await assert.rejects(
          restoreArchivedTurns({
            directory: root,
            mutationHook: failOnce(fault.point, fault.phase),
          }),
          /injected failure/
        );

        const retry = await restoreArchivedTurns({ directory: root });
        assert.equal(retry.restored, true);
        assert.equal(fs.existsSync(path.join(root, '[1]user.md')), true);
        assert.equal(fs.existsSync(path.join(root, '[2]assistant.md')), true);
        assert.equal(fs.existsSync(path.join(root, '[2]system.md.archive')), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  const recoveryFaults: Array<{
    point: LifecycleMutationPoint;
    phase: 'before' | 'after';
  }> = [
    { point: 'rollback_staging_file', phase: 'after' },
    { point: 'remove_staging', phase: 'before' },
  ];

  for (const fault of recoveryFaults) {
    it(`retries staging recovery after ${fault.point}:${fault.phase}`, async () => {
      const root = makeRoot();
      const staging = path.join(root, STAGING_DIR);
      try {
        fs.mkdirSync(staging);
        fs.writeFileSync(path.join(staging, '[1]user.md'), 'question');
        fs.writeFileSync(path.join(staging, '[2]assistant.md'), 'answer');
        fs.writeFileSync(path.join(staging, 'compression.json'), '{}');

        await assert.rejects(
          recover(root, {
            mutationHook: failOnce(fault.point, fault.phase),
          }),
          /injected failure/
        );

        const retry = await recover(root);
        assert.ok(retry.length > 0);
        assert.equal(fs.existsSync(path.join(root, '[1]user.md')), true);
        assert.equal(fs.existsSync(path.join(root, '[2]assistant.md')), true);
        assert.equal(fs.existsSync(staging), false);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
