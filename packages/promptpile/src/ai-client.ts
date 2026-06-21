import fetch from 'node-fetch';
import {
  beginLlmDump,
  finishLlmDumpFailure,
  finishLlmDumpSuccess,
  type LlmDumpSession
} from './llm-dump';
import type { AiCallResult, ChatApiToolChoice, ChatMessage, ToolCall, ToolDefinition } from './types';

interface StreamDeltaToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | null };
}

interface ChatCompletionStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: StreamDeltaToolCall[];
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string };
}

const trimTrailingSlash = (url: string) => url.replace(/\/$/, '');

export const pickNonEmptyString = (v: unknown): string | undefined => {
  if (typeof v !== 'string') {
    return undefined;
  }
  const t = v.trim();
  return t.length > 0 ? v : undefined;
};

const createPayload = (
  model: string,
  messages: ChatMessage[],
  stream: boolean,
  tools: ToolDefinition[] | undefined,
  toolChoice: ChatApiToolChoice | undefined,
  temperature: number,
  extraBody?: Record<string, unknown>
) => {
  const body: Record<string, unknown> = {
    model,
    stream,
    messages,
    temperature,
    ...(extraBody ?? {})
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    if (toolChoice !== undefined) {
      body.tool_choice = toolChoice;
    }
  }
  return body;
};

const createHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json'
});

export const normalizeToolCalls = (raw: unknown): ToolCall[] | undefined => {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const out: ToolCall[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const t = item as Record<string, unknown>;
    const id = typeof t.id === 'string' ? t.id : '';
    const type = typeof t.type === 'string' ? t.type : 'function';
    const fn = t.function;
    if (!fn || typeof fn !== 'object') {
      continue;
    }
    const f = fn as Record<string, unknown>;
    const name = typeof f.name === 'string' ? f.name : '';
    const args = typeof f.arguments === 'string' ? f.arguments : '';
    if (!id) {
      continue;
    }
    out.push({
      id,
      type,
      function: { name, arguments: args }
    });
  }
  return out.length > 0 ? out : undefined;
};

/** Merge streaming `delta.tool_calls` chunks into complete `ToolCall[]`. */
export const mergeStreamToolCalls = (deltas: StreamDeltaToolCall[]): ToolCall[] => {
  type Builder = {
    id: string;
    type: string;
    name: string;
    arguments: string;
  };
  const byIndex = new Map<number, Builder>();

  for (const tc of deltas) {
    const index = typeof tc.index === 'number' ? tc.index : 0;
    let b = byIndex.get(index);
    if (!b) {
      b = { id: '', type: 'function', name: '', arguments: '' };
      byIndex.set(index, b);
    }
    if (tc.id) {
      b.id = tc.id;
    }
    if (tc.type) {
      b.type = tc.type;
    }
    if (tc.function?.name) {
      b.name = tc.function.name;
    }
    if (tc.function?.arguments) {
      b.arguments += tc.function.arguments;
    }
  }

  const indices = [...byIndex.keys()].sort((a, b) => a - b);
  const out: ToolCall[] = [];
  for (const i of indices) {
    const b = byIndex.get(i);
    if (!b || !b.id) {
      continue;
    }
    out.push({
      id: b.id,
      type: b.type,
      function: { name: b.name, arguments: b.arguments }
    });
  }
  return out;
};

const failDumpAndThrow = (
  session: LlmDumpSession | null,
  status: number | null,
  message: string
): never => {
  finishLlmDumpFailure(session, status, message);
  throw new Error(message);
};

export const callAIStream = async (
  apiKey: string,
  apiBaseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: ToolDefinition[] | undefined,
  toolChoice: ChatApiToolChoice | undefined,
  temperature: number,
  onChunk: (chunk: string) => void,
  extraBody?: Record<string, unknown>
): Promise<AiCallResult> => {
  const url = `${trimTrailingSlash(apiBaseUrl)}/chat/completions`;
  const headers = createHeaders(apiKey);
  const payload = createPayload(model, messages, true, tools, toolChoice, temperature, extraBody);
  const dumpSession = beginLlmDump(url, headers, payload);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as ChatCompletionStreamChunk;
      const detail = data.error?.message ?? res.statusText;
      console.error('Error calling AI API:', detail);
      failDumpAndThrow(dumpSession, res.status, `AI API error (${res.status}): ${detail}`);
    }

    if (!res.body) {
      failDumpAndThrow(dumpSession, res.status, 'AI API did not return a stream body.');
    }

    let fullText = '';
    let fullReasoning = '';
    let buffer = '';
    const streamToolDeltas: StreamDeltaToolCall[] = [];

    for await (const chunk of res.body) {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) {
          continue;
        }

        const payloadLine = line.slice(5).trim();
        if (!payloadLine || payloadLine === '[DONE]') {
          continue;
        }

        try {
          const data = JSON.parse(payloadLine) as ChatCompletionStreamChunk;
          const delta = data.choices?.[0]?.delta;
          const piece = delta?.content ?? '';
          if (piece) {
            fullText += piece;
            onChunk(piece);
          }
          const reasoningPiece = delta?.reasoning_content ?? '';
          if (reasoningPiece) {
            fullReasoning += reasoningPiece;
          }
          const tc = delta?.tool_calls;
          if (tc && tc.length > 0) {
            streamToolDeltas.push(...tc);
          }
        } catch {
          // Ignore non-JSON lines to keep streaming resilient across providers.
        }
      }
    }

    if (buffer.trim().startsWith('data:')) {
      const payloadLine = buffer.trim().slice(5).trim();
      if (payloadLine && payloadLine !== '[DONE]') {
        try {
          const data = JSON.parse(payloadLine) as ChatCompletionStreamChunk;
          const delta = data.choices?.[0]?.delta;
          const piece = delta?.content ?? '';
          if (piece) {
            fullText += piece;
            onChunk(piece);
          }
          const reasoningPiece = delta?.reasoning_content ?? '';
          if (reasoningPiece) {
            fullReasoning += reasoningPiece;
          }
          const tc = delta?.tool_calls;
          if (tc && tc.length > 0) {
            streamToolDeltas.push(...tc);
          }
        } catch {
          // Ignore trailing malformed payload.
        }
      }
    }

    const merged = mergeStreamToolCalls(streamToolDeltas);
    const toolCalls = merged.length > 0 ? merged : undefined;
    const reasoningContent = pickNonEmptyString(fullReasoning);

    finishLlmDumpSuccess(dumpSession, res.status, true, fullText, toolCalls, reasoningContent);
    return { content: fullText, toolCalls, reasoningContent };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('AI API error')) {
      throw error;
    }
    const msg =
      error instanceof Error
        ? error.message
        : 'Failed to call AI API. Please check your network connection and API key.';
    finishLlmDumpFailure(dumpSession, null, msg);
    console.error('Error calling AI API:', error);
    console.error('Please check your network connection and API key');
    throw new Error('Failed to call AI API. Please check your network connection and API key.');
  }
};
