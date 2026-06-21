import fs from 'fs';
import path from 'path';
import { stripBom, stripYamlFrontMatter } from './file-handler';
import type { ChatMessage } from './types';

const SIDECAR_BASENAME_PATTERN = /^(.+)\.([^.]+)\.md$/i;
const ALLOWED_ROLES = new Set(['system', 'user', 'assistant']);

export const parsePipeSeparatedPaths = (raw: string | undefined): string[] => {
  if (raw === undefined) {
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return [];
  }
  return trimmed
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== '');
};

export const resolveSidecarPath = (cwd: string, cliPath: string): string =>
  path.isAbsolute(cliPath) ? cliPath : path.resolve(cwd, cliPath);

export const parseSidecarBasename = (resolvedPath: string): { name: string; role: string } => {
  const base = path.basename(resolvedPath);
  const m = base.match(SIDECAR_BASENAME_PATTERN);
  if (!m) {
    throw new Error(
      `sidecar file basename must be {name}.{role}.md: ${base} (path: ${resolvedPath})`
    );
  }
  const role = m[2].toLowerCase();
  if (!ALLOWED_ROLES.has(role)) {
    throw new Error(
      `sidecar role must be system, user, or assistant: got "${m[2]}" in ${base}`
    );
  }
  return { name: m[1], role };
};

const readSidecarContent = (resolvedPath: string): string => {
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    throw new Error(`sidecar file not found: ${resolvedPath}`);
  }
  let text = stripBom(fs.readFileSync(resolvedPath, 'utf8'));
  if (resolvedPath.toLowerCase().endsWith('.md')) {
    text = stripYamlFrontMatter(text);
  }
  return text;
};

export const readSidecarMessage = (resolvedPath: string): ChatMessage => {
  const { role } = parseSidecarBasename(resolvedPath);
  const content = readSidecarContent(resolvedPath).trim();
  return { role, content };
};

export const loadSidecarMessages = (cwd: string, pathsRaw: string | undefined): ChatMessage[] => {
  const paths = parsePipeSeparatedPaths(pathsRaw);
  const out: ChatMessage[] = [];
  for (const p of paths) {
    const resolved = resolveSidecarPath(cwd, p);
    const { role } = parseSidecarBasename(resolved);
    const content = readSidecarContent(resolved).trim();
    if (content === '') {
      continue;
    }
    out.push({ role, content });
  }
  return out;
};

export const applyInsertFiles = (base: ChatMessage[], inserts: ChatMessage[]): ChatMessage[] => [
  ...inserts,
  ...base
];

export const applyAppendFiles = (base: ChatMessage[], appends: ChatMessage[]): ChatMessage[] => [
  ...base,
  ...appends
];
