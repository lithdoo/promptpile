import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const STDERR_CAP = 32 * 1024;

export type PromptpileInvokeResult = {
  status: number | null;
  error?: NodeJS.ErrnoException;
  /** Non-streaming capture only; streaming path leaves empty (already written to TTY). */
  stdout: string;
  stderr: string;
};

/** 如何启动 promptpile 子进程（可能为全局命令或 node + 内置脚本）。 */
export type PromptpileSpawnConfig = {
  command: string;
  /** 插在 CLI 参数之前的 argv 片段（例如 `[bundled/dist/index.js]`）。 */
  argvPrefix: string[];
  /** 面向用户的简短描述（错误提示用）。 */
  displayName: string;
};

function tryResolveBundledPromptpileScript(): string | null {
  try {
    const pkgJson = require.resolve('promptpile/package.json');
    const script = path.join(path.dirname(pkgJson), 'dist', 'index.js');
    return fs.existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

/**
 * 解析 promptpile 子进程启动方式：
 * 1. `PROMPTPILE_BIN` 非空 → 沿用（覆盖内置）
 * 2. 否则若依赖中存在已构建的 `promptpile/dist/index.js` → `node` + 该脚本（本仓库默认）
 * 3. 否则回退到 PATH 上的 `promptpile`
 */
export function getPromptpileSpawnConfig(): PromptpileSpawnConfig {
  const bin = process.env.PROMPTPILE_BIN?.trim();
  if (bin) {
    return { command: bin, argvPrefix: [], displayName: bin };
  }
  const bundled = tryResolveBundledPromptpileScript();
  if (bundled) {
    return {
      command: process.execPath,
      argvPrefix: [bundled],
      displayName: `node "${bundled}"`
    };
  }
  return { command: 'promptpile', argvPrefix: [], displayName: 'promptpile' };
}

function appendStderrCapped(store: { value: string }, s: string): void {
  store.value += s;
  if (store.value.length > STDERR_CAP) {
    store.value = store.value.slice(-STDERR_CAP);
  }
}

/**
 * 异步调用 promptpile CLI：子进程存活期间将 stdout/stderr 实时转发到当前进程（除非 `quiet`）。
 * 结束后 `stdout` 为空（已流式写出）；`stderr` 为截断后的累积（供错误 tail）。
 */
export function invokePromptpileAsync(
  spawnConfig: PromptpileSpawnConfig,
  cliArgs: string[],
  options: { cwd?: string; quiet: boolean; env?: NodeJS.ProcessEnv }
): Promise<PromptpileInvokeResult> {
  const cwd = options.cwd ?? process.cwd();
  const argv = [...spawnConfig.argvPrefix, ...cliArgs];
  const stderrStore = { value: '' };
  const childEnv = options.env ?? process.env;

  return new Promise(resolve => {
    let settled = false;
    const finish = (r: PromptpileInvokeResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(r);
    };

    const child = spawn(spawnConfig.command, argv, {
      cwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string | Buffer) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!options.quiet) {
        process.stdout.write(s);
      }
    });

    child.stderr?.on('data', (chunk: string | Buffer) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      appendStderrCapped(stderrStore, s);
      if (!options.quiet) {
        process.stderr.write(s);
      }
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      finish({
        status: null,
        error: err,
        stdout: '',
        stderr: stderrStore.value
      });
    });

    child.on('close', (code: number | null) => {
      finish({
        status: typeof code === 'number' ? code : null,
        stdout: '',
        stderr: stderrStore.value
      });
    });
  });
}
