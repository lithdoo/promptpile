import type { AfterHookFailureMode } from './after-hook-policy';
import type { InvocationId } from './invocation-context';

/**
 * Synthetic `tool` message `content` when `[idx]assistant.calls.jsonl` lists a `tool_call_id` but
 * `[idx]assistant.result.jsonl` has no matching line (or the file is absent). Documented in README.
 */
export const formatMissingToolResultContent = (idx: number, toolCallId: string): string =>
  `错误：未在 [${idx}]assistant.result.jsonl 中找到 tool_call_id=${toolCallId}`;

/** OpenAI-style tool call on an assistant message. */
export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Chat Completions message shape (subset used by promptpile).
 * Maps directly to API JSON; optional fields omitted when unused.
 */
export interface ChatMessage {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  reasoning_content?: string | null;
  tool_call_id?: string;
  name?: string;
}

/** `[idx]assistant.extra.json` / `{basename}.extra.json` on-disk shape. */
export interface AssistantExtraPayload {
  reasoning_content: string;
}

/** One line in `[idx]assistant.result.jsonl`. */
export interface ToolResultLine {
  tool_call_id: string;
  content: string;
  name?: string;
}

export type MissingToolResultsPolicy = 'warn' | 'error' | 'ignore';

export interface MessageDiagnostic {
  kind: 'missing_tool_result';
  /** Source conversation layer; idx is only local to this directory. */
  directoryIndex: number;
  idx: number;
  toolCallId: string;
  resultPath: string;
  reason: 'result_file_missing' | 'tool_call_id_missing';
}

export interface BuildMessagesResult {
  messages: ChatMessage[];
  diagnostics: MessageDiagnostic[];
}

/** Resolved layered Conversation inputs, optional mutation target, and compatibility anchor. */
export interface ResolvedConversationIo {
  /** Canonical, de-duplicated conversation input directories in layer order. */
  inputDirectories: string[];
  /** Canonical unique Conversation mutation target, explicit or single-layer fallback. */
  outputDirectory?: string;
  /** Anchor for legacy relative config, tool discovery, and after-hook resolution. */
  anchorDirectory: string;
}

/** Single element of the API `tools` array (from tools `.toml` `[[tools]]` rows). */
export type ToolDefinition = Record<string, unknown>;

/** OpenAI Chat Completions `tool_choice` string values (subset used by promptpile). */
export type ChatApiToolChoiceString = 'none' | 'auto' | 'required';

/** OpenAI Chat Completions `tool_choice` (string or forced function). */
export type ChatApiToolChoice =
  | ChatApiToolChoiceString
  | { type: 'function'; function: { name: string } };

export type FileKind = 'message' | 'assistant_call' | 'assistant_result' | 'assistant_extra';

export interface FileInfo {
  path: string;
  /** Position in the effective ordered conversation directory list. */
  directoryIndex: number;
  /** Direct-child path relative to the source conversation directory. */
  relativePath: string;
  idx: number;
  /** Role from filename for normal messages; for assistant_call/assistant_result use `assistant`. */
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: FileKind;
}

export interface Config {
  /** Unambiguous internal model for resolved layered Conversation I/O. */
  conversationIo: ResolvedConversationIo;
  /** @deprecated Use `conversationIo.inputDirectories`. */
  inputDirectories: string[];
  /**
   * @deprecated Use `conversationIo.anchorDirectory`. Retained as a compatibility alias.
   */
  directory: string;
  /** @deprecated Use `conversationIo.outputDirectory`. */
  outputDirectory?: string;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  /** CLI-only external correlation label; never added to model input. */
  invocationId?: InvocationId;
  /** Merged sampling temperature; default 0.8 when unset at all layers. */
  temperature: number;
  /** Merged extra request body fields; omitted when unset at all layers. */
  extraBody?: Record<string, unknown>;
  continueMode: boolean;
  inputMode: boolean;
  /** CLI-only OCC precondition for the writable output Conversation directory. */
  expectedOutputFingerprint?: string;
  /** CLI-only OCC precondition for the next output Conversation mutation index. */
  expectedOutputNextIndex?: number;
  output?: string;
  /** Completion Receipt v1 file path; relative paths resolve from process cwd. */
  receipt?: string;
  /** Optional file/pipe path that receives streamed assistant output even when quiet is true. */
  outputPileFile?: string;
  /** Optional inherited fd that receives streamed assistant output even when quiet is true. */
  outputPileFd?: number;
  /** The sole resolved destination used by the runtime. CLI destination group wins over TOML. */
  outputPileTarget?:
    | { kind: 'file'; path: string; source: 'cli' | 'toml'; shadowedFile?: string }
    | { kind: 'fd'; fd: number; source: 'cli' | 'toml'; shadowedFile?: string };
  /** Stream output format for output pile; defaults to text when unset. */
  outputPileFormat?: 'text' | 'json';
  quiet: boolean;
  /** CLI `--tools-file`: relative to cwd when relative. */
  toolsFileCli?: string;
  /** TOML `tools_file`: relative to the conversation anchor when relative. */
  toolsFileConfig?: string;
  /** Merged `insert_files` / `--insert-files`: pipe-separated paths, relative to cwd. */
  insertFilesCli?: string;
  /** Merged `append_files` / `--append-files`: pipe-separated paths, relative to cwd. */
  appendFilesCli?: string;
  /** CLI `--after-hook-path`: relative to cwd when relative. */
  afterHookCli?: string;
  /** TOML `after_hook`: relative to the conversation anchor when relative. */
  afterHookConfig?: string;
  /** Resolved CLI > TOML > default policy for after-hook failures. */
  afterHookFailure: AfterHookFailureMode;
  /** CLI-only opt-in for discovering default .after-hook files at the conversation anchor. */
  allowDefaultAfterHook: boolean;
  /**
   * Raw `none` | `auto` | `required` | `function:<name>` from CLI `--tool-choice` or TOML `tool_choice`.
   * Parsed to {@link ChatApiToolChoice} when building the API body.
   */
  toolChoice?: string;
  /** Handling for calls without matching tool results. */
  missingToolResults: MissingToolResultsPolicy;
  /** CLI `--disable-tool`: skip loading tools from any source. */
  disableTool?: boolean;
}

export interface AiCallResult {
  content: string;
  toolCalls: ToolCall[] | undefined;
  reasoningContent: string | undefined;
  finishReason: string | undefined;
  usage: CompletionUsage | undefined;
}

export interface CompletionUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}
