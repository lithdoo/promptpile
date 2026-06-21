import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { ToolCall } from './types';

export type ResolveAfterHookResult =
  | { status: 'run'; path: string }
  | { status: 'skip' }
  | { status: 'warn_invalid_explicit'; attempted: string; reason: string };

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
 * Default names in the scan directory are considered only with explicit CLI opt-in.
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
      status: 'warn_invalid_explicit',
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
    return { status: 'skip' };
  }

  for (const name of defaultHookFilenames()) {
    const candidate = path.join(scanAbs, name);
    const resolved = resolveRegularFile(candidate);
    if (resolved.ok) {
      return { status: 'run', path: resolved.realPath };
    }
  }
  return { status: 'skip' };
};

const callsPathForMainOutput = (resolvedMainPath: string): string => {
  const { dir, name } = path.parse(resolvedMainPath);
  return path.join(dir, `${name}.calls.jsonl`);
};

export const buildPromptpileHookEnv = (params: {
  scanAbs: string;
  resolvedOutput?: string;
  toolCalls: ToolCall[] | undefined;
  model: string;
  quiet: boolean;
  responseLength: number;
  /** Absolute path to `[N]assistant.md` written by `--continue`; empty when not in continue mode. */
  continueMdPath?: string;
  /** Absolute path to `[N]assistant.calls.jsonl` written by `--continue` + tool_calls; empty otherwise. */
  continueCallsPath?: string;
  /** Absolute path to `[N]assistant.extra.json` written by `--continue` + reasoning_content; empty otherwise. */
  continueExtraPath?: string;
  reasoningContent?: string;
}): NodeJS.ProcessEnv => {
  const {
    scanAbs,
    resolvedOutput,
    toolCalls,
    model,
    quiet,
    responseLength,
    continueMdPath,
    continueCallsPath,
    continueExtraPath,
    reasoningContent
  } = params;
  const callsPath =
    resolvedOutput && toolCalls && toolCalls.length > 0
      ? callsPathForMainOutput(resolvedOutput)
      : '';
  return {
    ...process.env,
    PROMPTPILE_SCAN_DIRECTORY: scanAbs,
    PROMPTPILE_OUTPUT_FILE: resolvedOutput ?? '',
    PROMPTPILE_CALLS_FILE: callsPath,
    PROMPTPILE_ASSISTANT_MD_FILE: continueMdPath ?? '',
    PROMPTPILE_ASSISTANT_CALL_FILE: continueCallsPath ?? '',
    PROMPTPILE_ASSISTANT_EXTRA_FILE: continueExtraPath ?? '',
    PROMPTPILE_MODEL: model,
    PROMPTPILE_QUIET: quiet ? '1' : '0',
    PROMPTPILE_HAS_TOOL_CALLS: toolCalls && toolCalls.length > 0 ? '1' : '0',
    PROMPTPILE_HAS_REASONING: reasoningContent ? '1' : '0',
    PROMPTPILE_RESPONSE_LENGTH: String(responseLength)
  };
};

export const runAfterHook = (options: {
  scriptPath: string;
  scanAbs: string;
  hookEnv: NodeJS.ProcessEnv;
  quiet: boolean;
}): Promise<void> => {
  const { scriptPath, scanAbs, hookEnv } = options;
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
    const child = spawn(command, args, {
      cwd: scanAbs,
      env: hookEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', err => {
      console.error('after-hook spawn error:', err.message);
      resolvePromise();
    });

    child.on('close', code => {
      if (code !== 0) {
        console.error(`after-hook exited with code ${code}`);
        if (stderr.trim()) {
          console.error(stderr.trimEnd());
        }
      }
      resolvePromise();
    });
  });
};
