import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ArchiveDomainError,
  discoverArchives,
  readArchivedTurn,
} from './index';

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

describe('Archive Protocol reader', () => {
  it('discovers a valid archive and reads a deterministic turn', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-reader-'));
    const archive = path.join(root, '[2]system.md.archive');
    fs.mkdirSync(archive);
    fs.writeFileSync(
      path.join(archive, 'compression.json'),
      JSON.stringify({ version: 1, archivedTurnIndices: [1, 2], unknown: true })
    );
    fs.writeFileSync(path.join(archive, '[2]assistant.md'), 'answer');
    fs.writeFileSync(path.join(archive, '[1]CustomRole.md'), 'custom');
    fs.writeFileSync(path.join(archive, '[1]ignored.MD'), 'ignored');
    fs.writeFileSync(
      path.join(archive, '[2]Assistant.RESULT.JSONL'),
      'ignored\n'
    );
    fs.writeFileSync(
      path.join(archive, '[2]assistant.result.jsonl'),
      '{"ok":true}\n'
    );
    fs.mkdirSync(path.join(root, '[3]SYSTEM.MD.ARCHIVE'));
    try {
      const archives = await discoverArchives(root);
      assert.deepEqual(archives.map(({ idx }) => idx), [2]);
      const turn = await readArchivedTurn(root, 2, {
        includeToolResults: false,
      });
      assert.deepEqual(turn?.artifacts.map(({ fileKind }) => fileKind), [
        'message',
      ]);
      assert.equal(turn?.artifacts[0].content, 'answer');
      const custom = await readArchivedTurn(root, 1);
      assert.deepEqual(
        custom?.artifacts.map(({ role, name }) => ({ role, name })),
        [{ role: 'CustomRole', name: '[1]CustomRole.md' }]
      );
      await rejectsWithCode(() => readArchivedTurn(root, 9), 'TURN_NOT_FOUND');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects duplicate indices across archives', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-invalid-'));
    for (const idx of [2, 3]) {
      const archive = path.join(root, `[${idx}]system.md.archive`);
      fs.mkdirSync(archive);
      fs.writeFileSync(
        path.join(archive, 'compression.json'),
        JSON.stringify({
          version: 1,
          archivedTurnIndices: idx === 2 ? [1, 2] : [2, 3],
        })
      );
    }
    try {
      await rejectsWithCode(
        () => discoverArchives(root),
        'INVALID_ARCHIVE'
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('orders artifacts according to Conversation Protocol and includes results by default', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-order-'));
    const archive = path.join(root, '[4]system.md.archive');
    fs.mkdirSync(archive);
    fs.writeFileSync(
      path.join(archive, 'compression.json'),
      JSON.stringify({ version: 1, archivedTurnIndices: [4] })
    );
    for (const [name, content] of [
      ['[4]assistant.result.jsonl', 'result'],
      ['[4]assistant.extra.json', 'extra'],
      ['[4]assistant.calls.jsonl', 'calls'],
      ['[4]assistant.md', 'assistant'],
      ['[4]assistant.json', 'assistant json'],
      ['[4]zeta.md', 'zeta'],
      ['[4]Alpha.md', 'alpha'],
      ['[4]用户.md', 'unicode'],
      ['[9007199254740992]user.md', 'unsafe'],
    ]) {
      fs.writeFileSync(path.join(archive, name), content);
    }
    try {
      const turn = await readArchivedTurn(root, 4);
      assert.deepEqual(
        turn.artifacts.map(({ name }) => name),
        [
          '[4]Alpha.md',
          '[4]assistant.json',
          '[4]zeta.md',
          '[4]用户.md',
          '[4]assistant.md',
          '[4]assistant.calls.jsonl',
          '[4]assistant.extra.json',
          '[4]assistant.result.jsonl',
        ]
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns stable error codes for invalid input, missing archives, and invalid manifests', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-empty-'));
    const invalid = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-manifest-'));
    const archive = path.join(invalid, '[1]system.md.archive');
    fs.mkdirSync(archive);
    fs.writeFileSync(path.join(archive, 'compression.json'), '{}');
    try {
      await rejectsWithCode(
        () => readArchivedTurn(empty, -1),
        'INVALID_QUERY'
      );
      await rejectsWithCode(() => readArchivedTurn(empty, 1), 'NO_ARCHIVE');
      await rejectsWithCode(
        () => discoverArchives(invalid),
        'INVALID_ARCHIVE'
      );
      await rejectsWithCode(
        () => discoverArchives(path.join(empty, 'missing')),
        'IO_ERROR'
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(invalid, { recursive: true, force: true });
    }
  });
});
