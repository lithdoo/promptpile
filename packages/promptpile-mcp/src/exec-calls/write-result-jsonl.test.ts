import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it } from 'node:test';
import type { ExecCallItem, ExecCallResult } from '../http/types';
import {
  writeResultJsonlForCallsFile,
  writeResultJsonlToPath,
} from './write-result-jsonl';

const calls: ExecCallItem[] = [
  { id: 'call-1', type: 'function', function: { name: 'first', arguments: '{}' } },
  { id: 'call-2', type: 'function', function: { name: 'second', arguments: '{}' } },
];

const results: ExecCallResult[] = [
  {
    toolCallId: 'call-1',
    ok: true,
    content: { value: 1 },
    attempts: 1,
    durationMs: 10,
  },
  {
    toolCallId: 'call-2',
    ok: false,
    error: 'failed',
    attempts: 2,
    durationMs: 25,
  },
];

const temporaryFiles = (directory: string): string[] =>
  fs.readdirSync(directory).filter((name) => name.includes('.tmp-'));

describe('writeResultJsonl', () => {
  it('atomically replaces output and preserves call order', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-result-'));
    try {
      const output = path.join(directory, 'custom.result.jsonl');
      fs.writeFileSync(output, 'old\n', 'utf8');
      writeResultJsonlToPath(output, calls, results);

      const rows = fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      assert.deepStrictEqual(rows, [
        {
          tool_call_id: 'call-1',
          content: '{"value":1}',
          name: 'first',
          execution: { ok: true, attempts: 1, duration_ms: 10 },
        },
        {
          tool_call_id: 'call-2',
          content: 'failed',
          name: 'second',
          execution: {
            ok: false,
            attempts: 2,
            duration_ms: 25,
            error: 'failed',
          },
        },
      ]);
      assert.deepStrictEqual(temporaryFiles(directory), []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects an incomplete gateway result vector', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-missing-result-'));
    try {
      const output = path.join(directory, 'missing.result.jsonl');
      assert.throws(
        () => writeResultJsonlToPath(output, calls.slice(0, 1), []),
        /完整向量/
      );
      assert.equal(fs.existsSync(output), false);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes the paired result path for a calls file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-paired-'));
    try {
      const callsPath = path.join(directory, '[2]assistant.calls.jsonl');
      fs.writeFileSync(callsPath, '', 'utf8');
      writeResultJsonlForCallsFile(callsPath, calls.slice(0, 1), results.slice(0, 1));

      assert.ok(fs.existsSync(path.join(directory, '[2]assistant.result.jsonl')));
      assert.deepStrictEqual(temporaryFiles(directory), []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('cleans up the temporary file when commit fails', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-failed-'));
    try {
      const targetDirectory = path.join(directory, 'target.result.jsonl');
      fs.mkdirSync(targetDirectory);
      assert.throws(() => writeResultJsonlToPath(targetDirectory, calls, results));
      assert.ok(fs.statSync(targetDirectory).isDirectory());
      assert.deepStrictEqual(temporaryFiles(directory), []);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
