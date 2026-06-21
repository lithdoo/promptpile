import { randomBytes } from 'crypto';
import { atomicWriteFileSync } from './atomic-file';
import path from 'path';
import type { ToolCall } from './types';

const DUMP_VERSION = 1;

const envTruthy = (name: string): boolean => {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
};

export const isLlmDumpEnabled = (): boolean => envTruthy('PROMPTPILE_DUMP_LLM');

export const makeDumpId = (): { id: string; iso: string } => {
  const iso = new Date().toISOString();
  const ts = String(Date.now());
  const rand = randomBytes(4).toString('hex');
  return { id: `${ts}-${rand}`, iso };
};

export const readDumpTag = (): string | undefined => {
  const t = process.env.PROMPTPILE_DUMP_LLM_TAG?.trim();
  return t === '' ? undefined : t;
};

export const redactHeaders = (headers: Record<string, string>): Record<string, string> => {
  const out = { ...headers };
  if (typeof out.Authorization === 'string') {
    out.Authorization = 'Bearer ***';
  }
  return out;
};

const writeJsonQuiet = (filePath: string, data: unknown): void => {
  try {
    atomicWriteFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[promptpile] llm-dump: failed to write ${filePath}: ${msg}`);
  }
};

export const writeLlmReqDump = (
  cwd: string,
  id: string,
  meta: { iso: string; url: string; tag?: string },
  headers: Record<string, string>,
  body: Record<string, unknown>
): void => {
  const doc: Record<string, unknown> = {
    dumpVersion: DUMP_VERSION,
    timestamp: meta.iso,
    url: meta.url,
    method: 'POST',
    headers: redactHeaders(headers),
    body
  };
  if (meta.tag !== undefined) {
    doc.tag = meta.tag;
  }
  writeJsonQuiet(path.join(cwd, `${id}.req.json`), doc);
};

export type LlmResDumpSuccess = {
  ok: true;
  status: number;
  stream: boolean;
  content: string;
  tool_calls?: ToolCall[];
  reasoning_content?: string;
};

export type LlmResDumpFailure = {
  ok: false;
  status: number | null;
  error: string;
};

export const writeLlmResDump = (
  cwd: string,
  id: string,
  meta: { iso: string; tag?: string },
  result: LlmResDumpSuccess | LlmResDumpFailure
): void => {
  const doc: Record<string, unknown> = {
    dumpVersion: DUMP_VERSION,
    timestamp: meta.iso,
    ...result
  };
  if (meta.tag !== undefined) {
    doc.tag = meta.tag;
  }
  writeJsonQuiet(path.join(cwd, `${id}.res.json`), doc);
};

export type LlmDumpSession = {
  id: string;
  iso: string;
  tag?: string;
  cwd: string;
};

export const beginLlmDump = (
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>
): LlmDumpSession | null => {
  if (!isLlmDumpEnabled()) {
    return null;
  }
  const { id, iso } = makeDumpId();
  const tag = readDumpTag();
  const cwd = process.cwd();
  writeLlmReqDump(cwd, id, { iso, url, tag }, headers, body);
  return { id, iso, tag, cwd };
};

export const finishLlmDumpSuccess = (
  session: LlmDumpSession | null,
  status: number,
  stream: boolean,
  content: string,
  toolCalls: ToolCall[] | undefined,
  reasoningContent?: string
): void => {
  if (session === null) {
    return;
  }
  const result: LlmResDumpSuccess = {
    ok: true,
    status,
    stream,
    content,
    tool_calls: toolCalls
  };
  if (reasoningContent) {
    result.reasoning_content = reasoningContent;
  }
  writeLlmResDump(session.cwd, session.id, { iso: session.iso, tag: session.tag }, result);
};

export const finishLlmDumpFailure = (
  session: LlmDumpSession | null,
  status: number | null,
  error: string
): void => {
  if (session === null) {
    return;
  }
  writeLlmResDump(session.cwd, session.id, { iso: session.iso, tag: session.tag }, {
    ok: false,
    status,
    error
  });
};
