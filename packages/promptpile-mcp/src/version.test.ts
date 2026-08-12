import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';
import { PACKAGE_VERSION } from './version';

it('uses package metadata as the single version source', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8')) as { version: string };
  assert.equal(PACKAGE_VERSION, pkg.version);
});
