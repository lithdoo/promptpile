import fs from 'fs';
import path from 'path';
import { normalizeToolCalls } from './ai-client';
import type {
  AssistantExtraPayload,
  BuildMessagesResult,
  ChatMessage,
  FileInfo,
  MessageDiagnostic,
  ToolCall,
  ToolResultLine
} from './types';
import { atomicWriteFileSync } from './atomic-file';
import { formatMissingToolResultContent } from './types';
import {
  allocateConversationMutationIndex,
  MAX_CONVERSATION_INDEX,
  parseConversationIndex
} from './conversation-index';
import { ConversationTargetCollisionError } from './conversation-conflict';
import { classifyConversationArtifactName } from './conversation-artifact-name';

const readUtf8FileFromDisk = (filePath: string): string =>
  fs.readFileSync(filePath, 'utf8');

export { MAX_CONVERSATION_INDEX, parseConversationIndex } from './conversation-index';

export const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

/** YAML front matter: opening `---` on first line, closing `---` on a later line. */
export const stripYamlFrontMatter = (raw: string): string => {
  const text = stripBom(raw);
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return text;
  }
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines.slice(i + 1).join('\n');
    }
  }
  return text;
};

/** Locale-independent lexicographic order over the exact UTF-8 bytes. */
export const compareUtf8Bytes = (a: string, b: string): number =>
  Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

/** Sort key: ordinary messages, `[idx]assistant.md`, call/extra, then result. */
export const conversationArtifactTier = (f: FileInfo): number => {
  if (f.fileKind === 'assistant_result') {
    return 3;
  }
  if (f.fileKind === 'assistant_call' || f.fileKind === 'assistant_extra') {
    return 2;
  }
  if (f.fileKind === 'message' && f.role === 'assistant' && f.extension === 'md') {
    return 1;
  }
  return 0;
};

export const compareConversationArtifacts = (a: FileInfo, b: FileInfo): number => {
  if (a.idx !== b.idx) {
    return a.idx - b.idx;
  }
  const ta = conversationArtifactTier(a);
  const tb = conversationArtifactTier(b);
  if (ta !== tb) {
    return ta - tb;
  }
  const ra = compareUtf8Bytes(a.role, b.role);
  if (ra !== 0) {
    return ra;
  }
  return compareUtf8Bytes(a.relativePath, b.relativePath);
};

/** Scan only direct files in the message directory; nested directories are intentionally ignored. */
export const scanDirectory = (directory: string, directoryIndex = 0): FileInfo[] => {
  const files: FileInfo[] = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const fullPath = path.join(directory, entry.name);
    const recognized = classifyConversationArtifactName(entry.name);
    if (!recognized) continue;
    files.push({
      path: fullPath,
      directoryIndex,
      relativePath: entry.name,
      ...recognized
    });
  }
  return files.sort(compareConversationArtifacts);
};

const readMessageFileContent = (file: FileInfo): string => {
  let content = readUtf8FileFromDisk(file.path);
  if (file.extension === 'md') {
    content = stripYamlFrontMatter(content);
  }
  return content;
};

const parseAssistantCallFile = (raw: string): ToolCall[] => {
  const text = stripBom(raw).trim();
  if (!text) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return normalizeToolCalls(parsed) ?? [];
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const toolCalls = (parsed as { tool_calls?: unknown }).tool_calls;
      if (Array.isArray(toolCalls)) {
        return normalizeToolCalls(toolCalls) ?? [];
      }
    }
  } catch {
    // fall through to JSONL
  }

  const lines = stripBom(raw).split(/\r?\n/).filter(l => l.trim());
  const collected: ToolCall[] = [];
  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (Array.isArray(obj)) {
      const n = normalizeToolCalls(obj);
      if (n) {
        collected.push(...n);
      }
    } else if (obj && typeof obj === 'object' && 'id' in (obj as object)) {
      const n = normalizeToolCalls([obj]);
      if (n) {
        collected.push(...n);
      }
    }
  }
  return collected;
};

const parseAssistantResultFile = (raw: string): ToolResultLine[] => {
  const lines = stripBom(raw).split(/\r?\n/).filter(l => l.trim());
  const out: ToolResultLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    let obj: unknown;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      throw new Error(`Invalid JSON on line ${i + 1} of assistant.result.jsonl`);
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new Error(`assistant.result.jsonl line ${i + 1} must be a JSON object`);
    }
    const rec = obj as Record<string, unknown>;
    if (typeof rec.tool_call_id !== 'string' || !rec.tool_call_id) {
      throw new Error(`assistant.result.jsonl line ${i + 1} must include string "tool_call_id"`);
    }
    if (typeof rec.content !== 'string') {
      throw new Error(`assistant.result.jsonl line ${i + 1} must include string "content"`);
    }
    const line: ToolResultLine = {
      tool_call_id: rec.tool_call_id,
      content: rec.content
    };
    if (typeof rec.name === 'string') {
      line.name = rec.name;
    }
    out.push(line);
  }
  return out;
};

export const parseAssistantExtraFile = (raw: string): string => {
  const text = stripBom(raw).trim();
  if (!text) {
    throw new Error('assistant.extra.json is empty');
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('assistant.extra.json must be valid JSON');
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    throw new Error('assistant.extra.json must be a JSON object');
  }
  const rec = obj as AssistantExtraPayload;
  if (typeof rec.reasoning_content !== 'string' || !rec.reasoning_content.trim()) {
    throw new Error('assistant.extra.json must include non-empty string "reasoning_content"');
  }
  return rec.reasoning_content;
};

const buildMessagesForIdx = (
  group: FileInfo[],
  diagnostics: MessageDiagnostic[]
): ChatMessage[] => {
  const idx = group[0]?.idx ?? 0;
  const messages: ChatMessage[] = [];
  const callFile = group.find(f => f.fileKind === 'assistant_call');
  const extraFile = group.find(f => f.fileKind === 'assistant_extra');
  const resultFile = group.find(f => f.fileKind === 'assistant_result');
  const messageFiles = group.filter(f => f.fileKind === 'message');
  const assistantMdFile = messageFiles.find(
    f => f.role === 'assistant' && f.extension === 'md'
  );
  const otherMessageFiles = messageFiles.filter(f => f !== assistantMdFile);

  for (const file of otherMessageFiles) {
    const content = readMessageFileContent(file);
    messages.push({
      role: file.role,
      content
    });
  }

  let callToolCalls: ToolCall[] | undefined;
  if (callFile) {
    const raw = readUtf8FileFromDisk(callFile.path);
    callToolCalls = parseAssistantCallFile(raw);
  }

  const assistantText = assistantMdFile
    ? readMessageFileContent(assistantMdFile)
    : undefined;
  const reasoningContent = extraFile
    ? parseAssistantExtraFile(readUtf8FileFromDisk(extraFile.path))
    : undefined;
  const assistantExtra =
    reasoningContent !== undefined ? { reasoning_content: reasoningContent } : {};

  const hasCalls = !!callToolCalls && callToolCalls.length > 0;
  const hasMdFile = !!assistantMdFile;
  const hasExtra = reasoningContent !== undefined;

  if (hasCalls && hasMdFile) {
    messages.push({
      role: 'assistant',
      content: assistantText ?? '',
      tool_calls: callToolCalls,
      ...assistantExtra
    });
  } else if (hasCalls) {
    messages.push({
      role: 'assistant',
      content: null,
      tool_calls: callToolCalls,
      ...assistantExtra
    });
  } else if (hasMdFile) {
    messages.push({
      role: 'assistant',
      content: assistantText ?? '',
      ...assistantExtra
    });
  } else if (hasExtra) {
    messages.push({
      role: 'assistant',
      content: null,
      ...assistantExtra
    });
  }

  const idsFromCall = callToolCalls && callToolCalls.length > 0 ? callToolCalls : undefined;

  if (resultFile) {
    const raw = readUtf8FileFromDisk(resultFile.path);
    const rows = parseAssistantResultFile(raw);
    const byId = new Map(rows.map(r => [r.tool_call_id, r]));

    if (idsFromCall) {
      for (const tc of idsFromCall) {
        const r = byId.get(tc.id);
        if (!r) {
          diagnostics.push({
            kind: 'missing_tool_result',
            directoryIndex: group[0]?.directoryIndex ?? 0,
            idx,
            toolCallId: tc.id,
            resultPath: resultFile.path,
            reason: 'tool_call_id_missing'
          });
        }
        const msg: ChatMessage = {
          role: 'tool',
          tool_call_id: tc.id,
          content: r ? r.content : formatMissingToolResultContent(idx, tc.id)
        };
        if (r?.name) {
          msg.name = r.name;
        }
        messages.push(msg);
      }
    } else {
      for (const r of rows) {
        const msg: ChatMessage = {
          role: 'tool',
          tool_call_id: r.tool_call_id,
          content: r.content
        };
        if (r.name) {
          msg.name = r.name;
        }
        messages.push(msg);
      }
    }
  } else if (idsFromCall) {
    for (const tc of idsFromCall) {
      diagnostics.push({
        kind: 'missing_tool_result',
        directoryIndex: group[0]?.directoryIndex ?? 0,
        idx,
        toolCallId: tc.id,
        resultPath: path.join(path.dirname(callFile!.path), '[' + idx + ']assistant.result.jsonl'),
        reason: 'result_file_missing'
      });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: formatMissingToolResultContent(idx, tc.id)
      });
    }
  }

  return messages;
};

export const buildMessagesWithDiagnostics = (files: FileInfo[]): BuildMessagesResult => {
  const diagnostics: MessageDiagnostic[] = [];
  const byDirectory = new Map<number, FileInfo[]>();
  for (const f of files) {
    if (!byDirectory.has(f.directoryIndex)) {
      byDirectory.set(f.directoryIndex, []);
    }
    byDirectory.get(f.directoryIndex)!.push(f);
  }

  const out: ChatMessage[] = [];
  const directoryIndices = [...byDirectory.keys()].sort((a, b) => a - b);
  for (const directoryIndex of directoryIndices) {
    const byIdx = new Map<number, FileInfo[]>();
    for (const file of byDirectory.get(directoryIndex)!) {
      if (!byIdx.has(file.idx)) byIdx.set(file.idx, []);
      byIdx.get(file.idx)!.push(file);
    }
    const indices = [...byIdx.keys()].sort((a, b) => a - b);
    for (const idx of indices) {
      const group = byIdx.get(idx)!;
      group.sort(compareConversationArtifacts);
      out.push(...buildMessagesForIdx(group, diagnostics));
    }
  }

  return { messages: out, diagnostics };
};

export const buildMessages = (files: FileInfo[]): ChatMessage[] =>
  buildMessagesWithDiagnostics(files).messages;

/** @deprecated Use buildMessages(scanDirectory(...)) */
export const readFiles = (files: FileInfo[]): ChatMessage[] => {
  return buildMessages(files);
};

export const appendAssistantMessage = (
  directory: string,
  files: FileInfo[],
  content: string
): string | undefined => {
  return appendAssistantTurn(directory, files, content, undefined).mdPath;
};

export const appendUserMessage = (directory: string, files: FileInfo[], content: string): string => {
  const idx = allocateConversationMutationIndex(directory, files, 'append_user');
  return appendUserMessageAtIndex(directory, idx, content);
};

/**
 * Find the smallest index N (>= max(files.idx)+1) such that none of
 * `[N]assistant.md`, `[N]assistant.calls.jsonl`, `[N]assistant.extra.json`,
 * `[N]assistant.result.jsonl` exist on disk; used by `appendAssistantTurn` so
 * companion sidecars (continue) always share the same `N`.
 */
export const nextAssistantIdx = (directory: string, files: FileInfo[]): number => {
  return allocateConversationMutationIndex(directory, files, 'continue_assistant');
};

/**
 * Write an assistant turn under `--continue` semantics. `mdPath` and `callsPath`
 * are independent and may both be set for a single `[N]`; `buildMessagesForIdx`
 * merges them into one assistant message with both `content` and `tool_calls`:
 *
 * - When `content` is non-empty, write `[N]assistant.md`.
 * - When `toolCalls` is non-empty, write `[N]assistant.calls.jsonl`.
 * - When `reasoningContent` is non-empty, write `[N]assistant.extra.json`.
 * - When all three are absent, reserve nothing on disk.
 */
export const appendAssistantTurn = (
  directory: string,
  files: FileInfo[],
  content: string,
  toolCalls: ToolCall[] | undefined,
  reasoningContent?: string,
  options: AssistantTurnWriteOptions = {}
): { idx: number; mdPath?: string; callsPath?: string; extraPath?: string } => {
  const idx = nextAssistantIdx(directory, files);
  return appendAssistantTurnAtIndex(directory, idx, content, toolCalls, reasoningContent, options);
};

export interface AssistantTurnWriteOptions {
  onArtifactCommitted?: (artifact: {
    kind: 'body' | 'calls' | 'extra';
    absolutePath: string;
  }) => void;
  /** Deterministic fault-injection seam; production uses the atomic writer. */
  writeFile?: typeof atomicWriteFileSync;
}

export const appendAssistantTurnAtIndex = (
  directory: string,
  idx: number,
  content: string,
  toolCalls: ToolCall[] | undefined,
  reasoningContent?: string,
  options: AssistantTurnWriteOptions = {}
): { idx: number; mdPath?: string; callsPath?: string; extraPath?: string } => {
  const hasContent = content.length > 0;
  const hasCalls = !!(toolCalls && toolCalls.length > 0);
  const hasReasoning = !!(reasoningContent && reasoningContent.trim());
  if (!hasContent && !hasCalls && !hasReasoning) return { idx };

  const intendedPaths = [
    hasContent ? path.join(directory, `[${idx}]assistant.md`) : undefined,
    hasCalls ? path.join(directory, `[${idx}]assistant.calls.jsonl`) : undefined,
    hasReasoning ? path.join(directory, `[${idx}]assistant.extra.json`) : undefined
  ].filter((candidate): candidate is string => candidate !== undefined);
  const collision = intendedPaths.find(candidate => fs.existsSync(candidate));
  if (collision !== undefined) {
    throw new ConversationTargetCollisionError(collision);
  }

  let mdPath: string | undefined;
  let callsPath: string | undefined;
  let extraPath: string | undefined;

  const writeFile = options.writeFile ?? atomicWriteFileSync;
  if (hasContent) {
    mdPath = path.join(directory, `[${idx}]assistant.md`);
    writeFile(mdPath, content);
    options.onArtifactCommitted?.({ kind: 'body', absolutePath: mdPath });
  }
  if (hasCalls) {
    callsPath = path.join(directory, `[${idx}]assistant.calls.jsonl`);
    const body = toolCalls!.map(tc => JSON.stringify(tc)).join('\n') + '\n';
    writeFile(callsPath, body);
    options.onArtifactCommitted?.({ kind: 'calls', absolutePath: callsPath });
  }
  if (hasReasoning) {
    extraPath = path.join(directory, `[${idx}]assistant.extra.json`);
    const payload: AssistantExtraPayload = { reasoning_content: reasoningContent!.trim() };
    writeFile(extraPath, `${JSON.stringify(payload, null, 2)}\n`);
    options.onArtifactCommitted?.({ kind: 'extra', absolutePath: extraPath });
  }

  return { idx, mdPath, callsPath, extraPath };
};

export const appendUserMessageAtIndex = (
  directory: string,
  nextIdx: number,
  content: string
): string => {
  const filePath = path.join(directory, `[${nextIdx}]user.md`);
  if (fs.existsSync(filePath)) {
    throw new ConversationTargetCollisionError(filePath);
  }
  atomicWriteFileSync(filePath, content);
  return filePath;
};
