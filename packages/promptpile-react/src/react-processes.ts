import { randomBytes } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { buildPhaseArgv } from './build-phase-argv';
import { CHECK_DECISION_TOOL_NAME, writeCheckToolsToml } from './check-decision-tool';
import { callsPathForMainOutput, parseObserveDecisionFromCallsFileStrict } from './parse-observe-calls';
import {
  invokePromptpileAsync,
  invokePromptpileFinalStream,
  type PromptpileInvokeResult,
  type PromptpileSpawnConfig
} from './promptpile-invoker';
import {
  buildPromptpileChildEnv,
  logCheckPhaseLlmOutput,
  logObservePhaseLlmOutput,
  reactDebugLog,
} from './react-debug-log';
import { PromptpileReactInvocationError, type PromptpileReactPhase } from './react-errors';
import type { ReactSessionContext, ResolvedReactConfig } from './types';
import {
  finalInvocationId,
  finalReceiptPath,
  validateFinalReceipt
} from './final-receipt';

/** 子进程阶段共享依赖（不持有 {@link PromptpileReactRuntime} 引用）。 */
export type ReactProcessContext = {
  spawn: PromptpileSpawnConfig;
  config: ResolvedReactConfig;
  session: ReactSessionContext;
};

export abstract class ReactProcess {
  protected constructor(protected readonly ctx: ReactProcessContext) {}

  protected async assertPromptpileSuccess(
    argv: string[],
    phase: PromptpileReactPhase
  ): Promise<void> {
    const r = await invokePromptpileAsync(this.ctx.spawn, argv, {
      cwd: this.ctx.config.cwd,
      quiet: this.ctx.config.quiet,
      forwardStdout: this.ctx.config.outputFormat === 'terminal',
      env: buildPromptpileChildEnv(phase)
    });

    if (r.error) {
      this.logSpawnError(r);
      throw new PromptpileReactInvocationError(
        phase,
        r.error.message || '无法启动 promptpile',
        'promptpile_spawn_failed'
      );
    }

    if (r.status !== 0) {
      throw new PromptpileReactInvocationError(
        phase,
        `promptpile exited with status ${r.status ?? 'null'}`,
        'promptpile_exit_nonzero'
      );
    }
  }

  protected unlinkQuiet(p: string | undefined): void {
    if (p === undefined) {
      return;
    }
    try {
      fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }

  protected rmDirQuiet(p: string | undefined): void {
    if (p === undefined) {
      return;
    }
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  private logSpawnError(r: PromptpileInvokeResult): void {
    if (!r.error) {
      return;
    }
    if (r.error.code === 'ENOENT') {
      if (!this.ctx.config.quiet) {
        console.error(
          `Error: 找不到命令或脚本 "${this.ctx.spawn.displayName}"。请确认依赖包 promptpile 已安装且 package bin 可用，或将 promptpile 加入 PATH；也可设置 PROMPTPILE_BIN 覆盖。`
        );
      }
    } else if (!this.ctx.config.quiet) {
      console.error(`Error: 无法启动 promptpile: ${r.error.message}`);
    }
  }
}

/** ReAct「思考」：`prompts.core` 注入 + 子进程（失败抛 {@link PromptpileReactInvocationError}）。 */
export class CoreReactProcess extends ReactProcess {
  constructor(ctx: ReactProcessContext, private readonly coreBody: string) {
    super(ctx);
  }

  async run(): Promise<void> {
    const argv = buildPhaseArgv('thought', this.ctx.config, { session: this.ctx.session });

    const core = this.coreBody.trim();
    let tempPath: string | undefined;
    try {
      if (core !== '') {
        tempPath = path.join(
          os.tmpdir(),
          `promptpile-react-core-${Date.now()}-${randomBytes(8).toString('hex')}.system.md`
        );
        fs.writeFileSync(tempPath, this.coreBody, 'utf8');
        argv.push('--insert-files', path.resolve(tempPath));
      }
      reactDebugLog('phase=thought');
      await this.assertPromptpileSuccess(argv, 'thought');
    } finally {
      this.unlinkQuiet(tempPath);
    }
  }
}

/** ReAct「观察」：全量目录 + observe 提示，纯文本输出（`-o` 主文件）。 */
export class ObserveReactProcess extends ReactProcess {
  constructor(ctx: ReactProcessContext, private readonly observeBody: string) {
    super(ctx);
  }

  async run(): Promise<string> {
    const baseId = `${Date.now()}-${randomBytes(8).toString('hex')}`;
    let injectPath: string | undefined;
    const outPath = path.join(os.tmpdir(), `promptpile-react-observe-out-${baseId}.md`);
    const resolvedOut = path.resolve(outPath);

    try {
      const argv = buildPhaseArgv('observe', this.ctx.config, { session: this.ctx.session });
      argv.push('-o', resolvedOut);

      if (this.observeBody.trim() !== '') {
        injectPath = path.join(
          os.tmpdir(),
          `promptpile-react-observe-inject-${baseId}.system.md`
        );
        fs.writeFileSync(injectPath, this.observeBody, 'utf8');
        argv.push('--append-files', path.resolve(injectPath));
      }

      reactDebugLog('phase=observe');
      await this.assertPromptpileSuccess(argv, 'observe');

      let text: string;
      try {
        if (!fs.existsSync(resolvedOut)) {
          throw new Error(`观察输出文件不存在: ${resolvedOut}`);
        }
        text = fs.readFileSync(resolvedOut, 'utf8').trim();
        if (text === '') {
          throw new Error('观察输出文件为空');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new PromptpileReactInvocationError('observe', msg, 'phase_output_missing');
      }

      logObservePhaseLlmOutput(resolvedOut);
      reactDebugLog(`phase=observe text_len=${text.length}`);
      return text;
    } finally {
      this.unlinkQuiet(injectPath);
      this.unlinkQuiet(resolvedOut);
    }
  }
}

/** ReAct「校验」：仅 check 提示 + observe 正文（空目录 + insert），`react_check_decision` 决定是否继续。 */
export class CheckReactProcess extends ReactProcess {
  constructor(ctx: ReactProcessContext, private readonly checkBody: string) {
    super(ctx);
  }

  async run(observeText: string): Promise<boolean> {
    const baseId = `${Date.now()}-${randomBytes(8).toString('hex')}`;
    let emptyDir: string | undefined;
    let toolsPath: string | undefined;
    let checkInjectPath: string | undefined;
    let observeInjectPath: string | undefined;
    const outPath = path.join(os.tmpdir(), `promptpile-react-check-out-${baseId}.md`);
    const resolvedOut = path.resolve(outPath);

    try {
      emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-react-check-empty-'));

      const argv = buildPhaseArgv('check', this.ctx.config, {
        directoryOverride: emptyDir,
        session: this.ctx.session
      });

      const injectDir = path.join(os.tmpdir(), `promptpile-react-check-inject-${baseId}`);
      fs.mkdirSync(injectDir, { recursive: true });

      checkInjectPath = path.join(injectDir, 'check.system.md');
      fs.writeFileSync(checkInjectPath, this.checkBody, 'utf8');

      observeInjectPath = path.join(injectDir, 'observe-report.user.md');
      fs.writeFileSync(observeInjectPath, observeText, 'utf8');

      argv.push(
        '--insert-files',
        `${path.resolve(checkInjectPath)}|${path.resolve(observeInjectPath)}`
      );

      toolsPath = path.join(os.tmpdir(), `promptpile-react-check-tools-${baseId}.toml`);
      writeCheckToolsToml(path.resolve(toolsPath));
      argv.push('--tools-file', path.resolve(toolsPath));
      argv.push('-o', resolvedOut);

      reactDebugLog('phase=check');
      await this.assertPromptpileSuccess(argv, 'check');

      const callsPath = callsPathForMainOutput(resolvedOut);
      logCheckPhaseLlmOutput(resolvedOut, callsPath);

      let cont: boolean;
      try {
        cont = parseObserveDecisionFromCallsFileStrict(callsPath, CHECK_DECISION_TOOL_NAME);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new PromptpileReactInvocationError('check', msg, 'check_decision_invalid');
      }
      try {
        if (fs.existsSync(callsPath)) {
          fs.unlinkSync(callsPath);
        }
      } catch {
        // ignore
      }
      reactDebugLog(`phase=check continue=${cont}`);
      return cont;
    } finally {
      this.unlinkQuiet(toolsPath);
      this.unlinkQuiet(checkInjectPath);
      this.unlinkQuiet(observeInjectPath);
      this.unlinkQuiet(resolvedOut);
      if (checkInjectPath !== undefined) {
        this.rmDirQuiet(path.dirname(checkInjectPath));
      }
      this.rmDirQuiet(emptyDir);
    }
  }
}

/** ReAct「收尾」：非空 `prompts.final` 是 required phase，失败时抛错。 */
export class FinalReactProcess extends ReactProcess {
  constructor(ctx: ReactProcessContext, private readonly finalBody: string) {
    super(ctx);
  }

  async run(
    handoffPath: string | undefined,
    onDelta?: (content: string) => Promise<void>
  ): Promise<{ status: 'skipped' } | { status: 'completed'; content: string }> {
    if (this.finalBody.trim() === '') {
      reactDebugLog('phase=final skip');
      return { status: 'skipped' };
    }

    reactDebugLog('phase=final');
    if (handoffPath === undefined) {
      throw new PromptpileReactInvocationError('final', 'Final observation handoff is missing');
    }
    const argv = buildPhaseArgv('final', this.ctx.config, { session: this.ctx.session });
    let receiptPath: string | undefined;
    let expectedInvocationId: string | undefined;
    if (this.ctx.config.continueMode) {
      receiptPath = finalReceiptPath(this.ctx.session);
      expectedInvocationId = finalInvocationId(this.ctx.session);
      argv.push('--invocation-id', expectedInvocationId, '--receipt', receiptPath);
    }

    let tempPath: string | undefined;
    try {
      tempPath = path.join(
        os.tmpdir(),
        `promptpile-react-final-${Date.now()}-${randomBytes(8).toString('hex')}.system.md`
      );
      fs.writeFileSync(tempPath, this.finalBody, 'utf8');
      argv.push('--insert-files', path.resolve(tempPath));
      argv.push('--append-files', path.resolve(handoffPath));
      if (onDelta === undefined) {
        await this.assertPromptpileSuccess(argv, 'final');
        if (receiptPath !== undefined && expectedInvocationId !== undefined) {
          this.validateReceipt(receiptPath, expectedInvocationId);
        }
        return { status: 'completed', content: '' };
      }
      argv.push('--output-pile-fd', '3', '--output-pile-format', 'json');
      const result = await invokePromptpileFinalStream(this.ctx.spawn, argv, {
        cwd: this.ctx.config.cwd,
        quiet: this.ctx.config.quiet,
        env: buildPromptpileChildEnv('final'),
        onDelta
      });
      if (result.error) {
        throw new PromptpileReactInvocationError('final', result.error.message, 'promptpile_spawn_failed');
      }
      if (result.streamError) {
        throw new PromptpileReactInvocationError('final', result.streamError.message, 'final_stream_invalid');
      }
      if (result.status !== 0) {
        throw new PromptpileReactInvocationError('final', `promptpile 退出码 ${result.status ?? 'null'}`, 'promptpile_exit_nonzero');
      }
      if (receiptPath !== undefined && expectedInvocationId !== undefined) {
        this.validateReceipt(receiptPath, expectedInvocationId);
      }
      return { status: 'completed', content: result.content };
    } finally {
      this.unlinkQuiet(tempPath);
    }
  }

  private validateReceipt(receiptPath: string, expectedInvocationId: string): void {
    try {
      validateFinalReceipt({
        receiptPath,
        expectedInvocationId,
        userWritableAbs: this.ctx.config.userWritableAbs
      });
    } catch (error) {
      throw new PromptpileReactInvocationError(
        'final',
        error instanceof Error ? error.message : String(error),
        'internal_error'
      );
    }
  }
}
