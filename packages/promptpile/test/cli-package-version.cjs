'use strict';

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const packageRoot = path.join(__dirname, '..');
const metadata = require(path.join(packageRoot, 'package.json'));
const result = spawnSync(process.execPath, [path.join(packageRoot, 'dist', 'index.js'), '--version'], {
  cwd: packageRoot,
  encoding: 'utf8',
  env: { ...process.env, NODE_NO_WARNINGS: '1' }
});

assert.strictEqual(result.status, 0, result.stderr);
assert.strictEqual(result.stdout.trim(), metadata.version);
console.log('cli-package-version.cjs: ok');
