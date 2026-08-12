import { randomUUID } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type McpExecutionClaimV1 = {
  schema_version: 1;
  token: string;
  pid: number;
  host: string;
  created_at: string;
  calls_path: string;
  result_path: string;
};

export type ExecutionClaim = {
  path: string;
  metadata: McpExecutionClaimV1;
};

export class ExecutionClaimConflictError extends Error {
  constructor(readonly claimPath: string) {
    super(`promptpile-mcp: execution claim 已存在，拒绝自动重放: ${claimPath}`);
  }
}

export function executionClaimPath(resultPath: string): string {
  return `${path.resolve(resultPath)}.promptpile-mcp.exec.claim`;
}

export function observeExecutionClaim(resultPath: string): string | undefined {
  const claimPath = executionClaimPath(resultPath);
  return fs.existsSync(claimPath) ? claimPath : undefined;
}

export function acquireExecutionClaim(
  callsPath: string,
  resultPath: string
): ExecutionClaim {
  const resolvedCalls = path.resolve(callsPath);
  const resolvedResult = path.resolve(resultPath);
  const claimPath = executionClaimPath(resolvedResult);
  const metadata: McpExecutionClaimV1 = {
    schema_version: 1,
    token: randomUUID(),
    pid: process.pid,
    host: os.hostname(),
    created_at: new Date().toISOString(),
    calls_path: resolvedCalls,
    result_path: resolvedResult,
  };
  let fd: number;
  try {
    fd = fs.openSync(claimPath, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new ExecutionClaimConflictError(claimPath);
    }
    throw error;
  }
  try {
    fs.writeFileSync(fd, `${JSON.stringify(metadata)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } catch (error) {
    try { fs.unlinkSync(claimPath); } catch { /* preserve original error */ }
    throw error;
  } finally {
    fs.closeSync(fd);
  }
  return { path: claimPath, metadata };
}

export function releaseExecutionClaim(claim: ExecutionClaim): void {
  let current: unknown;
  try {
    current = JSON.parse(fs.readFileSync(claim.path, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(
      `promptpile-mcp: 无法验证 execution claim owner: ${claim.path}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (typeof current !== 'object' || current === null ||
      (current as { token?: unknown }).token !== claim.metadata.token) {
    throw new Error(`promptpile-mcp: execution claim owner token 不匹配: ${claim.path}`);
  }
  fs.unlinkSync(claim.path);
}
