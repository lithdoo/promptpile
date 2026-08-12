import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveDir } from './types';
import { classifyConversationArtifactNameV1 } from 'promptpile-protocol/conversation';

const ARCHIVE_DIR_PATTERN = /^\[(\d+)\]system\.md\.archive$/;

export const STAGING_DIR = '.promptpile-compress.staging';

export const isMessageFileName = (name: string): boolean =>
  classifyConversationArtifactNameV1(name) !== undefined;

export const findArchiveDirs = async (directory: string): Promise<ArchiveDir[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const archives: ArchiveDir[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const match = entry.name.match(ARCHIVE_DIR_PATTERN);
    if (!match) {
      continue;
    }
    archives.push({
      idx: Number.parseInt(match[1], 10),
      name: entry.name,
      path: path.join(directory, entry.name),
    });
  }

  return archives.sort((a, b) => b.idx - a.idx || a.name.localeCompare(b.name));
};

export const findStagingDir = async (directory: string): Promise<string | null> => {
  const stagingPath = path.join(directory, STAGING_DIR);
  try {
    const stat = await fs.stat(stagingPath);
    return stat.isDirectory() ? stagingPath : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
};

export const listMessageFiles = async (directory: string): Promise<string[]> => {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && isMessageFileName(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
};
