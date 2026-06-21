/** 主循环结束或未结束原因 */
export type ReactRuntimeStopReason =
  | 'running'
  | 'max_step'
  | 'final'
  | 'error'
  | 'aborted';
/** 实现类见 {@link PromptpileReactRuntime}（`./react-runtime`）。 */
export interface IReactRuntime {
  maxStep: number;
  /** 已成功完成的 `promptpile` 调用次数，从 0 起；与 `maxStep` 比较用 */
  currentStep: number;
  stopReason: ReactRuntimeStopReason;
  nextStep: () => Promise<void>;
  finalAnswer: () => Promise<void>;
}