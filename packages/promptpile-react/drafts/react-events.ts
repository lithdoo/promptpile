import type { ReactOutputFormat } from '../src/types';

export type ReactPhase = 'thought' | 'observe' | 'check' | 'final';

export type ReactStopReason =
  | 'running'
  | 'max_step'
  | 'final'
  | 'error'
  | 'aborted';

export interface ReactEventBaseV1 {
  schema_version: 1;
  type: string;
  session_id: string;
  sequence: number;
  timestamp: string;
}

export interface ReactSessionStartEventV1 extends ReactEventBaseV1 {
  type: 'session.start';
  output_format: ReactOutputFormat;
  max_step: number;
}

export interface ReactPhaseEventV1 extends ReactEventBaseV1 {
  type: 'phase.start' | 'phase.end';
  phase: ReactPhase;
  step: number;
}

export interface ReactSessionEndEventV1 extends ReactEventBaseV1 {
  type: 'session.end';
  stop_reason: ReactStopReason;
  steps_completed: number;
}

export type ReactEventV1 =
  | ReactSessionStartEventV1
  | ReactPhaseEventV1
  | ReactSessionEndEventV1;

export class ReactEventWriter {
  private sequence = 0;

  constructor(
    private readonly sessionId: string,
    private readonly outputFormat: ReactOutputFormat
  ) {}

  emit(event: Omit<ReactEventV1, keyof ReactEventBaseV1 | 'sequence' | 'timestamp' | 'session_id'>): void {
    const fullEvent = {
      ...event,
      schema_version: 1 as const,
      session_id: this.sessionId,
      sequence: this.sequence++,
      timestamp: new Date().toISOString()
    } as ReactEventV1;

    if (this.outputFormat === 'stream-json') {
      process.stdout.write(`${JSON.stringify(fullEvent)}\n`);
    }
  }
}
