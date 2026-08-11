import type { FileKind } from './types';
import { parseConversationIndex } from './conversation-index';

export interface RecognizedConversationArtifactName {
  idx: number;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: FileKind;
}

const FILE_PATTERN = /^\[(\d+)\](.+?)\.(md|json)$/;
const ASSISTANT_CALL_PATTERN = /^\[(\d+)\]assistant\.calls\.jsonl$/;
const ASSISTANT_RESULT_PATTERN = /^\[(\d+)\]assistant\.result\.jsonl$/;
const ASSISTANT_EXTRA_PATTERN = /^\[(\d+)\]assistant\.extra\.json$/;

/** The single filename classifier shared by the scanner and output-policy preflight. */
export const classifyConversationArtifactName = (
  basename: string
): RecognizedConversationArtifactName | undefined => {
  const special = [
    { pattern: ASSISTANT_CALL_PATTERN, extension: 'jsonl' as const, fileKind: 'assistant_call' as const },
    { pattern: ASSISTANT_RESULT_PATTERN, extension: 'jsonl' as const, fileKind: 'assistant_result' as const },
    { pattern: ASSISTANT_EXTRA_PATTERN, extension: 'json' as const, fileKind: 'assistant_extra' as const }
  ];
  for (const candidate of special) {
    const match = basename.match(candidate.pattern);
    if (!match) continue;
    const idx = parseConversationIndex(match[1]);
    if (idx === undefined) return undefined;
    return { idx, role: 'assistant', extension: candidate.extension, fileKind: candidate.fileKind };
  }

  const match = basename.match(FILE_PATTERN);
  if (!match) return undefined;
  const idx = parseConversationIndex(match[1]);
  if (idx === undefined) return undefined;
  return {
    idx,
    role: match[2],
    extension: match[3] as 'md' | 'json',
    fileKind: 'message'
  };
};
