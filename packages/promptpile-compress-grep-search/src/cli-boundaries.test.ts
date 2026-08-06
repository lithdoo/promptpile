import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { runArchiveCli, type ArchiveCliIo } from './cli';

const capture = async (args: string[]) => {
  let stdout = '';
  let stderr = '';
  const io: ArchiveCliIo = {
    stdout: { write: (content) => (stdout += content) },
    stderr: { write: (content) => (stderr += content) },
  };
  const code = await runArchiveCli(args, io);
  return { code, stdout, stderr };
};

describe('promptpile-archive CLI argument boundaries', () => {
  it('returns help without requiring a command or directory', async () => {
    for (const flag of ['--help', '-h']) {
      const result = await capture([flag]);
      assert.equal(result.code, 0);
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.stderr, '');
    }
  });

  it('rejects missing, unknown, and malformed top-level arguments', async () => {
    const cases: Array<[string[], RegExp]> = [
      [[], /command is required/],
      [['unknown', '-d', '.'], /unknown command/],
      [['list'], /directory is required/],
      [['list', '-d', '   '], /directory is required/],
      [['list', '-d', '.', '--unknown'], /Unknown option/],
    ];
    for (const [args, expected] of cases) {
      const result = await capture(args);
      assert.equal(result.code, 2, args.join(' '));
      assert.equal(result.stdout, '');
      assert.match(result.stderr, expected);
    }
  });

  it('validates command-specific positionals and options', async () => {
    const cases: Array<[string[], RegExp]> = [
      [['list', '-d', '.', 'extra'], /does not accept positional/],
      [['list', '-d', '.', '--limit', '1'], /does not support option/],
      [['search', '-d', '.'], /exactly one query/],
      [['search', '-d', '.', 'a', 'b'], /exactly one query/],
      [['search', '-d', '.', 'q', '--limit', '1.5'], /limit must be an integer/],
      [['read', '-d', '.'], /exactly one turnIdx/],
      [['read', '-d', '.', '--', '-1'], /non-negative integer/],
      [['read', '-d', '.', '1.5'], /non-negative integer/],
      [['read', '-d', '.', '9007199254740992'], /safe non-negative integer/],
      [['read', '-d', '.', '1', '--role', 'user'], /does not support option/],
      [['mcp', '-d', '.', 'extra'], /does not accept positional/],
      [['mcp', '-d', '.', '--limit', '1'], /does not support option/],
    ];
    for (const [args, expected] of cases) {
      const result = await capture(args);
      assert.equal(result.code, 2, args.join(' '));
      assert.match(result.stderr, expected);
    }
  });

  it('uses JSON failure envelopes even when parsing fails', async () => {
    const result = await capture(['read', '-d', '.', '--json', '--', '-1']);
    assert.equal(result.code, 2);
    assert.equal(result.stdout, '');
    assert.deepEqual(JSON.parse(result.stderr), {
      ok: false,
      error: {
        code: 'INVALID_QUERY',
        message: 'turnIdx must be a non-negative integer: -1',
      },
    });
  });

  it('maps unexpected filesystem failures to IO_ERROR', async () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-cli-file-')),
      'not-a-directory'
    );
    fs.writeFileSync(file, 'x');
    try {
      const result = await capture(['list', '-d', file]);
      assert.equal(result.code, 1);
      assert.match(result.stderr, /Error \[IO_ERROR\]/);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});
