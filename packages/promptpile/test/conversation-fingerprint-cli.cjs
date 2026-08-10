'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-fingerprint-cli-'));

const run = (args, extraEnv = {}) => spawnSync(process.execPath, [cli, ...args], {
  cwd: tmp,
  encoding: 'utf8',
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: '',
    PROMPTPILE_API_KEY: '',
    ...extraEnv
  }
});

const snapshot = directory => Object.fromEntries(
  fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => [entry.name, fs.readFileSync(path.join(directory, entry.name)).toString('base64')])
);

try {
  const conversationHelp = run(['conversation', '--help']);
  assert.strictEqual(conversationHelp.status, 0, conversationHelp.stderr);
  assert.match(conversationHelp.stdout, /fingerprint/);

  const commandHelp = run(['conversation', 'fingerprint', '--help']);
  assert.strictEqual(commandHelp.status, 0, commandHelp.stderr);
  assert.match(commandHelp.stdout, /--format <format>/);
  assert.match(commandHelp.stdout, /choices: "text", "json"/);

  fs.writeFileSync(path.join(tmp, 'promptpile.toml'), 'deliberately invalid TOML');
  const messages = path.join(tmp, 'messages');
  fs.mkdirSync(messages);
  fs.writeFileSync(path.join(messages, '[0]system.md'), Buffer.from([0xef, 0xbb, 0xbf, 0x0a]));
  fs.writeFileSync(path.join(messages, '[1]assistant.calls.jsonl'), 'not JSON at all');
  fs.writeFileSync(path.join(messages, '[1]assistant.extra.json'), '{broken');
  fs.writeFileSync(path.join(messages, 'ignored.txt'), 'ignored');
  fs.mkdirSync(path.join(messages, 'nested'));
  fs.writeFileSync(path.join(messages, 'nested', '[9]user.md'), 'ignored nested');

  const before = snapshot(messages);
  const text = run(['conversation', 'fingerprint', '-d', 'messages']);
  assert.strictEqual(text.status, 0, text.stderr);
  assert.strictEqual(text.stderr, '');
  assert.match(text.stdout, /^promptpile-conversation-v1:sha256:[0-9a-f]{64}\n$/);

  const json = run(['conversation', 'fingerprint', '--directory', messages, '--format', 'json']);
  assert.strictEqual(json.status, 0, json.stderr);
  assert.strictEqual(json.stderr, '');
  const parsed = JSON.parse(json.stdout);
  assert.deepStrictEqual(Object.keys(parsed), [
    'schemaVersion',
    'fingerprintVersion',
    'algorithm',
    'artifactCount',
    'maxIndex',
    'fingerprint'
  ]);
  assert.strictEqual(parsed.schemaVersion, 1);
  assert.strictEqual(parsed.fingerprintVersion, 1);
  assert.strictEqual(parsed.algorithm, 'sha256');
  assert.strictEqual(parsed.artifactCount, 3);
  assert.strictEqual(parsed.maxIndex, 1);
  assert.strictEqual(`${parsed.fingerprint}\n`, text.stdout);
  assert.deepStrictEqual(snapshot(messages), before, 'fingerprint is read-only');

  const empty = path.join(tmp, 'empty');
  fs.mkdirSync(empty);
  const emptyResult = run(['conversation', 'fingerprint', '-d', 'empty', '--format', 'json']);
  assert.strictEqual(emptyResult.status, 0, emptyResult.stderr);
  assert.deepStrictEqual(JSON.parse(emptyResult.stdout), {
    schemaVersion: 1,
    fingerprintVersion: 1,
    algorithm: 'sha256',
    artifactCount: 0,
    maxIndex: null,
    fingerprint: 'promptpile-conversation-v1:sha256:498248e5b997616e75071150e4d4e28f02ef0542c5292058a21efea8fb5865ee'
  });

  const invalidFormat = run([
    'conversation', 'fingerprint', '-d', 'messages', '--format', 'yaml'
  ]);
  assert.strictEqual(invalidFormat.status, 1);
  assert.strictEqual(invalidFormat.stdout, '');
  assert.match(invalidFormat.stderr, /allowed choices are text, json/i);

  const repeatedDirectory = run([
    'conversation', 'fingerprint', '-d', 'messages', '-d', 'empty'
  ]);
  assert.strictEqual(repeatedDirectory.status, 1);
  assert.strictEqual(repeatedDirectory.stdout, '');
  assert.match(repeatedDirectory.stderr, /--directory may only be specified once/);

  const missing = run(['conversation', 'fingerprint', '-d', 'missing']);
  assert.strictEqual(missing.status, 1);
  assert.strictEqual(missing.stdout, '');
  assert.match(missing.stderr, /directory does not exist/);

  const fileTarget = path.join(tmp, 'not-a-directory');
  fs.writeFileSync(fileTarget, 'file');
  const notDirectory = run(['conversation', 'fingerprint', '-d', fileTarget]);
  assert.strictEqual(notDirectory.status, 1);
  assert.strictEqual(notDirectory.stdout, '');
  assert.match(notDirectory.stderr, /is not a directory/);

  console.log('conversation fingerprint CLI tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
