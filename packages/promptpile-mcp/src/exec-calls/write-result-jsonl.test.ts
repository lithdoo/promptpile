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
    toolCallId: 'call-2',
    ok: false,
    error: 'failed',
    attempts: 2,
    durationMs: 25,
  },
  {
    toolCallId: 'call-1',
    ok: true,
    content: { value: 1 },
    attempts: 1,
    durationMs: 10,
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

  it('records missing gateway results as execution metadata', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-missing-result-'));
    try {
      const output = path.join(directory, 'missing.result.jsonl');
      writeResultJsonlToPath(output, calls.slice(0, 1), []);
      const row = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.deepStrictEqual(row.execution, {
        ok: false,
        attempts: 0,
        duration_ms: 0,
        error: 'missing_gateway_result',
      });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('writes the paired result path for a calls file', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ppm-paired-'));
    try {
      const callsPath = path.join(directory, '[2]assistant.calls.jsonl');
      fs.writeFileSync(callsPath, '', 'utf8');
      writeResultJsonlForCallsFile(callsPath, calls.slice(0, 1), results);

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
