import type { CompressionCommitReport, CompressionDecisionReport } from './types';

const validPlain: CompressionDecisionReport = {
  liveState: 'healthy_plain',
  liveTokens: 10,
  triggerTokens: 10,
  triggerReached: true,
  action: 'evaluate_current',
};

// @ts-expect-error healthy_plain cannot restore an archive
const invalidPlain: CompressionDecisionReport = {
  liveState: 'healthy_plain',
  liveTokens: 10,
  triggerTokens: 10,
  triggerReached: true,
  action: 'restore_then_evaluate',
};

// @ts-expect-error below_threshold requires triggerReached=false
const invalidBelow: CompressionDecisionReport = { liveState: 'healthy_plain', liveTokens: 9, triggerTokens: 10, triggerReached: true, action: 'skip', reason: 'below_threshold' };

// @ts-expect-error skipped commits cannot carry a summary index
const invalidCommit: CompressionCommitReport = { state: 'skipped', summaryIdx: 1 };

void validPlain;
void invalidPlain;
void invalidBelow;
void invalidCommit;
