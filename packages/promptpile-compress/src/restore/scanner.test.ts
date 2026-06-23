import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  findArchiveDirs,
  findStagingDir,
  isMessageFileName,
  listMessageFiles,
  STAGING_DIR,
} from './scanner';

describe('restore scanner', () => {
  it('recognizes promptpile message files only', () => {
    assert.equal(isMessageFileName('[1]user.md'), true);
    assert.equal(isMessageFileName('[2]assistant.calls.jsonl'), true);
    assert.equal(isMessageFileName('[2]assistant.result.jsonl'), true);
    assert.equal(isMessageFileName('[2]assistant.extra.json'), true);
    assert.equal(isMessageFileName('compression.json'), false);
    assert.equal(isMessageFileName('.summary.md'), false);
    assert.equal(isMessageFileName('[2]assistant.calls.txt'), false);
  });

  it('finds archives in descending idx order and ignores nested files', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-scanner-'));
    try {
      fs.mkdirSync(path.join(root, '[3]system.md.archive'));
      fs.mkdirSync(path.join(root, '[9]system.md.archive'));
      fs.mkdirSync(path.join(root, '[5]user.md.archive'));
      fs.writeFileSync(path.join(root, '[7]system.md.archive'), '');

      const archives = await findArchiveDirs(root);
      assert.deepEqual(
        archives.map((archive) => archive.idx),
        [9, 3]
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists only regular message files and finds staging', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-message-files-'));
    try {
      const staging = path.join(root, STAGING_DIR);
      fs.mkdirSync(staging);
      fs.writeFileSync(path.join(staging, '[2]assistant.md'), 'answer');
      fs.writeFileSync(path.join(staging, '[1]user.md'), 'question');
      fs.writeFileSync(path.join(staging, 'compression.json'), '{}');
      fs.mkdirSync(path.join(staging, '[3]assistant.md'));

      assert.equal(await findStagingDir(root), staging);
      assert.deepEqual(await listMessageFiles(staging), [
        '[1]user.md',
        '[2]assistant.md',
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
