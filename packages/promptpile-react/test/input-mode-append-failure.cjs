'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const reactCli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-input-failure-'));

try {
  const base = path.join(tmp, 'base');
  const messages = path.join(tmp, 'messages');
  const output = path.join(tmp, 'session');
  const logPath = path.join(tmp, 'invocations.jsonl');
  fs.mkdirSync(base);
  fs.mkdirSync(messages);

  const fakeJs = path.join(tmp, 'fake-promptpile.cjs');
  fs.writeFileSync(
    fakeJs,
    [
      "'use strict';",
      "const fs = require('fs');",
      "let stdin = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', chunk => { stdin += chunk; });",
      "process.stdin.on('end', () => {",
      "  const args = process.argv.slice(2);",
      "  args.unshift('conversation');",
      "  fs.appendFileSync(process.env.FAKE_PROMPTPILE_LOG, JSON.stringify({ args, stdin }) + '\\n');",
      "  if (args[0] === 'conversation') {",
      "    console.error('synthetic append failure');",
      "    process.exitCode = 7;",
      "  }",
      "});",
      ''
    ].join('\n')
  );

  // PROMPTPILE_BIN accepts a native executable. Point it at the current Node
  // binary and provide the public `conversation` command as a script fixture.
  // This avoids copying a running .exe, which Windows Node 20 may keep locked.
  fs.copyFileSync(fakeJs, path.join(tmp, 'conversation'));
  const fakeBin = process.execPath;

  const result = spawnSync(
    process.execPath,
    [
      reactCli,
      '--input',
      '--directory', base,
      '--directory', messages,
      '--output-dir', output,
      '--api-key', 'unused-key',
      '--max-step', '1'
    ],
    {
      cwd: tmp,
      input: 'user input\n',
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        PROMPTPILE_BIN: fakeBin,
        FAKE_PROMPTPILE_LOG: logPath
      }
    }
  );

  assert.strictEqual(result.status, 1);
  assert.match(result.stderr, /synthetic append failure/);

  const invocations = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(invocations.length, 1, 'append failure aborts before any React phase starts');
  assert.deepStrictEqual(
    invocations[0].args,
    ['conversation', 'append-user', '-d', output, '--quiet'],
    'terminal input targets the writable output directory'
  );
  assert.strictEqual(invocations[0].stdin, 'user input');
  assert.deepStrictEqual(fs.readdirSync(messages), [], 'failed append writes no conversation files');
  assert.deepStrictEqual(fs.readdirSync(base), [], 'failed append leaves every input layer untouched');
  assert.deepStrictEqual(fs.readdirSync(output), [], 'failed append leaves the output directory empty');

  console.log('promptpile-react input append failure tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
