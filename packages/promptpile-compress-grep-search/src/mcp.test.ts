import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createArchiveMcpServer } from './mcp';

const temporaryDirectories: string[] = [];

const writeArchive = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-mcp-'));
  temporaryDirectories.push(root);
  const archive = path.join(root, '[3]system.md.archive');
  fs.mkdirSync(archive);
  fs.writeFileSync(
    path.join(archive, 'compression.json'),
    JSON.stringify({ version: 1, archivedTurnIndices: [2, 3] })
  );
  fs.writeFileSync(path.join(archive, '[2]user.md'), 'authentication bug report');
  fs.writeFileSync(path.join(archive, '[3]assistant.md'), 'authentication fix');
  fs.writeFileSync(
    path.join(archive, '[3]assistant.result.jsonl'),
    '{"result":"authentication tool output"}\n'
  );
  return root;
};

const snapshot = (root: string): string[] => {
  const walk = (directory: string, prefix = ''): string[] =>
    fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        const relative = path.join(prefix, entry.name);
        return entry.isDirectory()
          ? walk(absolute, relative)
          : [`${relative}:${fs.readFileSync(absolute).toString('base64')}`];
      });
  return walk(root);
};

const parseTextEnvelope = (result: unknown): unknown => {
  assert.ok(result && typeof result === 'object' && 'content' in result);
  const content = (result as { content: unknown[] }).content;
  const block = content[0] as { type?: string; text?: string } | undefined;
  assert.equal(block?.type, 'text');
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('missing MCP text result');
  }
  return JSON.parse(block.text);
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Archive MCP adapter', () => {
  it('lists only fixed-directory read-only tools and reuses domain semantics', async () => {
    const root = writeArchive();
    const before = snapshot(root);
    const server = createArchiveMcpServer(root);
    const client = new Client({ name: 'archive-mcp-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map(({ name }) => name),
        ['list_archives', 'search_archive', 'read_archived_turn']
      );
      for (const tool of listed.tools) {
        assert.equal(tool.annotations?.readOnlyHint, true);
        assert.equal(tool.annotations?.destructiveHint, false);
        const properties = tool.inputSchema.properties as Record<string, unknown>;
        assert.equal(Object.hasOwn(properties, 'directory'), false);
      }

      const listedArchives = await client.callTool({
        name: 'list_archives',
        arguments: {},
      });
      const listEnvelope = parseTextEnvelope(listedArchives) as {
        ok: boolean;
        data: Array<{ idx: number; archivedTurnIndices: number[] }>;
      };
      assert.equal(listEnvelope.ok, true);
      assert.deepEqual(
        listEnvelope.data.map(({ idx, archivedTurnIndices }) => ({
          idx,
          archivedTurnIndices,
        })),
        [{ idx: 3, archivedTurnIndices: [2, 3] }]
      );

      const searched = await client.callTool({
        name: 'search_archive',
        arguments: { query: 'authentication', limit: 1 },
      });
      assert.equal(searched.isError, undefined);
      const searchEnvelope = parseTextEnvelope(searched) as {
        ok: boolean;
        data: { results: Array<{ turnIdx: number; matches: Array<{ fileKind: string }> }> };
      };
      assert.equal(searchEnvelope.ok, true);
      assert.deepEqual(searchEnvelope.data.results.map(({ turnIdx }) => turnIdx), [3]);
      assert.equal(
        searchEnvelope.data.results[0].matches.some(({ fileKind }) => fileKind === 'result'),
        false
      );

      const read = await client.callTool({
        name: 'read_archived_turn',
        arguments: { turn_idx: 3 },
      });
      const readEnvelope = parseTextEnvelope(read) as {
        ok: boolean;
        data: { artifacts: Array<{ fileKind: string }> };
      };
      assert.equal(readEnvelope.ok, true);
      assert.equal(
        readEnvelope.data.artifacts.some(({ fileKind }) => fileKind === 'result'),
        true
      );

      const missing = await client.callTool({
        name: 'read_archived_turn',
        arguments: { turn_idx: 99 },
      });
      assert.equal(missing.isError, true);
      assert.deepEqual(parseTextEnvelope(missing), {
        ok: false,
        error: {
          code: 'TURN_NOT_FOUND',
          message: 'archived turn not found: 99',
        },
      });
      assert.deepEqual(snapshot(root), before);
    } finally {
      await client.close();
    }
  });

  it('serves the same tools through the installed CLI stdio entry', async () => {
    const root = writeArchive();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(__dirname, 'cli-entry.js'), 'mcp', '-d', root],
      stderr: 'pipe',
    });
    const client = new Client({ name: 'archive-mcp-stdio-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.deepEqual(
        listed.tools.map(({ name }) => name),
        ['list_archives', 'search_archive', 'read_archived_turn']
      );
      const result = await client.callTool({
        name: 'search_archive',
        arguments: { query: 'bug report' },
      });
      const envelope = parseTextEnvelope(result) as {
        ok: boolean;
        data: { results: Array<{ turnIdx: number }> };
      };
      assert.equal(envelope.ok, true);
      assert.deepEqual(envelope.data.results.map(({ turnIdx }) => turnIdx), [2]);
    } finally {
      await client.close();
    }
  });
});
