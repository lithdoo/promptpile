'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');
assert.deepStrictEqual(packageJson.dependencies, {});
const forbiddenImport = /(?:from\s+|require\s*\()['"](?:node:)?(?:fs|path|child_process|net|http|https|os)|promptpile(?:-[^/'"]+)?\/(?:src|dist)\//;
const forbiddenRuntime = /\b(?:process\.(?:env|cwd|on|once|addListener)|setTimeout|setInterval|setImmediate|globalThis\s*[.[])/;
for (const name of fs.readdirSync(path.join(__dirname, '../src'))) {
  if (!name.endsWith('.ts')) continue;
  const source = fs.readFileSync(path.join(__dirname, '../src', name), 'utf8');
  assert.doesNotMatch(source, forbiddenImport, name);
  assert.doesNotMatch(source, forbiddenRuntime, name);
}
