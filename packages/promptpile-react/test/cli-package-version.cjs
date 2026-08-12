'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const metadata = require(path.join(root, 'package.json'));
const result = spawnSync(process.execPath, [path.join(root, 'dist', 'index.js'), '--version'], {
  encoding: 'utf8'
});

assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(result.stdout.trim(), metadata.version);
assert.strictEqual(metadata.main, undefined, 'promptpile-react exposes only its CLI bin');
console.log('promptpile-react package version tests ok');
