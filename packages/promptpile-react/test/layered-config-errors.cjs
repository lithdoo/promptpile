'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const reactCli = path.join(root, 'dist', 'index.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-layered-config-errors-'));

const runConfig = (name, body, extraArgs = []) => {
  const cwd = path.join(tmp, name);
  const configPath = path.join(cwd, 'app.toml');
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(configPath, body);
  return spawnSync(
    process.execPath,
    [reactCli, '--config', configPath, '--api-key', 'unused', ...extraArgs],
    { cwd, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } }
  );
};

try {
  const conflicting = runConfig(
    'conflicting',
    '[promptpile-react]\ndir = "one"\ndirs = ["two"]\n'
  );
  assert.strictEqual(conflicting.status, 1);
  assert.match(conflicting.stderr, /dirs and dir cannot be used together/);

  const emptyDirs = runConfig('empty-dirs', '[promptpile-react]\ndirs = []\n');
  assert.strictEqual(emptyDirs.status, 1);
  assert.match(emptyDirs.stderr, /dirs must be a non-empty array/);

  const noOutputCwd = path.join(tmp, 'mutation-without-output');
  fs.mkdirSync(path.join(noOutputCwd, 'one'), { recursive: true });
  fs.mkdirSync(path.join(noOutputCwd, 'two'), { recursive: true });
  const missingOutput = runConfig(
    'mutation-without-output',
    '[promptpile-react]\ndirs = ["one", "two"]\ncontinue = true\n'
  );
  assert.strictEqual(missingOutput.status, 1);
  assert.match(
    missingOutput.stderr,
    /multiple conversation input directories cannot be used.*--output-dir/
  );

  const badOutputCwd = path.join(tmp, 'bad-output');
  fs.mkdirSync(badOutputCwd, { recursive: true });
  fs.writeFileSync(path.join(badOutputCwd, 'not-a-directory'), 'file');
  const badOutput = runConfig(
    'bad-output',
    '[promptpile-react]\noutput_dir = "not-a-directory"\n'
  );
  assert.strictEqual(badOutput.status, 1);
  assert.match(badOutput.stderr, /cannot create, scan, or write conversation output directory/);

  console.log('promptpile-react layered config error tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
