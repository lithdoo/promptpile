import fs from 'fs';
import path from 'path';
import type { ExecCallItem } from '../http/types';

function isExecCallItem(x: unknown): x is ExecCallItem {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.type !== 'function') return false;
  const fn = o.function;
  if (typeof fn !== 'object' || fn === null) return false;
  const f = fn as Record<string, unknown>;
  return typeof f.name === 'string' && typeof f.arguments === 'string';
}

/**
 * 解析单个 `*.calls.jsonl`（每行工具调用）；与网关 `isExecCallItem` 规则一致。失败抛错（fail-fast）。
 */
export function parseCallJsonlFile(absPath: string): ExecCallItem[] {
  const raw = fs.readFileSync(absPath, 'utf8');
  const label = path.basename(absPath);
  const lines = raw.split(/\r?\n/);
  const calls: ExecCallItem[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      throw new Error(
        `promptpile-mcp: ${label} 第 ${i + 1} 行不是合法 JSON`
      );
    }
    if (!isExecCallItem(obj)) {
      throw new Error(
        `promptpile-mcp: ${label} 第 ${i + 1} 行不是合法 tool_call（须含 id、type:function、function.name、function.arguments 字符串）`
      );
    }
    calls.push(obj);
  }
  return calls;
}
