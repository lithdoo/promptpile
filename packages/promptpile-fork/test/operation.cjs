'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { executeConversationFork } = require('../dist/operation');

const makeCase = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-op-'));
  const source = path.join(root, 'source'); fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, '[01]User.md'), Buffer.from([0, 10, 255]));
  fs.writeFileSync(path.join(source, '[1]assistant.calls.jsonl'), '{malformed\n');
  fs.writeFileSync(path.join(source, '[1]assistant.result.jsonl'), 'also malformed');
  fs.writeFileSync(path.join(source, '[2]assistant.md'), 'above');
  fs.writeFileSync(path.join(source, 'notes.txt'), 'ignored');
  fs.mkdirSync(path.join(source, 'nested'));
  fs.writeFileSync(path.join(source, 'nested', '[0]user.md'), 'nested');
  return { root, source, target: path.join(root, 'target') };
};
const snapshot = directory => Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => [entry.name, crypto.createHash('sha256')
    .update(fs.readFileSync(path.join(directory, entry.name))).digest('hex')]));
const options = item => ({ source: item.source, target: item.target, throughIndex: 1, dryRun: false });

(async () => {
  {
    const item = makeCase(); const before = snapshot(item.source);
    try {
      const report = await executeConversationFork(options(item));
      assert.strictEqual(report.status, 'completed');
      assert.strictEqual(report.artifactCount, 3);
      assert.deepStrictEqual(fs.readdirSync(item.target), [
        '[01]User.md', '[1]assistant.calls.jsonl', '[1]assistant.result.jsonl'
      ]);
      assert.deepStrictEqual(snapshot(item.source), before);
      for (const name of fs.readdirSync(item.target)) {
        assert.deepStrictEqual(fs.readFileSync(path.join(item.target, name)), fs.readFileSync(path.join(item.source, name)));
      }
      assert(!fs.readdirSync(item.root).some(name => name.startsWith('.promptpile-fork.')));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const item = makeCase();
    try {
      const report = await executeConversationFork(options(item), { hooks: {
        afterStagingVerify: () => fs.writeFileSync(path.join(item.source, '[3]user.md'), 'append')
      }});
      assert.strictEqual(report.status, 'completed');
      assert(!fs.existsSync(path.join(item.target, '[3]user.md')));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const item = makeCase();
    try {
      await assert.rejects(executeConversationFork(options(item), { hooks: {
        afterStagingVerify: () => fs.writeFileSync(path.join(item.source, '[0]system.md'), 'changed')
      }}), error => error.code === 'source_unstable');
      assert(!fs.existsSync(item.target));
      assert(!fs.readdirSync(item.root).some(name => name.startsWith('.promptpile-fork.')));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const item = makeCase();
    try {
      await assert.rejects(executeConversationFork(options(item), { hooks: {
        afterStagingCreate: staging => fs.writeFileSync(path.join(staging, '[0]system.md'), 'unexpected')
      }}), error => error.code === 'staging_verify_failed');
      assert(!fs.existsSync(item.target));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  for (const hook of ['afterBaseline', 'beforeStagingCreate', 'afterStagingCreate', 'afterEachCopy',
    'afterStagingVerify', 'afterSourceReobserve', 'beforePublish']) {
    const item = makeCase();
    try {
      await assert.rejects(executeConversationFork(options(item), { hooks: { [hook]: () => { throw new Error(hook); } } }));
      assert(!fs.existsSync(item.target), `${hook} must precede publication`);
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const item = makeCase(); const warnings = [];
    try {
      const report = await executeConversationFork(options(item), {
        hooks: { afterPublish: () => { throw new Error('after publish'); } },
        onWarning: warning => warnings.push(warning)
      });
      assert.strictEqual(report.status, 'completed');
      assert(fs.statSync(item.target).isDirectory());
      assert(warnings.some(value => value.includes('after publish')));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const item = makeCase();
    try {
      await assert.rejects(executeConversationFork(options(item), {
        rename: async () => { const error = new Error('rename injected'); error.code = 'EACCES'; throw error; }
      }), error => error.code === 'publication_failed');
      assert(!fs.existsSync(item.target));
      assert(!fs.readdirSync(item.root).some(name => name.startsWith('.promptpile-fork.')));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const item = makeCase(); const warnings = [];
    try {
      const report = await executeConversationFork(options(item), {
        hooks: { beforeClaimCleanup: () => { throw new Error('cleanup injected'); } },
        onWarning: warning => warnings.push(warning)
      });
      assert.strictEqual(report.status, 'completed');
      assert(warnings.some(value => value.includes('cleanup injected')));
      assert(fs.readdirSync(item.root).some(name => name.startsWith('.promptpile-fork.claim.')));
    } finally { fs.rmSync(item.root, { recursive: true, force: true }); }
  }
  {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fork-empty-'));
    const source = path.join(root, 'source'); fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, '[5]user.md'), 'later');
    try {
      const report = await executeConversationFork({ source, target: path.join(root, 'target'), throughIndex: 0, dryRun: false });
      assert.strictEqual(report.artifactCount, 0);
      assert.deepStrictEqual(fs.readdirSync(path.join(root, 'target')), []);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }
  console.log('fork operation, failure, race, and commit boundary tests ok');
})().catch(error => { console.error(error); process.exitCode = 1; });
