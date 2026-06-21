import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it } from 'node:test';
import { scanCallsJsonlFiles } from './scan-call-files';

describe('scanCallsJsonlFiles', () => {
  it('scans only regular calls files in the root directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-scan-'));
    try {
      fs.writeFileSync(path.join(root, 'b.calls.jsonl'), '');
      fs.writeFileSync(path.join(root, 'a.calls.jsonl'), '');
      fs.writeFileSync(path.join(root, 'ignored.jsonl'), '');
      const nested = path.join(root, 'nested');
      fs.mkdirSync(nested);
      fs.writeFileSync(path.join(nested, 'nested.calls.jsonl'), '');

      const refs = scanCallsJsonlFiles(root);
      assert.deepEqual(refs.map((ref) => path.basename(ref.absPath)), [
        'a.calls.jsonl',
        'b.calls.jsonl',
      ]);
      assert.deepEqual(refs.map((ref) => path.dirname(ref.absPath)), [root, root]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not enter a directory whose name ends with calls.jsonl', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-scan-dir-'));
    try {
      fs.mkdirSync(path.join(root, 'fake.calls.jsonl'));
      assert.deepEqual(scanCallsJsonlFiles(root), []);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
