import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { recover, restoreArchivedTurns } from './index';
import { STAGING_DIR } from './scanner';

interface ArchiveFixture {
  summaryIdx: number;
  indices: number[];
  files: Record<string, string>;
  summary?: boolean;
}

const makeRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-restore-'));

const writeArchive = (root: string, fixture: ArchiveFixture): string => {
  const archivePath = path.join(root, `[${fixture.summaryIdx}]system.md.archive`);
  fs.mkdirSync(archivePath);
  for (const [name, content] of Object.entries(fixture.files)) {
    fs.writeFileSync(path.join(archivePath, name), content);
  }
  fs.writeFileSync(
    path.join(archivePath, 'compression.json'),
    JSON.stringify({
      version: 1,
      archivedTurnIndices: fixture.indices,
      summary: 'ignored by restore',
    })
  );
  if (fixture.summary !== false) {
    fs.writeFileSync(path.join(root, `[${fixture.summaryIdx}]system.md`), 'summary');
  }
  return archivePath;
};

const snapshot = (root: string): string[] => {
  const walk = (dir: string, prefix = ''): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(`${relative}/`);
        out.push(...walk(absolute, relative));
      } else {
        out.push(`${relative}:${fs.readFileSync(absolute, 'utf8')}`);
      }
    }
    return out;
  };
  return walk(root).sort();
};

describe('restoreArchivedTurns', () => {
  it('returns a no-op for an uncompressed directory', async () => {
    const root = makeRoot();
    try {
      const result = await restoreArchivedTurns({ directory: root });
      assert.deepEqual(result, {
        restored: false,
        skipReason: 'no_archive_found',
        recoveryActions: [],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores multiple archives from newest to oldest and removes summaries', async () => {
    const root = makeRoot();
    try {
      fs.writeFileSync(path.join(root, '[0]system.md'), 'system');
      writeArchive(root, {
        summaryIdx: 3,
        indices: [1, 2, 3],
        files: {
          '[1]user.md': 'first user',
          '[2]assistant.md': 'first answer',
          '[3]user.md': 'second user',
        },
      });
      writeArchive(root, {
        summaryIdx: 5,
        indices: [4, 5],
        files: {
          '[4]assistant.md': 'second answer',
          '[5]user.md': 'third user',
        },
      });

      const result = await restoreArchivedTurns({ directory: root });
      assert.equal(result.restored, true);
      if (!result.restored) return;
      assert.equal(result.turnsRestored, 5);
      assert.equal(result.archivesRestored, 2);
      assert.deepEqual(result.summaryIndices, [5, 3]);

      for (const name of [
        '[1]user.md',
        '[2]assistant.md',
        '[3]user.md',
        '[4]assistant.md',
        '[5]user.md',
      ]) {
        assert.equal(fs.existsSync(path.join(root, name)), true);
      }
      assert.equal(fs.existsSync(path.join(root, '[3]system.md')), false);
      assert.equal(fs.existsSync(path.join(root, '[5]system.md')), false);
      assert.equal(fs.existsSync(path.join(root, '[3]system.md.archive')), false);
      assert.equal(fs.existsSync(path.join(root, '[5]system.md.archive')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('deletes every summary before moving the first archived message', async () => {
    const root = makeRoot();
    const originalRename = fsPromises.rename;
    try {
      writeArchive(root, {
        summaryIdx: 2,
        indices: [1, 2],
        files: {
          '[1]user.md': 'first user',
          '[2]assistant.md': 'first answer',
        },
      });
      writeArchive(root, {
        summaryIdx: 4,
        indices: [3, 4],
        files: {
          '[3]user.md': 'second user',
          '[4]assistant.md': 'second answer',
        },
      });

      let checked = false;
      const archiveMoveOrder: string[] = [];
      fsPromises.rename = async (...args: Parameters<typeof fsPromises.rename>) => {
        if (!checked) {
          checked = true;
          assert.equal(fs.existsSync(path.join(root, '[2]system.md')), false);
          assert.equal(fs.existsSync(path.join(root, '[4]system.md')), false);
        }
        archiveMoveOrder.push(path.basename(path.dirname(String(args[0]))));
        return originalRename(...args);
      };

      const result = await restoreArchivedTurns({ directory: root });
      assert.equal(result.restored, true);
      assert.equal(checked, true);
      assert.deepEqual(archiveMoveOrder, [
        '[4]system.md.archive',
        '[4]system.md.archive',
        '[2]system.md.archive',
        '[2]system.md.archive',
      ]);
    } finally {
      fsPromises.rename = originalRename;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('performs a read-only dry run', async () => {
    const root = makeRoot();
    try {
      writeArchive(root, {
        summaryIdx: 2,
        indices: [1, 2],
        files: {
          '[1]user.md': 'question',
          '[2]assistant.md': 'answer',
        },
      });
      const before = snapshot(root);
      const result = await restoreArchivedTurns({ directory: root, dryRun: true });
      assert.equal(result.restored, false);
      assert.equal(result.skipReason, 'dry_run');
      assert.equal(result.turnsRestored, 2);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects target conflicts before deleting any summary', async () => {
    const root = makeRoot();
    try {
      writeArchive(root, {
        summaryIdx: 2,
        indices: [1, 2],
        files: {
          '[1]user.md': 'archived',
          '[2]assistant.md': 'answer',
        },
      });
      fs.writeFileSync(path.join(root, '[1]user.md'), 'new data');
      const before = snapshot(root);

      await assert.rejects(
        restoreArchivedTurns({ directory: root }),
        /目标文件已存在/
      );
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate indices across archives before changing files', async () => {
    const root = makeRoot();
    try {
      writeArchive(root, {
        summaryIdx: 3,
        indices: [1, 3],
        files: { '[1]user.md': 'one', '[3]assistant.md': 'three' },
      });
      writeArchive(root, {
        summaryIdx: 4,
        indices: [3, 4],
        files: { '[4]user.md': 'four' },
      });
      const before = snapshot(root);

      await assert.rejects(
        restoreArchivedTurns({ directory: root }),
        /重复 idx/
      );
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects damaged compression metadata before changing files', async () => {
    const root = makeRoot();
    try {
      const archive = writeArchive(root, {
        summaryIdx: 2,
        indices: [1, 2],
        files: {
          '[1]user.md': 'question',
          '[2]assistant.md': 'answer',
        },
      });
      fs.writeFileSync(path.join(archive, 'compression.json'), '{broken');
      const before = snapshot(root);

      await assert.rejects(
        restoreArchivedTurns({ directory: root }),
        /无法读取 compression\.json/
      );
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('continues a partially completed restore without recreating summaries', async () => {
    const root = makeRoot();
    try {
      const archive = writeArchive(root, {
        summaryIdx: 2,
        indices: [1, 2],
        files: {
          '[1]user.md': 'question',
          '[2]assistant.md': 'answer',
        },
        summary: false,
      });
      fs.renameSync(path.join(archive, '[1]user.md'), path.join(root, '[1]user.md'));

      const result = await restoreArchivedTurns({ directory: root });
      assert.equal(result.restored, true);
      assert.equal(fs.readFileSync(path.join(root, '[1]user.md'), 'utf8'), 'question');
      assert.equal(fs.readFileSync(path.join(root, '[2]assistant.md'), 'utf8'), 'answer');
      assert.equal(fs.existsSync(archive), false);
      assert.equal(fs.existsSync(path.join(root, '[2]system.md')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('cleans an empty archive left after message movement', async () => {
    const root = makeRoot();
    try {
      const archive = writeArchive(root, {
        summaryIdx: 2,
        indices: [1, 2],
        files: {},
        summary: false,
      });
      fs.writeFileSync(path.join(root, '[1]user.md'), 'question');
      fs.writeFileSync(path.join(root, '[2]assistant.md'), 'answer');

      const result = await restoreArchivedTurns({ directory: root });
      assert.equal(result.restored, true);
      assert.equal(fs.existsSync(archive), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('recover', () => {
  it('rolls staging message files back and removes metadata', async () => {
    const root = makeRoot();
    try {
      const staging = path.join(root, STAGING_DIR);
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, '[1]user.md'), 'question');
      fs.writeFileSync(path.join(staging, 'compression.json'), '{}');

      const actions = await recover(root);
      assert.deepEqual(actions, [
        { kind: 'rollback_staging', detail: '[1]user.md' },
      ]);
      assert.equal(fs.readFileSync(path.join(root, '[1]user.md'), 'utf8'), 'question');
      assert.equal(fs.existsSync(staging), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not modify staging during dry run', async () => {
    const root = makeRoot();
    try {
      const staging = path.join(root, STAGING_DIR);
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, '[1]user.md'), 'question');
      const before = snapshot(root);

      const actions = await recover(root, { dryRun: true });
      assert.equal(actions.length, 1);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an empty staging cleanup during dry run', async () => {
    const root = makeRoot();
    try {
      const staging = path.join(root, STAGING_DIR);
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, 'compression.json'), '{}');
      const before = snapshot(root);

      const result = await restoreArchivedTurns({ directory: root, dryRun: true });
      assert.equal(result.restored, false);
      assert.equal(result.skipReason, 'dry_run');
      assert.equal(result.recoveryActions.length, 1);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous staging plus archive state', async () => {
    const root = makeRoot();
    try {
      fs.mkdirSync(path.join(root, STAGING_DIR));
      writeArchive(root, {
        summaryIdx: 1,
        indices: [1],
        files: { '[1]user.md': 'question' },
      });
      await assert.rejects(recover(root), /状态有歧义/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
