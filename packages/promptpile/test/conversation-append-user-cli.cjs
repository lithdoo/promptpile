'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-conversation-cli-'));

const run = (args, input) => spawnSync(process.execPath, [cli, ...args], {
  cwd: tmp,
  input,
  encoding: 'utf8',
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    OPENAI_API_KEY: '',
    PROMPTPILE_API_KEY: ''
  }
});

try {
  const rootHelp = run(['--help']);
  assert.strictEqual(rootHelp.status, 0, rootHelp.stderr);
  assert.match(rootHelp.stdout, /Commands:\s+[\s\S]*conversation/);

  const conversationHelp = run(['conversation', '--help']);
  assert.strictEqual(conversationHelp.status, 0, conversationHelp.stderr);
  assert.match(conversationHelp.stdout, /Commands:\s+[\s\S]*append-user/);

  const unknownCommand = run(['conversation', 'unknown']);
  assert.strictEqual(unknownCommand.status, 1);
  assert.match(unknownCommand.stderr, /unknown command ['"]unknown['"]/);

  const messages = path.join(tmp, 'messages');
  fs.mkdirSync(messages);

  const multiline = 'first line\nsecond line\n';
  const first = run(['conversation', 'append-user', '-d', 'messages'], multiline);
  assert.strictEqual(first.status, 0, first.stderr);
  assert.strictEqual(first.stderr, '');
  assert.strictEqual(first.stdout, `${path.join(messages, '[0]user.md')}\n`);
  assert.strictEqual(fs.readFileSync(path.join(messages, '[0]user.md'), 'utf8'), multiline);

  const quiet = run(
    ['conversation', 'append-user', '--directory', messages, '--quiet'],
    'quiet message'
  );
  assert.strictEqual(quiet.status, 0, quiet.stderr);
  assert.strictEqual(quiet.stdout, '');
  assert.strictEqual(quiet.stderr, '');
  assert.strictEqual(fs.readFileSync(path.join(messages, '[1]user.md'), 'utf8'), 'quiet message');

  const beforeEmpty = fs.readdirSync(messages).sort();
  const empty = run(['conversation', 'append-user', '-d', messages], ' \r\n\t');
  assert.strictEqual(empty.status, 1);
  assert.match(empty.stderr, /user message is empty/);
  assert.deepStrictEqual(fs.readdirSync(messages).sort(), beforeEmpty, 'empty input writes no file');

  const missing = run(['conversation', 'append-user', '-d', 'missing'], 'message');
  assert.strictEqual(missing.status, 1);
  assert.match(missing.stderr, /directory does not exist/);

  const fileTarget = path.join(tmp, 'not-a-directory');
  fs.writeFileSync(fileTarget, 'file');
  const notDirectory = run(['conversation', 'append-user', '-d', fileTarget], 'message');
  assert.strictEqual(notDirectory.status, 1);
  assert.match(notDirectory.stderr, /is not a directory/);

  assert.ok(
    !fs.readdirSync(messages).some(name => name.includes('.tmp-')),
    'successful commands leave no atomic-write temporary files'
  );

  console.log('conversation append-user CLI tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
