import fs from 'fs';
import path from 'path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { appendUserMessage, scanDirectory } from './file-handler';
import {
  formatConversationInspectionJson,
  formatConversationInspectionText,
  inspectConversation,
  type ConversationInspectFormat
} from './conversation-inspect';

export interface AppendUserOptions {
  directory: string;
  quiet?: boolean;
}

export interface InspectConversationOptions {
  directory: string;
  format: ConversationInspectFormat;
}

export const registerConversationCommand = (
  program: Command,
  handlers?: {
    appendUser?: (options: AppendUserOptions) => void | Promise<void>;
    inspectConversation?: (options: InspectConversationOptions) => void | Promise<void>;
  }
): void => {
  const conversation = program
    .command('conversation')
    .description('Manage conversation message artifacts');
  const appendUser = conversation
    .command('append-user')
    .description('Append one user message without invoking an LLM')
    .requiredOption('-d, --directory <path>', 'Existing message directory')
    .option('-q, --quiet', 'Suppress successful stdout output');

  if (handlers?.appendUser !== undefined) {
    appendUser.action(handlers.appendUser);
  }

  const singleDirectory = (value: string, previous: string | undefined): string => {
    if (previous !== undefined) {
      throw new InvalidArgumentError('--directory may only be specified once');
    }
    if (value.trim() === '') {
      throw new InvalidArgumentError('--directory must not be empty');
    }
    return value;
  };
  const inspect = conversation
    .command('inspect')
    .description('List recognized artifacts without reading their contents')
    .requiredOption(
      '-d, --directory <path>',
      'Existing Conversation directory',
      singleDirectory
    )
    .addOption(
      new Option('--format <format>', 'Output format')
        .choices(['text', 'json'])
        .default('text')
    );

  if (handlers?.inspectConversation !== undefined) {
    inspect.action(handlers.inspectConversation);
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

/** List recognized artifacts without loading completion config or reading their contents. */
export const runInspectConversationCommand = (
  options: InspectConversationOptions,
  cwd: string
): void => {
  try {
    const directory = requireExistingDirectory(cwd, options.directory);
    const inspection = inspectConversation(directory, options.directory);
    const output = options.format === 'json'
      ? formatConversationInspectionJson(inspection)
      : formatConversationInspectionText(inspection);
    process.stdout.write(output);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};
