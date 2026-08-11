import { spawn, type SpawnOptions } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { CompletionArtifactLedger } from './completion-artifact-ledger';
import type { ToolCall } from './types';
import type { ResolvedInvocationContextV1 } from './invocation-context';

export type ResolveAfterHookResult =
  | { status: 'run'; path: string }
  | { status: 'skip'; reason: 'not_configured' | 'default_not_found' }
  | { status: 'invalid_explicit'; attempted: string; reason: string };

export interface AfterHookStderrDiagnostic {
  stderrTail: string;
  stderrTruncated: boolean;
}

export type AfterHookExecutionResult =
  | { status: 'succeeded'; path: string; exitCode: 0 }
  | { status: 'spawn_failed'; path: string; errorCode?: string; message: string }
  | ({ status: 'exited_nonzero'; path: string; exitCode: number } & AfterHookStderrDiagnostic)
  | ({ status: 'signaled'; path: string; signal: string } & AfterHookStderrDiagnostic);

export const MAX_AFTER_HOOK_STDERR_TAIL_BYTES = 64 * 1024;

interface AfterHookChildProcess {
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown } | null;
  on(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this;
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): this;
}

export type AfterHookSpawn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => AfterHookChildProcess;

const resolveRegularFile = (candidate: string):
  | { ok: true; realPath: string }
  | { ok: false; reason: string } => {
  try {
    const realPath = fs.realpathSync(candidate);
    if (!fs.statSync(realPath).isFile()) {
      return { ok: false, reason: 'not a regular file' };
    }
    return { ok: true, realPath };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
};

const defaultHookFilenames = (): string[] =>
  process.platform === 'win32'
    ? ['.after-hook.ps1', '.after-hook.bat', '.after-hook.cmd']
    : ['.after-hook.sh'];

/**
 * Resolve which hook script to run: CLI path (relative cwd) > TOML path (relative scan dir).
 * `scanAbs` is the conversation anchor. Default names there are considered only
 * with explicit CLI opt-in.
 */
export const resolveAfterHookScript = (options: {
  cwd: string;
  scanAbs: string;
  afterHookCli?: string;
  afterHookConfig?: string;
  allowDefaultAfterHook?: boolean;
}): ResolveAfterHookResult => {
  const {
    cwd,
    scanAbs,
    afterHookCli,
    afterHookConfig,
    allowDefaultAfterHook = false
  } = options;

  const tryExplicit = (raw: string, base: string): ResolveAfterHookResult => {
    const candidate = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(base, raw);
    const resolved = resolveRegularFile(candidate);
    if (resolved.ok) {
      return { status: 'run', path: resolved.realPath };
    }
    return {
      status: 'invalid_explicit',
      attempted: candidate,
      reason: resolved.reason
    };
  };

  if (afterHookCli) {
    return tryExplicit(afterHookCli, cwd);
  }
  if (afterHookConfig) {
    return tryExplicit(afterHookConfig, scanAbs);
  }

  if (!allowDefaultAfterHook) {
    return { status: 'skip', reason: 'not_configured' };
  }

  for (const name of defaultHookFilenames()) {
    const candidate = path.join(scanAbs, name);
    const resolved = resolveRegularFile(candidate);
    if (resolved.ok) {
      return { status: 'run', path: resolved.realPath };
    }
  }
  return { status: 'skip', reason: 'default_not_found' };
};

export const buildPromptpileHookEnv = (params: {
  scanAbs: string;
  inputDirectories: string[];
  outputDirectory?: string;
  ledger: CompletionArtifactLedger;
  toolCalls: ToolCall[] | undefined;
  model: string;
  quiet: boolean;
  responseLength: number;
  reasoningContent?: string;
  invocation: ResolvedInvocationContextV1;
}): NodeJS.ProcessEnv => {
  const {
    scanAbs,
    inputDirectories,
    outputDirectory,
    ledger,
    toolCalls,
    model,
    quiet,
    responseLength,
    reasoningContent,
    invocation
  } = params;
  const mainBody = ledger.find('main', 'body')?.absolutePath ?? '';
  const mainCalls = ledger.find('main', 'calls')?.absolutePath ?? '';
  const conversationBody = ledger.find('conversation', 'body')?.absolutePath ?? '';
  const conversationCalls = ledger.find('conversation', 'calls')?.absolutePath ?? '';
  const conversationExtra = ledger.find('conversation', 'extra')?.absolutePath ?? '';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PROMPTPILE_SCAN_DIRECTORY: inputDirectories.length === 1 ? scanAbs : '',
    PROMPTPILE_INPUT_DIRECTORIES_JSON: JSON.stringify(inputDirectories),
    PROMPTPILE_OUTPUT_DIRECTORY: outputDirectory ?? '',
    PROMPTPILE_OUTPUT_FILE: mainBody,
    PROMPTPILE_CALLS_FILE: mainCalls,
    PROMPTPILE_ASSISTANT_MD_FILE: conversationBody,
    PROMPTPILE_ASSISTANT_CALL_FILE: conversationCalls,
    PROMPTPILE_ASSISTANT_EXTRA_FILE: conversationExtra,
    PROMPTPILE_MODEL: model,
    PROMPTPILE_QUIET: quiet ? '1' : '0',
    PROMPTPILE_HAS_TOOL_CALLS: toolCalls && toolCalls.length > 0 ? '1' : '0',
    PROMPTPILE_HAS_REASONING: reasoningContent ? '1' : '0',
    PROMPTPILE_RESPONSE_LENGTH: String(responseLength)
  };
  // Never accept a stale/spoofed value inherited from the parent process.
  delete env.PROMPTPILE_INVOCATION_ID;
  if (invocation.id !== null) {
    env.PROMPTPILE_INVOCATION_ID = invocation.id;
  }
  return env;
};

export const runAfterHook = (options: {
  scriptPath: string;
  scanAbs: string;
  hookEnv: NodeJS.ProcessEnv;
  /** Test seam for deterministic child lifecycle classification. */
  spawnProcess?: AfterHookSpawn;
}): Promise<AfterHookExecutionResult> => {
  const { scriptPath, scanAbs, hookEnv } = options;
  const spawnProcess: AfterHookSpawn = options.spawnProcess ?? ((command, args, spawnOptions) =>
    spawn(command, args, spawnOptions) as AfterHookChildProcess);
  const ext = path.extname(scriptPath).toLowerCase();

  let command: string;
  let args: string[];

  if (process.platform === 'win32') {
    if (ext === '.ps1') {
      command = 'powershell.exe';
      args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else if (ext === '.bat' || ext === '.cmd') {
      command = process.env.ComSpec || 'cmd.exe';
      args = ['/d', '/s', '/c', scriptPath];
    } else if (ext === '.sh') {
      command = 'sh';
      args = [scriptPath];
    } else {
      command = process.env.ComSpec || 'cmd.exe';
      args = ['/d', '/s', '/c', scriptPath];
    }
  } else if (ext === '.sh') {
    command = 'sh';
    args = [scriptPath];
  } else {
    command = scriptPath;
    args = [];
  }

  return new Promise(resolvePromise => {
    let child: AfterHookChildProcess;
    try {
      child = spawnProcess(command, args, {
        cwd: scanAbs,
        env: hookEnv,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      resolvePromise({
        status: 'spawn_failed',
        path: scriptPath,
        errorCode: 'code' in failure && typeof failure.code === 'string' ? failure.code : undefined,
        message: failure.message
      });
      return;
    }

    let settled = false;
    let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderrBytes = 0;
    const settle = (result: AfterHookExecutionResult): void => {
      if (settled) return;
      settled = true;
      resolvePromise(result);
    };
    child.stderr?.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      stderrBytes += bytes.length;
      if (bytes.length >= MAX_AFTER_HOOK_STDERR_TAIL_BYTES) {
        stderrTail = bytes.subarray(bytes.length - MAX_AFTER_HOOK_STDERR_TAIL_BYTES);
      } else {
        const combined = Buffer.concat([stderrTail, bytes]);
        stderrTail = combined.length <= MAX_AFTER_HOOK_STDERR_TAIL_BYTES
          ? combined
          : combined.subarray(combined.length - MAX_AFTER_HOOK_STDERR_TAIL_BYTES);
      }
    });
    const diagnostic = (): AfterHookStderrDiagnostic => ({
      stderrTail: stderrTail.toString('utf8'),
      stderrTruncated: stderrBytes > MAX_AFTER_HOOK_STDERR_TAIL_BYTES
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      settle({
        status: 'spawn_failed',
        path: scriptPath,
        errorCode: error.code,
        message: error.message
      });
    });
    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (signal !== null) {
        settle({ status: 'signaled', path: scriptPath, signal, ...diagnostic() });
      } else if (code === 0) {
        settle({ status: 'succeeded', path: scriptPath, exitCode: 0 });
      } else if (typeof code === 'number') {
        settle({ status: 'exited_nonzero', path: scriptPath, exitCode: code, ...diagnostic() });
      } else {
        settle({
          status: 'spawn_failed',
          path: scriptPath,
          message: 'after-hook closed without an exit code or signal'
        });
      }
    });
  });
};
