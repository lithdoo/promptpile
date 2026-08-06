import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runCompressionBeforeCompletion } from '../compress';
import { isLifecycleLockFileName } from './lock';
import { STAGING_DIR } from '../restore/scanner';

const makeConversation = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-orchestrator-'));
  fs.writeFileSync(path.join(root, '[1]user.md'), 'question');
  return root;
};

const hasLifecycleLock = (root: string): boolean =>
  fs.readdirSync(root).some(isLifecycleLockFileName);

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

describe('compression orchestrator boundary', () => {
  it('returns a structured I/O error for an invalid directory', async () => {
    const missing = path.join(
      os.tmpdir(),
      `ppc-orchestrator-missing-${process.pid}-${Date.now()}`
    );
    const result = await runCompressionBeforeCompletion({
      compression: { directory: missing, threshold: 0 },
      completion: async () => 'unreachable',
    });
    assert.equal(result.ok, false);
    assert.equal(result.report.error?.code, 'IO_ERROR');
    assert.equal(result.report.commit.state, 'not_started');
    assert.deepEqual(result.report.phases, [
      { phase: 'estimate_plan', status: 'failed', durationMs: 0 },
    ]);
  });

  it('releases the filesystem lock before completion and reports every phase', async () => {
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
      assert.equal(result.completion, 'completed');
      assert.equal(result.report.status, 'completed');
      assert.deepEqual(
        result.report.phases.map(({ phase }) => phase),
        [
          'estimate_plan',
          'acquire_exclusive',
          'compress',
          'release_exclusive',
          'completion',
        ]
      );
      assert.equal(result.report.commit.state, 'skipped');
      assert.deepEqual(result.report.selection.keptTurnIndices, [1]);
      assert.ok(result.report.budget);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('serializes the next lifecycle phase until active completion finishes', async () => {
    const root = makeConversation();
    let releaseFirst!: () => void;
    let firstStarted!: () => void;
    const completionStarted = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const completionGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondCompletionStarted = false;
    try {
      const first = runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => {
          firstStarted();
          await completionGate;
          return 1;
        },
      });
      await completionStarted;
      const second = runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 10_000 },
        completion: async () => {
          secondCompletionStarted = true;
          return 2;
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(secondCompletionStarted, false);
      releaseFirst();
      const [firstResult, secondResult] = await Promise.all([first, second]);
      assert.equal(firstResult.ok, true);
      assert.equal(secondResult.ok, true);
      assert.equal(secondCompletionStarted, true);
    } finally {
      releaseFirst?.();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns actionable sanitized errors without running completion', async () => {
    const root = makeConversation();
    let completionCalled = false;
    let providerCalls = 0;
    try {
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 0,
          keepRecent: 0,
          summary: {
            kind: 'semantic',
            provider: {
              id: 'failing-provider',
              summarize: async () => {
                providerCalls += 1;
                throw new Error('SECRET CONVERSATION PAYLOAD');
              },
            },
          },
        },
        completion: async () => {
          completionCalled = true;
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.report.error?.code, 'SUMMARY_PROVIDER_FAILED');
      assert.equal(result.report.error?.retryable, true);
      assert.doesNotMatch(JSON.stringify(result.report), /SECRET/);
      assert.equal(completionCalled, false);
      assert.equal(providerCalls, 1);
      assert.deepEqual(
        result.report.phases.map(({ phase, status }) => ({ phase, status })),
        [
          { phase: 'estimate_plan', status: 'completed' },
          { phase: 'acquire_exclusive', status: 'completed' },
          { phase: 'compress', status: 'failed' },
          { phase: 'release_exclusive', status: 'completed' },
        ]
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes recovery actions in the operation report', async () => {
    const root = makeConversation();
    let providerCalls = 0;
    const staging = path.join(root, STAGING_DIR);
    fs.mkdirSync(staging);
    fs.renameSync(path.join(root, '[1]user.md'), path.join(staging, '[1]user.md'));
    fs.writeFileSync(path.join(staging, 'compression.json'), '{}');
    try {
      const result = await runCompressionBeforeCompletion({
        compression: {
          directory: root,
          threshold: 0,
          keepRecent: 0,
          summary: {
            kind: 'semantic',
            provider: {
              id: 'counting-provider',
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
      assert.deepEqual(result.report.recoveryActions, ['[1]user.md']);
      assert.equal(providerCalls, 1);
      assert.equal(result.report.plan?.budget.summaryTokenBasis, 'upper-bound');
      assert.equal(result.report.budget?.summaryTokenBasis, 'actual');
      assert.equal(fs.existsSync(staging), false);
      assert.equal(fs.existsSync(path.join(root, '[1]system.md.archive')), true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports committed selection without exposing conversation content', async () => {
    const root = makeConversation();
    fs.writeFileSync(path.join(root, '[2]assistant.md'), 'answer');
    fs.writeFileSync(path.join(root, '[3]user.md'), 'latest');
    try {
      const result = await runCompressionBeforeCompletion({
        compression: { directory: root, threshold: 0, keepRecent: 1 },
        completion: async () => 'ok',
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.report.commit.state, 'committed');
      assert.equal(result.report.commit.summaryIdx, 2);
      assert.deepEqual(result.report.selection.archivedTurnIndices, [1, 2]);
      assert.deepEqual(result.report.selection.keptTurnIndices, [3]);
      assert.doesNotMatch(JSON.stringify(result.report), /question|answer|latest/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
