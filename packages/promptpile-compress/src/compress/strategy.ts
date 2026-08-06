import type { CompressStrategyKind, TurnSelector } from './types';

const slidingWindowSelector: TurnSelector = {
  kind: 'sliding-window',

  selectTurns(turns, options) {
    const keepRecent = Math.max(0, options.keepRecent);
    const systemTurns = turns.filter((turn) => turn.isSystemTurn);
    const nonSystemTurns = turns.filter((turn) => !turn.isSystemTurn);
    const recent = keepRecent > 0 ? nonSystemTurns.slice(-keepRecent) : [];
    const archive =
      keepRecent > 0 ? nonSystemTurns.slice(0, -keepRecent) : nonSystemTurns;

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
