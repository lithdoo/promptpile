'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
assert.deepStrictEqual(packageJson.dependencies, { 'promptpile-protocol': '0.1.0-beta.1' });
assert.strictEqual(packageJson.main, undefined, 'v1 exposes a CLI contract, not a public library entry point');
const forbiddenImport = /(?:from\s+|require\s*\()['"](?:promptpile|promptpile-[^/'"]+)\/(?:src|dist)\//;
for (const name of fs.readdirSync(path.join(__dirname, '../src'))) {
  if (!name.endsWith('.ts')) continue;
  const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  assert.doesNotMatch(source, forbiddenImport, name);
}
console.log('fork package ownership boundary ok');
