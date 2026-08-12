export interface CompletionUsageV1 {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type CompletionReceiptHookV1 =
  | { status: 'skipped'; failureMode: 'warn' | 'error'; reason: 'not_configured' | 'default_not_found' }
  | { status: 'invalid_explicit'; failureMode: 'warn'; attempted: string; reason: string }
  | { status: 'succeeded'; failureMode: 'warn' | 'error'; path: string; exitCode: 0 }
  | { status: 'spawn_failed'; failureMode: 'warn'; path: string; errorCode?: string }
  | { status: 'exited_nonzero'; failureMode: 'warn'; path: string; exitCode: number }
  | { status: 'signaled'; failureMode: 'warn'; path: string; signal: string };

export interface CompletionReceiptV1 {
  schemaVersion: 1;
  status: 'completed';
  invocationId: string | null;
  artifacts: {
    assistant: string | null;
    calls: string | null;
    extra: string | null;
    mainOutput: string | null;
    mainCalls: string | null;
    mainExtra: string | null;
  };
  model: string;
  finishReason: string | null;
  usage: CompletionUsageV1 | null;
  hook: CompletionReceiptHookV1;
}
