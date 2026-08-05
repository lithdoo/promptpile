'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'dist', 'index.js');

const run = (args, env = {}) => spawnSync(process.execPath, [cli, ...args], {
  cwd: os.tmpdir(),
  encoding: 'utf8',
  env: {
    ...process.env,
    NODE_NO_WARNINGS: '1',
    ...env
  }
});

const secret = 'must-not-appear-in-diagnostics';
const conflict = run([
  '--config', path.join(os.tmpdir(), `promptpile-missing-config-${process.pid}.toml`),
  '--api-key', secret,
  '--api-key-env', 'PROMPTPILE_EXPLICIT_KEY'
], { PROMPTPILE_EXPLICIT_KEY: 'env-secret' });
assert.strictEqual(conflict.status, 1);
assert.match(conflict.stderr, /--api-key and --api-key-env cannot be used together/);
assert.doesNotMatch(conflict.stderr, new RegExp(secret));
assert.doesNotMatch(conflict.stderr, /env-secret/);

const missing = run(
  ['--api-key-env', 'PROMPTPILE_MISSING_EXPLICIT_KEY'],
  { PROMPTPILE_MISSING_EXPLICIT_KEY: undefined }
);
assert.strictEqual(missing.status, 1);
assert.match(
  missing.stderr,
  /API key environment variable is not set or empty: PROMPTPILE_MISSING_EXPLICIT_KEY/
);
assert.doesNotMatch(missing.stderr, /AI API key is required/);

const empty = run(
  ['--api-key-env', 'PROMPTPILE_EMPTY_EXPLICIT_KEY'],
  { PROMPTPILE_EMPTY_EXPLICIT_KEY: '   ' }
);
assert.strictEqual(empty.status, 1);
assert.match(empty.stderr, /API key environment variable is not set or empty/);

console.log('api-key-env CLI tests ok');
