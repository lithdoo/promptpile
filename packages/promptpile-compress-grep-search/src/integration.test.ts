import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { it } from 'node:test';
import { compressDirectory } from 'promptpile-compress';
import { discoverArchives, readArchivedTurn, searchArchive } from './index';

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
      ['message', 'calls', 'result']
    );
    assert.deepEqual(snapshot(root), beforeRead);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it('searches only the explicitly selected layered output directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-layered-output-'));
  const base = path.join(root, 'base');
  const output = path.join(root, 'session-output');
  fs.mkdirSync(base);
  fs.mkdirSync(output);

  const baseArchive = path.join(base, '[1]system.md.archive');
  fs.mkdirSync(baseArchive);
  fs.writeFileSync(
    path.join(baseArchive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: [1] })
  );
  fs.writeFileSync(path.join(baseArchive, '[1]user.md'), 'base-only-needle');

  fs.writeFileSync(path.join(output, '[1]user.md'), 'session-only-needle question');
  fs.writeFileSync(path.join(output, '[2]assistant.md'), 'session-only-needle answer');
  fs.writeFileSync(path.join(output, '[3]user.md'), 'latest');

  try {
    const produced = await compressDirectory({
      directory: output,
      threshold: 0,
      keepRecent: 1,
    });
    assert.equal(produced.compressed, true);
    const baseBefore = snapshot(base);
    const outputBefore = snapshot(output);

    const sessionSearch = await searchArchive(output, { query: 'session-only-needle' });
    assert.deepEqual(sessionSearch.results.map(({ turnIdx }) => turnIdx), [2, 1]);
    const noCrossLayerSearch = await searchArchive(output, { query: 'base-only-needle' });
    assert.deepEqual(noCrossLayerSearch.results, []);
    const explicitBaseSearch = await searchArchive(base, { query: 'base-only-needle' });
    assert.deepEqual(explicitBaseSearch.results.map(({ turnIdx }) => turnIdx), [1]);

    assert.deepEqual(snapshot(base), baseBefore);
    assert.deepEqual(snapshot(output), outputBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
