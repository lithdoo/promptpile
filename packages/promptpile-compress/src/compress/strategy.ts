import type {
  CompressStrategy,
  CompressStrategyKind,
  Turn,
} from './types';

const summarizeArchiveRange = (archive: Turn[]): {
  minIdx: number;
  maxIdx: number;
  turnCount: number;
  estimatedTokens: number;
} => ({
  minIdx: Math.min(...archive.map((turn) => turn.idx)),
  maxIdx: Math.max(...archive.map((turn) => turn.idx)),
  turnCount: archive.length,
  estimatedTokens: archive.reduce((sum, turn) => sum + turn.estimatedTokens, 0),
});

const slidingWindowStrategy: CompressStrategy = {
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

  async generateSummary(archive) {
    const { minIdx, maxIdx, turnCount, estimatedTokens } =
      summarizeArchiveRange(archive);
    return [
      `对话第 ${minIdx}-${maxIdx} 轮已被归档，可通过 lookup_archive 工具检索原文。`,
      `归档范围共 ${turnCount} 轮，原始 token 数约 ${estimatedTokens}。`,
    ].join('\n');
  },
};

export const createStrategy = (
  kind: CompressStrategyKind
): CompressStrategy => {
  if (kind === 'sliding-window') {
    return slidingWindowStrategy;
  }
  throw new Error(`不支持的压缩策略: ${kind}`);
};
