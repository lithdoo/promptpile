import fs from 'fs';
import path from 'path';
import {
  resultAbsPathForCallFile,
  stemFromCallsBasename,
} from './calls-paths';

export type CallFileRef = {
  absPath: string;
  stem: string;
  resultAbsPath: string;
};

/**
 * 扫描 `rootAbs` 第一层中以 `.calls.jsonl` 结尾的普通文件。
 * 不进入子目录；非法 basename `.calls.jsonl`（空 stem）跳过并 stderr 警告。
 */
export function scanCallsJsonlFiles(rootAbs: string): CallFileRef[] {
  if (!fs.existsSync(rootAbs)) return [];
  if (!fs.statSync(rootAbs).isDirectory()) return [];

  const refs: CallFileRef[] = [];
  for (const entry of fs.readdirSync(rootAbs, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const stem = stemFromCallsBasename(entry.name);
    const absPath = path.join(rootAbs, entry.name);
    if (stem === undefined) {
      if (entry.name.endsWith('.calls.jsonl')) {
        console.error(
          `promptpile-mcp: 跳过（无效的 .calls.jsonl 文件名）: ${absPath}`
        );
      }
      continue;
    }
    refs.push({
      absPath,
      stem,
      resultAbsPath: resultAbsPathForCallFile(absPath, stem),
    });
  }

  refs.sort((a, b) => a.absPath.localeCompare(b.absPath));
  return refs;
}
