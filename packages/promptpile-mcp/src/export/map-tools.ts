import type { OpenAiToolEntry } from '../http/types';

/** promptpile `.tools.toml` 扁平表项（与 tools-loader 一致）。 */
export type FlatToolEntry = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

export function openAiToolsToFlat(tools: OpenAiToolEntry[]): FlatToolEntry[] {
  return tools.map((t, index) => {
    if (t.type !== 'function') {
      throw new Error(
        `promptpile-mcp: tools[${index}] 须为 type=function（网关响应非法）`
      );
    }
    const fn = t.function;
    if (!fn || typeof fn !== 'object') {
      throw new Error(`promptpile-mcp: tools[${index}].function 须为对象`);
    }
    if (typeof fn.name !== 'string' || fn.name.length === 0) {
      throw new Error(`promptpile-mcp: tools[${index}].function.name 须为非空字符串`);
    }
    const params = fn.parameters;
    if (params !== undefined) {
      if (
        params === null ||
        typeof params !== 'object' ||
        Array.isArray(params)
      ) {
        throw new Error(
          `promptpile-mcp: tools[${index}].function.parameters 须为对象`
        );
      }
    }

    const entry: FlatToolEntry = { name: fn.name };
    if (fn.description !== undefined) {
      if (typeof fn.description !== 'string') {
        throw new Error(
          `promptpile-mcp: tools[${index}].function.description 须为字符串`
        );
      }
      entry.description = fn.description;
    }
    if (params !== undefined) {
      entry.parameters = params as Record<string, unknown>;
    }
    return entry;
  });
}
