import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { compressDirectory, restoreArchivedTurns } from './index';

const snapshot = (directory: string): string[] => {
  const walk = (current: string, prefix = ''): string[] =>
    fs.readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const absolute = path.join(current, entry.name);
        const relative = path.join(prefix, entry.name);
        return entry.isDirectory()
          ? walk(absolute, relative)
          : [`${relative}:${fs.readFileSync(absolute).toString('base64')}`];
      });
  return walk(directory);
};

describe('layered Conversation output lifecycle', () => {
  it('compresses and restores only the explicit output directory byte-for-byte', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppc-layered-output-'));
    const base = path.join(root, 'base-read-only');
    const output = path.join(root, 'session-output');
    fs.mkdirSync(base);
    fs.mkdirSync(output);

    fs.writeFileSync(path.join(base, '[90]system.md'), 'shared immutable context');
    fs.writeFileSync(path.join(base, '[91]assistant.calls.jsonl'), '{"id":"base-call"}\n');
    fs.writeFileSync(path.join(base, '[91]assistant.result.jsonl'), '{"tool_call_id":"base-call"}\n');

    fs.writeFileSync(path.join(output, '[0]user.md'), 'session question');
    fs.writeFileSync(path.join(output, '[1]assistant.md'), 'session answer');
    fs.writeFileSync(path.join(output, '[1]assistant.calls.jsonl'), '{"id":"session-call"}\n');
    fs.writeFileSync(path.join(output, '[1]assistant.result.jsonl'), '{"tool_call_id":"session-call"}\n');
    fs.writeFileSync(path.join(output, '[2]user.md'), 'latest session turn');

    const baseBefore = snapshot(base);
    const outputBefore = snapshot(output);
    const originalMode = fs.statSync(base).mode;
    if (process.platform !== 'win32') fs.chmodSync(base, 0o555);

    try {
      const compressed = await compressDirectory({
        directory: output,
        threshold: 0,
        keepRecent: 1,
      });
      assert.equal(compressed.compressed, true);
      assert.deepEqual(snapshot(base), baseBefore);
      assert.ok(fs.existsSync(path.join(output, '[1]system.md.archive')));

      const restored = await restoreArchivedTurns({ directory: output });
      assert.equal(restored.restored, true);
      assert.deepEqual(snapshot(output), outputBefore);
      assert.deepEqual(snapshot(base), baseBefore, 'base input remains outside lifecycle mutation');
    } finally {
      if (process.platform !== 'win32') fs.chmodSync(base, originalMode & 0o777);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
