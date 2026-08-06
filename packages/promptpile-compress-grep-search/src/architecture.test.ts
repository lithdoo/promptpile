import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

it('production reader does not import compression implementation details', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
  assert.doesNotMatch(source, /promptpile-compress|\.\.\/promptpile-compress/);
  assert.doesNotMatch(source, /\/src\/|\/dist\//);
});
