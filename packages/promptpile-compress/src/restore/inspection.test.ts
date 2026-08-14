import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  inspectCompressionLifecycleState,
  resolveCompressionExecution,
} from '../compress/live-state';
import { inspectArchiveSet, inspectStagingState } from './inspection';
import { STAGING_DIR } from './scanner';

const makeRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-inspect-'));

const writeArchive = (
  root: string,
  options: { summary?: boolean; message?: boolean } = {}
): string => {
  const archive = path.join(root, '[1]system.md.archive');
  fs.mkdirSync(archive);
  fs.writeFileSync(
    path.join(archive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: [1] })
  );
  if (options.message !== false) fs.writeFileSync(path.join(archive, '[1]user.md'), 'q');
  if (options.summary !== false) fs.writeFileSync(path.join(root, '[1]system.md'), 'summary');
  return archive;
};

describe('authoritative lifecycle inspection', () => {
  it('rejects a non-directory reserved staging path', async () => {
    const root = makeRoot();
    try {
      fs.writeFileSync(path.join(root, STAGING_DIR), 'not a directory');
      assert.deepEqual(await inspectStagingState(root), {
        state: 'invalid',
        reason: 'staging_path_invalid',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not follow staging or archive-shaped symlinks', async (t) => {
    const root = makeRoot();
    try {
      const target = path.join(root, 'target');
      fs.mkdirSync(target);
      try {
        fs.symlinkSync(target, path.join(root, STAGING_DIR), 'junction');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') {
          t.skip('symlink creation is not permitted on this host');
          return;
        }
        throw error;
      }
      assert.deepEqual(await inspectStagingState(root), {
        state: 'invalid',
        reason: 'staging_path_invalid',
      });
      fs.rmSync(path.join(root, STAGING_DIR));
      fs.symlinkSync(target, path.join(root, '[1]system.md.archive'), 'junction');
      assert.deepEqual(await inspectArchiveSet(root), {
        state: 'invalid',
        reason: 'archive_path_invalid',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a staging rollback target conflict', async () => {
    const root = makeRoot();
    try {
      const staging = path.join(root, STAGING_DIR);
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, '[1]user.md'), 'staged');
      fs.writeFileSync(path.join(root, '[1]user.md'), 'live');
      assert.deepEqual(await inspectStagingState(root), {
        state: 'invalid',
        reason: 'staging_target_conflict',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects archive-shaped non-directories and non-regular summaries', async () => {
    const root = makeRoot();
    try {
      fs.writeFileSync(path.join(root, '[1]system.md.archive'), 'not an archive');
      assert.deepEqual(await inspectArchiveSet(root), {
        state: 'invalid',
        reason: 'archive_path_invalid',
      });
      fs.rmSync(path.join(root, '[1]system.md.archive'));
      writeArchive(root, { summary: false });
      fs.mkdirSync(path.join(root, '[1]system.md'));
      assert.deepEqual(await inspectArchiveSet(root), {
        state: 'invalid',
        reason: 'archive_summary_path_invalid',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('classifies missing summaries as archive recovery without scanning live state', async () => {
    const root = makeRoot();
    try {
      writeArchive(root, { summary: false });
      const state = await inspectCompressionLifecycleState(
        root,
        resolveCompressionExecution({ directory: root, threshold: 100 })
      );
      assert.equal(state.state, 'recovery_required');
      if (state.state === 'recovery_required') {
        assert.equal(state.reason, 'archive_recovery');
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('classifies a complete archive and matching regular summary as healthy compacted', async () => {
    const root = makeRoot();
    try {
      writeArchive(root);
      const state = await inspectCompressionLifecycleState(
        root,
        resolveCompressionExecution({ directory: root, threshold: 100 })
      );
      assert.equal(state.state, 'healthy_compacted');
      if (state.state === 'healthy_compacted') assert.equal(state.archives.length, 1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed on staging/archive and restore-target conflicts', async () => {
    const root = makeRoot();
    try {
      fs.mkdirSync(path.join(root, STAGING_DIR));
      writeArchive(root);
      let state = await inspectCompressionLifecycleState(
        root,
        resolveCompressionExecution({ directory: root, threshold: 100 })
      );
      assert.deepEqual(state, { state: 'invalid', reason: 'staging_archive_conflict' });

      fs.rmSync(path.join(root, STAGING_DIR), { recursive: true });
      fs.writeFileSync(path.join(root, '[1]user.md'), 'conflict');
      state = await inspectCompressionLifecycleState(
        root,
        resolveCompressionExecution({ directory: root, threshold: 100 })
      );
      assert.deepEqual(state, { state: 'invalid', reason: 'archive_target_conflict' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
