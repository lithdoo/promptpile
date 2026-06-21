import fs from 'fs';
import { stringify } from '@iarna/toml';
import type { FlatToolEntry } from './map-tools';

/** 写入与 promptpile `loadTools` 兼容的 `.tools.toml`（根键 `tools`）。 */
export function writeToolsToml(absPath: string, tools: FlatToolEntry[]): void {
  const doc = { tools };
  const plain = JSON.parse(JSON.stringify(doc)) as Parameters<
    typeof stringify
  >[0];
  const raw = stringify(plain);
  fs.writeFileSync(absPath, raw, 'utf8');
}
