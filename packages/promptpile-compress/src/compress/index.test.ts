import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory } from './index';
import { STAGING_DIR } from '../restore/scanner';

const makeRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-compress-'));

const write = (root: string, name: string, content: string): void => {
  fs.writeFileSync(path.join(root, name), content);
};

const exists = (root: string, name: string): boolean =>
  fs.existsSync(path.join(root, name));

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

describe('compressDirectory', () => {
  it('compresses older non-system turns with the sliding-window strategy', async () => {
    const root = makeRoot();
    try {
      write(root, '[0]system.md', 'system prompt');
      write(root, '[1]user.md', 'first question');
      write(root, '[2]assistant.md', 'first answer');
      write(root, '[2]assistant.calls.jsonl', '{"name":"tool"}\n');
      write(root, '[2]assistant.result.jsonl', '{"ok":true}\n');
      write(root, '[3]user.md', 'second question');
      write(root, '[4]assistant.md', 'second answer');

      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 2,
      });

      assert.equal(result.compressed, true);
      assert.equal(result.turnsArchived, 2);
      assert.equal(result.turnsKept, 3);
      assert.equal(result.summaryIdx, 2);

      assert.equal(exists(root, '[0]system.md'), true);
      assert.equal(exists(root, '[1]user.md'), false);
      assert.equal(exists(root, '[2]assistant.md'), false);
      assert.equal(exists(root, '[2]assistant.calls.jsonl'), false);
      assert.equal(exists(root, '[2]system.md'), true);
      assert.equal(exists(root, '[2]system.md.archive'), true);
      assert.equal(exists(root, '[3]user.md'), true);
      assert.equal(exists(root, '[4]assistant.md'), true);

      const archive = path.join(root, '[2]system.md.archive');
      assert.equal(fs.existsSync(path.join(archive, '[1]user.md')), true);
      assert.equal(fs.existsSync(path.join(archive, '[2]assistant.calls.jsonl')), true);
      assert.equal(fs.existsSync(path.join(archive, '.summary.md')), true);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(archive, 'compression.json'), 'utf8')
      ) as {
        archivedTurnIndices: number[];
        liveTokenCountBefore: number;
        summaryTokenCount: number;
        liveTokenCountAfter: number;
        summaryKind: string;
        summaryProvider?: string;
        tokenizer: { id: string; model: string; kind: string };
        budget: { mode: string; tokensBefore: number; summaryTokens: number };
        summary?: string;
      };
      assert.deepEqual(manifest.archivedTurnIndices, [1, 2]);
      assert.equal(manifest.liveTokenCountBefore, result.tokensBefore);
      assert.equal(manifest.liveTokenCountAfter, result.tokensAfter);
      assert.ok(manifest.summaryTokenCount > 0);
      assert.ok(manifest.summaryTokenCount < manifest.liveTokenCountAfter);
      assert.equal(manifest.summaryKind, 'archive-pointer');
      assert.equal(manifest.summaryProvider, undefined);
      assert.deepEqual(manifest.tokenizer, {
        id: 'promptpile-unicode-heuristic-v1',
        model: 'model-agnostic',
        kind: 'heuristic-fallback',
      });
      assert.equal(manifest.budget.mode, 'legacy-threshold');
      assert.equal(manifest.budget.tokensBefore, result.tokensBefore);
      assert.equal(manifest.budget.summaryTokens, manifest.summaryTokenCount);
      assert.equal('summary' in manifest, false);
      const liveSummary = fs.readFileSync(path.join(root, '[2]system.md'), 'utf8');
      assert.match(liveSummary, /1-2/);
      assert.match(liveSummary, /Archive Protocol/);
      assert.doesNotMatch(liveSummary, /lookup_archive/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not modify files during dry-run', async () => {
    const root = makeRoot();
    try {
      write(root, '[1]user.md', 'question');
      write(root, '[2]assistant.md', 'answer');
      write(root, '[3]user.md', 'again');
      const before = snapshot(root);

      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
        dryRun: true,
      });

      assert.equal(result.compressed, false);
      assert.equal(result.skipReason, 'dry_run');
      assert.equal(result.turnsArchived, 2);
      assert.equal(result.summaryIdx, 2);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps system turns and skips when nothing is compressible', async () => {
    const root = makeRoot();
    try {
      write(root, '[0]system.md', 'system');
      write(root, '[5]system.md', 'previous summary');

      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 0,
      });

      assert.equal(result.compressed, false);
      assert.equal(result.skipReason, 'no_turns_to_compress');
      assert.equal(result.compressibleTokens, 0);
      assert.equal(exists(root, '[0]system.md'), true);
      assert.equal(exists(root, '[5]system.md'), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores existing archives before recompressing', async () => {
    const root = makeRoot();
    try {
      write(root, '[0]system.md', 'system');
      write(root, '[1]user.md', 'first');
      write(root, '[2]assistant.md', 'answer');
      write(root, '[3]user.md', 'second');

      const first = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });
      assert.equal(first.compressed, true);
      assert.equal(exists(root, '[2]system.md.archive'), true);

      write(root, '[4]assistant.md', 'new answer');

      const second = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });

      assert.equal(second.compressed, true);
      assert.equal(second.summaryIdx, 3);
      assert.equal(exists(root, '[2]system.md.archive'), false);
      assert.equal(exists(root, '[3]system.md.archive'), true);
      assert.equal(exists(root, '[4]assistant.md'), true);
      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(root, '[3]system.md.archive', 'compression.json'),
          'utf8'
        )
      ) as { archivedTurnIndices: number[] };
      assert.deepEqual(manifest.archivedTurnIndices, [1, 2, 3]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rolls back staging leftovers before compressing', async () => {
    const root = makeRoot();
    try {
      fs.mkdirSync(path.join(root, STAGING_DIR));
      write(root, path.join(STAGING_DIR, '[1]user.md'), 'staged user');
      write(root, '[2]assistant.md', 'answer');

      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 0,
      });

      assert.equal(result.compressed, true);
      assert.equal(exists(root, STAGING_DIR), false);
      assert.equal(exists(root, '[2]system.md.archive'), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('recovers an archive with a missing summary by restoring and recompressing', async () => {
    const root = makeRoot();
    try {
      const archive = path.join(root, '[2]system.md.archive');
      fs.mkdirSync(archive);
      fs.writeFileSync(path.join(archive, '[1]user.md'), 'question');
      fs.writeFileSync(path.join(archive, '[2]assistant.md'), 'answer');
      fs.writeFileSync(
        path.join(archive, 'compression.json'),
        JSON.stringify({ version: 1, archivedTurnIndices: [1, 2] })
      );
      write(root, '[3]user.md', 'latest');

      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });

      assert.equal(result.compressed, true);
      assert.equal(result.summaryIdx, 2);
      assert.equal(exists(root, '[2]system.md'), true);
      assert.equal(exists(root, '[2]system.md.archive'), true);
      assert.equal(exists(root, '[3]user.md'), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('dry-runs restore and recompress from an existing archive with real statistics', async () => {
    const root = makeRoot();
    try {
      write(root, '[0]system.md', 'system');
      write(root, '[1]user.md', 'first');
      write(root, '[2]assistant.md', 'answer');
      write(root, '[3]user.md', 'second');
      await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });
      write(root, '[4]assistant.md', 'new answer');
      const before = snapshot(root);

      const dryRun = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
        dryRun: true,
      });

      assert.equal(dryRun.compressed, false);
      assert.equal(dryRun.skipReason, 'dry_run');
      assert.equal(dryRun.dryRunPlan?.archivesToRestore, 1);
      assert.equal(dryRun.dryRunPlan?.outcome, 'compressed');
      assert.ok(dryRun.tokensBefore > 0);
      assert.ok(dryRun.turnsArchived > 0);
      assert.deepEqual(snapshot(root), before);

      const actual = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });
      assert.equal(actual.compressed, true);
      assert.equal(actual.turnsArchived, dryRun.turnsArchived);
      assert.equal(actual.turnsKept, dryRun.turnsKept);
      assert.equal(actual.tokensBefore, dryRun.tokensBefore);
      assert.equal(actual.tokensAfter, dryRun.tokensAfter);
      assert.equal(actual.summaryIdx, dryRun.summaryIdx);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('dry-runs staging recovery and compression without zero placeholders', async () => {
    const root = makeRoot();
    try {
      const staging = path.join(root, STAGING_DIR);
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, '[1]user.md'), 'staged user');
      fs.writeFileSync(path.join(staging, 'compression.json'), '{}');
      write(root, '[2]assistant.md', 'answer');
      write(root, '[3]user.md', 'latest');
      const before = snapshot(root);

      const dryRun = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
        dryRun: true,
      });

      assert.equal(dryRun.skipReason, 'dry_run');
      assert.equal(dryRun.dryRunPlan?.archivesToRestore, 0);
      assert.deepEqual(dryRun.dryRunPlan?.recoveryActions, ['[1]user.md']);
      assert.equal(dryRun.dryRunPlan?.outcome, 'compressed');
      assert.ok(dryRun.tokensBefore > 0);
      assert.ok(dryRun.turnsArchived > 0);
      assert.deepEqual(snapshot(root), before);

      const actual = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
      });
      assert.equal(actual.compressed, true);
      assert.equal(actual.turnsArchived, dryRun.turnsArchived);
      assert.equal(actual.tokensBefore, dryRun.tokensBefore);
      assert.equal(actual.tokensAfter, dryRun.tokensAfter);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
