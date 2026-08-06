import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

it('production reader and adapters do not import compression implementation details', () => {
  const sourceDirectory = path.join(__dirname, '../src');
  const source = fs
    .readdirSync(sourceDirectory)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => fs.readFileSync(path.join(sourceDirectory, name), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /promptpile-compress|\.\.\/promptpile-compress/);
  assert.doesNotMatch(source, /\/src\/|\/dist\//);
});
