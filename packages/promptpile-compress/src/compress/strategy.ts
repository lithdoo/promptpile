import type { CompressStrategyKind, TurnSelector } from './types';

const slidingWindowSelector: TurnSelector = {
  kind: 'sliding-window',

  selectTurns(turns, options) {
    const keepRecent = Math.max(0, options.keepRecent);
    const systemTurns = turns.filter((turn) => turn.isSystemTurn);
    const nonSystemTurns = turns.filter((turn) => !turn.isSystemTurn);
    const candidates = keepRecent > 0 ? nonSystemTurns.slice(-keepRecent) : [];
    const maxKeptTokens = options.maxKeptTokens ?? Number.POSITIVE_INFINITY;
    const systemTokens = systemTurns.reduce(
      (sum, turn) => sum + turn.estimatedTokens,
      0
    );
    if (systemTokens > maxKeptTokens) {
      throw new Error(
        `system turns exceed the live-history budget: ${systemTokens} > ${maxKeptTokens}`
      );
    }
    let keptTokens = systemTokens;
    const recent: typeof candidates = [];
    for (const turn of [...candidates].reverse()) {
      if (keptTokens + turn.estimatedTokens <= maxKeptTokens) {
        recent.unshift(turn);
        keptTokens += turn.estimatedTokens;
      } else {
        break;
      }
    }
    const recentIndices = new Set(recent.map((turn) => turn.idx));
    const archive = nonSystemTurns.filter((turn) => !recentIndices.has(turn.idx));

    return {
      keep: [...systemTurns, ...recent].sort((a, b) => a.idx - b.idx),
      archive,
    };
  },
};

export const createTurnSelector = (
  kind: CompressStrategyKind
): TurnSelector => {
  if (kind === 'sliding-window') {
    return slidingWindowSelector;
  }
  throw new Error(`unsupported compression strategy: ${kind}`);
};
