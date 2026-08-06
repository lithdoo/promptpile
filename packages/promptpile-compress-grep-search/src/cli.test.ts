import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const cliEntry = path.join(__dirname, 'cli-entry.js');

const writeArchive = (root: string): void => {
  const archive = path.join(root, '[2]system.md.archive');
  fs.mkdirSync(archive);
  fs.writeFileSync(
    path.join(archive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: [1, 2] })
  );
  fs.writeFileSync(path.join(archive, '[1]user.md'), 'postgres question');
  fs.writeFileSync(path.join(archive, '[2]assistant.md'), 'migration answer');
  fs.writeFileSync(
    path.join(archive, '[2]assistant.result.jsonl'),
    '{"result":"migration result"}\n'
  );
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

const runCli = (
  args: string[]
): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

describe('promptpile-archive CLI', () => {
  it('builds a Node-compatible bin entry and displays help', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')
    ) as { bin?: Record<string, string> };
    assert.equal(packageJson.bin?.['promptpile-archive'], 'dist/cli-entry.js');
    assert.match(fs.readFileSync(cliEntry, 'utf8'), /^#!\/usr\/bin\/env node/);

    const result = runCli(['--help']);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /promptpile-archive search/);
    assert.equal(result.stderr, '');
  });

  it('executes list, search, and read without mutating the archive', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-cli-'));
    writeArchive(root);
    const before = snapshot(root);
    try {
      const list = runCli(['list', '-d', root]);
      assert.equal(list.status, 0);
      assert.match(list.stdout, /Archive 2/);
      assert.match(list.stdout, /Turns: 1, 2/);
      assert.equal(list.stderr, '');

      const search = runCli([
        'search',
        '-d',
        root,
        'migration',
        '--include-tool-results',
      ]);
      assert.equal(search.status, 0);
      assert.match(search.stdout, /Turn 2 \(Archive 2\)/);
      assert.match(search.stdout, /assistant\/message/);
      assert.match(search.stdout, /assistant\/result/);

      const read = runCli(['read', '-d', root, '2', '--no-tool-results']);
      assert.equal(read.status, 0);
      assert.match(read.stdout, /migration answer/);
      assert.doesNotMatch(read.stdout, /migration result/);
      assert.deepEqual(snapshot(root), before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('emits stable JSON success and failure envelopes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-cli-json-'));
    writeArchive(root);
    try {
      const success = runCli(['search', '-d', root, 'migration', '--json']);
      assert.equal(success.status, 0);
      assert.equal(success.stderr, '');
      const successJson = JSON.parse(success.stdout) as {
        ok: boolean;
        data: { results: Array<{ turnIdx: number }>; truncated: boolean };
      };
      assert.equal(successJson.ok, true);
      assert.deepEqual(
        successJson.data.results.map(({ turnIdx }) => turnIdx),
        [2]
      );

      const conflict = runCli([
        'search',
        '-d',
        root,
        'migration',
        '--include-tool-results',
        '--no-tool-results',
        '--json',
      ]);
      assert.equal(conflict.status, 2);
      assert.equal(conflict.stdout, '');
      const failureJson = JSON.parse(conflict.stderr) as {
        ok: boolean;
        error: { code: string };
      };
      assert.deepEqual(failureJson, {
        ok: false,
        error: {
          code: 'INVALID_QUERY',
          message:
            '--include-tool-results and --no-tool-results are mutually exclusive',
        },
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes role, limit, and case-sensitive search options to the domain API', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-cli-options-'));
    writeArchive(root);
    try {
      const role = runCli([
        'search',
        '-d',
        root,
        'postgres',
        '--role',
        'user',
        '--limit',
        '1',
      ]);
      assert.equal(role.status, 0);
      assert.match(role.stdout, /Turn 1/);
      assert.doesNotMatch(role.stdout, /Turn 2/);

      const caseSensitive = runCli([
        'search',
        '-d',
        root,
        'Migration',
        '--case-sensitive',
      ]);
      assert.equal(caseSensitive.status, 0);
      assert.equal(caseSensitive.stdout, 'No archived turns matched.\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses documented error exits for missing archives and turns', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-cli-empty-'));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-cli-missing-'));
    writeArchive(root);
    try {
      const noArchive = runCli(['list', '-d', empty]);
      assert.equal(noArchive.status, 3);
      assert.match(noArchive.stderr, /Error \[NO_ARCHIVE\]/);
      assert.equal(noArchive.stdout, '');

      const noTurn = runCli(['read', '-d', root, '9', '--json']);
      assert.equal(noTurn.status, 3);
      assert.equal(
        (JSON.parse(noTurn.stderr) as { error: { code: string } }).error.code,
        'TURN_NOT_FOUND'
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
