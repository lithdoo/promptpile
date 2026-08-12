import fs from 'fs';
import path from 'path';
import { normalizeGatewayBaseUrl } from '../export/url';
import {
  checkCallsStatus,
  type CallsStatusReport,
} from '../exec-calls/check-status';
import {
  resultAbsPathForCallFile,
  stemFromCallsBasename,
} from '../exec-calls/calls-paths';
import { parseCallJsonlFile } from '../exec-calls/parse-call-jsonl';
import {
  acquireExecutionClaim,
  releaseExecutionClaim,
  type ExecutionClaim,
} from '../exec-calls/execution-claim';
import {
  parseExecCallsResponseBody,
  postExecCalls,
  truncateBody,
} from '../exec-calls/post-exec';
import { scanCallsJsonlFiles } from '../exec-calls/scan-call-files';
import { writeResultJsonlToPath } from '../exec-calls/write-result-jsonl';

function reportInvalidExistingResult(
  callsPath: string,
  report: CallsStatusReport
): void {
  if (report.status === 'partial') {
    console.warn(
      `promptpile-mcp: result 不完整，缺少 ${report.missing.join(', ')}；拒绝执行 ${callsPath}。确认副作用后可显式使用 --overwrite-results。`
    );
  } else if (report.status === 'invalid') {
    console.warn(
      `promptpile-mcp: result 状态无效（${report.error ?? 'unknown'}）；拒绝执行 ${callsPath}。确认副作用后可显式使用 --overwrite-results。`
    );
  }
}

export type ExecCallsCliOptions = {
  baseUrl: string;
  /** 目录模式：扫描根目录；未设置时用 `process.cwd()`；与 `input` 互斥 */
  dir?: string;
  /** 单文件模式：仅此 `.calls.jsonl`；与 `dir` 互斥 */
  input?: string;
  /** 单文件模式：result 输出路径；省略则同目录 `stem.result.jsonl`（仅当 input 为 `.calls.jsonl`） */
  output?: string;
  /** 可选；请求网关时在 Authorization 中发送 Bearer token */
  token?: string;
  /** 为 true 时覆盖已存在的 result；默认仅处理尚无 result 的项 */
  overwriteResults?: boolean;
  requestTimeoutMs?: number;
  signal?: AbortSignal;
};

const PRE_EXECUTION_HTTP_STATUSES = new Set([400, 401, 404, 405, 413, 415]);

function releaseBeforeExecution(claim: ExecutionClaim): void {
  releaseExecutionClaim(claim);
}

async function executeCallsFile(
  callsPath: string,
  resultOutPath: string,
  opts: ExecCallsCliOptions,
  baseUrlNorm: string,
  token: string | undefined,
  overwrite: boolean
): Promise<'written' | 'skipped' | 'failed'> {
  const parent = path.dirname(resultOutPath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    console.error(`promptpile-mcp: result 父目录不存在或不是目录: ${parent}`);
    return 'failed';
  }

  if (!overwrite && fs.existsSync(resultOutPath)) {
    const report = checkCallsStatus(callsPath, resultOutPath);
    if (report.status === 'complete') {
      console.log(`promptpile-mcp: 已存在完整 result，安全跳过: ${resultOutPath}`);
      return 'skipped';
    }
    reportInvalidExistingResult(callsPath, report);
    return 'failed';
  }

  let claim: ExecutionClaim;
  try {
    claim = acquireExecutionClaim(callsPath, resultOutPath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 'failed';
  }

  // Close the pre-check/acquire TOCTOU seam.
  if (!overwrite && fs.existsSync(resultOutPath)) {
    const report = checkCallsStatus(callsPath, resultOutPath);
    if (report.status === 'complete') {
      try { releaseBeforeExecution(claim); } catch (error) {
        console.warn(`promptpile-mcp: warning: ${error instanceof Error ? error.message : String(error)}`);
      }
      return 'skipped';
    }
    try { releaseBeforeExecution(claim); } catch { /* the original failure remains primary */ }
    reportInvalidExistingResult(callsPath, report);
    return 'failed';
  }

  let calls;
  try {
    calls = parseCallJsonlFile(callsPath);
    if (calls.length === 0) throw new Error(`promptpile-mcp: calls 文件为空: ${callsPath}`);
    const ids = new Set(calls.map((call) => call.id));
    if (ids.size !== calls.length) throw new Error(`promptpile-mcp: calls 包含重复 id: ${callsPath}`);
  } catch (error) {
    try { releaseBeforeExecution(claim); } catch { /* parser failure remains primary */ }
    console.error(error instanceof Error ? error.message : String(error));
    return 'failed';
  }

  let httpRes;
  try {
    httpRes = await postExecCalls(baseUrlNorm, token, calls, {
      signal: opts.signal,
      timeoutMs: opts.requestTimeoutMs,
    });
  } catch (error) {
    console.error(`promptpile-mcp: gateway 执行状态不确定，claim 已保留: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
  if (!httpRes.ok) {
    if (PRE_EXECUTION_HTTP_STATUSES.has(httpRes.status)) {
      try { releaseBeforeExecution(claim); } catch { /* HTTP failure remains primary */ }
    }
    console.error(`promptpile-mcp: exec-calls HTTP ${httpRes.status}: ${truncateBody(httpRes.bodyText)}`);
    return 'failed';
  }

  let body: ReturnType<typeof parseExecCallsResponseBody>;
  try {
    body = parseExecCallsResponseBody(httpRes.bodyText, calls);
  } catch (error) {
    console.error(`promptpile-mcp: gateway 响应不确定，claim 已保留: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
  try {
    writeResultJsonlToPath(resultOutPath, calls, body.results);
  } catch (error) {
    console.error(`promptpile-mcp: result 发布失败，claim 已保留: ${error instanceof Error ? error.message : String(error)}`);
    return 'failed';
  }
  try {
    releaseExecutionClaim(claim);
  } catch (error) {
    console.warn(`promptpile-mcp: warning: result 已发布，但 claim 清理失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  console.log(`promptpile-mcp: 已写入 ${resultOutPath}`);
  return 'written';
}

async function runExecCallsSingleFile(
  opts: ExecCallsCliOptions,
  baseUrlNorm: string,
  token: string | undefined,
  overwrite: boolean
): Promise<number> {
  const rawInput = opts.input?.trim();
  if (!rawInput) {
    console.error('promptpile-mcp: --input 不能为空');
    return 1;
  }

  const inputPath = path.resolve(rawInput);
  if (!fs.existsSync(inputPath)) {
    console.error(`promptpile-mcp: 输入文件不存在: ${inputPath}`);
    return 1;
  }
  const st = fs.statSync(inputPath);
  if (!st.isFile()) {
    console.error(`promptpile-mcp: --input 须为普通文件: ${inputPath}`);
    return 1;
  }

  const base = path.basename(inputPath);
  const stem = stemFromCallsBasename(base);
  if (stem === undefined) {
    console.error(
      'promptpile-mcp: --input 须为有效 .calls.jsonl 路径（去掉后缀后 stem 非空）'
    );
    return 1;
  }

  let resultOutPath: string;
  if (opts.output !== undefined && opts.output.trim() !== '') {
    resultOutPath = path.resolve(opts.output.trim());
  } else {
    resultOutPath = resultAbsPathForCallFile(inputPath, stem);
  }

  const outcome = await executeCallsFile(inputPath, resultOutPath, opts, baseUrlNorm, token, overwrite);
  return outcome === 'failed' ? 1 : 0;
}

async function runExecCallsDirectory(
  opts: ExecCallsCliOptions,
  baseUrlNorm: string,
  token: string | undefined,
  overwrite: boolean
): Promise<number> {
  const root = path.resolve(opts.dir ?? process.cwd());
  if (!fs.existsSync(root)) {
    console.error(`promptpile-mcp: 目录不存在: ${root}`);
    return 1;
  }
  const st = fs.statSync(root);
  if (!st.isDirectory()) {
    console.error(`promptpile-mcp: 不是目录: ${root}`);
    return 1;
  }

  const allRefs = scanCallsJsonlFiles(root);

  if (allRefs.length === 0) {
    console.error('promptpile-mcp: 未发现 *.calls.jsonl，无可执行内容');
    return 1;
  }

  let wroteAny = false;
  let failed = false;
  for (const { absPath, resultAbsPath } of allRefs) {
    if (opts.signal?.aborted) return 130;
    const outcome = await executeCallsFile(absPath, resultAbsPath, opts, baseUrlNorm, token, overwrite);
    if (outcome === 'written') wroteAny = true;
    if (outcome === 'failed') failed = true;
  }
  if (failed) return 1;
  if (!wroteAny) console.log('promptpile-mcp: 所有选中项均已有完整 result，未执行');
  return 0;
}

/**
 * **目录模式**：仅扫描 `--dir` 第一层的 `*.calls.jsonl` → POST → 同目录 `stem.result.jsonl`。
 * **单文件模式**：`--input` 指定单个 `.calls.jsonl`，`--output` 可选（默认同目录配对）。
 * `--input` 与 `--dir` 互斥。默认跳过已存在配对 result；`--overwrite-results` 覆盖。
 */
export async function runExecCalls(
  opts: ExecCallsCliOptions
): Promise<number> {
  const controller = new AbortController();
  const abort = (): void => controller.abort(new Error('cancelled'));
  const onExternalAbort = (): void => abort();
  if (opts.signal?.aborted) abort();
  else opts.signal?.addEventListener('abort', onExternalAbort, { once: true });
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  const effectiveOpts = { ...opts, signal: controller.signal };

  try {
    const hasInput = opts.input !== undefined && String(opts.input).trim() !== '';
    const hasExplicitDir = opts.dir !== undefined;
    if (opts.output !== undefined && opts.output.trim() !== '' && !hasInput) {
      console.error('promptpile-mcp: 使用 --output 时必须同时指定 --input');
      return 1;
    }
    if (hasInput && hasExplicitDir) {
      console.error('promptpile-mcp: 不能同时使用 --input 与 --dir');
      return 1;
    }
    const overwrite = opts.overwriteResults === true;
    const baseUrlNorm = normalizeGatewayBaseUrl(opts.baseUrl);
    const token = opts.token !== undefined && opts.token !== '' ? opts.token : undefined;
    const code = hasInput
      ? await runExecCallsSingleFile(effectiveOpts, baseUrlNorm, token, overwrite)
      : await runExecCallsDirectory(effectiveOpts, baseUrlNorm, token, overwrite);
    return controller.signal.aborted ? 130 : code;
  } catch (e) {
    if (controller.signal.aborted) {
      console.error('promptpile-mcp: exec-calls 已取消');
      return 130;
    }
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`promptpile-mcp: exec-calls 失败: ${msg}`);
    return 1;
  } finally {
    opts.signal?.removeEventListener('abort', onExternalAbort);
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}
