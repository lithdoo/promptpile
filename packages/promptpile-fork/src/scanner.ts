import fs from 'node:fs/promises';
import path from 'node:path';
import {
  classifyConversationArtifactNameV1,
  compareConversationArtifactsV1
} from 'promptpile-protocol/conversation';
import { ForkError } from './errors';
import type { ForkArtifactEntry } from './types';

export async function scanSelectedArtifacts(directory: string, throughIndex: number): Promise<ForkArtifactEntry[]> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) {
    throw new ForkError('invalid_source', `unable to scan source directory: ${directory}`, error);
  }
  const selected: ForkArtifactEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const recognized = classifyConversationArtifactNameV1(entry.name);
    if (recognized === undefined || recognized.idx > throughIndex) continue;
    const sourcePath = path.join(directory, entry.name);
    try {
      const stat = await fs.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
    } catch (error) {
      throw new ForkError('source_unstable', `selected artifact changed during scan: ${entry.name}`, error);
    }
    selected.push({ relativePath: entry.name, sourcePath, ...recognized });
  }
  selected.sort(compareConversationArtifactsV1);
  return selected;
}

export const sameArtifactEntries = (left: readonly ForkArtifactEntry[], right: readonly ForkArtifactEntry[]): boolean =>
  left.length === right.length && left.every((item, index) => {
    const other = right[index];
    return other !== undefined && item.relativePath === other.relativePath && item.idx === other.idx &&
      item.fileKind === other.fileKind && item.role === other.role && item.extension === other.extension;
  });
