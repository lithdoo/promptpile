import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory } from './index';
import { restoreArchivedTurns } from '../restore';
import type {
  SemanticSummaryDocument,
  SemanticSummaryProvider,
  SemanticSummaryRequest,
} from './types';

const fixtureRoot = path.resolve(
  __dirname,
  '../../../../fixtures/semantic-summary-v1/coding-session'
);

const makeConversation = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-semantic-'));
  fs.cpSync(path.join(fixtureRoot, 'conversation'), root, { recursive: true });
  return root;
};

const snapshot = (root: string): string[] => {
  const walk = (directory: string, prefix = ''): string[] => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    return entries.flatMap((entry) => {
      const relative = path.join(prefix, entry.name);
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? [`${relative}/`, ...walk(absolute, relative)]
        : [`${relative}:${fs.readFileSync(absolute).toString('base64')}`];
    });
  };
  return walk(root);
};

const expectedDocument = (): SemanticSummaryDocument =>
  JSON.parse(
    fs.readFileSync(path.join(fixtureRoot, 'expected-summary.json'), 'utf8')
  ) as SemanticSummaryDocument;

const provider = (
  summarize: (
    request: SemanticSummaryRequest,
    signal: AbortSignal
  ) => Promise<unknown>
): SemanticSummaryProvider => ({ id: 'fixture-provider-v1', summarize });

const semanticOptions = (summaryProvider: SemanticSummaryProvider) => ({
  kind: 'semantic' as const,
  provider: summaryProvider,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_048,
  timeoutMs: 1_000,
});

describe('semantic summary generation', () => {
  it('plans a dry-run without invoking the provider', async () => {
    const root = makeConversation();
    const before = snapshot(root);
    let calls = 0;
    try {
      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
        dryRun: true,
        summary: semanticOptions(
          provider(async () => {
            calls += 1;
            return expectedDocument();
          })
        ),
      });

      assert.equal(result.skipReason, 'dry_run');
      assert.equal(calls, 0);
      assert.equal(result.budget.summaryTokenBasis, 'upper-bound');
      assert.equal(
        result.budget.summaryTokens,
        result.budget.summaryOutputLimitTokens
      );
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('normalizes artifacts, renders sourced context, and restores exact bytes', async () => {
    const root = makeConversation();
    const before = snapshot(root);
    try {
      let observed: SemanticSummaryRequest | undefined;
      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        keepRecent: 1,
        summary: semanticOptions(
          provider(async (request) => {
            observed = request;
            return expectedDocument();
          })
        ),
      });

      assert.equal(result.compressed, true);
      assert.deepEqual(observed?.turns.map((turn) => turn.idx), [1, 2, 3, 4]);
      assert.equal(observed?.version, 1);
      assert.ok((observed?.budget.estimatedInputTokens ?? 0) > 0);
      const assistant = observed?.turns.find((turn) => turn.idx === 2);
      assert.equal(assistant?.hasToolCalls, true);
      assert.deepEqual(
        assistant?.artifacts.map((artifact) => artifact.fileKind),
        ['calls', 'message', 'result']
      );
      assert.match(
        assistant?.artifacts.find((artifact) => artifact.fileKind === 'result')
          ?.content ?? '',
        /no cache exists/
      );

      const summary = fs.readFileSync(path.join(root, '[4]system.md'), 'utf8');
      for (const phrase of [
        'under 200 ms',
        'public JSON response shape',
        'five-minute in-memory TTL cache',
        'buildReport ran directly',
        'targeted tests',
        'p95 latency',
        'display name failed',
      ]) {
        assert.match(summary, new RegExp(phrase));
      }
      assert.match(summary, /\(sources: 2, 4\)/);
      assert.doesNotMatch(summary, /lookup_archive/);

      const manifest = JSON.parse(
        fs.readFileSync(
          path.join(root, '[4]system.md.archive', 'compression.json'),
          'utf8'
        )
      ) as { summaryKind: string; summaryProvider: string };
      assert.equal(manifest.summaryKind, 'semantic');
      assert.equal(manifest.summaryProvider, 'fixture-provider-v1');

      const restored = await restoreArchivedTurns({ directory: root });
      assert.equal(restored.restored, true);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves the conversation unchanged when the provider fails', async () => {
    const root = makeConversation();
    const before = snapshot(root);
    try {
      await assert.rejects(
        compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
          summary: semanticOptions(
            provider(async () => {
              throw new Error('provider unavailable');
            })
          ),
        }),
        /provider unavailable/
      );
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('aborts a timed-out provider without mutating the conversation', async () => {
    const root = makeConversation();
    const before = snapshot(root);
    try {
      let aborted = false;
      await assert.rejects(
        compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
          summary: {
            ...semanticOptions(
              provider(
                async (_request, signal) =>
                  new Promise((_resolve) => {
                    signal.addEventListener('abort', () => {
                      aborted = true;
                    });
                  })
              )
            ),
            timeoutMs: 10,
          },
        }),
        /timed out/
      );
      assert.equal(aborted, true);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  for (const [name, response, pattern] of [
    ['missing fields', { version: 1 }, /must be an array/],
    [
      'invalid source index',
      {
        ...expectedDocument(),
        goal: [{ text: 'invented', sourceTurnIndices: [99] }],
      },
      /invalid source turn indices/,
    ],
    [
      'empty document',
      Object.fromEntries([
        ['version', 1],
        ...Object.keys(expectedDocument())
          .filter((key) => key !== 'version')
          .map((key) => [key, []]),
      ]),
      /at least one sourced item/,
    ],
  ] as const) {
    it(`rejects ${name} without mutating the conversation`, async () => {
      const root = makeConversation();
      const before = snapshot(root);
      try {
        await assert.rejects(
          compressDirectory({
            directory: root,
            threshold: 0,
            keepRecent: 1,
            summary: semanticOptions(provider(async () => response)),
          }),
          pattern
        );
        assert.deepEqual(snapshot(root), before);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it('enforces input budget before calling the provider', async () => {
    const root = makeConversation();
    const before = snapshot(root);
    let called = false;
    try {
      await assert.rejects(
        compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
          summary: {
            ...semanticOptions(
              provider(async () => {
                called = true;
                return expectedDocument();
              })
            ),
            maxInputTokens: 1,
          },
        }),
        /input exceeds budget/
      );
      assert.equal(called, false);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects output over budget without mutating the conversation', async () => {
    const root = makeConversation();
    const before = snapshot(root);
    try {
      await assert.rejects(
        compressDirectory({
          directory: root,
          threshold: 0,
          keepRecent: 1,
          summary: {
            ...semanticOptions(provider(async () => expectedDocument())),
            maxOutputTokens: 1,
          },
        }),
        /output exceeds budget/
      );
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
