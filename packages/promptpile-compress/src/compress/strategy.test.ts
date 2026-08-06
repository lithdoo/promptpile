import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTurnSelector } from './strategy';
import type { Turn } from './types';

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

describe('sliding-window turn selector', () => {
  const selector = createTurnSelector('sliding-window');

  it('keeps system turns and the requested recent non-system suffix', () => {
    const result = selector.selectTurns(
      [turn(1, 5, true), turn(2, 2), turn(3, 3), turn(4, 4)],
      { keepRecent: 2 }
    );

    assert.deepEqual(result.keep.map(({ idx }) => idx), [1, 3, 4]);
    assert.deepEqual(result.archive.map(({ idx }) => idx), [2]);
  });

  it('treats zero and negative keepRecent as keeping no non-system turns', () => {
    for (const keepRecent of [0, -2]) {
      const result = selector.selectTurns(
        [turn(1, 1, true), turn(2, 2), turn(3, 3)],
        { keepRecent }
      );
      assert.deepEqual(result.keep.map(({ idx }) => idx), [1]);
      assert.deepEqual(result.archive.map(({ idx }) => idx), [2, 3]);
    }
  });

  it('keeps all available recent turns when keepRecent exceeds their count', () => {
    const result = selector.selectTurns([turn(1, 1), turn(2, 2)], {
      keepRecent: 99,
    });
    assert.deepEqual(result.keep.map(({ idx }) => idx), [1, 2]);
    assert.deepEqual(result.archive, []);
  });

  it('honors the exact token boundary', () => {
    const result = selector.selectTurns(
      [turn(1, 3, true), turn(2, 4), turn(3, 5)],
      { keepRecent: 2, maxKeptTokens: 12 }
    );
    assert.deepEqual(result.keep.map(({ idx }) => idx), [1, 2, 3]);
    assert.deepEqual(result.archive, []);
  });

  it('keeps a contiguous recent suffix instead of skipping an oversized turn', () => {
    const result = selector.selectTurns(
      [turn(1, 1), turn(2, 20), turn(3, 3)],
      { keepRecent: 3, maxKeptTokens: 10 }
    );
    assert.deepEqual(result.keep.map(({ idx }) => idx), [3]);
    assert.deepEqual(result.archive.map(({ idx }) => idx), [1, 2]);
  });

  it('rejects a budget smaller than the mandatory system turns', () => {
    assert.throws(
      () =>
        selector.selectTurns([turn(1, 6, true), turn(2, 5, true)], {
          keepRecent: 1,
          maxKeptTokens: 10,
        }),
      /system turns exceed the live-history budget: 11 > 10/
    );
  });

  it('fails closed for an unsupported runtime strategy value', () => {
    assert.throws(
      () => createTurnSelector('future-strategy' as 'sliding-window'),
      /unsupported compression strategy/
    );
  });
});
