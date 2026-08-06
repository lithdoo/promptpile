import type { TokenizerAdapter, Turn } from './types';

const MESSAGE_WRAPPER_TOKENS = 30;

const stripFrontMatter = (content: string): string => {
  if (!content.startsWith('---')) return content;
  const lines = content.split(/\r?\n/);
  if (lines[0] !== '---') return content;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') return lines.slice(index + 1).join('\n');
  }
  return content;
};

export const heuristicTokenizer: TokenizerAdapter = {
  id: 'promptpile-unicode-heuristic-v1',
  model: 'model-agnostic',
  kind: 'heuristic-fallback',
  messageOverheadTokens: MESSAGE_WRAPPER_TOKENS,
  countText(content) {
    let asciiCharacters = 0;
    let nonAsciiCodePoints = 0;
    for (const codePoint of content) {
      if (codePoint.codePointAt(0)! <= 0x7f) asciiCharacters += 1;
      else nonAsciiCodePoints += 1;
    }
    return Math.ceil(asciiCharacters / 4 + nonAsciiCodePoints / 2.5);
  },
};

export const assertTokenizerAdapter = (
  tokenizer: TokenizerAdapter
): void => {
  if (!tokenizer || typeof tokenizer.countText !== 'function') {
    throw new Error('tokenizer must provide countText(content)');
  }
  if (!tokenizer.id?.trim() || !tokenizer.model?.trim()) {
    throw new Error('tokenizer id and model must be non-empty');
  }
  if (!['exact', 'heuristic-fallback'].includes(tokenizer.kind)) {
    throw new Error(`unsupported tokenizer kind: ${tokenizer.kind}`);
  }
  if (
    !Number.isInteger(tokenizer.messageOverheadTokens) ||
    tokenizer.messageOverheadTokens < 0
  ) {
    throw new Error('tokenizer messageOverheadTokens must be a non-negative integer');
  }
};

const countText = (content: string, tokenizer: TokenizerAdapter): number => {
  const count = tokenizer.countText(content);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(
      `tokenizer ${tokenizer.id} returned an invalid token count: ${count}`
    );
  }
  return count;
};

export const createTiktokenTokenizer = async (
  model = 'gpt-4o-mini'
): Promise<TokenizerAdapter> => {
  let tiktoken: typeof import('tiktoken');
  try {
    tiktoken = await import('tiktoken');
  } catch (error) {
    throw new Error(
      `tiktoken is unavailable; use heuristicTokenizer or install the optional dependency (${error instanceof Error ? error.message : String(error)})`
    );
  }
  let encoding;
  try {
    encoding = tiktoken.encoding_for_model(
      model as Parameters<typeof tiktoken.encoding_for_model>[0]
    );
  } catch (error) {
    throw new Error(
      `unsupported tiktoken model ${model}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return {
    id: 'tiktoken@1.0.22',
    model,
    kind: 'exact',
    messageOverheadTokens: MESSAGE_WRAPPER_TOKENS,
    countText: (content) => encoding.encode(content).length,
    dispose: () => encoding.free(),
  };
};

export const estimateTextTokens = (
  content: string,
  tokenizer: TokenizerAdapter = heuristicTokenizer
): number => countText(content, tokenizer);

export const estimateTurnTokens = (
  turn: Pick<Turn, 'files'>,
  tokenizer: TokenizerAdapter = heuristicTokenizer
): number => {
  let tokens = 0;
  for (const file of turn.files) {
    if (file.content === undefined) {
      throw new Error(`missing cached content for tokenization: ${file.name}`);
    }
    const content =
      file.extension === 'md' ? stripFrontMatter(file.content) : file.content;
    tokens += countText(content, tokenizer) + tokenizer.messageOverheadTokens;
  }
  return tokens;
};

export const estimateTotalTokens = (turns: Turn[]): number =>
  turns.reduce((sum, turn) => sum + turn.estimatedTokens, 0);
