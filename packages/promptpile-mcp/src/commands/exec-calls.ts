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
  parseExecCallsResponseBody,
  postExecCalls,
  truncateBody,
} from '../exec-calls/post-exec';
import { scanCallsJsonlFiles } from '../exec-calls/scan-call-files';
import {
  writeResultJsonlForCallsFile,
  writeResultJsonlToPath,
} from '../exec-calls/write-result-jsonl';

function warnSkippedResult(
  callsPath: string,
  report: CallsStatusReport
): void {
  if (report.status === 'partial') {
    console.warn(
      `promptpile-mcp: warning: result 不完整，缺少 ${report.missing.join(', ')}；已跳过 ${callsPath}。使用 check 查看状态，确认后通过 --overwrite-results 重新执行。`
    );
  } else if (report.status === 'invalid') {
    console.warn(
      `promptpile-mcp: warning: result 状态无效（${report.error ?? 'unknown'}）；已跳过 ${callsPath}。使用 check 查看状态，确认后通过 --overwrite-results 重新执行。`
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

  if (!overwrite && fs.existsSync(resultOutPath)) {
    const report = checkCallsStatus(inputPath, resultOutPath);
    if (report.status === 'partial' || report.status === 'invalid') {
      warnSkippedResult(inputPath, report);
    } else {
      console.error(
        `promptpile-mcp: 已存在 result，跳过（使用 --overwrite-results 可覆盖）: ${resultOutPath}`
      );
    }
    return 0;
  }

  let calls;
  try {
    calls = parseCallJsonlFile(inputPath);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }

  if (calls.length === 0) {
    console.error(`promptpile-mcp: 跳过空文件: ${inputPath}`);
    return 1;
  }

  const httpRes = await postExecCalls(baseUrlNorm, token, calls, {
    signal: opts.signal,
    timeoutMs: opts.requestTimeoutMs,
  });
  if (!httpRes.ok) {
    console.error(
      `promptpile-mcp: exec-calls HTTP ${httpRes.status}: ${truncateBody(httpRes.bodyText)}`
    );
    return 1;
  }

  let body: ReturnType<typeof parseExecCallsResponseBody>;
  try {
    body = parseExecCallsResponseBody(httpRes.bodyText);
  } catch (e) {
    console.error(
      `promptpile-mcp: exec-calls ${e instanceof Error ? e.message : String(e)}`
    );
    return 1;
  }

  writeResultJsonlToPath(resultOutPath, calls, body.results);
  console.log(`promptpile-mcp: 已写入 ${resultOutPath}`);
  return 0;
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

  if (!overwrite) {
    for (const ref of allRefs) {
      if (!fs.existsSync(ref.resultAbsPath)) continue;
      const report = checkCallsStatus(ref.absPath, ref.resultAbsPath);
      warnSkippedResult(ref.absPath, report);
    }
  }

  const toProcess = overwrite
    ? allRefs
    : allRefs.filter((r) => !fs.existsSync(r.resultAbsPath));

  if (toProcess.length === 0) {
    console.error(
      'promptpile-mcp: 全部 *.calls.jsonl 已有配对 result，未执行（使用 --overwrite-results 可覆盖）'
    );
    return 0;
  }

  let wroteAny = false;
  for (const { absPath, resultAbsPath } of toProcess) {
    if (opts.signal?.aborted) return 130;
    let calls;
    try {
      calls = parseCallJsonlFile(absPath);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      return 1;
    }

    if (calls.length === 0) {
      console.error(`promptpile-mcp: 跳过空文件: ${absPath}`);
      continue;
    }

    const httpRes = await postExecCalls(baseUrlNorm, token, calls, {
      signal: opts.signal,
      timeoutMs: opts.requestTimeoutMs,
    });
    if (!httpRes.ok) {
      console.error(
        `promptpile-mcp: exec-calls HTTP ${httpRes.status}: ${truncateBody(httpRes.bodyText)}`
      );
      return 1;
    }

    let body: ReturnType<typeof parseExecCallsResponseBody>;
    try {
      body = parseExecCallsResponseBody(httpRes.bodyText);
    } catch (e) {
      console.error(
        `promptpile-mcp: exec-calls ${e instanceof Error ? e.message : String(e)}`
      );
      return 1;
    }

    writeResultJsonlForCallsFile(absPath, calls, body.results);
    wroteAny = true;
    console.log(`promptpile-mcp: 已写入 ${resultAbsPath}`);
  }

  if (!wroteAny) {
    console.error(
      'promptpile-mcp: 所有 call 文件均为空，未写入任何 result.jsonl'
    );
    return 1;
  }

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
