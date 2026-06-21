import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it } from 'node:test';
import { checkCallsStatus, statusExitCode } from './check-status';

const call = (id: string): string => JSON.stringify({
  id,
  type: 'function',
  function: { name: 'tool', arguments: '{}' },
});
const result = (id: string): string => JSON.stringify({
  tool_call_id: id,
  content: 'ok',
});

function fixture(): { root: string; calls: string; result: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-check-'));
  const calls = path.join(root, 'turn.calls.jsonl');
  const resultPath = path.join(root, 'turn.result.jsonl');
  fs.writeFileSync(calls, call('a') + '\n' + call('b') + '\n');
  return { root, calls, result: resultPath };
}

describe('checkCallsStatus', () => {
  it('reports pending when result is absent', () => {
    const f = fixture();
    try {
      const report = checkCallsStatus(f.calls);
      assert.equal(report.status, 'pending');
      assert.deepEqual(report.missing, ['a', 'b']);
      assert.equal(statusExitCode(report.status), 1);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports partial when some call ids are missing', () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.result, result('a') + '\n');
      const report = checkCallsStatus(f.calls);
      assert.equal(report.status, 'partial');
      assert.equal(report.calls, 2);
      assert.equal(report.results, 1);
      assert.deepEqual(report.missing, ['b']);
      assert.equal(statusExitCode(report.status), 1);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports complete when every call id has a result', () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.result, result('b') + '\n' + result('a') + '\n');
      const report = checkCallsStatus(f.calls);
      assert.equal(report.status, 'complete');
      assert.deepEqual(report.missing, []);
      assert.equal(statusExitCode(report.status), 0);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports an empty calls file as invalid', () => {
    const f = fixture();
    try {
      fs.writeFileSync(f.calls, '');
      const report = checkCallsStatus(f.calls);
      assert.equal(report.status, 'invalid');
      assert.match(report.error ?? '', /为空/);
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });

  it('reports invalid for duplicate, unknown, or malformed results', () => {
    const f = fixture();
    try {
      const invalidContents = [
        result('a') + '\n' + result('a') + '\n',
        result('unknown') + '\n',
        '{bad json}\n',
      ];
      for (const content of invalidContents) {
        fs.writeFileSync(f.result, content);
        const report = checkCallsStatus(f.calls);
        assert.equal(report.status, 'invalid');
        assert.equal(statusExitCode(report.status), 2);
      }
    } finally {
      fs.rmSync(f.root, { recursive: true, force: true });
    }
  });
});
