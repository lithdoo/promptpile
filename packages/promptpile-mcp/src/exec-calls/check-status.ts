import fs from 'fs';
import path from 'path';
import { resultAbsPathForCallFile, stemFromCallsBasename } from './calls-paths';
import { parseCallJsonlFile } from './parse-call-jsonl';

export type CallsStatus = 'pending' | 'partial' | 'complete' | 'invalid';

export type CallsStatusReport = {
  status: CallsStatus;
  callsPath: string;
  resultPath: string;
  calls: number;
  results: number;
  missing: string[];
  error?: string;
};

function invalidReport(
  callsPath: string,
  resultPath: string,
  error: unknown,
  calls = 0,
  results = 0
): CallsStatusReport {
  return {
    status: 'invalid',
    callsPath,
    resultPath,
    calls,
    results,
    missing: [],
    error: error instanceof Error ? error.message : String(error),
  };
}

function parseResultIds(resultPath: string): string[] {
  const raw = fs.readFileSync(resultPath, 'utf8');
  const ids: string[] = [];
  for (const [index, source] of raw.split(/\r?\n/).entries()) {
    const line = source.trim();
    if (!line) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(
        `promptpile-mcp: ${path.basename(resultPath)} 第 ${index + 1} 行不是合法 JSON`
      );
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(
        `promptpile-mcp: ${path.basename(resultPath)} 第 ${index + 1} 行须为对象`
      );
    }
    const row = value as Record<string, unknown>;
    if (typeof row.tool_call_id !== 'string' || row.tool_call_id === '') {
      throw new Error(
        `promptpile-mcp: ${path.basename(resultPath)} 第 ${index + 1} 行缺少 tool_call_id`
      );
    }
    if (typeof row.content !== 'string') {
      throw new Error(
        `promptpile-mcp: ${path.basename(resultPath)} 第 ${index + 1} 行缺少字符串 content`
      );
    }
    ids.push(row.tool_call_id);
  }
  return ids;
}

export function checkCallsStatus(
  callsInputPath: string,
  explicitResultPath?: string
): CallsStatusReport {
  const callsPath = path.resolve(callsInputPath);
  const base = path.basename(callsPath);
  const stem = stemFromCallsBasename(base);
  const fallbackResultPath = stem === undefined
    ? path.join(path.dirname(callsPath), base + '.result.jsonl')
    : resultAbsPathForCallFile(callsPath, stem);
  const resultPath = explicitResultPath
    ? path.resolve(explicitResultPath)
    : fallbackResultPath;

  if (!fs.existsSync(callsPath)) {
    return invalidReport(callsPath, resultPath, `promptpile-mcp: calls 文件不存在: ${callsPath}`);
  }
  if (!fs.statSync(callsPath).isFile()) {
    return invalidReport(callsPath, resultPath, `promptpile-mcp: calls 路径不是普通文件: ${callsPath}`);
  }
  if (stem === undefined) {
    return invalidReport(callsPath, resultPath, 'promptpile-mcp: --input 须为有效 .calls.jsonl 路径');
  }

  let callIds: string[];
  try {
    callIds = parseCallJsonlFile(callsPath).map((call) => call.id);
  } catch (error) {
    return invalidReport(callsPath, resultPath, error);
  }
  if (callIds.length === 0) {
    return invalidReport(
      callsPath,
      resultPath,
      'promptpile-mcp: calls 文件为空'
    );
  }
  const callSet = new Set(callIds);
  if (callSet.size !== callIds.length) {
    return invalidReport(callsPath, resultPath, 'promptpile-mcp: calls 包含重复 id', callIds.length);
  }

  if (!fs.existsSync(resultPath)) {
    return {
      status: 'pending',
      callsPath,
      resultPath,
      calls: callIds.length,
      results: 0,
      missing: [...callIds],
    };
  }
  if (!fs.statSync(resultPath).isFile()) {
    return invalidReport(callsPath, resultPath, 'promptpile-mcp: result 路径不是普通文件', callIds.length);
  }

  let resultIds: string[];
  try {
    resultIds = parseResultIds(resultPath);
  } catch (error) {
    return invalidReport(callsPath, resultPath, error, callIds.length);
  }
  const resultSet = new Set(resultIds);
  if (resultSet.size !== resultIds.length) {
    return invalidReport(
      callsPath,
      resultPath,
      'promptpile-mcp: result 包含重复 tool_call_id',
      callIds.length,
      resultIds.length
    );
  }
  const unknown = resultIds.filter((id) => !callSet.has(id));
  if (unknown.length > 0) {
    return invalidReport(
      callsPath,
      resultPath,
      `promptpile-mcp: result 包含未知 tool_call_id: ${unknown.join(', ')}`,
      callIds.length,
      resultIds.length
    );
  }

  const missing = callIds.filter((id) => !resultSet.has(id));
  return {
    status: missing.length === 0 ? 'complete' : 'partial',
    callsPath,
    resultPath,
    calls: callIds.length,
    results: resultIds.length,
    missing,
  };
}

export function statusExitCode(status: CallsStatus): number {
  if (status === 'complete') return 0;
  if (status === 'invalid') return 2;
  return 1;
}
