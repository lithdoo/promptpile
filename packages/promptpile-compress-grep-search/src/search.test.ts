import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { searchArchive } from './index';

const writeArchive = (
  root: string,
  archiveIdx: number,
  turnIndices: number[],
  files: Record<string, string>
): void => {
  const archive = path.join(root, `[${archiveIdx}]system.md.archive`);
  fs.mkdirSync(archive);
  fs.writeFileSync(
    path.join(archive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: turnIndices })
  );
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(archive, name), content);
  }
};

const snapshot = (root: string): string[] => {
  const walk = (directory: string, prefix = ''): string[] =>
    fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        const relative = path.join(prefix, entry.name);
        return entry.isDirectory()
          ? walk(absolute, relative)
          : [`${relative}:${fs.readFileSync(absolute).toString('base64')}`];
      });
  return walk(root);
};

describe('searchArchive', () => {
  it('aggregates Chinese, Markdown, JSON, and JSONL matches by newest turn', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-search-'));
    writeArchive(root, 2, [1, 2], {
      '[1]user.md': '需要迁移数据库',
      '[2]assistant.md': '先执行 PostgreSQL migration',
      '[2]assistant.calls.jsonl': '{"query":"数据库 migration"}\n',
    });
    writeArchive(root, 4, [3, 4], {
      '[3]user.json': '{"request":"数据库 migration"}',
      '[4]assistant.md': 'DATABASE MIGRATION completed',
      '[4]assistant.result.jsonl': '{"private":"数据库 migration result"}\n',
    });
    const before = snapshot(root);
    try {
      const response = await searchArchive(root, {
        query: 'database migration',
      });
      assert.deepEqual(
        response.results.map(({ turnIdx, matches }) => ({
          turnIdx,
          files: matches.map(({ sourceFile }) => sourceFile),
        })),
        [{ turnIdx: 4, files: ['[4]assistant.md'] }]
      );
      const caseSensitive = await searchArchive(root, {
        query: 'database migration',
        caseSensitive: true,
      });
      assert.deepEqual(caseSensitive.results, []);

      const chinese = await searchArchive(root, { query: '数据库' });
      assert.deepEqual(
        chinese.results.map(({ turnIdx, matches }) => ({
          turnIdx,
          files: matches.map(({ sourceFile }) => sourceFile),
        })),
        [
          { turnIdx: 3, files: ['[3]user.json'] },
          {
            turnIdx: 2,
            files: ['[2]assistant.calls.jsonl'],
          },
          { turnIdx: 1, files: ['[1]user.md'] },
        ]
      );
      assert.equal(chinese.truncated, false);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies turn limit and tool-result filters', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-search-limit-'));
    writeArchive(root, 2, [1, 2], {
      '[1]user.md': 'needle',
      '[2]assistant.md': 'needle',
      '[2]assistant.result.jsonl': 'result-only-token\n',
    });
    try {
      const limited = await searchArchive(root, { query: 'needle', limit: 1 });
      assert.deepEqual(limited.results.map(({ turnIdx }) => turnIdx), [2]);
      assert.equal(limited.truncated, true);

      const excluded = await searchArchive(root, { query: 'result-only-token' });
      assert.deepEqual(excluded, { results: [], truncated: false });
      const included = await searchArchive(root, {
        query: 'result-only-token',
        includeToolResults: true,
      });
      assert.deepEqual(
        included.results[0].matches.map(({ fileKind }) => fileKind),
        ['result']
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports truncation for a line beyond the internal safety bound', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-search-long-'));
    writeArchive(root, 1, [1], {
      '[1]user.md': `${'x'.repeat(100_001)}\n`,
    });
    try {
      const response = await searchArchive(root, { query: 'not-present' });
      assert.deepEqual(response.results, []);
      assert.equal(response.truncated, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('stops at the global match safety limit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-search-global-'));
    const turnIndices = Array.from({ length: 11 }, (_, index) => index + 1);
    const files = Object.fromEntries(
      turnIndices.map((turnIdx) => [
        `[${turnIdx}]user.md`,
        `${Array.from({ length: 100 }, () => 'hit').join('\n')}\n`,
      ])
    );
    writeArchive(root, 11, turnIndices, files);
    try {
      const response = await searchArchive(root, { query: 'hit' });
      assert.equal(response.results.length, 10);
      assert.equal(
        response.results.reduce(
          (total, result) => total + result.matches.length,
          0
        ),
        1_000
      );
      assert.equal(response.truncated, true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
