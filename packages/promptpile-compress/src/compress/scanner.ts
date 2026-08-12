import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  findArchiveDirs,
  findStagingDir,
  isMessageFileName,
  listMessageFiles,
} from '../restore/scanner';
import {
  estimateTurnTokens as estimateCachedTurnTokens,
  heuristicTokenizer,
} from './tokenizer';
import type {
  MessageExtension,
  MessageFileKind,
  MessageRole,
  ScannedFile,
  Turn,
  TokenizerAdapter,
} from './types';
import {
  classifyConversationArtifactNameV1,
  compareConversationArtifactsV1,
  type ConversationArtifactFileKindV1,
} from 'promptpile-protocol/conversation';

const localKind = (kind: ConversationArtifactFileKindV1): MessageFileKind => {
  if (kind === 'assistant_call') return 'calls';
  if (kind === 'assistant_result') return 'result';
  if (kind === 'assistant_extra') return 'extra';
  return 'message';
};

const protocolSortEntry = (file: ScannedFile) => ({
  idx: file.idx,
  role: file.role,
  extension: file.extension,
  fileKind: file.fileKind === 'calls'
    ? 'assistant_call' as const
    : file.fileKind === 'result'
      ? 'assistant_result' as const
      : file.fileKind === 'extra'
        ? 'assistant_extra' as const
        : 'message' as const,
  relativePath: file.name,
});

export const parseMessageFileName = (
  directory: string,
  name: string
): ScannedFile | null => {
  const recognized = classifyConversationArtifactNameV1(name);
  return recognized ? {
    name,
    path: path.join(directory, name),
    idx: recognized.idx,
    role: recognized.role as MessageRole,
    extension: recognized.extension as MessageExtension,
    fileKind: localKind(recognized.fileKind),
  } : null;
};

export const estimateTurnTokens = (
  turn: Pick<Turn, 'files'>,
  tokenizer: TokenizerAdapter = heuristicTokenizer
): number => estimateCachedTurnTokens(turn, tokenizer);

export const scanTurns = async (
  directory: string,
  tokenizer: TokenizerAdapter = heuristicTokenizer
): Promise<Turn[]> => {
  const names = await listMessageFiles(directory);
  const byIdx = new Map<number, ScannedFile[]>();

  const parsedFiles = (
    await Promise.all(
      names.map(async (name) => {
        if (!isMessageFileName(name)) return null;
        const file = parseMessageFileName(directory, name);
        if (!file) return null;
        return { ...file, content: await fs.readFile(file.path, 'utf8') };
      })
    )
  ).filter((file): file is ScannedFile & { content: string } => file !== null);

  for (const file of parsedFiles) {
    const files = byIdx.get(file.idx) ?? [];
    files.push(file);
    byIdx.set(file.idx, files);
  }

  const turns: Turn[] = [];
  for (const [idx, files] of byIdx) {
    files.sort((a, b) =>
      compareConversationArtifactsV1(protocolSortEntry(a), protocolSortEntry(b))
    );
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
      estimatedTokens: estimateTurnTokens(turn, tokenizer),
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
  const messageContents = await Promise.all(
    messageFiles.map((fileName) => fs.readFile(path.join(directory, fileName)))
  );

  for (let index = 0; index < messageFiles.length; index += 1) {
    const fileName = messageFiles[index];
    const content = messageContents[index];
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
