import fs from 'fs';
import path from 'path';

import { OBSERVE_DECISION_TOOL_NAME } from './observe-decision-tool';

/** 与 `promptpile` 的 `callsPathForMainOutput` 一致。 */
export function callsPathForMainOutput(resolvedMainPath: string): string {
  const { dir, name } = path.parse(resolvedMainPath);
  return path.join(dir, `${name}.calls.jsonl`);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 读取 `.calls.jsonl`（每行一个 OpenAI `tool_calls` 元素 JSON）。
 * 任一行匹配 `toolName` 且 `arguments.decision === true` 则返回 `true`；否则 `false`（含解析失败、无文件）。
 */
export function parseObserveDecisionFromCallsFile(
  callsPath: string,
  toolName: string = OBSERVE_DECISION_TOOL_NAME
): boolean {
  if (!fs.existsSync(callsPath)) {
    return false;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(callsPath, 'utf8');
  } catch {
    return false;
  }

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '') {
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(t);
    } catch {
      return false;
    }
    if (!isRecord(obj)) {
      return false;
    }
    const fn = obj.function;
    if (!isRecord(fn)) {
      continue;
    }
    if (fn.name !== toolName) {
      continue;
    }
    const argsStr = fn.arguments;
    if (typeof argsStr !== 'string') {
      return false;
    }
    let args: unknown;
    try {
      args = JSON.parse(argsStr);
    } catch {
      return false;
    }
    if (!isRecord(args)) {
      return false;
    }
    if (args.decision === true) {
      return true;
    }
  }

  return false;
}

/**
 * 与 {@link parseObserveDecisionFromCallsFile} 相同成功语义，但：
 * - 文件不存在 → `false`（合法：无 `decision:true`）；
 * - `readFileSync` 失败、非空行非法 JSON、目标工具行格式非法 → **抛 `Error`**（由调用方转为 `PromptpileReactInvocationError`）。
 */
export function parseObserveDecisionFromCallsFileStrict(
  callsPath: string,
  toolName: string = OBSERVE_DECISION_TOOL_NAME
): boolean {
  if (!fs.existsSync(callsPath)) {
    return false;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(callsPath, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`无法读取 calls 文件: ${msg}`);
  }

  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (t === '') {
      continue;
    }
    let obj: unknown;
    try {
      obj = JSON.parse(t);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`calls.jsonl 含非法 JSON 行: ${msg}`);
    }
    if (!isRecord(obj)) {
      throw new Error('calls.jsonl 行解析后不是 JSON 对象');
    }
    const fn = obj.function;
    if (!isRecord(fn)) {
      continue;
    }
    if (fn.name !== toolName) {
      continue;
    }
    const argsStr = fn.arguments;
    if (typeof argsStr !== 'string') {
      throw new Error(`工具 ${toolName} 的 function.arguments 不是字符串`);
    }
    let args: unknown;
    try {
      args = JSON.parse(argsStr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`工具 ${toolName} 的 arguments JSON 无效: ${msg}`);
    }
    if (!isRecord(args)) {
      throw new Error(`工具 ${toolName} 的 arguments 解析后不是 JSON 对象`);
    }
    if (args.decision === true) {
      return true;
    }
  }

  return false;
}
