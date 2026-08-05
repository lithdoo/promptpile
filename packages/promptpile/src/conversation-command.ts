import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { appendUserMessage, scanDirectory } from './file-handler';

export interface AppendUserOptions {
  directory: string;
  quiet?: boolean;
}

export const registerConversationCommand = (
  program: Command,
  onAppendUser?: (options: AppendUserOptions) => void | Promise<void>
): void => {
  const conversation = program
    .command('conversation')
    .description('Manage conversation message artifacts');
  const appendUser = conversation
    .command('append-user')
    .description('Append one user message without invoking an LLM')
    .requiredOption('-d, --directory <path>', 'Existing message directory')
    .option('-q, --quiet', 'Suppress successful stdout output');

  if (onAppendUser !== undefined) {
    appendUser.action(onAppendUser);
  }
};

const readStdinUtf8 = async (): Promise<string> => {
  process.stdin.setEncoding('utf8');
  let content = '';
  for await (const chunk of process.stdin) {
    content += chunk;
  }
  return content;
};

const requireExistingDirectory = (cwd: string, directory: string): string => {
  const resolved = path.isAbsolute(directory) ? directory : path.resolve(cwd, directory);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error(`conversation directory does not exist: ${resolved}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`conversation directory is not a directory: ${resolved}`);
  }
  return resolved;
};

/** Append one user message without loading completion config or invoking an LLM. */
export const runAppendUserCommand = async (
  options: AppendUserOptions,
  cwd: string
): Promise<void> => {
  try {
    const directory = requireExistingDirectory(cwd, options.directory);
    const content = await readStdinUtf8();
    if (content.trim() === '') {
      throw new Error('user message is empty; nothing was written');
    }

    const writtenPath = appendUserMessage(directory, scanDirectory(directory), content);
    if (!options.quiet) {
      process.stdout.write(`${writtenPath}\n`);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};
