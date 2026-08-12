import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

function sources(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? sources(target) : entry.name.endsWith('.ts') ? [target] : [];
  });
}

it('keeps MCP outside private Promptpile, React, and Fork runtimes', () => {
  const root = path.resolve(__dirname);
  const forbidden = [
    /promptpile\/src\//,
    /promptpile\/dist\//,
    /promptpile-react\/src\//,
    /promptpile-fork\/src\//,
  ];
  for (const file of sources(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) assert.doesNotMatch(source, pattern, file);
  }
});
