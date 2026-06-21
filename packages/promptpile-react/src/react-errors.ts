export type PromptpileReactPhase = 'thought' | 'observe' | 'check';

/** thought / observe / check 子进程或不可恢复读盘失败时抛出；`nextStep` 捕获并写 `stopReason = 'error'`。 */
export class PromptpileReactInvocationError extends Error {
  readonly phase: PromptpileReactPhase;

  constructor(phase: PromptpileReactPhase, message: string) {
    super(message);
    this.name = 'PromptpileReactInvocationError';
    this.phase = phase;
  }
}
