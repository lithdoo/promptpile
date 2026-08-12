/** 主循环结束或未结束原因 */
export type ReactRuntimeStopReason =
  | 'running'
  | 'max_step'
  | 'final'
  | 'error';
/** 实现类见 {@link PromptpileReactRuntime}（`./react-runtime`）。 */
export interface IReactRuntime {
  maxStep: number;
  /** 已成功完成的 Thought + Observe + Check ReAct iteration 数量。 */
  currentStep: number;
  stopReason: ReactRuntimeStopReason;
  nextStep: () => Promise<void>;
  finalAnswer: () => Promise<void>;
}
