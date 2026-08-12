import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it } from 'node:test';
import {
  acquireExecutionClaim,
  ExecutionClaimConflictError,
  executionClaimPath,
  observeExecutionClaim,
  releaseExecutionClaim,
} from './execution-claim';

describe('execution claim', () => {
  it('acquires exclusively and releases only for the owner token', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-claim-'));
    try {
      const calls = path.join(directory, 'x.calls.jsonl');
      const result = path.join(directory, 'x.result.jsonl');
      const claim = acquireExecutionClaim(calls, result);
      assert.equal(observeExecutionClaim(result), executionClaimPath(result));
      assert.throws(() => acquireExecutionClaim(calls, result), ExecutionClaimConflictError);
      assert.throws(
        () => releaseExecutionClaim({ ...claim, metadata: { ...claim.metadata, token: 'wrong' } }),
        /token 不匹配/
      );
      assert.ok(fs.existsSync(claim.path));
      releaseExecutionClaim(claim);
      assert.equal(observeExecutionClaim(result), undefined);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
