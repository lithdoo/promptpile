'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
assert.deepStrictEqual(packageJson.dependencies, {});
const forbidden = /(?:from\s+|require\s*\()['"](?:node:)?(?:fs|path|child_process|net|http|https|os)|promptpile(?:-[^/'"]+)?\/(?:src|dist)\//;
for (const name of fs.readdirSync(path.join(__dirname, '../src'))) {
  if (name.endsWith('.ts')) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), forbidden, name);
}
