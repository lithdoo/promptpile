import type { MessageDiagnostic, MissingToolResultsPolicy } from './types';

export const parseMissingToolResultsPolicy = (
  value: unknown
): MissingToolResultsPolicy | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new Error('missing_tool_results must be warn, error, or ignore');
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === '') return undefined;
  if (normalized === 'warn' || normalized === 'error' || normalized === 'ignore') {
    return normalized;
  }
  throw new Error('Invalid missing tool results policy: expected warn, error, or ignore');
};

export const formatMissingToolResultDiagnostic = (diagnostic: MessageDiagnostic): string => {
  const detail = diagnostic.reason === 'result_file_missing'
    ? 'result file is missing'
    : 'tool_call_id is missing from result file';
  return `Incomplete tool result at idx=${diagnostic.idx}, tool_call_id=${diagnostic.toolCallId}: ${detail} (${diagnostic.resultPath})`;
};

export const applyMissingToolResultsPolicy = (
  diagnostics: MessageDiagnostic[],
  policy: MissingToolResultsPolicy,
  warn: (message: string) => void = message => console.error(message)
): void => {
  if (diagnostics.length === 0 || policy === 'ignore') return;
  const details = diagnostics.map(formatMissingToolResultDiagnostic);
  if (policy === 'error') throw new Error(details.join('\n'));
  for (const detail of details) warn(`Warning: ${detail}`);
};
