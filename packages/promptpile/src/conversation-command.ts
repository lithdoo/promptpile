import fs from 'fs';
import path from 'path';
import { Command } from 'commander';
import { appendUserMessage, scanDirectory } from './file-handler';

interface AppendUserOptions {
  directory: string;
  quiet?: boolean;
}

const isAppendUserCommand = (argv: string[]): boolean =>
  argv[2] === 'conversation' && argv[3] === 'append-user';

const parseAppendUserOptions = (argv: string[]): AppendUserOptions => {
  const program = new Command();
  program
    .name('promptpile conversation append-user')
    .description('Append one user message without invoking an LLM')
    .requiredOption('-d, --directory <path>', 'Existing message directory')
    .option('-q, --quiet', 'Suppress successful stdout output');

  program.parse([argv[0], argv[1], ...argv.slice(4)], { from: 'node' });
  return program.opts<AppendUserOptions>();
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

/**
 * Run a conversation-domain command when argv selects one.
 * Returns false for the normal completion command path.
 */
export const tryRunConversationCommand = async (
  argv: string[],
  cwd: string
): Promise<boolean> => {
  if (!isAppendUserCommand(argv)) {
    return false;
  }

  try {
    const options = parseAppendUserOptions(argv);
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

  return true;
};
