import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory } from '../compress';
import { restoreArchivedTurns } from '../restore';

interface ActorExpectation {
  valid: boolean;
  error?: string;
  archiveCount?: number;
  turnCount?: number;
}

interface FixtureCase {
  name: string;
  consumer: ActorExpectation;
  restore: ActorExpectation;
}

interface DiscoveredArchive {
  idx: number;
  archivedTurnIndices: number[];
}

const ARCHIVE_PATTERN = /^\[(\d+)\]system\.md\.archive$/i;
const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../../../../fixtures/archive-protocol-v1'
);

const fixtureCases = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, 'cases.json'), 'utf8')
) as FixtureCase[];

const snapshot = (root: string): string[] => {
  const walk = (directory: string, prefix = ''): string[] => {
    const entries: string[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        entries.push(`${relative}/`);
        entries.push(...walk(absolute, relative));
      } else {
        entries.push(`${relative}:${fs.readFileSync(absolute, 'utf8')}`);
      }
    }
    return entries;
  };
  return walk(root).sort();
};

const discoverAsReadOnlyConsumer = (
  conversationDirectory: string
): DiscoveredArchive[] => {
  const archives: DiscoveredArchive[] = [];
  for (const entry of fs.readdirSync(conversationDirectory, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const match = entry.name.match(ARCHIVE_PATTERN);
    if (!match) {
      continue;
    }

    const archiveIdx = Number.parseInt(match[1], 10);
    const manifestPath = path.join(
      conversationDirectory,
      entry.name,
      'compression.json'
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      throw new Error(
        `invalid compression.json: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('compression.json must be an object');
    }

    const manifest = parsed as Record<string, unknown>;
    if (manifest.version !== 1) {
      throw new Error(`unsupported version: ${String(manifest.version)}`);
    }
    if (
      !Array.isArray(manifest.archivedTurnIndices) ||
      manifest.archivedTurnIndices.length === 0 ||
      !manifest.archivedTurnIndices.every(
        (value) => Number.isInteger(value) && (value as number) >= 0
      ) ||
      new Set(manifest.archivedTurnIndices).size !==
        manifest.archivedTurnIndices.length
    ) {
      throw new Error(
        'archivedTurnIndices must contain unique non-negative integers'
      );
    }

    const archivedTurnIndices = manifest.archivedTurnIndices as number[];
    if (Math.max(...archivedTurnIndices) !== archiveIdx) {
      throw new Error('archive directory index does not match manifest');
    }
    archives.push({ idx: archiveIdx, archivedTurnIndices });
  }
  return archives.sort((a, b) => b.idx - a.idx);
};

describe('Archive Protocol v1 conformance corpus', () => {
  describe('read-only consumer behavior', () => {
    for (const fixture of fixtureCases) {
      it(fixture.name, () => {
        const directory = path.join(FIXTURE_ROOT, fixture.name);
        const before = snapshot(directory);

        if (fixture.consumer.valid) {
          const archives = discoverAsReadOnlyConsumer(directory);
          assert.equal(archives.length, fixture.consumer.archiveCount);
        } else {
          assert.throws(
            () => discoverAsReadOnlyConsumer(directory),
            new RegExp(fixture.consumer.error ?? '')
          );
        }

        assert.deepEqual(snapshot(directory), before);
      });
    }
  });

  describe('restore preflight behavior', () => {
    for (const fixture of fixtureCases) {
      it(fixture.name, async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-contract-'));
        try {
          fs.cpSync(path.join(FIXTURE_ROOT, fixture.name), root, {
            recursive: true,
          });
          const before = snapshot(root);

          if (fixture.restore.valid) {
            const result = await restoreArchivedTurns({
              directory: root,
              dryRun: true,
            });
            assert.equal(result.restored, false);
            assert.equal(result.skipReason, 'dry_run');
            assert.equal(result.turnsRestored, fixture.restore.turnCount);
          } else {
            await assert.rejects(
              restoreArchivedTurns({ directory: root, dryRun: true }),
              new RegExp(fixture.restore.error ?? '')
            );
          }

          assert.deepEqual(snapshot(root), before);
        } finally {
          fs.rmSync(root, { recursive: true, force: true });
        }
      });
    }
  });

  it('accepts a newly produced archive without private parser imports', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-producer-'));
    try {
      fs.writeFileSync(path.join(root, '[0]system.md'), 'system');
      fs.writeFileSync(path.join(root, '[1]user.md'), 'question');
      fs.writeFileSync(path.join(root, '[2]assistant.md'), 'answer');
      fs.writeFileSync(path.join(root, '[3]user.md'), 'latest');

      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });
      assert.equal(result.compressed, true);

      const archives = discoverAsReadOnlyConsumer(root);
      assert.deepEqual(archives, [
        { idx: 2, archivedTurnIndices: [1, 2] },
      ]);

      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(root, '[2]system.md.archive', 'compression.json'),
          'utf8'
        )
      ) as Record<string, unknown>;
      assert.equal(manifest.liveTokenCountBefore, result.tokensBefore);
      assert.equal(manifest.liveTokenCountAfter, result.tokensAfter);
      assert.equal(typeof manifest.summaryTokenCount, 'number');
      assert.equal('originalTokenCount' in manifest, false);
      assert.equal('compressedTokenCount' in manifest, false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
