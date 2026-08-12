import type { ReactErrorCodeV1 } from './react-event-protocol';

export type PromptpileReactPhase = 'thought' | 'observe' | 'check' | 'final';

/** required phase 子进程或不可恢复读盘失败时抛出。 */
export class PromptpileReactInvocationError extends Error {
  readonly phase: PromptpileReactPhase;
  readonly code: ReactErrorCodeV1;

  constructor(phase: PromptpileReactPhase, message: string, code: ReactErrorCodeV1 = 'internal_error') {
    super(message);
    this.name = 'PromptpileReactInvocationError';
    this.phase = phase;
    this.code = code;
  }
}
