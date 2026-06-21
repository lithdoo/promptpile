import type { ResolvedReactConfig } from './types';
import {
  CheckReactProcess,
  CoreReactProcess,
  FinalReactProcess,
  ObserveReactProcess,
  type ReactProcessContext
} from './react-processes';
import type { IReactRuntime, ReactRuntimeStopReason } from './runtime';
import { getPromptpileSpawnConfig, type PromptpileSpawnConfig } from './promptpile-invoker';

/**
 * 配置来自 {@link resolveReactConfig}；子进程 argv 由 {@link buildPhaseArgv} 按阶段生成（无 `--config`）。
 */
export class PromptpileReactRuntime implements IReactRuntime {
  maxStep: number;
  currentStep = 0;
  stopReason: ReactRuntimeStopReason = 'running';

  private readonly config: ResolvedReactConfig;
  private readonly spawn: PromptpileSpawnConfig;

  constructor(config: ResolvedReactConfig) {
    this.config = config;
    this.maxStep = config.maxStep;
    this.spawn = getPromptpileSpawnConfig();
  }

  async nextStep(): Promise<void> {
    if (this.stopReason !== 'running') {
      return;
    }
    if (Number.isFinite(this.maxStep) && this.currentStep >= this.maxStep) {
      this.stopReason = 'max_step';
      return;
    }

    try {
      await this.reactThoughtProcess();
      const observeText = await this.reactObserveProcess();
      const continueOuter = await this.reactCheckProcess(observeText);
      this.currentStep += 1;
      if (!continueOuter) {
        this.stopReason = 'final';
        return;
      }
      if (Number.isFinite(this.maxStep) && this.currentStep >= this.maxStep) {
        this.stopReason = 'max_step';
      }
    } catch {
      this.stopReason = 'error';
    }
  }

  async finalAnswer(): Promise<void> {
    await this.reactFinalAnswerProcess();
  }

  async reactThoughtProcess(): Promise<void> {
    await new CoreReactProcess(this.reactProcessCtx(), this.config.prompts.core).run();
  }

  async reactObserveProcess(): Promise<string> {
    return new ObserveReactProcess(this.reactProcessCtx(), this.config.prompts.observe).run();
  }

  async reactCheckProcess(observeText: string): Promise<boolean> {
    return new CheckReactProcess(this.reactProcessCtx(), this.config.prompts.check).run(observeText);
  }

  async reactFinalAnswerProcess(): Promise<void> {
    await new FinalReactProcess(this.reactProcessCtx(), this.config.prompts.final).run();
  }

  private reactProcessCtx(): ReactProcessContext {
    return {
      spawn: this.spawn,
      config: this.config
    };
  }
}
