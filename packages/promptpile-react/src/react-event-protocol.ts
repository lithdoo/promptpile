export type ReactPhaseV1 = 'thought' | 'observe' | 'check' | 'final';
export type ReactSuccessStopReasonV1 = 'final' | 'max_step';
export type ReactFailurePhaseV1 = ReactPhaseV1 | 'startup';
export type ReactErrorCodeV1 =
  | 'promptpile_spawn_failed'
  | 'promptpile_exit_nonzero'
  | 'phase_output_missing'
  | 'check_decision_invalid'
  | 'final_stream_invalid'
  | 'internal_error';

export type ReactFinalResultV1 =
  | { status: 'skipped' }
  | { status: 'completed'; content: string };

export interface ReactRuntimeFailureV1 {
  phase: ReactFailurePhaseV1;
  code: ReactErrorCodeV1;
  message: string;
  cause?: unknown;
}

export type ReactEventPayloadV1 =
  | { type: 'session.started'; max_steps: number }
  | { type: 'phase.started'; phase: Exclude<ReactPhaseV1, 'final'>; step_index: number }
  | { type: 'phase.started'; phase: 'final'; steps_completed: number }
  | { type: 'phase.completed'; phase: 'thought' | 'observe'; step_index: number }
  | { type: 'phase.completed'; phase: 'check'; step_index: number; continue: boolean }
  | { type: 'phase.completed'; phase: 'final'; steps_completed: number }
  | { type: 'final.delta'; content: string }
  | {
      type: 'session.completed';
      stop_reason: ReactSuccessStopReasonV1;
      steps_completed: number;
      final: ReactFinalResultV1;
    }
  | {
      type: 'session.failed';
      phase: ReactFailurePhaseV1;
      steps_completed: number;
      error: { code: ReactErrorCodeV1; message: string };
    };

export type ReactEventV1 = ReactEventPayloadV1 & {
  schema_version: 1;
  session_id: string;
  sequence: number;
};

export const isTerminalEventType = (type: ReactEventPayloadV1['type']): boolean =>
  type === 'session.completed' || type === 'session.failed';
