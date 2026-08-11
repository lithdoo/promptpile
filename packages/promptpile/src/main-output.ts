import { atomicWriteFileSync } from './atomic-file';
import type { CompletionArtifactLedger } from './completion-artifact-ledger';
import type { ResolvedOutputArtifactPolicyV1 } from './output-artifact-policy';
import type { AssistantExtraPayload, ToolCall } from './types';

export const commitMainOutput = (options: {
  targets: NonNullable<ResolvedOutputArtifactPolicyV1['mainOutput']>;
  response: string;
  toolCalls: ToolCall[] | undefined;
  reasoningContent: string | undefined;
  ledger: CompletionArtifactLedger;
  writeFile?: typeof atomicWriteFileSync;
}): void => {
  const { targets, response, toolCalls, reasoningContent, ledger } = options;
  const writeFile = options.writeFile ?? atomicWriteFileSync;
  writeFile(targets.body.absolutePath, response);
  ledger.record({ namespace: 'main', kind: 'body', absolutePath: targets.body.absolutePath });

  if (toolCalls?.length) {
    const body = toolCalls.map(call => JSON.stringify(call)).join('\n') + '\n';
    writeFile(targets.calls.absolutePath, body);
    ledger.record({ namespace: 'main', kind: 'calls', absolutePath: targets.calls.absolutePath });
  }

  if (reasoningContent) {
    const payload: AssistantExtraPayload = { reasoning_content: reasoningContent };
    writeFile(targets.extra.absolutePath, `${JSON.stringify(payload, null, 2)}\n`);
    ledger.record({ namespace: 'main', kind: 'extra', absolutePath: targets.extra.absolutePath });
  }
};
