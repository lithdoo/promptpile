import type { ChatApiToolChoice, ToolDefinition } from './types';

const FUNCTION_PREFIX = /^function:/i;

/**
 * Parse CLI `--tool-choice` raw string into an OpenAI-shaped `tool_choice` value.
 * @throws Error if the string is non-empty but invalid.
 */
export const parseToolChoiceInput = (raw: string | undefined): ChatApiToolChoice => {
  if (raw === undefined) {
    return 'auto';
  }
  const s = raw.trim();
  if (s === '') {
    return 'auto';
  }

  const lower = s.toLowerCase();
  if (lower === 'none') {
    return 'none';
  }
  if (lower === 'auto') {
    return 'auto';
  }
  if (lower === 'required') {
    return 'required';
  }

  const m = s.match(FUNCTION_PREFIX);
  if (m) {
    const name = s.slice(m[0].length).trim();
    if (!name) {
      throw new Error('Invalid --tool-choice: function:<name> requires a non-empty name.');
    }
    return { type: 'function', function: { name } };
  }

  throw new Error(
    `Invalid --tool-choice: "${raw}". Expected none | auto | required | function:<name>.`
  );
};

/**
 * Only include `tool_choice` in the API body when `tools` is non-empty (OpenAI requirement).
 */
export const effectiveToolChoiceForRequest = (
  tools: ToolDefinition[] | undefined,
  choice: ChatApiToolChoice
): ChatApiToolChoice | undefined => {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return choice;
};
