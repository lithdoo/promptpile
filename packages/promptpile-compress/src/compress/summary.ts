import fs from 'node:fs/promises';
import { estimateTextTokens } from './tokenizer';
import type {
  SemanticSummaryDocument,
  SemanticSummaryItem,
  SemanticSummaryRequest,
  SummaryGenerator,
  SummaryOptions,
  Turn,
  LifecycleErrorCode,
} from './types';

const DEFAULT_TIMEOUT_MS = 60_000;

const semanticSections: Array<{
  key: keyof Omit<SemanticSummaryDocument, 'version'>;
  title: string;
}> = [
  { key: 'goal', title: 'Goal' },
  { key: 'stableFacts', title: 'Stable facts' },
  { key: 'constraints', title: 'Constraints' },
  { key: 'decisions', title: 'Decisions' },
  { key: 'importantToolFindings', title: 'Important tool findings' },
  { key: 'completedWork', title: 'Completed work' },
  { key: 'unresolvedWork', title: 'Unresolved work' },
  { key: 'failedApproaches', title: 'Failed approaches' },
  { key: 'nextActions', title: 'Next actions' },
];

const assertPositiveInteger = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer: ${value}`);
  }
};

const createArchivePointerGenerator = (): SummaryGenerator => ({
  kind: 'archive-pointer',
  async generateSummary(archive) {
    const minIdx = Math.min(...archive.map((turn) => turn.idx));
    const maxIdx = Math.max(...archive.map((turn) => turn.idx));
    const estimatedTokens = archive.reduce(
      (sum, turn) => sum + turn.estimatedTokens,
      0
    );
    return [
      `Conversation turns ${minIdx}-${maxIdx} were archived using Archive Protocol.`,
      'Original-text retrieval depends on a compatible read-only consumer configured by the caller.',
      `The archive contains ${archive.length} turns and approximately ${estimatedTokens} original tokens.`,
    ].join('\n');
  },
});

const normalizeArchive = async (
  archive: Turn[],
  maxInputTokens: number,
  maxOutputTokens: number
): Promise<SemanticSummaryRequest> => {
  const estimatedInputTokens = archive.reduce(
    (sum, turn) => sum + turn.estimatedTokens,
    0
  );
  if (estimatedInputTokens > maxInputTokens) {
    throw new Error(
      `semantic summary input exceeds budget: ${estimatedInputTokens} > ${maxInputTokens}`
    );
  }

  return {
    version: 1,
    turns: await Promise.all(
      [...archive]
        .sort((a, b) => a.idx - b.idx)
        .map(async (turn) => ({
          idx: turn.idx,
          estimatedTokens: turn.estimatedTokens,
          hasToolCalls: turn.hasToolCalls,
          artifacts: await Promise.all(
            [...turn.files]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(async (file) => ({
                name: file.name,
                role: file.role,
                extension: file.extension,
                fileKind: file.fileKind,
                content: file.content ?? (await fs.readFile(file.path, 'utf8')),
              }))
          ),
        }))
    ),
    budget: { estimatedInputTokens, maxInputTokens, maxOutputTokens },
  };
};

const validateItems = (
  key: string,
  value: unknown,
  archivedIndices: Set<number>
): SemanticSummaryItem[] => {
  if (!Array.isArray(value)) {
    throw new Error(`semantic summary field ${key} must be an array`);
  }
  return value.map((candidate, itemIndex) => {
    if (!candidate || typeof candidate !== 'object') {
      throw new Error(`semantic summary field ${key}[${itemIndex}] must be an object`);
    }
    const item = candidate as Record<string, unknown>;
    if (typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw new Error(`semantic summary field ${key}[${itemIndex}].text is empty`);
    }
    if (
      !Array.isArray(item.sourceTurnIndices) ||
      item.sourceTurnIndices.length === 0 ||
      !item.sourceTurnIndices.every(
        (idx) => Number.isInteger(idx) && archivedIndices.has(idx as number)
      )
    ) {
      throw new Error(
        `semantic summary field ${key}[${itemIndex}] has invalid source turn indices`
      );
    }
    return {
      text: item.text.trim(),
      sourceTurnIndices: [...new Set(item.sourceTurnIndices as number[])].sort(
        (a, b) => a - b
      ),
    };
  });
};

export const validateSemanticSummary = (
  value: unknown,
  archivedTurnIndices: number[]
): SemanticSummaryDocument => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('semantic summary provider returned a non-object value');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) {
    throw new Error('semantic summary version must be 1');
  }
  const indices = new Set(archivedTurnIndices);
  const document = { version: 1 } as SemanticSummaryDocument;
  let itemCount = 0;
  for (const { key } of semanticSections) {
    const items = validateItems(key, candidate[key], indices);
    document[key] = items;
    itemCount += items.length;
  }
  if (itemCount === 0) {
    throw new Error('semantic summary must contain at least one sourced item');
  }
  return document;
};

export const renderSemanticSummary = (
  document: SemanticSummaryDocument
): string => {
  const lines = [
    '<!-- promptpile-semantic-summary:v1 -->',
    '# Conversation semantic summary',
  ];
  for (const { key, title } of semanticSections) {
    lines.push('', `## ${title}`);
    const items = document[key];
    if (items.length === 0) {
      lines.push('- None retained.');
      continue;
    }
    for (const item of items) {
      const text = item.text.replace(/\s+/g, ' ').trim();
      lines.push(
        `- ${text} _(sources: ${item.sourceTurnIndices.join(', ')})_`
      );
    }
  }
  return `${lines.join('\n')}\n`;
};

const withTimeout = async <T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number
): Promise<T> => {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`semantic summary provider timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const createSemanticGenerator = (
  options: Extract<SummaryOptions, { kind: 'semantic' }>
): SummaryGenerator => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertPositiveInteger('summary.timeoutMs', timeoutMs);
  if (options.maxInputTokens !== undefined) {
    assertPositiveInteger('summary.maxInputTokens', options.maxInputTokens);
  }
  if (options.maxOutputTokens !== undefined) {
    assertPositiveInteger('summary.maxOutputTokens', options.maxOutputTokens);
  }
  if (!options.provider || typeof options.provider.summarize !== 'function') {
    throw new Error('semantic summary requires a provider');
  }
  if (
    typeof options.provider.id !== 'string' ||
    options.provider.id.trim().length === 0
  ) {
    throw new Error('semantic summary provider id must be non-empty');
  }

  return {
    kind: 'semantic',
    providerId: options.provider.id,
    async generateSummary(archive, generationOptions) {
      const maxOutputTokens = Math.min(
        options.maxOutputTokens ?? generationOptions.maxOutputTokens,
        generationOptions.maxOutputTokens
      );
      assertPositiveInteger('summary.maxOutputTokens', maxOutputTokens);
      const estimatedInputTokens = archive.reduce(
        (sum, turn) => sum + turn.estimatedTokens,
        0
      );
      const maxInputTokens = options.maxInputTokens ?? estimatedInputTokens;
      assertPositiveInteger('summary.maxInputTokens', maxInputTokens);
      const request = await normalizeArchive(
        archive,
        maxInputTokens,
        maxOutputTokens
      );
      let raw: unknown;
      try {
        raw = await withTimeout(
          (signal) => options.provider.summarize(request, signal),
          timeoutMs
        );
      } catch (error) {
        if (error && typeof error === 'object') {
          (
            error as Error & { lifecycleErrorCode?: LifecycleErrorCode }
          ).lifecycleErrorCode = 'SUMMARY_PROVIDER_FAILED';
        }
        throw error;
      }
      const document = validateSemanticSummary(
        raw,
        archive.map((turn) => turn.idx)
      );
      const summary = renderSemanticSummary(document);
      const outputTokens =
        estimateTextTokens(summary, generationOptions.tokenizer) +
        generationOptions.tokenizer.messageOverheadTokens;
      if (outputTokens > maxOutputTokens) {
        throw new Error(
          `semantic summary output exceeds budget: ${outputTokens} > ${maxOutputTokens}`
        );
      }
      return summary;
    },
  };
};

export const createSummaryGenerator = (
  options: SummaryOptions | undefined
): SummaryGenerator => {
  if (!options || options.kind === undefined || options.kind === 'archive-pointer') {
    return createArchivePointerGenerator();
  }
  if (options.kind === 'semantic') {
    return createSemanticGenerator(options);
  }
  throw new Error(`unsupported summary kind: ${(options as { kind: string }).kind}`);
};
