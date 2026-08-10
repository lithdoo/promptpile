'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-inspect-cli-'));

const run = args => spawnSync(process.execPath, [cli, ...args], {
  cwd: tmp,
  encoding: 'utf8',
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: '',
    PROMPTPILE_API_KEY: ''
  }
});

const snapshot = directory => {
  const result = {};
  const visit = (current, relative) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryRelative = path.join(relative, entry.name);
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath, entryRelative);
      } else {
        result[entryRelative] = fs.readFileSync(entryPath).toString('base64');
      }
    }
  };
  visit(directory, '');
  return result;
};

try {
  const conversationHelp = run(['conversation', '--help']);
  assert.strictEqual(conversationHelp.status, 0, conversationHelp.stderr);
  assert.match(conversationHelp.stdout, /Commands:\s+[\s\S]*inspect/);

  const inspectHelp = run(['conversation', 'inspect', '--help']);
  assert.strictEqual(inspectHelp.status, 0, inspectHelp.stderr);
  assert.match(inspectHelp.stdout, /--format <format>/);
  assert.match(inspectHelp.stdout, /choices: "text", "json"/);

  fs.writeFileSync(path.join(tmp, 'promptpile.toml'), 'this is deliberately invalid TOML');
  const messages = path.join(tmp, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]system.md'), 'system');
  fs.writeFileSync(path.join(messages, '[2]assistant.calls.jsonl'), 'invalid is still inspectable');
  fs.writeFileSync(path.join(messages, 'ignored.txt'), 'ignored');
  fs.mkdirSync(path.join(messages, 'nested'));
  fs.writeFileSync(path.join(messages, 'nested', '[9]user.md'), 'nested and ignored');

  const before = snapshot(messages);
  const jsonResult = run(['conversation', 'inspect', '-d', 'messages', '--format', 'json']);
  assert.strictEqual(jsonResult.status, 0, jsonResult.stderr);
  assert.strictEqual(jsonResult.stderr, '');
  const parsed = JSON.parse(jsonResult.stdout);
  assert.strictEqual(parsed.schemaVersion, 1);
  assert.strictEqual(parsed.directory, 'messages');
  assert.strictEqual(parsed.artifactCount, 2);
  assert.strictEqual(parsed.maxIndex, 2);
  assert.deepStrictEqual(
    parsed.artifacts.map(artifact => artifact.path),
    ['[0]system.md', '[2]assistant.calls.jsonl']
  );
  assert.deepStrictEqual(snapshot(messages), before, 'inspect must not modify any artifact');

  const textResult = run(['conversation', 'inspect', '--directory', messages]);
  assert.strictEqual(textResult.status, 0, textResult.stderr);
  assert.strictEqual(textResult.stderr, '');
  assert.match(textResult.stdout, new RegExp(`^Conversation: ${messages.replace(/\\/g, '\\\\')}`));
  assert.match(textResult.stdout, /Artifacts: 2\nMax index: 2\n\n/);
  assert.match(textResult.stdout, /assistant_call\s+assistant\s+jsonl/);

  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  const emptyResult = run(['conversation', 'inspect', '-d', 'empty']);
  assert.strictEqual(emptyResult.status, 0, emptyResult.stderr);
  assert.strictEqual(
    emptyResult.stdout,
    'Conversation: empty\nArtifacts: 0\nMax index: null\n\n'
  );
  assert.strictEqual(emptyResult.stderr, '');

  const invalidFormat = run([
    'conversation', 'inspect', '-d', 'messages', '--format', 'yaml'
  ]);
  assert.strictEqual(invalidFormat.status, 1);
  assert.strictEqual(invalidFormat.stdout, '');
  assert.match(invalidFormat.stderr, /allowed choices are text, json/i);

  const repeatedDirectory = run([
    'conversation', 'inspect', '-d', 'messages', '-d', 'empty'
  ]);
  assert.strictEqual(repeatedDirectory.status, 1);
  assert.strictEqual(repeatedDirectory.stdout, '');
  assert.match(repeatedDirectory.stderr, /--directory may only be specified once/);

  const emptyDirectoryValue = run(['conversation', 'inspect', '-d', '']);
  assert.strictEqual(emptyDirectoryValue.status, 1);
  assert.strictEqual(emptyDirectoryValue.stdout, '');
  assert.match(emptyDirectoryValue.stderr, /--directory must not be empty/);

  const missing = run(['conversation', 'inspect', '-d', 'missing', '--format', 'json']);
  assert.strictEqual(missing.status, 1);
  assert.strictEqual(missing.stdout, '');
  assert.match(missing.stderr, /directory does not exist/);

  const fileTarget = path.join(tmp, 'not-a-directory');
  fs.writeFileSync(fileTarget, 'file');
  const notDirectory = run(['conversation', 'inspect', '-d', fileTarget]);
  assert.strictEqual(notDirectory.status, 1);
  assert.strictEqual(notDirectory.stdout, '');
  assert.match(notDirectory.stderr, /is not a directory/);

  console.log('conversation inspect CLI tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
