import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { compressDirectory } from 'promptpile-compress';
import { discoverArchives, readArchivedTurn } from './index';

const snapshot = (directory: string): string[] =>
  fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? snapshot(target).map((item) => `${entry.name}/${item}`)
        : [`${entry.name}:${fs.readFileSync(target).toString('base64')}`];
    });

it('reads a producer archive through public package boundaries without mutation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-integration-'));
  fs.writeFileSync(path.join(root, '[1]user.md'), 'question');
  fs.writeFileSync(path.join(root, '[2]assistant.md'), 'answer');
  fs.writeFileSync(
    path.join(root, '[2]assistant.calls.jsonl'),
    '{"name":"read_file"}\n'
  );
  fs.writeFileSync(
    path.join(root, '[2]assistant.result.jsonl'),
    '{"status":"ok"}\n'
  );
  fs.writeFileSync(path.join(root, '[3]user.md'), 'latest');
  try {
    const produced = await compressDirectory({
      directory: root,
      threshold: 0,
      keepRecent: 1,
    });
    assert.equal(produced.compressed, true);
    const beforeRead = snapshot(root);
    const archives = await discoverArchives(root);
    assert.deepEqual(archives[0].archivedTurnIndices, [1, 2]);
    const turn = await readArchivedTurn(root, 2);
    assert.deepEqual(
      turn?.artifacts.map(({ fileKind }) => fileKind),
      ['calls', 'message', 'result']
    );
    assert.deepEqual(snapshot(root), beforeRead);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
