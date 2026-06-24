import path from 'node:path';
import { isMessageFileName, listMessageFiles } from '../restore/scanner';
import { estimateTurnTokens as estimateFileTokens } from './tokenizer';
import type {
  MessageExtension,
  MessageFileKind,
  MessageRole,
  ScannedFile,
  Turn,
} from './types';

const MESSAGE_PATTERN = /^\[(\d+)\](.+?)\.(md|json)$/i;
const ASSISTANT_SIDE_CAR_PATTERN =
  /^\[(\d+)\]assistant\.(calls|result)\.jsonl$/i;
const ASSISTANT_EXTRA_PATTERN = /^\[(\d+)\]assistant\.extra\.json$/i;

export const parseMessageFileName = (
  directory: string,
  name: string
): ScannedFile | null => {
  const sideCarMatch = name.match(ASSISTANT_SIDE_CAR_PATTERN);
  if (sideCarMatch) {
    return {
      name,
      path: path.join(directory, name),
      idx: Number.parseInt(sideCarMatch[1], 10),
      role: 'assistant',
      extension: 'jsonl',
      fileKind: sideCarMatch[2].toLowerCase() as MessageFileKind,
    };
  }

  const extraMatch = name.match(ASSISTANT_EXTRA_PATTERN);
  if (extraMatch) {
    return {
      name,
      path: path.join(directory, name),
      idx: Number.parseInt(extraMatch[1], 10),
      role: 'assistant',
      extension: 'json',
      fileKind: 'extra',
    };
  }

  const messageMatch = name.match(MESSAGE_PATTERN);
  if (messageMatch) {
    return {
      name,
      path: path.join(directory, name),
      idx: Number.parseInt(messageMatch[1], 10),
      role: messageMatch[2].toLowerCase() as MessageRole,
      extension: messageMatch[3].toLowerCase() as MessageExtension,
      fileKind: 'message',
    };
  }

  return null;
};

export const estimateTurnTokens = async (
  directory: string,
  turn: Pick<Turn, 'idx' | 'files'>
): Promise<number> =>
  estimateFileTokens(
    directory,
    turn.idx,
    turn.files.map((file) => file.name)
  );

export const scanTurns = async (directory: string): Promise<Turn[]> => {
  const names = await listMessageFiles(directory);
  const byIdx = new Map<number, ScannedFile[]>();

  for (const name of names) {
    if (!isMessageFileName(name)) {
      continue;
    }
    const file = parseMessageFileName(directory, name);
    if (!file) {
      continue;
    }
    const files = byIdx.get(file.idx) ?? [];
    files.push(file);
    byIdx.set(file.idx, files);
  }

  const turns: Turn[] = [];
  for (const [idx, files] of byIdx) {
    files.sort((a, b) => a.name.localeCompare(b.name));
    const turn = {
      idx,
      files,
      estimatedTokens: 0,
      isSystemTurn: files.some(
        (file) =>
          file.role === 'system' &&
          file.extension === 'md' &&
          file.fileKind === 'message'
      ),
      hasToolCalls: files.some((file) => file.fileKind === 'calls'),
    };
    turns.push({
      ...turn,
      estimatedTokens: await estimateTurnTokens(directory, turn),
    });
  }

  return turns.sort((a, b) => a.idx - b.idx);
};
