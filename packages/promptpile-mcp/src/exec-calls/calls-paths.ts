import path from 'path';

/** Suffix for exec-calls input files; stem is basename without this whole suffix (not `path.parse`). */
export const CALLS_JSONL_SUFFIX = '.calls.jsonl';

/** Paired output: same directory as the calls file. */
export const RESULT_JSONL_SUFFIX = '.result.jsonl';

/**
 * `foo.calls.jsonl` → `foo`; `[2]assistant.calls.jsonl` → `[2]assistant`.
 * Returns undefined if basename does not end with `.calls.jsonl` or stem would be empty (e.g. `.calls.jsonl`).
 */
export function stemFromCallsBasename(basename: string): string | undefined {
  if (!basename.endsWith(CALLS_JSONL_SUFFIX)) {
    return undefined;
  }
  const stem = basename.slice(0, -CALLS_JSONL_SUFFIX.length);
  return stem.length > 0 ? stem : undefined;
}

/** Absolute path to the result file paired with a calls file at `callAbsPath`. */
export function resultAbsPathForCallFile(callAbsPath: string, stem: string): string {
  return path.join(path.dirname(callAbsPath), stem + RESULT_JSONL_SUFFIX);
}
