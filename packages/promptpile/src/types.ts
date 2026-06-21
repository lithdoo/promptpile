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
  idx: number;
  toolCallId: string;
  resultPath: string;
  reason: 'result_file_missing' | 'tool_call_id_missing';
}

export interface BuildMessagesResult {
  messages: ChatMessage[];
  diagnostics: MessageDiagnostic[];
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
  idx: number;
  /** Role from filename for normal messages; for assistant_call/assistant_result use `assistant`. */
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: FileKind;
}

export interface Config {
  directory: string;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  /** Merged sampling temperature; default 0.8 when unset at all layers. */
  temperature: number;
  /** Merged extra request body fields; omitted when unset at all layers. */
  extraBody?: Record<string, unknown>;
  continueMode: boolean;
  inputMode: boolean;
  output?: string;
  /** Optional file/pipe path that receives streamed assistant output even when quiet is true. */
  outputPileFile?: string;
  /** Optional inherited fd that receives streamed assistant output even when quiet is true. */
  outputPileFd?: number;
  /** Stream output format for output pile; defaults to text when unset. */
  outputPileFormat?: 'text' | 'json';
  quiet: boolean;
  /** CLI `--tools-file`: relative to cwd when relative. */
  toolsFileCli?: string;
  /** TOML `tools_file`: relative to scan directory root when relative. */
  toolsFileConfig?: string;
  /** Merged `insert_files` / `--insert-files`: pipe-separated paths, relative to cwd. */
  insertFilesCli?: string;
  /** Merged `append_files` / `--append-files`: pipe-separated paths, relative to cwd. */
  appendFilesCli?: string;
  /** CLI `--after-hook-path`: relative to cwd when relative. */
  afterHookCli?: string;
  /** TOML `after_hook`: relative to scan directory when relative. */
  afterHookConfig?: string;
  /** CLI-only opt-in for discovering default .after-hook files in the scan directory. */
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
}
