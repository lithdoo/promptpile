import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory } from './index';
import { createTurnSelector } from './strategy';
import type { TokenizerAdapter, Turn } from './types';

const characterTokenizer: TokenizerAdapter = {
  id: 'test-character-v1',
  model: 'fixture',
  kind: 'exact',
  messageOverheadTokens: 0,
  countText: (content) => content.length,
};

const makeConversation = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-budget-'));
  fs.writeFileSync(path.join(root, '[0]system.md'), 'system1234');
  for (let idx = 1; idx <= 8; idx += 1) {
    fs.writeFileSync(path.join(root, `[${idx}]user.md`), String(idx).repeat(40));
  }
  return root;
};

const budget = {
  modelContextTokens: 500,
  reservedOutputTokens: 50,
  systemToolOverheadTokens: 50,
  targetLiveHistoryTokens: 300,
  summaryOutputTokens: 250,
  safetyMarginTokens: 50,
};

describe('context budget', () => {
  it('keeps a contiguous recent suffix when an older turn exceeds budget', () => {
    const turn = (
      idx: number,
      estimatedTokens: number,
      isSystemTurn = false
    ): Turn => ({
      idx,
      estimatedTokens,
      isSystemTurn,
      hasToolCalls: false,
      files: [],
    });
    const selected = createTurnSelector('sliding-window').selectTurns(
      [turn(0, 10, true), turn(1, 5), turn(2, 100), turn(3, 40)],
      { keepRecent: 3, maxKeptTokens: 60 }
    );
    assert.deepEqual(selected.keep.map(({ idx }) => idx), [0, 3]);
    assert.deepEqual(selected.archive.map(({ idx }) => idx), [1, 2]);
  });

  it('uses one budget for trigger, selection, summary, and reporting', async () => {
    const root = makeConversation();
    try {
      const before = fs.readdirSync(root).sort();
      const dryRun = await compressDirectory({
        directory: root,
        budget,
        tokenizer: characterTokenizer,
        keepRecent: 8,
        dryRun: true,
      });
      assert.equal(dryRun.skipReason, 'dry_run');
      assert.equal(dryRun.turnsArchived, 7);
      assert.equal(dryRun.turnsKept, 2);
      assert.equal(dryRun.summaryIdx, 7);
      assert.deepEqual(fs.readdirSync(root).sort(), before);

      const actual = await compressDirectory({
        directory: root,
        budget,
        tokenizer: characterTokenizer,
        keepRecent: 8,
      });
      assert.equal(actual.compressed, true);
      assert.equal(actual.turnsArchived, dryRun.turnsArchived);
      assert.equal(actual.turnsKept, dryRun.turnsKept);
      assert.equal(actual.summaryIdx, dryRun.summaryIdx);
      assert.deepEqual(actual.budget, dryRun.budget);
      assert.equal(actual.budget.mode, 'context-budget');
      assert.equal(actual.budget.triggerTokens, 300);
      assert.equal(actual.budget.keptHistoryTokens, 50);
      assert.equal(actual.budget.summaryOutputLimitTokens, 250);
      assert.equal(
        actual.budget.totalPlannedTokens,
        50 + 50 + actual.budget.summaryTokens + 50 + 50
      );
      assert.equal(
        actual.budget.remainingContextTokens,
        500 - actual.budget.totalPlannedTokens
      );
      assert.ok((actual.budget.remainingContextTokens ?? -1) >= 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects ambiguous threshold plus budget before mutation', async () => {
    const root = makeConversation();
    const before = fs.readdirSync(root).sort();
    try {
      await assert.rejects(
        compressDirectory({ directory: root, threshold: 0, budget }),
        /cannot be combined/
      );
      assert.deepEqual(fs.readdirSync(root).sort(), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('preserves legacy threshold selection semantics and reports the mode', async () => {
    const root = makeConversation();
    try {
      const result = await compressDirectory({
        directory: root,
        threshold: 0,
        tokenizer: characterTokenizer,
        keepRecent: 2,
      });
      assert.equal(result.turnsArchived, 6);
      assert.equal(result.turnsKept, 3);
      assert.equal(result.budget.mode, 'legacy-threshold');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
