'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const reactRoot = path.join(__dirname, '..');
const promptpileRoot = path.join(reactRoot, '..', 'promptpile');
const promptpileCli = path.join(promptpileRoot, 'dist', 'index.js');
const { appendUserFromTerminal } = require(path.join(
  reactRoot,
  'dist',
  'append-user-message.js'
));

const spawnConfig = {
  command: process.execPath,
  argvPrefix: [promptpileCli],
  displayName: `node "${promptpileCli}"`
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-append-cli-'));

(async () => {
  try {
    const messages = path.join(tmp, 'messages');
    fs.mkdirSync(messages);

    const content = 'first line\n第二行\n';
    await appendUserFromTerminal(spawnConfig, messages, content, tmp);
    assert.strictEqual(
      fs.readFileSync(path.join(messages, '[0]user.md'), 'utf8'),
      content,
      'React forwards the original multiline content through stdin'
    );

    const beforeFailure = fs.readdirSync(messages).sort();
    await assert.rejects(
      appendUserFromTerminal(
        spawnConfig,
        path.join(tmp, 'missing'),
        'x'.repeat(1024 * 1024),
        tmp
      ),
      /conversation append-user exited with code 1.*directory does not exist/s
    );
    assert.deepStrictEqual(
      fs.readdirSync(messages).sort(),
      beforeFailure,
      'a failed append does not change the conversation directory'
    );

    const missingCommand = {
      command: path.join(tmp, 'missing-promptpile-command'),
      argvPrefix: [],
      displayName: 'missing-promptpile-command'
    };
    await assert.rejects(
      appendUserFromTerminal(missingCommand, messages, 'message', tmp),
      /Unable to run promptpile conversation append-user/
    );

    console.log('promptpile-react append-user CLI tests ok');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
