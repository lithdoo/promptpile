import path from 'path';
import { atomicWriteUtf8FileSync } from '../atomic-file';
import type { ExecCallItem, ExecCallResult } from '../http/types';
import {
  resultAbsPathForCallFile,
  stemFromCallsBasename,
} from './calls-paths';

function resultContent(result: ExecCallResult): string {
  if (result.ok) {
    const c = result.content;
    if (c === undefined) {
      return '';
    }
    return typeof c === 'string' ? c : JSON.stringify(c);
  }
  return result.error ?? '执行失败';
}

function writeResultLinesToPath(
  outPath: string,
  calls: ExecCallItem[],
  results: ExecCallResult[]
): void {
  const byId = new Map(results.map((r) => [r.toolCallId, r]));
  const lines: string[] = [];

  for (const c of calls) {
    const r = byId.get(c.id);
    const content = r
      ? resultContent(r)
      : `错误：网关未返回 toolCallId=${c.id} 的结果`;

    const execution = r
      ? {
          ok: r.ok,
          attempts: r.attempts ?? 0,
          duration_ms: r.durationMs ?? 0,
          ...(r.error !== undefined ? { error: r.error } : {}),
        }
      : {
          ok: false,
          attempts: 0,
          duration_ms: 0,
          error: 'missing_gateway_result',
        };
    const row: {
      tool_call_id: string;
      content: string;
      name?: string;
      execution: {
        ok: boolean;
        attempts: number;
        duration_ms: number;
        error?: string;
      };
    } = {
      tool_call_id: c.id,
      content,
      execution,
    };
    if (c.function.name) {
      row.name = c.function.name;
    }
    lines.push(JSON.stringify(row));
  }

  atomicWriteUtf8FileSync(
    outPath,
    lines.length > 0 ? `${lines.join('\n')}\n` : ''
  );
}

/**
 * 写入指定路径的 result JSONL。基础字段与 promptpile `ToolResultLine` 对齐，`execution` 保存工具级执行元数据。
 */
export function writeResultJsonlToPath(
  outputAbsPath: string,
  calls: ExecCallItem[],
  results: ExecCallResult[]
): void {
  writeResultLinesToPath(path.resolve(outputAbsPath), calls, results);
}

/**
 * 写入与 `callPath` 同目录的 `stem.result.jsonl`（stem 来自 basename 去掉 `.calls.jsonl`）。
 */
export function writeResultJsonlForCallsFile(
  callPath: string,
  calls: ExecCallItem[],
  results: ExecCallResult[]
): void {
  const base = path.basename(callPath);
  const stem = stemFromCallsBasename(base);
  if (stem === undefined) {
    throw new Error(`writeResultJsonlForCallsFile: not a .calls.jsonl path: ${callPath}`);
  }

  const outPath = resultAbsPathForCallFile(callPath, stem);
  writeResultLinesToPath(outPath, calls, results);
}
