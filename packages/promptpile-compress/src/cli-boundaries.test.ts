import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

const cliEntry = path.join(__dirname, 'index.js');

const runCli = (args: string[]) => {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
};

describe('promptpile-compress CLI boundaries', () => {
  it('provides help and rejects unknown or incomplete commands', () => {
    const help = runCli(['--help']);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /compress/);
    assert.match(help.stdout, /restore/);

    for (const args of [['unknown'], ['compress'], ['restore']]) {
      const result = runCli(args);
      assert.equal(result.status, 1, args.join(' '));
    }
  });

  it('rejects every malformed numeric and enum option before mutation', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-cli-invalid-'));
    try {
      const cases: Array<[string[], RegExp]> = [
        [['--threshold', 'no'], /threshold.*整数/],
        [['--keep-recent', 'no'], /keep-recent.*整数/],
        [['--model-context', 'no'], /model-context.*整数/],
        [['--reserved-output', 'no'], /reserved-output.*整数/],
        [['--system-tool-overhead', 'no'], /system-tool-overhead.*整数/],
        [['--target-live-history', 'no'], /target-live-history.*整数/],
        [['--summary-output', 'no'], /summary-output.*整数/],
        [['--safety-margin', 'no'], /safety-margin.*整数/],
        [['--strategy', 'future'], /不支持的压缩策略/],
        [['--tokenizer', 'approximate'], /不支持的 tokenizer/],
      ];
      for (const [extra, expected] of cases) {
        const result = runCli(['compress', '-d', root, ...extra]);
        assert.equal(result.status, 1, extra.join(' '));
        assert.match(result.stderr, expected);
        assert.deepEqual(fs.readdirSync(root), []);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('reports no-op compress and restore operations without changing the directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-cli-noop-'));
    try {
      const compress = runCli(['compress', '-d', root, '--dry-run']);
      assert.equal(compress.status, 0);
      assert.match(compress.stdout, /预算:/);
      assert.match(compress.stdout, /跳过压缩:/);

      const restore = runCli(['restore', '-d', root, '--dry-run']);
      assert.equal(restore.status, 0);
      assert.match(restore.stdout, /跳过还原:/);
      assert.deepEqual(fs.readdirSync(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('returns failure for unavailable directories in both commands', () => {
    const missing = path.join(os.tmpdir(), `ppc-missing-${process.pid}-${Date.now()}`);
    for (const command of ['compress', 'restore']) {
      const result = runCli([command, '-d', missing]);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(`promptpile-compress ${command}:`));
    }
  });
});
