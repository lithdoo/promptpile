import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory, runCompressionBeforeCompletion } from '../compress';
import { isLifecycleLockFileName, LIFECYCLE_LOCK_FILE } from './lock';
import { STAGING_DIR } from '../restore/scanner';

const makeConversation = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-orchestrator-'));
  fs.writeFileSync(path.join(root, '[1]user.md'), 'question');
  return root;
};

const hasLifecycleLock = (root: string): boolean =>
  fs.readdirSync(root).some(isLifecycleLockFileName);

const replaceLockOwner = (root: string): void => {
  const lockName = fs.readdirSync(root).find(isLifecycleLockFileName);
  assert.ok(lockName);
  const lockPath = path.join(root, lockName);
  const metadata = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  fs.writeFileSync(lockPath, JSON.stringify({ ...metadata, ownerId: 'changed-owner' }));
};

const snapshotTree = (root: string): string[] => {
  const walk = (directory: string, prefix = ''): string[] =>
    fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? [`${relative}/`, ...walk(absolute, relative)]
        : [`${relative}:${fs.readFileSync(absolute).toString('base64')}`];
    });
  return walk(root).sort();
};

const semanticDocument = (sourceTurnIndex: number) => ({
  version: 1,
  goal: [{ text: 'Retain the active goal.', sourceTurnIndices: [sourceTurnIndex] }],
  stableFacts: [],
  constraints: [],
  decisions: [],
  importantToolFindings: [],
  completedWork: [],
  unresolvedWork: [],
  failedApproaches: [],
  nextActions: [],
});

describe('compression orchestrator v2 boundary', () => {
  it('reports request-preparation failure with no lifecycle phases', async () => {
    const missing = path.join(os.tmpdir(), `ppc-missing-${process.pid}-${Date.now()}`);
    const result = await runCompressionBeforeCompletion({
      compression: { directory: missing, threshold: 0 },
      completion: async () => 'unreachable',
    });
    assert.equal(result.ok, false);
    assert.equal(result.report.version, 2);
    assert.equal(result.report.error?.code, 'IO_ERROR');
    assert.deepEqual(result.report.phases, []);
    assert.equal(result.report.decision, undefined);
    assert.equal(result.report.selection, undefined);
    assert.equal(result.report.archivesRestored, 0);
    assert.deepEqual(result.report.commit, { state: 'not_started' });
  });

  it('validates all options before starting a lifecycle phase', async () => {
    const root = makeConversation();
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000, keepRecent: -1 },
        completion: async () => 'unreachable',
      });
      assert.equal(result.ok, false);
      assert.equal(result.report.error?.code, 'INVALID_OPTIONS');
      assert.deepEqual(result.report.phases, []);
      assert.equal(hasLifecycleLock(root), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('records the complete skipped phase matrix when lock acquisition fails', async () => {
    const root = makeConversation();
    fs.writeFileSync(
      path.join(root, LIFECYCLE_LOCK_FILE),
      JSON.stringify({
        version: 1,
        ownerId: 'legacy-owner',
        pid: process.pid,
        hostname: os.hostname(),
        operation: 'compress',
        createdAt: new Date().toISOString(),
      })
    );
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => 'unreachable',
      });
      assert.equal(result.ok, false);
      assert.equal(result.report.error?.code, 'LIFECYCLE_LOCKED');
      assert.deepEqual(
        result.report.phases.map(({ phase, status }) => ({ phase, status })),
        [
          { phase: 'acquire_exclusive', status: 'failed' },
          { phase: 'maintain_context', status: 'skipped' },
          { phase: 'release_exclusive', status: 'skipped' },
          { phase: 'completion', status: 'skipped' },
        ]
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the lock-held live gate, releases before completion, and omits report selection', async () => {
    const root = makeConversation();
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => {
          assert.equal(hasLifecycleLock(root), false);
          return 'completed';
        },
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.report.phases.map(({ phase }) => phase), [
        'acquire_exclusive',
        'maintain_context',
        'release_exclusive',
        'completion',
      ]);
      assert.equal(result.report.decision?.action, 'skip');
      assert.equal(result.report.decision?.action, 'skip');
      if (result.report.decision?.action === 'skip') {
        assert.equal(result.report.decision.reason, 'below_threshold');
      }
      assert.equal(result.report.selection, undefined);
      assert.equal('plan' in result.report, false);
      assert.deepEqual(result.report.commit, { state: 'skipped' });
      assert.deepEqual(result.compression.selection.keptTurnIndices, [1]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves empty no-turns semantics even when triggerTokens is zero', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-empty-'));
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 0 },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.compression.skipReason, 'no_turns_to_compress');
      assert.equal(result.report.decision?.action, 'skip');
      assert.equal(result.report.decision?.triggerReached, true);
      assert.equal(result.report.selection, undefined);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('serializes the next lifecycle until active completion finishes', async () => {
    const root = makeConversation();
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const started = new Promise<void>((resolve) => (firstStarted = resolve));
    const gate = new Promise<void>((resolve) => (releaseFirst = resolve));
    let secondStarted = false;
    try {
      const first = runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => {
          firstStarted();
          await gate;
          return 1;
        },
      });
      await started;
      const second = runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => {
          secondStarted = true;
          return 2;
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(secondStarted, false);
      releaseFirst();
      const results = await Promise.all([first, second]);
      assert.ok(results.every((result) => result.ok));
    } finally {
      releaseFirst?.();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes recoverable staging exactly once before taking a fresh decision', async () => {
    const root = makeConversation();
    const staging = path.join(root, STAGING_DIR);
    fs.mkdirSync(staging);
    fs.renameSync(path.join(root, '[1]user.md'), path.join(staging, '[1]user.md'));
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.deepEqual(result.report.recoveryActions, ['[1]user.md']);
      assert.equal(result.report.decision?.action, 'skip');
      if (result.report.decision?.action === 'skip') {
        assert.equal(result.report.decision.reason, 'below_threshold');
      }
      assert.equal(fs.existsSync(staging), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes a missing-summary archive once and lets the recovered live state decide', async () => {
    const root = makeConversation();
    try {
      await compressDirectory({ directory: root, threshold: 0, keepRecent: 0 });
      fs.rmSync(path.join(root, '[1]system.md'));
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.report.archivesRestored, 1);
      assert.equal(result.compression.archivesRestored, 1);
      assert.equal(result.report.decision?.liveState, 'healthy_plain');
      assert.equal(result.report.decision?.action, 'skip');
      assert.equal(result.compression.skipReason, 'below_threshold');
      assert.equal(fs.existsSync(path.join(root, '[1]system.md.archive')), false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not restore, call a provider, or mutate a healthy compact state below trigger', async () => {
    const root = makeConversation();
    let providerCalls = 0;
    try {
      await compressDirectory({ directory: root, threshold: 0, keepRecent: 0 });
      const before = snapshotTree(root);
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 10_000,
          summary: {
            kind: 'semantic',
            provider: {
              id: 'must-not-run',
              summarize: async () => {
                providerCalls += 1;
                return semanticDocument(1);
              },
            },
          },
        },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      assert.equal(providerCalls, 0);
      assert.equal(result.report.archivesRestored, 0);
      assert.equal(result.report.decision?.liveState, 'healthy_compacted');
      assert.deepEqual(snapshotTree(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('restores original turns after crossing the live trigger and excludes the previous summary', async () => {
    const root = makeConversation();
    fs.writeFileSync(path.join(root, '[2]assistant.md'), 'original answer');
    let providerCalls = 0;
    let providerInput = '';
    try {
      await compressDirectory({ directory: root, threshold: 0, keepRecent: 0 });
      fs.writeFileSync(path.join(root, '[3]user.md'), 'new question');
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 0,
          keepRecent: 1,
          summary: {
            kind: 'semantic',
            provider: {
              id: 'fresh-source',
              summarize: async (request) => {
                providerCalls += 1;
                providerInput = request.turns
                  .flatMap((turn) => turn.artifacts.map((artifact) => artifact.content))
                  .join('\n');
                return semanticDocument(request.turns[0].idx);
              },
            },
          },
        },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(providerCalls, 1);
      assert.match(providerInput, /question|original answer/);
      assert.doesNotMatch(providerInput, /Archived Promptpile turns/);
      assert.equal(result.report.decision?.action, 'restore_then_evaluate');
      assert.equal(result.report.archivesRestored, 1);
      assert.equal(result.compression.archivesRestored, 1);
      assert.ok(result.report.selection);
      assert.equal(result.report.commit.state, 'committed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('may restore on the live trigger and then legitimately skip from the original source', async () => {
    const root = makeConversation();
    try {
      await compressDirectory({ directory: root, threshold: 0, keepRecent: 0 });
      fs.writeFileSync(path.join(root, '[1]system.md'), 'very large summary '.repeat(100));
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 100, keepRecent: 0 },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.report.decision?.action, 'restore_then_evaluate');
      assert.equal(result.compression.skipReason, 'below_threshold');
      assert.equal(result.report.commit.state, 'skipped');
      assert.ok(result.report.selection);
      assert.equal(fs.existsSync(path.join(root, '[1]system.md.archive')), false);
      assert.equal(fs.existsSync(path.join(root, '[1]user.md')), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('may restore on the live trigger and produce an original-source no-turns skip', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-empty-archive-'));
    const archive = path.join(root, '[1]system.md.archive');
    fs.mkdirSync(archive);
    fs.writeFileSync(
      path.join(archive, 'compression.json'),
      JSON.stringify({ version: 1, archivedTurnIndices: [1] })
    );
    fs.writeFileSync(path.join(root, '[1]system.md'), 'large summary '.repeat(100));
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10 },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.report.decision?.action, 'restore_then_evaluate');
      assert.equal(result.compression.skipReason, 'no_turns_to_compress');
      assert.equal(result.report.commit.state, 'skipped');
      assert.deepEqual(result.report.selection, {
        archivedTurnIndices: [],
        keptTurnIndices: [],
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports an incomplete fresh commit when archive publication happened', async () => {
    const root = makeConversation();
    try {
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 0,
          keepRecent: 0,
          mutationHook: ({ point, phase }) => {
            if (point === 'commit_archive' && phase === 'after') {
              throw new Error('injected after archive publication');
            }
          },
        },
        completion: async () => 'unreachable',
      });
      assert.equal(result.ok, false);
      assert.deepEqual(result.report.commit, { state: 'incomplete', summaryIdx: 1 });
      assert.equal(result.report.phases[1].phase, 'maintain_context');
      assert.equal(result.report.phases[1].status, 'failed');
      assert.equal(result.report.phases.at(-1)?.phase, 'completion');
      assert.equal(result.report.phases.at(-1)?.status, 'skipped');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses release failure as primary only when maintain_context succeeded', async () => {
    const root = makeConversation();
    try {
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 0,
          keepRecent: 0,
          mutationHook: ({ point, phase }) => {
            if (point === 'create_staging' && phase === 'before') replaceLockOwner(root);
          },
        },
        completion: async () => 'unreachable',
      });
      assert.equal(result.ok, false);
      assert.equal(result.report.error?.code, 'LIFECYCLE_LOCKED');
      assert.equal(
        result.report.phases.find((phase) => phase.phase === 'maintain_context')?.status,
        'completed'
      );
      assert.equal(
        result.report.phases.find((phase) => phase.phase === 'release_exclusive')?.status,
        'failed'
      );
      assert.equal(result.report.commit.state, 'committed');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves the maintain error when release also fails', async () => {
    const root = makeConversation();
    try {
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 0,
          keepRecent: 0,
          summary: {
            kind: 'semantic',
            provider: {
              id: 'dual-failure',
              summarize: async () => {
                replaceLockOwner(root);
                throw new Error('provider secret');
              },
            },
          },
        },
        completion: async () => 'unreachable',
      });
      assert.equal(result.ok, false);
      assert.equal(result.report.error?.code, 'SUMMARY_PROVIDER_FAILED');
      assert.equal(
        result.report.phases.find((phase) => phase.phase === 'maintain_context')?.status,
        'failed'
      );
      assert.equal(
        result.report.phases.find((phase) => phase.phase === 'release_exclusive')?.status,
        'failed'
      );
      assert.doesNotMatch(JSON.stringify(result.report), /provider secret/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves committed facts when completion fails', async () => {
    const root = makeConversation();
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 0, keepRecent: 0 },
        completion: async () => {
          throw new Error('completion secret');
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.report.error?.code, 'COMPLETION_FAILED');
      assert.deepEqual(result.report.commit, { state: 'committed', summaryIdx: 1 });
      assert.doesNotMatch(JSON.stringify(result.report), /completion secret/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
