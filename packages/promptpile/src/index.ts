#!/usr/bin/env node
import readline from 'readline';
import path from 'path';
import { resolveConfig } from './resolve-config';
import {
  appendAssistantTurn,
  appendAssistantTurnAtIndex,
  appendUserMessage,
  appendUserMessageAtIndex,
  buildMessagesWithDiagnostics,
  scanDirectory
} from './file-handler';
import { callAIStream } from './ai-client';
import { loadTools } from './tools-loader';
import { buildPromptpileHookEnv, resolveAfterHookScript, runAfterHook } from './after-hook';
import { effectiveToolChoiceForRequest, parseToolChoiceInput } from './tool-choice';
import {
  applyAppendFiles,
  applyInsertFiles,
  loadSidecarMessages
} from './message-sidecar-files';
import { isPromptpileDiagnostic } from './diagnostic-log';
import { createOutputPileWriter } from './output-pile';
import type { ChatApiToolChoice, FileInfo, ToolCall } from './types';
import { CompletionArtifactLedger } from './completion-artifact-ledger';
import { commitMainOutput } from './main-output';
import {
  prepareOutputArtifactPolicy,
  resolveOutputArtifactPolicy
} from './output-artifact-policy';
import { applyMissingToolResultsPolicy } from './tool-result-policy';
import {
  runAppendUserCommand,
  runFingerprintConversationCommand,
  runInspectConversationCommand
} from './conversation-command';
import { runCli } from './cli';
import {
  commitConversationMutation,
  hasConversationMutationPrecondition,
  preflightConversationMutation,
  type ConversationMutationPrecondition
} from './conversation-mutation-guard';
import {
  CONVERSATION_CONFLICT_EXIT_CODE,
  formatConversationConflict,
  isConversationConflictError
} from './conversation-conflict';
import { secondaryFailuresOf } from './primary-failure';
import { runModelOutputLifecycle } from './model-output-lifecycle';

const readUserInputFromTerminal = async (): Promise<string> => {
  console.log('Enter user message. Finish with Ctrl+Z then Enter (Windows), or Ctrl+D (macOS/Linux).');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  rl.close();
  return lines.join('\n').trim();
};

const printToolCallsLines = (toolCalls: ToolCall[] | undefined, quiet: boolean): void => {
  if (quiet || !toolCalls?.length) {
    return;
  }
  for (const tc of toolCalls) {
    process.stdout.write(`${JSON.stringify(tc)}\n`);
  }
};

async function runCompletion(cwd: string): Promise<void> {
  try {
    const config = resolveConfig(cwd, process.argv);

    if (!config.apiKey) {
      console.error('Error: AI API key is required');
      process.exit(1);
    }

    const { inputDirectories, anchorDirectory } = config.conversationIo;
    const scanAbs = path.resolve(cwd, anchorDirectory);
    const hookResolution = resolveAfterHookScript({
      cwd,
      scanAbs,
      afterHookCli: config.afterHookCli,
      afterHookConfig: config.afterHookConfig,
      allowDefaultAfterHook: config.allowDefaultAfterHook
    });
    let outputPolicy = resolveOutputArtifactPolicy({
      cwd,
      config,
      hook: hookResolution
    });
    const quiet = outputPolicy.terminal.quiet;
    const { outputDirectory, outputDirectoryIndex } = outputPolicy.conversation;
    const artifactLedger = new CompletionArtifactLedger();

    const scanInputLayers = () =>
      inputDirectories.flatMap((directory, directoryIndex) =>
        scanDirectory(directory, directoryIndex)
      );
    let files: FileInfo[] = [];
    if (outputDirectory !== undefined && outputDirectoryIndex === -1) {
      throw new Error('resolved conversation output directory is not an input layer');
    }
    const outputFiles = () => outputDirectoryIndex === undefined
      ? []
      : files.filter(file => file.directoryIndex === outputDirectoryIndex);

    const callerPrecondition: ConversationMutationPrecondition = {
      expectedFingerprint: config.expectedOutputFingerprint,
      expectedNextIndex: config.expectedOutputNextIndex
    };
    const occEnabled = hasConversationMutationPrecondition(callerPrecondition);
    let assistantPrecondition: ConversationMutationPrecondition = callerPrecondition;
    if (occEnabled) {
      await preflightConversationMutation(
        outputDirectory!,
        config.inputMode ? 'append_user' : 'continue_assistant',
        callerPrecondition
      );
    }
    if (!config.inputMode || !occEnabled) {
      files = scanInputLayers();
    }

    if (config.inputMode) {
      const userContent = await readUserInputFromTerminal();
      if (!userContent) {
        console.error('Error: Empty input. Nothing was written.');
        process.exit(1);
      }

      if (occEnabled) {
        const committed = await commitConversationMutation({
          directory: outputDirectory!,
          mutationKind: 'append_user',
          precondition: callerPrecondition,
          mutate: state => appendUserMessageAtIndex(outputDirectory!, state.nextIndex, userContent),
          deriveFor: outputPolicy.conversation.continueEnabled ? 'continue_assistant' : undefined
        });
        if (outputPolicy.conversation.continueEnabled) {
          assistantPrecondition = {
            expectedFingerprint: committed.baseline?.fingerprint,
            expectedNextIndex: committed.baseline?.nextIndex
          };
        }
      } else {
        appendUserMessage(outputDirectory!, outputFiles(), userContent);
      }
      files = scanInputLayers();
    }
    const hasInsertFiles = (config.insertFilesCli?.trim() ?? '') !== '';
    if (files.length === 0 && !hasInsertFiles) {
      console.error(
        'Error: No files found matching message patterns ([idx]role.md/json, [idx]assistant.calls.jsonl, [idx]assistant.extra.json, [idx]assistant.result.jsonl)'
      );
      process.exit(1);
    }

    let tools;
    if (config.disableTool) {
      tools = undefined;
      if (isPromptpileDiagnostic()) {
        console.error('[promptpile] tools: disabled (--disable-tool)');
      }
    } else {
      try {
        tools = loadTools({
          directory: anchorDirectory,
          cwd,
          toolsFileCli: config.toolsFileCli,
          toolsFileConfig: config.toolsFileConfig
        });
      } catch (e) {
        console.error('Error loading tools:', e instanceof Error ? e.message : e);
        process.exit(1);
      }

      if (tools === undefined) {
        console.error(
          'Error: tools require an explicit .toml path (--tools-file), tools_file in config, or use --disable-tool to skip tools.'
        );
        process.exit(1);
      }

    }

    let toolChoiceForApi: ChatApiToolChoice | undefined;
    try {
      const parsed = parseToolChoiceInput(config.toolChoice);
      toolChoiceForApi = effectiveToolChoiceForRequest(tools, parsed);
    } catch (e) {
      console.error('Error: Invalid tool choice:', e instanceof Error ? e.message : e);
      process.exit(1);
    }

    const built = buildMessagesWithDiagnostics(files);
    applyMissingToolResultsPolicy(built.diagnostics, config.missingToolResults);
    let messages = built.messages;

    try {
      const inserts = loadSidecarMessages(cwd, config.insertFilesCli);
      if (inserts.length > 0) {
        messages = applyInsertFiles(messages, inserts);
      }
      const appends = loadSidecarMessages(cwd, config.appendFilesCli);
      if (appends.length > 0) {
        messages = applyAppendFiles(messages, appends);
      }
    } catch (e) {
      console.error('Error loading insert/append files:', e instanceof Error ? e.message : e);
      process.exit(1);
    }

    // Side-effectful sink preparation begins only after deterministic OCC,
    // message, tool, and sidecar validation has completed.
    outputPolicy = prepareOutputArtifactPolicy(outputPolicy);

    const outputPile = createOutputPileWriter({
      target: outputPolicy.outputPile?.target,
      format: outputPolicy.outputPile?.format
    });

    const result = await runModelOutputLifecycle({
      outputPile,
      runModel: () => callAIStream(
        config.apiKey,
        config.apiBaseUrl,
        config.model,
        messages,
        tools,
        toolChoiceForApi,
        config.temperature,
        (chunk) => {
          outputPile.writeDelta(chunk);
          if (!quiet) {
            process.stdout.write(chunk);
          }
        },
        config.extraBody
      )
    });
    const response = result.content;
    const toolCalls = result.toolCalls;
    const reasoningContent = result.reasoningContent;

    if (outputPolicy.mainOutput) {
      commitMainOutput({
        targets: outputPolicy.mainOutput,
        response,
        toolCalls,
        reasoningContent,
        ledger: artifactLedger
      });
    }
    printToolCallsLines(toolCalls, quiet);

    if (outputPolicy.conversation.continueEnabled) {
      const conversationWriteOptions = {
        onArtifactCommitted: (artifact: { kind: 'body' | 'calls' | 'extra'; absolutePath: string }) => {
          artifactLedger.record({ namespace: 'conversation', ...artifact });
        }
      };
      const saved = occEnabled
        ? (await commitConversationMutation({
            directory: outputDirectory!,
            mutationKind: 'continue_assistant',
            precondition: assistantPrecondition,
            mutate: state => appendAssistantTurnAtIndex(
              outputDirectory!,
              state.nextIndex,
              response,
              toolCalls,
              reasoningContent,
              conversationWriteOptions
            )
          })).value
        : appendAssistantTurn(
            outputDirectory!,
            outputFiles(),
            response,
            toolCalls,
            reasoningContent,
            conversationWriteOptions
          );
      void saved;
    }

    if (outputPolicy.hook.status === 'skip' && isPromptpileDiagnostic()) {
      console.error('[promptpile] after-hook: skipped (no script resolved)');
    }
    if (outputPolicy.hook.status === 'warn_invalid_explicit') {
      console.error(
        `Warning: after-hook script is not executable as a regular file: ${outputPolicy.hook.attempted} (${outputPolicy.hook.reason})`
      );
    } else if (outputPolicy.hook.status === 'run') {
      const hookEnv = buildPromptpileHookEnv({
        scanAbs,
        inputDirectories,
        outputDirectory,
        ledger: artifactLedger,
        toolCalls,
        model: config.model,
        quiet,
        responseLength: response.length,
        reasoningContent
      });
      await runAfterHook({
        scriptPath: outputPolicy.hook.path,
        scanAbs,
        hookEnv,
        quiet
      });
    }
  } catch (error) {
    for (const secondary of secondaryFailuresOf(error)) {
      console.error('Secondary cleanup error:', secondary);
    }
    if (isConversationConflictError(error)) {
      console.error(formatConversationConflict(error));
      process.exitCode = CONVERSATION_CONFLICT_EXIT_CODE;
      return;
    }
    console.error('Error:', error);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  await runCli(process.argv, {
    completion: () => runCompletion(cwd),
    appendUser: options => runAppendUserCommand(options, cwd),
    inspectConversation: options => runInspectConversationCommand(options, cwd),
    fingerprintConversation: options => runFingerprintConversationCommand(options, cwd)
  });
}

void main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
