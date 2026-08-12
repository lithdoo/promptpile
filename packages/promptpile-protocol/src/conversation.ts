export const MAX_CONVERSATION_INDEX_V1 = Number.MAX_SAFE_INTEGER;

export function parseConversationIndexV1(raw: string): number | undefined {
  if (!/^\d+$/.test(raw)) return undefined;
  const index = Number(raw);
  return Number.isSafeInteger(index) && index >= 0 ? index : undefined;
}

export type ConversationArtifactFileKindV1 =
  | 'message'
  | 'assistant_call'
  | 'assistant_result'
  | 'assistant_extra';

export interface RecognizedConversationArtifactNameV1 {
  idx: number;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: ConversationArtifactFileKindV1;
}

const MESSAGE = /^\[(\d+)\](.+?)\.(md|json)$/;
const SPECIAL: ReadonlyArray<{
  pattern: RegExp;
  extension: 'json' | 'jsonl';
  fileKind: Exclude<ConversationArtifactFileKindV1, 'message'>;
}> = [
  { pattern: /^\[(\d+)\]assistant\.calls\.jsonl$/, extension: 'jsonl', fileKind: 'assistant_call' },
  { pattern: /^\[(\d+)\]assistant\.extra\.json$/, extension: 'json', fileKind: 'assistant_extra' },
  { pattern: /^\[(\d+)\]assistant\.result\.jsonl$/, extension: 'jsonl', fileKind: 'assistant_result' }
];

export function classifyConversationArtifactNameV1(
  basename: string
): RecognizedConversationArtifactNameV1 | undefined {
  for (const candidate of SPECIAL) {
    const match = candidate.pattern.exec(basename);
    if (!match) continue;
    const idx = parseConversationIndexV1(match[1]);
    return idx === undefined
      ? undefined
      : { idx, role: 'assistant', extension: candidate.extension, fileKind: candidate.fileKind };
  }
  const match = MESSAGE.exec(basename);
  if (!match) return undefined;
  const idx = parseConversationIndexV1(match[1]);
  return idx === undefined
    ? undefined
    : { idx, role: match[2], extension: match[3] as 'md' | 'json', fileKind: 'message' };
}

export type AssistantArtifactKindV1 = 'body' | 'calls' | 'extra' | 'result';

export function formatAssistantArtifactNameV1(idx: number, kind: AssistantArtifactKindV1): string {
  if (!Number.isSafeInteger(idx) || idx < 0) {
    throw new RangeError(`conversation index must be an integer from 0 to ${MAX_CONVERSATION_INDEX_V1}`);
  }
  switch (kind) {
    case 'body': return `[${idx}]assistant.md`;
    case 'calls': return `[${idx}]assistant.calls.jsonl`;
    case 'extra': return `[${idx}]assistant.extra.json`;
    case 'result': return `[${idx}]assistant.result.jsonl`;
  }
}

export interface ConversationArtifactSortEntryV1 extends RecognizedConversationArtifactNameV1 {
  relativePath: string;
}

const utf8 = new TextEncoder();
function compareUtf8BytesV1(a: string, b: string): number {
  const left = utf8.encode(a);
  const right = utf8.encode(b);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function tier(entry: ConversationArtifactSortEntryV1): number {
  if (entry.fileKind === 'message') {
    return entry.role === 'assistant' && entry.extension === 'md' ? 1 : 0;
  }
  if (entry.fileKind === 'assistant_call') return 2;
  if (entry.fileKind === 'assistant_extra') return 3;
  return 4;
}

export function compareConversationArtifactsV1(
  a: ConversationArtifactSortEntryV1,
  b: ConversationArtifactSortEntryV1
): number {
  if (a.idx !== b.idx) return a.idx < b.idx ? -1 : 1;
  const tierDifference = tier(a) - tier(b);
  if (tierDifference !== 0) return tierDifference;
  const roleDifference = compareUtf8BytesV1(a.role, b.role);
  return roleDifference || compareUtf8BytesV1(a.relativePath, b.relativePath);
}
