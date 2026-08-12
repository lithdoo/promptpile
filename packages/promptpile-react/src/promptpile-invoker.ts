import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { Readable } from 'stream';
import { FinalOutputPileDecoder } from './final-output-pile-decoder';

const STDERR_CAP = 32 * 1024;

export type PromptpileInvokeResult = {
  status: number | null;
  error?: NodeJS.ErrnoException;
  /** Non-streaming capture only; streaming path leaves empty (already written to TTY). */
  stdout: string;
  stderr: string;
};

export type PromptpileFinalStreamResult = PromptpileInvokeResult & {
  content: string;
  streamError?: Error;
};

/** 如何启动 promptpile 子进程（可能为全局命令或 node + 内置脚本）。 */
export type PromptpileSpawnConfig = {
  command: string;
  /** 插在 CLI 参数之前的 argv 片段（默认是 package metadata 声明的 Node entry script）。 */
  argvPrefix: string[];
  /** 面向用户的简短描述（错误提示用）。 */
  displayName: string;
};

type PackageJsonWithBin = {
  name?: unknown;
  bin?: unknown;
};

/**
 * Resolve a package-declared Node entry script without assuming its build layout.
 * The caller intentionally launches this path with `process.execPath`; this is not
 * a generic npm executable/shim resolver. Use `PROMPTPILE_BIN` for native wrappers.
 */
export function resolveDeclaredPackageBin(
  packageJsonPath: string,
  executableName: string
): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as PackageJsonWithBin;
    let declared: unknown;
    if (typeof parsed.bin === 'string') {
      declared = parsed.bin;
    } else if (parsed.bin !== null && typeof parsed.bin === 'object') {
      declared = (parsed.bin as Record<string, unknown>)[executableName];
    }
    if (typeof declared !== 'string' || declared.trim() === '') {
      return null;
    }

    const packageDirectory = path.dirname(packageJsonPath);
    const resolved = path.resolve(packageDirectory, declared.trim());
    const relative = path.relative(packageDirectory, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null;
    }
    return fs.statSync(resolved).isFile() ? resolved : null;
  } catch {
    return null;
  }
}

function tryResolveBundledPromptpileScript(packageJsonPath?: string | null): string | null {
  if (packageJsonPath === null) {
    return null;
  }
  try {
    const resolvedPackageJson = packageJsonPath ?? require.resolve('promptpile/package.json');
    return resolveDeclaredPackageBin(resolvedPackageJson, 'promptpile');
  } catch {
    return null;
  }
}

/**
 * 解析 promptpile 子进程启动方式：
 * 1. `PROMPTPILE_BIN` 非空 → 沿用（覆盖内置）
 * 2. 否则读取依赖包 `package.json` 声明的 `bin.promptpile` → `node` + Node-compatible entry script
 * 3. 否则回退到 PATH 上的 `promptpile`
 */
export function getPromptpileSpawnConfig(options?: {
  /** Test/integration override; null skips package lookup and exercises PATH fallback. */
  packageJsonPath?: string | null;
}): PromptpileSpawnConfig {
  const bin = process.env.PROMPTPILE_BIN?.trim();
  if (bin) {
    return { command: bin, argvPrefix: [], displayName: bin };
  }
  const bundled = tryResolveBundledPromptpileScript(options?.packageJsonPath);
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
  options: { cwd?: string; quiet: boolean; env?: NodeJS.ProcessEnv; stdin?: string; forwardStdout?: boolean }
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
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    let stdinError: NodeJS.ErrnoException | undefined;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string | Buffer) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!options.quiet && options.forwardStdout !== false) {
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

    child.stdin?.on('error', (err: NodeJS.ErrnoException) => {
      // A child may reject arguments and close before consuming all stdin.
      // Preserve the error, then wait for close so callers receive its status/stderr.
      stdinError = err;
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
        error: code === 0 ? stdinError : undefined,
        stdout: '',
        stderr: stderrStore.value
      });
    });

    if (options.stdin !== undefined) {
      try {
        child.stdin?.end(options.stdin, 'utf8');
      } catch (err) {
        stdinError = err as NodeJS.ErrnoException;
      }
    }
  });
}

/** Final-only private fd3 transport. Child stdout is always drained and never forwarded. */
export async function invokePromptpileFinalStream(
  spawnConfig: PromptpileSpawnConfig,
  cliArgs: string[],
  options: {
    cwd?: string;
    quiet: boolean;
    env?: NodeJS.ProcessEnv;
    stdin?: string;
    onDelta: (content: string) => Promise<void>;
  }
): Promise<PromptpileFinalStreamResult> {
  const stderrStore = { value: '' };
  const child = spawn(spawnConfig.command, [...spawnConfig.argvPrefix, ...cliArgs], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  let content = '';
  let spawnError: NodeJS.ErrnoException | undefined;
  let streamError: Error | undefined;
  let stdinError: NodeJS.ErrnoException | undefined;

  child.stdout?.resume();
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string | Buffer) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    appendStderrCapped(stderrStore, text);
    if (!options.quiet) process.stderr.write(text);
  });
  child.on('error', error => { spawnError = error; });
  child.stdin?.on('error', error => { stdinError = error; });

  const transport = child.stdio[3] as Readable | null;
  const decoder = new FinalOutputPileDecoder(async delta => {
    await options.onDelta(delta);
    content += delta;
  });
  const consume = (async () => {
    if (!transport) throw new Error('Final fd3 transport was not created');
    for await (const chunk of transport) await decoder.push(Buffer.from(chunk));
    await decoder.finish();
  })().catch(error => {
    streamError = error instanceof Error ? error : new Error(String(error));
    transport?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill();
  });

  if (options.stdin !== undefined) {
    try { child.stdin?.end(options.stdin, 'utf8'); } catch (error) {
      stdinError = error as NodeJS.ErrnoException;
    }
  }

  const status = await new Promise<number | null>(resolve => child.once('close', resolve));
  await consume;
  return {
    status,
    error: spawnError ?? (status === 0 ? stdinError : undefined),
    stdout: '',
    stderr: stderrStore.value,
    content,
    streamError
  };
}
