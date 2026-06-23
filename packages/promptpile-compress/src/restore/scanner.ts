import fs from 'node:fs/promises';
import path from 'node:path';
import type { ArchiveDir } from './types';

const FILE_PATTERN = /^\[(\d+)\](.+?)\.(md|json)$/i;
const ASSISTANT_CALL_PATTERN = /^\[(\d+)\]assistant\.calls\.jsonl$/i;
const ASSISTANT_RESULT_PATTERN = /^\[(\d+)\]assistant\.result\.jsonl$/i;
const ASSISTANT_EXTRA_PATTERN = /^\[(\d+)\]assistant\.extra\.json$/i;
const ARCHIVE_DIR_PATTERN = /^\[(\d+)\]system\.md\.archive$/i;

export const STAGING_DIR = '.promptpile-compress.staging';

export const isMessageFileName = (name: string): boolean =>
  ASSISTANT_CALL_PATTERN.test(name) ||
  ASSISTANT_RESULT_PATTERN.test(name) ||
  ASSISTANT_EXTRA_PATTERN.test(name) ||
  FILE_PATTERN.test(name);

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
