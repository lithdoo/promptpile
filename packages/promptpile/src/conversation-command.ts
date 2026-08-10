import fs from 'fs';
import path from 'path';
import { Command, InvalidArgumentError, Option } from 'commander';
import { appendUserMessage, appendUserMessageAtIndex, scanDirectory } from './file-handler';
import {
  formatConversationInspectionJson,
  formatConversationInspectionText,
  inspectConversation,
  type ConversationInspectFormat
} from './conversation-inspect';
import {
  fingerprintConversationDirectory,
  formatConversationFingerprintJson,
  formatConversationFingerprintText,
  type ConversationFingerprintFormat
} from './conversation-fingerprint';
import { parseConversationFingerprintTokenV1 } from './conversation-fingerprint';
import { parseExpectedConversationIndex } from './conversation-index';
import {
  commitConversationMutation,
  hasConversationMutationPrecondition,
  preflightConversationMutation,
  type ConversationMutationPrecondition
} from './conversation-mutation-guard';
import {
  CONVERSATION_CONFLICT_EXIT_CODE,
  formatConversationConflict,
  isConversationConflictError
} from './conversation-conflict';

export interface AppendUserOptions {
  directory: string;
  quiet?: boolean;
  expectFingerprint?: string;
  expectedNextIndex?: number;
}

export interface InspectConversationOptions {
  directory: string;
  format: ConversationInspectFormat;
}

export interface FingerprintConversationOptions {
  directory: string;
  format: ConversationFingerprintFormat;
}

export const registerConversationCommand = (
  program: Command,
  handlers?: {
    appendUser?: (options: AppendUserOptions) => void | Promise<void>;
    inspectConversation?: (options: InspectConversationOptions) => void | Promise<void>;
    fingerprintConversation?: (
      options: FingerprintConversationOptions
    ) => void | Promise<void>;
  }
): void => {
  const conversation = program
    .command('conversation')
    .description('Manage conversation message artifacts');
  const appendUser = conversation
    .command('append-user')
    .description('Append one user message without invoking an LLM')
    .requiredOption('-d, --directory <path>', 'Existing message directory')
    .option(
      '--expect-fingerprint <token>',
      'Require the current Conversation Fingerprint v1 token',
      parseConversationFingerprintTokenV1
    )
    .option(
      '--expected-next-index <idx>',
      'Require the next user mutation index',
      parseExpectedConversationIndex
    )
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

  const fingerprint = conversation
    .command('fingerprint')
    .description('Hash the exact raw-byte state of recognized Conversation artifacts')
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

  if (handlers?.fingerprintConversation !== undefined) {
    fingerprint.action(handlers.fingerprintConversation);
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
    const precondition: ConversationMutationPrecondition = {
      expectedFingerprint: options.expectFingerprint,
      expectedNextIndex: options.expectedNextIndex
    };
    if (hasConversationMutationPrecondition(precondition)) {
      await preflightConversationMutation(directory, 'append_user', precondition);
    }
    const content = await readStdinUtf8();
    if (content.trim() === '') {
      throw new Error('user message is empty; nothing was written');
    }

    const writtenPath = hasConversationMutationPrecondition(precondition)
      ? (await commitConversationMutation({
          directory,
          mutationKind: 'append_user',
          precondition,
          mutate: state => appendUserMessageAtIndex(directory, state.nextIndex, content)
        })).value
      : appendUserMessage(directory, scanDirectory(directory), content);
    if (!options.quiet) {
      process.stdout.write(`${writtenPath}\n`);
    }
  } catch (error) {
    if (isConversationConflictError(error)) {
      console.error(formatConversationConflict(error));
      process.exitCode = CONVERSATION_CONFLICT_EXIT_CODE;
    } else {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
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

/** Fingerprint one physical Conversation directory without loading completion runtime state. */
export const runFingerprintConversationCommand = async (
  options: FingerprintConversationOptions,
  cwd: string
): Promise<void> => {
  try {
    const directory = requireExistingDirectory(cwd, options.directory);
    const result = await fingerprintConversationDirectory(directory);
    const output = options.format === 'json'
      ? formatConversationFingerprintJson(result)
      : formatConversationFingerprintText(result);
    process.stdout.write(output);
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
};
