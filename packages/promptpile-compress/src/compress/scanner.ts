import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findArchiveDirs,
  findStagingDir,
  isMessageFileName,
  listMessageFiles,
} from '../restore/scanner';
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

export const captureConversationGeneration = async (
  directory: string
): Promise<string> => {
  const hash = createHash('sha256');
  const hashTree = async (root: string, label: string): Promise<void> => {
    hash.update(label);
    hash.update('\0root\0');
    const walk = async (current: string, prefix = ''): Promise<void> => {
      const entries = await fs.readdir(current, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const relative = path.join(prefix, entry.name);
        const absolute = path.join(current, entry.name);
        hash.update(label);
        hash.update('\0');
        hash.update(relative);
        hash.update('\0');
        if (entry.isDirectory()) {
          hash.update('directory\0');
          await walk(absolute, relative);
        } else if (entry.isFile()) {
          const content = await fs.readFile(absolute);
          hash.update('file\0');
          hash.update(String(content.length));
          hash.update('\0');
          hash.update(content);
          hash.update('\0');
        } else {
          hash.update('other\0');
        }
      }
    };
    await walk(root);
  };

  const messageFiles = await listMessageFiles(directory);

  for (const fileName of messageFiles) {
    const content = await fs.readFile(path.join(directory, fileName));
    hash.update('message\0');
    hash.update(fileName);
    hash.update('\0');
    hash.update(String(content.length));
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  const archives = await findArchiveDirs(directory);
  for (const archive of archives) {
    await hashTree(archive.path, `archive:${archive.name}`);
  }
  const staging = await findStagingDir(directory);
  if (staging) {
    await hashTree(staging, 'staging');
  }

  return hash.digest('hex');
};

export const assertConversationGeneration = async (
  directory: string,
  expectedGeneration: string
): Promise<void> => {
  const actualGeneration = await captureConversationGeneration(directory);
  if (actualGeneration !== expectedGeneration) {
    throw new Error(
      'conversation 在 compression 规划期间发生变化，拒绝提交；请在 exclusive lifecycle phase 重试'
    );
  }
};
