import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import {
  ArchiveDomainError,
  archiveJsonFailure,
  archiveJsonSuccess,
} from './contracts';
import { discoverArchives, readArchivedTurn, searchArchive } from './index';

const SERVER_INFO = {
  name: 'promptpile-archive',
  version: '0.1.0-beta.1',
} as const;

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const listInput = z.object({}).strict();

const searchInput = z
  .object({
    query: z.string().describe('Single-line literal text to search for'),
    limit: z.number().int().min(1).max(100).optional(),
    roles: z.array(z.string().min(1)).optional(),
    include_tool_results: z.boolean().optional(),
    case_sensitive: z.boolean().optional(),
  })
  .strict();

const readInput = z
  .object({
    turn_idx: z.number().int().nonnegative(),
    include_tool_results: z.boolean().optional(),
  })
  .strict();

const asToolSuccess = (data: unknown) => ({
  content: [
    {
      type: 'text' as const,
      text: JSON.stringify(archiveJsonSuccess(data)),
    },
  ],
});

const asToolFailure = (error: unknown) => {
  const domainError =
    error instanceof ArchiveDomainError
      ? error
      : new ArchiveDomainError('IO_ERROR', 'unexpected archive MCP failure', {
          cause: error,
        });
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(archiveJsonFailure(domainError)),
      },
    ],
  };
};

export const createArchiveMcpServer = (directory: string): McpServer => {
  const conversationDirectory = path.resolve(directory);
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    'list_archives',
    {
      title: 'List conversation archives',
      description:
        'List Archive Protocol archives and their archived turn indices in the configured Promptpile conversation directory.',
      inputSchema: listInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => {
      try {
        const archives = await discoverArchives(conversationDirectory);
        if (archives.length === 0) {
          throw new ArchiveDomainError(
            'NO_ARCHIVE',
            `no Archive Protocol archive found in: ${conversationDirectory}`
          );
        }
        return asToolSuccess(archives);
      } catch (error) {
        return asToolFailure(error);
      }
    }
  );

  server.registerTool(
    'search_archive',
    {
      title: 'Search archived conversation turns',
      description:
        'Search the configured Promptpile conversation archive for single-line literal text.',
      inputSchema: searchInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return asToolSuccess(
          await searchArchive(conversationDirectory, {
            query: input.query,
            limit: input.limit,
            roles: input.roles,
            includeToolResults: input.include_tool_results,
            caseSensitive: input.case_sensitive,
          })
        );
      } catch (error) {
        return asToolFailure(error);
      }
    }
  );

  server.registerTool(
    'read_archived_turn',
    {
      title: 'Read an archived conversation turn',
      description:
        'Read the authoritative artifacts for one turn from the configured Promptpile conversation archive.',
      inputSchema: readInput,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      try {
        return asToolSuccess(
          await readArchivedTurn(conversationDirectory, input.turn_idx, {
            includeToolResults: input.include_tool_results,
          })
        );
      } catch (error) {
        return asToolFailure(error);
      }
    }
  );

  return server;
};

const validateConversationDirectory = async (directory: string): Promise<void> => {
  try {
    const stat = await fs.stat(directory);
    if (!stat.isDirectory()) {
      throw new Error('path is not a directory');
    }
  } catch (error) {
    throw new ArchiveDomainError(
      'IO_ERROR',
      `conversation directory is unavailable: ${directory}`,
      { cause: error }
    );
  }
};

export const startArchiveMcpServer = async (
  directory: string,
  transport: Transport = new StdioServerTransport()
): Promise<McpServer> => {
  await validateConversationDirectory(directory);
  const server = createArchiveMcpServer(directory);
  await server.connect(transport);
  return server;
};
