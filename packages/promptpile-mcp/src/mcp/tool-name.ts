/**
 * Gateway OpenAI `function.name` ↔ MCP server id + MCP tool name (DESIGN §7).
 */

const PREFIX = 'mcp__';

/** Exported tool name for GET /v1/tools/export and promptpile `.tools.toml`. */
export function toGatewayToolName(
  serverId: string,
  mcpToolName: string,
  flatNames: boolean,
): string {
  if (flatNames) return mcpToolName;
  return `${PREFIX}${serverId}__${mcpToolName}`;
}

/** Parse `mcp__<serverId>__<rest>` — `rest` is the MCP tool name (may contain `_` but not used as delimiter after first `__`). */
export function parsePrefixedGatewayToolName(openAiName: string): { serverId: string; mcpToolName: string } | null {
  if (!openAiName.startsWith(PREFIX)) return null;
  const body = openAiName.slice(PREFIX.length);
  const sep = body.indexOf('__');
  if (sep <= 0) return null;
  const serverId = body.slice(0, sep);
  const mcpToolName = body.slice(sep + 2);
  if (!serverId || !mcpToolName) return null;
  return { serverId, mcpToolName };
}

export type FlatRouteResult =
  | { ok: true; serverId: string; mcpToolName: string }
  | { ok: false; reason: 'unknown_tool' | 'ambiguous_tool' };

/**
 * Resolve flat tool name to a single server when exactly one server lists that MCP tool name.
 */
export function resolveFlatToolName(
  mcpToolName: string,
  serverToToolNames: ReadonlyMap<string, ReadonlySet<string>>,
): FlatRouteResult {
  const hits: string[] = [];
  for (const [serverId, names] of serverToToolNames) {
    if (names.has(mcpToolName)) hits.push(serverId);
  }
  if (hits.length === 0) return { ok: false, reason: 'unknown_tool' };
  if (hits.length > 1) return { ok: false, reason: 'ambiguous_tool' };
  return { ok: true, serverId: hits[0], mcpToolName };
}

export type RouteExecToolNameOptions = {
  flatNames: boolean;
  flatIndex: ReadonlyMap<string, ReadonlySet<string>>;
  /**
   * When `flat_names` is true and flat lookup returns `unknown_tool`, retry parsing as prefixed
   * `mcp__<serverId>__<tool>` (e.g. legacy `.calls.jsonl` after toggling config).
   * Default: true.
   */
  allowPrefixedUnderFlat?: boolean;
};

export type RouteExecToolNameError = 'invalid_tool_name' | 'unknown_tool' | 'ambiguous_tool';

export type RouteExecToolNameResult =
  | { ok: true; serverId: string; mcpToolName: string }
  | { ok: false; error: RouteExecToolNameError };

/**
 * Single entry for `execCalls`: prefix mode vs flat_names (+ optional prefixed fallback).
 */
export function routeExecToolName(
  openAiName: string,
  options: RouteExecToolNameOptions,
): RouteExecToolNameResult {
  const { flatNames, flatIndex, allowPrefixedUnderFlat = true } = options;

  if (!flatNames) {
    const parsed = parsePrefixedGatewayToolName(openAiName);
    if (!parsed) return { ok: false, error: 'invalid_tool_name' };
    return { ok: true, serverId: parsed.serverId, mcpToolName: parsed.mcpToolName };
  }

  const flat = resolveFlatToolName(openAiName, flatIndex);
  if (flat.ok) {
    return { ok: true, serverId: flat.serverId, mcpToolName: flat.mcpToolName };
  }

  if (flat.reason === 'ambiguous_tool') {
    return { ok: false, error: 'ambiguous_tool' };
  }

  if (
    allowPrefixedUnderFlat &&
    openAiName.startsWith(PREFIX)
  ) {
    const parsed = parsePrefixedGatewayToolName(openAiName);
    if (parsed) {
      return { ok: true, serverId: parsed.serverId, mcpToolName: parsed.mcpToolName };
    }
    return { ok: false, error: 'invalid_tool_name' };
  }

  return { ok: false, error: 'unknown_tool' };
}
