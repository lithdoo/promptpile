import fs from 'node:fs/promises';
import path from 'node:path';
import type { Turn } from './types';

const MESSAGE_WRAPPER_TOKENS = 30;
const CHARS_PER_TOKEN = 3.5;

const stripFrontMatter = (content: string): string => {
  if (!content.startsWith('---')) {
    return content;
  }
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') {
    return content;
  }
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      return lines.slice(index + 1).join('\n');
    }
  }
  return content;
};

export const estimateTextTokens = (content: string): number =>
  Math.ceil(content.length / CHARS_PER_TOKEN);

export const estimateTurnTokens = async (
  directory: string,
  _turnIdx: number,
  fileNames: string[]
): Promise<number> => {
  let characters = 0;
  for (const fileName of fileNames) {
    const content = await fs.readFile(path.join(directory, fileName), 'utf8');
    characters += fileName.endsWith('.md')
      ? stripFrontMatter(content).length
      : content.length;
  }
  return Math.ceil(characters / CHARS_PER_TOKEN) + fileNames.length * MESSAGE_WRAPPER_TOKENS;
};

export const estimateTotalTokens = (turns: Turn[]): number =>
  turns.reduce((sum, turn) => sum + turn.estimatedTokens, 0);
