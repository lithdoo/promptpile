import fs from 'fs';
import path from 'path';
import { parseToolCallV1 } from 'promptpile-protocol/tool';

import { OBSERVE_DECISION_TOOL_NAME } from './observe-decision-tool';

/** 与 `promptpile` 的 `callsPathForMainOutput` 一致。 */
export function callsPathForMainOutput(resolvedMainPath: string): string {
  const { dir, name } = path.parse(resolvedMainPath);
  return path.join(dir, `${name}.calls.jsonl`);
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 与 {@link parseObserveDecisionFromCallsFile} 相同成功语义，但：
 * ToolCall 的通用结构由 promptpile-protocol 校验；React 只拥有工具名和 decision 语义。
 */
export function parseObserveDecisionFromCallsFileStrict(
  callsPath: string,
  toolName: string = OBSERVE_DECISION_TOOL_NAME
): boolean {
  if (!fs.existsSync(callsPath)) {
    throw new Error(`calls 文件不存在: ${callsPath}`);
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
    const call = parseToolCallV1(obj);
    if (call === undefined) {
      throw new Error('calls.jsonl 行不是合法 ToolCallV1');
    }
    if (call.function.name !== toolName) {
      continue;
    }
    let args: unknown;
    try {
      args = JSON.parse(call.function.arguments);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`工具 ${toolName} 的 arguments JSON 无效: ${msg}`);
    }
    if (!isRecord(args)) {
      throw new Error(`工具 ${toolName} 的 arguments 解析后不是 JSON 对象`);
    }
    if (typeof args.decision !== 'boolean') {
      throw new Error(`工具 ${toolName} 的 arguments.decision 必须是 boolean`);
    }
    return args.decision;
  }

  throw new Error(`calls.jsonl 中缺少工具 ${toolName}`);
}
