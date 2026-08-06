import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ArchiveDomainError } from './contracts';
import {
  DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS,
  NodeLiteralSearchBackend,
} from './node-literal-search';
import type {
  ArchiveSearchBackendEvent,
  ArchiveSearchSafetyLimits,
  SearchableArtifact,
} from './search-domain';

const limits = (
  overrides: Partial<ArchiveSearchSafetyLimits> = {}
): ArchiveSearchSafetyLimits => ({
  ...DEFAULT_ARCHIVE_SEARCH_SAFETY_LIMITS,
  ...overrides,
});

const artifactFor = (filePath: string): SearchableArtifact => ({
  archiveIdx: 2,
  turnIdx: 2,
  role: 'assistant',
  fileKind: 'message',
  name: path.basename(filePath),
  path: filePath,
});

const collect = async (
  artifact: SearchableArtifact,
  query: string,
  safetyLimits: ArchiveSearchSafetyLimits,
  signal?: AbortSignal
): Promise<ArchiveSearchBackendEvent[]> => {
  const events: ArchiveSearchBackendEvent[] = [];
  const backend = new NodeLiteralSearchBackend();
  for await (const event of backend.search([artifact], {
    query,
    caseSensitive: false,
    safetyLimits,
    signal,
  })) {
    events.push(event);
  }
  return events;
};

describe('Node literal search backend', () => {
  it('matches literal metacharacters and preserves line numbers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-scanner-'));
    const file = path.join(root, '[2]assistant.md');
    fs.writeFileSync(file, 'first\n中文 Literal.*[x]\nlast\n');
    try {
      const events = await collect(
        artifactFor(file),
        'literal.*[x]',
        limits()
      );
      assert.deepEqual(events, [
        {
          type: 'match',
          match: {
            archiveIdx: 2,
            turnIdx: 2,
            role: 'assistant',
            fileKind: 'message',
            sourceFile: '[2]assistant.md',
            snippet: '中文 Literal.*[x]',
            line: 2,
          },
        },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('bounds long lines and reports line truncation', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-long-line-'));
    const file = path.join(root, '[2]assistant.md');
    fs.writeFileSync(file, `${'a'.repeat(32)}needle\n`);
    try {
      const events = await collect(
        artifactFor(file),
        'needle',
        limits({ maxLineCharacters: 16 })
      );
      assert.deepEqual(events, [
        { type: 'truncated', reason: 'line_limit' },
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('matches across stream chunks and bounds the returned snippet', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-chunks-'));
    const file = path.join(root, '[2]assistant.md');
    fs.writeFileSync(file, `${'a'.repeat(65_534)}needle${'z'.repeat(100)}\n`);
    try {
      const events = await collect(
        artifactFor(file),
        'needle',
        limits({
          maxLineCharacters: 100_000,
          maxSnippetCharacters: 40,
        })
      );
      assert.equal(events.length, 1);
      const event = events[0];
      assert.equal(event.type, 'match');
      if (event.type === 'match') {
        assert.equal(event.match.snippet.length, 40);
        assert.match(event.match.snippet, /needle/);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('enforces the per-turn match limit deterministically', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-match-limit-'));
    const file = path.join(root, '[2]assistant.md');
    fs.writeFileSync(file, 'hit\nhit\nhit\n');
    try {
      const events = await collect(
        artifactFor(file),
        'hit',
        limits({ maxMatchesPerTurn: 2 })
      );
      assert.equal(events.filter((event) => event.type === 'match').length, 2);
      assert.deepEqual(events.at(-1), {
        type: 'truncated',
        reason: 'match_limit',
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('maps an aborted scan to SEARCH_TIMEOUT', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-timeout-'));
    const file = path.join(root, '[2]assistant.md');
    fs.writeFileSync(file, 'content');
    const controller = new AbortController();
    controller.abort();
    try {
      await assert.rejects(
        () => collect(artifactFor(file), 'content', limits(), controller.signal),
        (error: unknown) => {
          assert.ok(error instanceof ArchiveDomainError);
          assert.equal(error.code, 'SEARCH_TIMEOUT');
          return true;
        }
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
