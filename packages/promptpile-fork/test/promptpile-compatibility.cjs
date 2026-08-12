'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executeConversationFork } = require('../dist/operation');
const { fingerprintConversationDirectory } = require('../../promptpile/dist/conversation-fingerprint');
const { scanDirectory } = require('../../promptpile/dist/file-handler');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-compat-'));
  try {
    const source = path.join(root, 'source'); const target = path.join(root, 'target'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, '[0]system.md'), 'system');
    fs.writeFileSync(path.join(source, '[1]assistant.md'), 'assistant');
    fs.writeFileSync(path.join(source, '[1]assistant.calls.jsonl'), '{"id":"call"}\n');
    fs.writeFileSync(path.join(source, '[2]user.md'), 'excluded');
    const report = await executeConversationFork({ source, target, throughIndex: 1, dryRun: false });
    assert.deepStrictEqual(scanDirectory(target).map(item => item.relativePath), [
      '[0]system.md', '[1]assistant.md', '[1]assistant.calls.jsonl'
    ]);
    assert.strictEqual((await fingerprintConversationDirectory(target)).fingerprint, report.sourcePrefixFingerprint);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
  console.log('fork target is directly consumable by Promptpile');
})().catch(error => { console.error(error); process.exitCode = 1; });
