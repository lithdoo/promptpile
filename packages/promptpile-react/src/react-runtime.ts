import type { ReactSessionContext, ResolvedReactConfig } from './types';
import {
  CheckReactProcess,
  CoreReactProcess,
  FinalReactProcess,
  ObserveReactProcess,
  type ReactProcessContext
} from './react-processes';
import type { IReactRuntime, ReactRuntimeStopReason } from './runtime';
import { getPromptpileSpawnConfig, type PromptpileSpawnConfig } from './promptpile-invoker';
import { PromptpileReactInvocationError } from './react-errors';
import type { ReactFinalResultV1, ReactRuntimeFailureV1 } from './react-event-protocol';
import {
  writeFinalObservationHandoff,
  type LatestSuccessfulObserve
} from './final-observation-handoff';

export type ReactPhaseStartedFact =
  | { phase: 'thought' | 'observe' | 'check'; stepIndex: number }
  | { phase: 'final'; stepsCompleted: number };
export type ReactPhaseCompletedFact =
  | { phase: 'thought' | 'observe'; stepIndex: number }
  | { phase: 'check'; stepIndex: number; continue: boolean }
  | { phase: 'final'; stepsCompleted: number };

export interface ReactRuntimeObserver {
  phaseStarted(fact: ReactPhaseStartedFact): Promise<void>;
  phaseCompleted(fact: ReactPhaseCompletedFact): Promise<void>;
  finalDelta(content: string): Promise<void>;
}

const noopObserver: ReactRuntimeObserver = {
  phaseStarted: async () => undefined,
  phaseCompleted: async () => undefined,
  finalDelta: async () => undefined
};

/** Frozen Thought -> Observe -> Check FSM with a read-only observation seam. */
export class PromptpileReactRuntime implements IReactRuntime {
  maxStep: number;
  currentStep = 0;
  stopReason: ReactRuntimeStopReason = 'running';
  failure?: ReactRuntimeFailureV1;
  finalResult?: ReactFinalResultV1;

  private readonly config: ResolvedReactConfig;
  private readonly spawn: PromptpileSpawnConfig;
  private readonly observer: ReactRuntimeObserver;
  private readonly session: ReactSessionContext;
  private latestSuccessfulObserve?: LatestSuccessfulObserve;

  constructor(
    config: ResolvedReactConfig,
    session: ReactSessionContext,
    spawn?: PromptpileSpawnConfig,
    observer: ReactRuntimeObserver = noopObserver
  ) {
    this.config = config;
    this.maxStep = config.maxStep;
    this.spawn = spawn ?? getPromptpileSpawnConfig();
    this.observer = observer;
    this.session = session;
  }

  async nextStep(): Promise<void> {
    if (this.stopReason !== 'running') return;
    if (this.currentStep >= this.maxStep) {
      this.stopReason = 'max_step';
      return;
    }

    let phase: 'thought' | 'observe' | 'check' = 'thought';
    try {
      await this.observer.phaseStarted({ phase, stepIndex: this.currentStep });
      await this.reactThoughtProcess();
      await this.observer.phaseCompleted({ phase, stepIndex: this.currentStep });

      phase = 'observe';
      await this.observer.phaseStarted({ phase, stepIndex: this.currentStep });
      const observeText = await this.reactObserveProcess();
      this.latestSuccessfulObserve = { stepIndex: this.currentStep, text: observeText };
      await this.observer.phaseCompleted({ phase, stepIndex: this.currentStep });

      phase = 'check';
      await this.observer.phaseStarted({ phase, stepIndex: this.currentStep });
      const continueOuter = await this.reactCheckProcess(observeText);
      await this.observer.phaseCompleted({ phase, stepIndex: this.currentStep, continue: continueOuter });

      this.currentStep += 1;
      if (!continueOuter) {
        this.stopReason = 'final';
      } else if (this.currentStep >= this.maxStep) {
        this.stopReason = 'max_step';
      }
    } catch (error) {
      this.recordFailure(error, phase);
    }
  }

  async finalAnswer(): Promise<void> {
    if (this.stopReason !== 'final' && this.stopReason !== 'max_step') return;
    try {
      if (this.config.prompts.final.trim() === '') {
        await this.reactFinalAnswerProcess();
        this.finalResult = { status: 'skipped' };
        return;
      }
      await this.observer.phaseStarted({ phase: 'final', stepsCompleted: this.currentStep });
      const session = this.requiredSession();
      const observation = this.latestSuccessfulObserve;
      if (observation === undefined) {
        throw new PromptpileReactInvocationError('final', 'Final requires a successful Observe report');
      }
      const handoffPath = writeFinalObservationHandoff({
        session,
        observation,
        stopReason: this.stopReason
      });
      this.finalResult = await this.reactFinalAnswerProcess(
        handoffPath,
        this.config.outputFormat === 'stream-json'
          ? content => this.observer.finalDelta(content)
          : undefined
      );
      await this.observer.phaseCompleted({ phase: 'final', stepsCompleted: this.currentStep });
    } catch (error) {
      this.recordFailure(error, 'final');
    }
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

  async reactFinalAnswerProcess(
    handoffPath?: string,
    onDelta?: (content: string) => Promise<void>
  ): Promise<ReactFinalResultV1> {
    return new FinalReactProcess(this.reactProcessCtx(), this.config.prompts.final).run(handoffPath, onDelta);
  }

  private recordFailure(error: unknown, phase: 'thought' | 'observe' | 'check' | 'final'): void {
    const invocation = error instanceof PromptpileReactInvocationError ? error : undefined;
    const code = invocation?.code ?? 'internal_error';
    this.failure = {
      phase,
      code,
      message: this.publicFailureMessage(code, phase),
      cause: error
    };
    this.stopReason = 'error';
  }

  private publicFailureMessage(
    code: ReactRuntimeFailureV1['code'],
    phase: 'thought' | 'observe' | 'check' | 'final'
  ): string {
    switch (code) {
      case 'promptpile_spawn_failed': return `promptpile could not be started for ${phase}`;
      case 'promptpile_exit_nonzero': return `promptpile failed during ${phase}`;
      case 'phase_output_missing': return `${phase} required output was missing`;
      case 'check_decision_invalid': return 'react_check_decision output was invalid';
      case 'final_stream_invalid': return 'Final output stream was invalid or incomplete';
      default: return `React ${phase} phase failed`;
    }
  }

  private reactProcessCtx(): ReactProcessContext {
    return { spawn: this.spawn, config: this.config, session: this.requiredSession() };
  }

  private requiredSession(): ReactSessionContext {
    return this.session;
  }
}
