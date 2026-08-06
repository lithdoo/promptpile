import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ArchiveDomainError,
  enumerateSearchableArtifacts,
  resolveArchiveSearchOptions,
} from './index';

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

const rejectsWithCode = async (
  action: () => Promise<unknown>,
  code: ArchiveDomainError['code']
): Promise<void> => {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof ArchiveDomainError);
    assert.equal(error.code, code);
    return true;
  });
};

describe('search domain', () => {
  it('resolves literal search defaults and validates query options', () => {
    assert.deepEqual(
      resolveArchiveSearchOptions({
        query: '  literal.*text  ',
        roles: ['assistant', 'assistant'],
      }),
      {
        query: '  literal.*text  ',
        limit: 20,
        roles: ['assistant'],
        includeToolResults: false,
        caseSensitive: false,
      }
    );

    for (const options of [
      { query: '' },
      { query: '   ' },
      { query: 'two\nlines' },
      { query: 'ok', limit: 0 },
      { query: 'ok', limit: 101 },
      { query: 'ok', limit: 1.5 },
      { query: 'ok', roles: [''] },
    ]) {
      assert.throws(
        () => resolveArchiveSearchOptions(options),
        (error: unknown) => {
          assert.ok(error instanceof ArchiveDomainError);
          assert.equal(error.code, 'INVALID_QUERY');
          return true;
        }
      );
    }
  });

  it('enumerates only declared authoritative artifacts in deterministic order', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-enumerate-'));
    writeArchive(root, 2, [1, 2], {
      '[1]user.md': 'one',
      '[2]assistant.md': 'two',
      '[2]assistant.result.jsonl': 'result',
      '[99]user.md': 'not declared',
      '.summary.md': 'private',
      'derived.index.json': 'derived',
    });
    writeArchive(root, 4, [3, 4], {
      '[3]user.json': 'three',
      '[4]Custom.md': 'custom',
      '[4]assistant.md': 'four',
      '[4]assistant.calls.jsonl': 'calls',
      '[4]assistant.extra.json': 'extra',
      '[4]assistant.result.jsonl': 'result',
      '.promptpile-compress.lock': 'private',
    });
    try {
      const artifacts = await enumerateSearchableArtifacts(root);
      assert.deepEqual(
        artifacts.map(({ archiveIdx, turnIdx, role, fileKind, name }) => ({
          archiveIdx,
          turnIdx,
          role,
          fileKind,
          name,
        })),
        [
          {
            archiveIdx: 4,
            turnIdx: 4,
            role: 'Custom',
            fileKind: 'message',
            name: '[4]Custom.md',
          },
          {
            archiveIdx: 4,
            turnIdx: 4,
            role: 'assistant',
            fileKind: 'message',
            name: '[4]assistant.md',
          },
          {
            archiveIdx: 4,
            turnIdx: 4,
            role: 'assistant',
            fileKind: 'calls',
            name: '[4]assistant.calls.jsonl',
          },
          {
            archiveIdx: 4,
            turnIdx: 4,
            role: 'assistant',
            fileKind: 'extra',
            name: '[4]assistant.extra.json',
          },
          {
            archiveIdx: 4,
            turnIdx: 3,
            role: 'user',
            fileKind: 'message',
            name: '[3]user.json',
          },
          {
            archiveIdx: 2,
            turnIdx: 2,
            role: 'assistant',
            fileKind: 'message',
            name: '[2]assistant.md',
          },
          {
            archiveIdx: 2,
            turnIdx: 1,
            role: 'user',
            fileKind: 'message',
            name: '[1]user.md',
          },
        ]
      );
      assert.ok(artifacts.every((artifact) => path.isAbsolute(artifact.path)));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('applies case-sensitive role and tool-result filters', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-filter-'));
    writeArchive(root, 2, [1, 2], {
      '[1]Assistant.md': 'custom casing',
      '[2]assistant.md': 'answer',
      '[2]assistant.result.jsonl': 'result',
    });
    try {
      const assistant = await enumerateSearchableArtifacts(root, {
        roles: ['assistant'],
        includeToolResults: true,
      });
      assert.deepEqual(
        assistant.map(({ name }) => name),
        ['[2]assistant.md', '[2]assistant.result.jsonl']
      );
      const upper = await enumerateSearchableArtifacts(root, {
        roles: ['Assistant'],
      });
      assert.deepEqual(upper.map(({ name }) => name), ['[1]Assistant.md']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed for no archives and declared turns without artifacts', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-no-archive-'));
    const invalid = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-no-turn-'));
    writeArchive(invalid, 2, [1, 2], { '[2]assistant.md': 'two' });
    try {
      await rejectsWithCode(
        () => enumerateSearchableArtifacts(empty),
        'NO_ARCHIVE'
      );
      await rejectsWithCode(
        () => enumerateSearchableArtifacts(invalid),
        'INVALID_ARCHIVE'
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(invalid, { recursive: true, force: true });
    }
  });
});
