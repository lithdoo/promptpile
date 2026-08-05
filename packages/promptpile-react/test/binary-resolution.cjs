'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const {
  getPromptpileSpawnConfig,
  resolveDeclaredPackageBin
} = require(path.join(root, 'dist', 'promptpile-invoker.js'));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-bin-resolution-'));
const previousOverride = process.env.PROMPTPILE_BIN;

try {
  delete process.env.PROMPTPILE_BIN;
  const packageDirectory = path.join(tmp, 'object-bin-package');
  const customDirectory = path.join(packageDirectory, 'custom-entry');
  const customCli = path.join(customDirectory, 'promptpile-cli.js');
  const packageJson = path.join(packageDirectory, 'package.json');
  fs.mkdirSync(customDirectory, { recursive: true });
  fs.writeFileSync(customCli, '#!/usr/bin/env node\n');
  fs.writeFileSync(packageJson, JSON.stringify({
    name: 'promptpile',
    bin: { promptpile: 'custom-entry/promptpile-cli.js' }
  }));

  assert.strictEqual(
    resolveDeclaredPackageBin(packageJson, 'promptpile'),
    customCli,
    'object-form bin resolves the declared nonstandard entry'
  );
  assert.deepStrictEqual(
    getPromptpileSpawnConfig({ packageJsonPath: packageJson }),
    {
      command: process.execPath,
      argvPrefix: [customCli],
      displayName: `node "${customCli}"`
    }
  );

  const stringPackageDirectory = path.join(tmp, 'string-bin-package');
  const stringCli = path.join(stringPackageDirectory, 'cli.cjs');
  const stringPackageJson = path.join(stringPackageDirectory, 'package.json');
  fs.mkdirSync(stringPackageDirectory);
  fs.writeFileSync(stringCli, '');
  fs.writeFileSync(stringPackageJson, JSON.stringify({ name: 'promptpile', bin: 'cli.cjs' }));
  assert.strictEqual(resolveDeclaredPackageBin(stringPackageJson, 'promptpile'), stringCli);

  fs.writeFileSync(
    stringPackageJson,
    JSON.stringify({ name: 'promptpile', bin: { another: 'cli.cjs' } })
  );
  assert.strictEqual(resolveDeclaredPackageBin(stringPackageJson, 'promptpile'), null);

  fs.writeFileSync(
    stringPackageJson,
    JSON.stringify({ name: 'promptpile', bin: { promptpile: 'missing.js' } })
  );
  assert.strictEqual(resolveDeclaredPackageBin(stringPackageJson, 'promptpile'), null);

  const outsideCli = path.join(tmp, 'outside.js');
  fs.writeFileSync(outsideCli, '');
  fs.writeFileSync(
    stringPackageJson,
    JSON.stringify({ name: 'promptpile', bin: { promptpile: '../outside.js' } })
  );
  assert.strictEqual(resolveDeclaredPackageBin(stringPackageJson, 'promptpile'), null);

  fs.writeFileSync(stringPackageJson, '{ malformed');
  assert.strictEqual(resolveDeclaredPackageBin(stringPackageJson, 'promptpile'), null);

  assert.deepStrictEqual(
    getPromptpileSpawnConfig({ packageJsonPath: null }),
    { command: 'promptpile', argvPrefix: [], displayName: 'promptpile' },
    'missing package metadata falls back to PATH'
  );

  process.env.PROMPTPILE_BIN = 'custom-promptpile-wrapper';
  assert.deepStrictEqual(
    getPromptpileSpawnConfig({ packageJsonPath: packageJson }),
    {
      command: 'custom-promptpile-wrapper',
      argvPrefix: [],
      displayName: 'custom-promptpile-wrapper'
    },
    'PROMPTPILE_BIN remains the highest-priority override'
  );

  console.log('promptpile-react binary resolution tests ok');
} finally {
  if (previousOverride === undefined) {
    delete process.env.PROMPTPILE_BIN;
  } else {
    process.env.PROMPTPILE_BIN = previousOverride;
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
