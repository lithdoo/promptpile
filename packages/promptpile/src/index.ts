#!/usr/bin/env node
import readline from 'readline';
import fs from 'fs';
import { atomicWriteFileSync } from './atomic-file';
import path from 'path';
import { resolveConfig } from './resolve-config';
import {
  appendAssistantTurn,
  appendUserMessage,
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
import type { AssistantExtraPayload, ChatApiToolChoice, ToolCall } from './types';
import { applyMissingToolResultsPolicy } from './tool-result-policy';

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

const resolveOutputPath = (outputPath: string): string =>
  path.isAbsolute(outputPath) ? outputPath : path.resolve(process.cwd(), outputPath);

/**
 * Ensure parent directory exists and is writable before calling the API.
 */
const ensureOutputPaths = (outputPath: string): string => {
  const resolvedPath = resolveOutputPath(outputPath);
  const dir = path.dirname(resolvedPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch {
    console.error(`Error: Cannot create or write to output directory: ${dir}`);
    process.exit(1);
  }
  return resolvedPath;
};

const callsPathForMainOutput = (resolvedMainPath: string): string => {
  const { dir, name } = path.parse(resolvedMainPath);
  return path.join(dir, `${name}.calls.jsonl`);
};

const writeCallsFile = (resolvedMainPath: string, toolCalls: ToolCall[] | undefined): void => {
  if (!toolCalls || toolCalls.length === 0) {
    return;
  }
  const callsPath = callsPathForMainOutput(resolvedMainPath);
  const body = toolCalls.map(tc => JSON.stringify(tc)).join('\n') + '\n';
  atomicWriteFileSync(callsPath, body);
};

const extraPathForMainOutput = (resolvedMainPath: string): string => {
  const { dir, name } = path.parse(resolvedMainPath);
  return path.join(dir, `${name}.extra.json`);
};

const writeExtraFile = (resolvedMainPath: string, reasoningContent: string | undefined): void => {
  if (!reasoningContent) {
    return;
  }
  const payload: AssistantExtraPayload = { reasoning_content: reasoningContent };
  atomicWriteFileSync(
    extraPathForMainOutput(resolvedMainPath),
    `${JSON.stringify(payload, null, 2)}\n`
  );
};

const printToolCallsLines = (toolCalls: ToolCall[] | undefined, quiet: boolean): void => {
  if (quiet || !toolCalls?.length) {
    return;
  }
  for (const tc of toolCalls) {
    process.stdout.write(`${JSON.stringify(tc)}\n`);
  }
};

async function main(): Promise<void> {
  try {
    const cwd = process.cwd();
    const config = resolveConfig(cwd, process.argv);

    if (!config.apiKey) {
      console.error('Error: AI API key is required');
      process.exit(1);
    }

    const quiet = config.quiet;

    let files = scanDirectory(config.directory);

    if (config.inputMode) {
      const userContent = await readUserInputFromTerminal();
      if (!userContent) {
        console.error('Error: Empty input. Nothing was written.');
        process.exit(1);
      }

      appendUserMessage(config.directory, files, userContent);
      files = scanDirectory(config.directory);
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
          directory: config.directory,
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

    let resolvedOutput: string | undefined;
    if (config.output) {
      resolvedOutput = ensureOutputPaths(config.output);
    }

    let response = '';
    let toolCalls: ToolCall[] | undefined;
    let reasoningContent: string | undefined;

    const outputPile = createOutputPileWriter({
      pileFile: config.outputPileFile,
      pileFd: config.outputPileFd,
      format: config.outputPileFormat
    });

    try {
      const result = await callAIStream(
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
      );
      response = result.content;
      toolCalls = result.toolCalls;
      reasoningContent = result.reasoningContent;
      outputPile.writeDone();
    } catch (e) {
      outputPile.writeError(e);
      throw e;
    } finally {
      await outputPile.close();
    }

    if (resolvedOutput) {
      atomicWriteFileSync(resolvedOutput, response);
      writeCallsFile(resolvedOutput, toolCalls);
      writeExtraFile(resolvedOutput, reasoningContent);
    }
    printToolCallsLines(toolCalls, quiet);

    let continueMdPath: string | undefined;
    let continueCallsPath: string | undefined;
    let continueExtraPath: string | undefined;
    if (config.continueMode) {
      const saved = appendAssistantTurn(
        config.directory,
        files,
        response,
        toolCalls,
        reasoningContent
      );
      continueMdPath = saved.mdPath;
      continueCallsPath = saved.callsPath;
      continueExtraPath = saved.extraPath;
    }

    const scanAbs = path.resolve(cwd, config.directory);
    const hookResolution = resolveAfterHookScript({
      cwd,
      scanAbs,
      afterHookCli: config.afterHookCli,
      afterHookConfig: config.afterHookConfig,
      allowDefaultAfterHook: config.allowDefaultAfterHook
    });
    if (hookResolution.status === 'skip' && isPromptpileDiagnostic()) {
      console.error('[promptpile] after-hook: skipped (no script resolved)');
    }
    if (hookResolution.status === 'warn_invalid_explicit') {
      console.error(
        `Warning: after-hook script is not executable as a regular file: ${hookResolution.attempted} (${hookResolution.reason})`
      );
    } else if (hookResolution.status === 'run') {
      const hookEnv = buildPromptpileHookEnv({
        scanAbs,
        resolvedOutput,
        toolCalls,
        model: config.model,
        quiet,
        responseLength: response.length,
        continueMdPath,
        continueCallsPath,
        continueExtraPath,
        reasoningContent
      });
      await runAfterHook({
        scriptPath: hookResolution.path,
        scanAbs,
        hookEnv,
        quiet
      });
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

void main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
