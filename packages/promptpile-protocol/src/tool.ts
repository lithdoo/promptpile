export interface ToolCallV1 {
  id: string;
  type: string;
  function: { name: string; arguments: string };
}

export interface ToolResultLineV1 {
  tool_call_id: string;
  content: string;
  name?: string;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

export function parseToolCallV1(value: unknown): ToolCallV1 | undefined {
  const outer = record(value);
  if (!outer || typeof outer.id !== 'string' || typeof outer.type !== 'string') return undefined;
  const fn = record(outer.function);
  if (!fn || typeof fn.name !== 'string' || typeof fn.arguments !== 'string') return undefined;
  return { id: outer.id, type: outer.type, function: { name: fn.name, arguments: fn.arguments } };
}

export function parseToolResultLineV1(value: unknown): ToolResultLineV1 | undefined {
  const outer = record(value);
  if (!outer || typeof outer.tool_call_id !== 'string' || typeof outer.content !== 'string') {
    return undefined;
  }
  if (outer.name !== undefined && typeof outer.name !== 'string') return undefined;
  return outer.name === undefined
    ? { tool_call_id: outer.tool_call_id, content: outer.content }
    : { tool_call_id: outer.tool_call_id, content: outer.content, name: outer.name };
}
