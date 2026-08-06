import type {
  CompressOptions,
  ContextBudgetOptions,
  ContextBudgetReport,
  TokenizerAdapter,
} from './types';

const DEFAULTS: Required<ContextBudgetOptions> = {
  modelContextTokens: 128_000,
  reservedOutputTokens: 8_000,
  systemToolOverheadTokens: 2_000,
  targetLiveHistoryTokens: 32_000,
  summaryOutputTokens: 2_048,
  safetyMarginTokens: 4_000,
};

export interface ResolvedContextBudget {
  mode: ContextBudgetReport['mode'];
  modelContextTokens?: number;
  reservedOutputTokens: number;
  systemToolOverheadTokens: number;
  targetLiveHistoryTokens: number;
  summaryOutputLimitTokens: number;
  safetyMarginTokens: number;
  triggerTokens: number;
  maxKeptTokens?: number;
}

const assertInteger = (
  name: string,
  value: number,
  allowZero = true
): void => {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(
      `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer: ${value}`
    );
  }
};

const requestedSummaryLimit = (options: CompressOptions): number | undefined =>
  options.summary?.kind === 'semantic'
    ? options.summary.maxOutputTokens
    : undefined;

export const resolveContextBudget = (
  options: CompressOptions
): ResolvedContextBudget => {
  if (options.threshold !== undefined && options.budget !== undefined) {
    throw new Error('threshold and budget cannot be combined');
  }

  if (options.threshold !== undefined) {
    assertInteger('threshold', options.threshold);
    const summaryOutputLimitTokens = requestedSummaryLimit(options) ?? 2_048;
    assertInteger('summary output limit', summaryOutputLimitTokens, false);
    return {
      mode: 'legacy-threshold',
      reservedOutputTokens: 0,
      systemToolOverheadTokens: 0,
      targetLiveHistoryTokens: options.threshold,
      summaryOutputLimitTokens,
      safetyMarginTokens: 0,
      triggerTokens: options.threshold,
    };
  }

  const budget = { ...DEFAULTS, ...options.budget };
  assertInteger('budget.modelContextTokens', budget.modelContextTokens, false);
  assertInteger('budget.reservedOutputTokens', budget.reservedOutputTokens);
  assertInteger(
    'budget.systemToolOverheadTokens',
    budget.systemToolOverheadTokens
  );
  assertInteger(
    'budget.targetLiveHistoryTokens',
    budget.targetLiveHistoryTokens,
    false
  );
  assertInteger('budget.summaryOutputTokens', budget.summaryOutputTokens, false);
  assertInteger('budget.safetyMarginTokens', budget.safetyMarginTokens);

  const availableHistoryTokens =
    budget.modelContextTokens -
    budget.reservedOutputTokens -
    budget.systemToolOverheadTokens -
    budget.safetyMarginTokens;
  if (availableHistoryTokens <= 0) {
    throw new Error('context budget leaves no capacity for live history');
  }
  const triggerTokens = Math.min(
    budget.targetLiveHistoryTokens,
    availableHistoryTokens
  );
  const summaryOutputLimitTokens = Math.min(
    requestedSummaryLimit(options) ?? budget.summaryOutputTokens,
    budget.summaryOutputTokens,
    triggerTokens
  );

  return {
    mode: 'context-budget',
    modelContextTokens: budget.modelContextTokens,
    reservedOutputTokens: budget.reservedOutputTokens,
    systemToolOverheadTokens: budget.systemToolOverheadTokens,
    targetLiveHistoryTokens: budget.targetLiveHistoryTokens,
    summaryOutputLimitTokens,
    safetyMarginTokens: budget.safetyMarginTokens,
    triggerTokens,
    maxKeptTokens: Math.max(0, triggerTokens - summaryOutputLimitTokens),
  };
};

export const createBudgetReport = (
  budget: ResolvedContextBudget,
  tokenizer: TokenizerAdapter,
  tokensBefore: number,
  keptHistoryTokens: number,
  summaryTokens: number,
  summaryTokenBasis: ContextBudgetReport['summaryTokenBasis'] = 'actual'
): ContextBudgetReport => {
  const totalPlannedTokens =
    budget.systemToolOverheadTokens +
    keptHistoryTokens +
    summaryTokens +
    budget.reservedOutputTokens +
    budget.safetyMarginTokens;
  return {
    mode: budget.mode,
    summaryTokenBasis,
    tokenizer: {
      id: tokenizer.id,
      model: tokenizer.model,
      kind: tokenizer.kind,
    },
    ...(budget.modelContextTokens !== undefined
      ? { modelContextTokens: budget.modelContextTokens }
      : {}),
    reservedOutputTokens: budget.reservedOutputTokens,
    systemToolOverheadTokens: budget.systemToolOverheadTokens,
    targetLiveHistoryTokens: budget.targetLiveHistoryTokens,
    summaryOutputLimitTokens: budget.summaryOutputLimitTokens,
    safetyMarginTokens: budget.safetyMarginTokens,
    triggerTokens: budget.triggerTokens,
    tokensBefore,
    keptHistoryTokens,
    summaryTokens,
    totalPlannedTokens,
    ...(budget.modelContextTokens !== undefined
      ? {
          remainingContextTokens:
            budget.modelContextTokens - totalPlannedTokens,
        }
      : {}),
  };
};
