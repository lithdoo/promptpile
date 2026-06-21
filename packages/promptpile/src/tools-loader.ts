import fs from 'fs';
import path from 'path';
import { parse as parseToml } from '@iarna/toml';
import { isPromptpileDiagnostic } from './diagnostic-log';
import type { ToolDefinition } from './types';

/** Maximum `extends` nesting depth (root file is depth 0); entering depth > 32 throws. */
const MAX_EXTENDS_DEPTH = 32;

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);

const isFile = (absPath: string): boolean =>
  fs.existsSync(absPath) && fs.statSync(absPath).isFile();

const toolFunctionName = (t: ToolDefinition): string | undefined => {
  const fn = (t as { function?: unknown }).function;
  if (!fn || typeof fn !== 'object' || Array.isArray(fn)) {
    return undefined;
  }
  const name = (fn as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
};

/**
 * Validate one flat tool entry and wrap it into the OpenAI Chat Completions
 * `tools[]` shape: `{ type: "function", function: { name, description?, parameters? } }`.
 */
const normalizeFlatToolEntry = (
  rec: Record<string, unknown>,
  labelForErrors: string,
  locator: string,
): ToolDefinition => {
  if ('type' in rec || 'function' in rec) {
    throw new Error(
      `${labelForErrors}: ${locator}: tool entries must be flat (no "type" or "function" fields). Use { name, description?, parameters? }.`,
    );
  }
  if (typeof rec.name !== 'string' || rec.name.length === 0) {
    throw new Error(`${labelForErrors}: ${locator}: missing non-empty string "name"`);
  }
  let parameters: unknown = rec.parameters;
  if (typeof parameters === 'string') {
    try {
      parameters = JSON.parse(parameters) as unknown;
    } catch {
      throw new Error(`${labelForErrors}: ${locator}: invalid JSON in "parameters"`);
    }
  }
  if (
    parameters !== undefined &&
    (parameters === null || typeof parameters !== 'object' || Array.isArray(parameters))
  ) {
    throw new Error(
      `${labelForErrors}: ${locator}: "parameters" must be an object (or JSON string of one)`,
    );
  }
  const description = rec.description;
  if (description !== undefined && typeof description !== 'string') {
    throw new Error(`${labelForErrors}: ${locator}: "description" must be a string`);
  }

  const fn: Record<string, unknown> = { name: rec.name };
  if (description !== undefined) fn.description = description;
  if (parameters !== undefined) fn.parameters = parameters;
  return { type: 'function', function: fn } as ToolDefinition;
};

const parseTomlRootTable = (raw: string, labelForErrors: string): Record<string, unknown> => {
  let root: unknown;
  try {
    root = parseToml(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${labelForErrors}: ${msg}`);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error(`${labelForErrors}: root must be a TOML table`);
  }
  return root as Record<string, unknown>;
};

/** Later entries in `overlay` win on duplicate `function.name`. */
const mergeToolsByName = (base: ToolDefinition[], overlay: ToolDefinition[]): ToolDefinition[] => {
  const map = new Map<string, ToolDefinition>();
  for (const t of base) {
    const n = toolFunctionName(t);
    if (n) {
      map.set(n, t);
    }
  }
  for (const t of overlay) {
    const n = toolFunctionName(t);
    if (n) {
      map.set(n, t);
    }
  }
  return [...map.values()];
};

const parseToolsArrayFromTable = (
  table: Record<string, unknown>,
  labelForErrors: string,
): ToolDefinition[] => {
  const toolsRaw = table.tools;
  if (toolsRaw === undefined || toolsRaw === null) {
    return [];
  }
  if (!Array.isArray(toolsRaw)) {
    throw new Error(`${labelForErrors}: "tools" must be an array`);
  }
  if (toolsRaw.length === 0) {
    return [];
  }
  const tools: ToolDefinition[] = [];
  for (let i = 0; i < toolsRaw.length; i++) {
    const item = toolsRaw[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${labelForErrors}: tools[${i}] must be a table`);
    }
    const rec = item as Record<string, unknown>;
    tools.push(normalizeFlatToolEntry(rec, labelForErrors, `tools[${i}]`));
  }
  return tools;
};

const normalizeExtendsField = (table: Record<string, unknown>, labelForErrors: string): string[] => {
  const v = table.extends;
  if (v === undefined || v === null) {
    return [];
  }
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? [] : [t];
  }
  if (Array.isArray(v)) {
    const out: string[] = [];
    for (let i = 0; i < v.length; i++) {
      const item = v[i];
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error(`${labelForErrors}: extends[${i}] must be a non-empty string`);
      }
      out.push(item.trim());
    }
    return out;
  }
  throw new Error(`${labelForErrors}: "extends" must be a string or an array of strings`);
};

/**
 * Load one tools TOML (with `extends` resolved) into a flat tool list.
 * Merge order: each `extends` target fully resolved depth-first, siblings merged left-to-right
 * (later sibling wins on duplicate names), then this file's `tools` wins over all extends.
 */
export const loadToolsTomlResolved = (
  absPath: string,
  stack: Set<string>,
  depth: number,
): ToolDefinition[] => {
  if (depth > MAX_EXTENDS_DEPTH) {
    throw new Error(`Tools extends depth exceeds ${MAX_EXTENDS_DEPTH}: ${absPath}`);
  }
  const normalizedAbs = path.resolve(absPath);
  if (stack.has(normalizedAbs)) {
    throw new Error(`Circular tools extends detected: ${normalizedAbs}`);
  }
  if (!isFile(normalizedAbs)) {
    throw new Error(`Tools file not found: ${normalizedAbs}`);
  }
  if (path.extname(normalizedAbs).toLowerCase() !== '.toml') {
    throw new Error(`Tools file must be .toml: ${normalizedAbs}`);
  }

  if (isPromptpileDiagnostic()) {
    console.error('[promptpile] tools load:', normalizedAbs, `(depth ${depth})`);
  }

  const raw = stripBom(fs.readFileSync(normalizedAbs, 'utf8'));
  const label = path.basename(normalizedAbs);
  const table = parseTomlRootTable(raw, label);

  stack.add(normalizedAbs);
  try {
    const extendsList = normalizeExtendsField(table, label);
    let mergedFromExtends: ToolDefinition[] = [];
    const dir = path.dirname(normalizedAbs);
    for (const rel of extendsList) {
      const childAbs = path.resolve(dir, rel);
      const childTools = loadToolsTomlResolved(childAbs, stack, depth + 1);
      mergedFromExtends = mergeToolsByName(mergedFromExtends, childTools);
    }
    const localTools = parseToolsArrayFromTable(table, label);
    return mergeToolsByName(mergedFromExtends, localTools);
  } finally {
    stack.delete(normalizedAbs);
  }
};

const resolveExplicitToolsPath = (raw: string, baseDir: string): string => {
  const abs = path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(baseDir, raw);
  if (path.extname(abs).toLowerCase() !== '.toml') {
    throw new Error(`Tools file must end with .toml: ${abs}`);
  }
  if (!isFile(abs)) {
    throw new Error(`Tools file not found: ${abs}`);
  }
  return abs;
};

export type LoadToolsParams = {
  directory: string;
  cwd: string;
  toolsFileCli?: string;
  toolsFileConfig?: string;
};

/**
 * Load tools from an explicit `.toml` path only (no JSONL, no scan-directory defaults).
 * Priority: `toolsFileCli` (relative to cwd) > `toolsFileConfig` from TOML (relative to scan root).
 * Returns `undefined` when neither path is set (caller should require one or `--disable-tool`).
 */
export const loadTools = (params: LoadToolsParams): ToolDefinition[] | undefined => {
  const { directory, cwd, toolsFileCli, toolsFileConfig } = params;
  const scanAbs = path.resolve(cwd, directory);

  if (toolsFileCli) {
    const abs = resolveExplicitToolsPath(toolsFileCli, cwd);
    if (isPromptpileDiagnostic()) {
      console.error('[promptpile] tools source: --tools-file', abs);
    }
    return loadToolsTomlResolved(abs, new Set(), 0);
  }
  if (toolsFileConfig) {
    const abs = resolveExplicitToolsPath(toolsFileConfig, scanAbs);
    if (isPromptpileDiagnostic()) {
      console.error('[promptpile] tools source: TOML config', abs);
    }
    return loadToolsTomlResolved(abs, new Set(), 0);
  }
  return undefined;
};
