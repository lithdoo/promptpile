import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { CLI_DESCRIPTION, parseCli } from './index';

describe('promptpile-compress CLI', () => {
  it('describes only lifecycle mutation capabilities', () => {
    assert.match(CLI_DESCRIPTION, /压缩、归档与恢复/);
    assert.doesNotMatch(CLI_DESCRIPTION, /检索|搜索|lookup_archive/);
  });

  it('rejects mixing legacy threshold with explicit budget flags', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-cli-budget-'));
    const originalError = console.error;
    const errors: string[] = [];
    console.error = (...values: unknown[]) => errors.push(values.join(' '));
    try {
      const code = await parseCli([
        'node',
        'promptpile-compress',
        'compress',
        '--directory',
        root,
        '--threshold',
        '0',
        '--model-context',
        '1000',
      ]);
      assert.equal(code, 1);
      assert.match(errors.join('\n'), /threshold.*budget/);
    } finally {
      console.error = originalError;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
