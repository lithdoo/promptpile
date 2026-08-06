import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { discoverArchives, readArchivedTurn } from './index';

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
      assert.equal(await readArchivedTurn(root, 9), null);
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
      await assert.rejects(discoverArchives(root), /duplicate archived turn/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
