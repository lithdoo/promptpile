import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLI_DESCRIPTION } from './index';

describe('promptpile-compress CLI', () => {
  it('describes only lifecycle mutation capabilities', () => {
    assert.match(CLI_DESCRIPTION, /压缩、归档与恢复/);
    assert.doesNotMatch(CLI_DESCRIPTION, /检索|搜索|lookup_archive/);
  });
});
