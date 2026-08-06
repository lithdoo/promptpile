import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  createArchiveMcpServer,
  startArchiveMcpServer,
} from './mcp';

const temporaryDirectories: string[] = [];

const tempDirectory = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ppcg-mcp-boundary-'));
  temporaryDirectories.push(root);
  return root;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Archive MCP boundaries', () => {
  it('validates the configured directory before connecting a transport', async () => {
    const root = tempDirectory();
    const file = path.join(root, 'file');
    const missing = path.join(root, 'missing');
    fs.writeFileSync(file, 'x');
    const [, transport] = InMemoryTransport.createLinkedPair();

    await assert.rejects(
      startArchiveMcpServer(file, transport),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'ArchiveDomainError' &&
        /conversation directory is unavailable/.test(error.message)
    );
    await assert.rejects(
      startArchiveMcpServer(missing, transport),
      /conversation directory is unavailable/
    );
  });

  it('returns stable tool failures for an empty archive directory', async () => {
    const root = tempDirectory();
    const server = createArchiveMcpServer(root);
    const client = new Client({ name: 'boundary-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const result = await client.callTool({
        name: 'list_archives',
        arguments: {},
      });
      assert.equal(result.isError, true);
      assert.ok(result.content && Array.isArray(result.content));
      const block = result.content[0] as { type?: string; text?: string };
      assert.equal(block.type, 'text');
      if (block.type !== 'text' || typeof block.text !== 'string') {
        throw new Error('expected text result');
      }
      const envelope = JSON.parse(block.text) as {
        ok: boolean;
        error: { code: string };
      };
      assert.equal(envelope.ok, false);
      assert.equal(envelope.error.code, 'NO_ARCHIVE');
    } finally {
      await client.close();
    }
  });

  it('rejects invalid tool inputs through the published schemas', async () => {
    const root = tempDirectory();
    const server = createArchiveMcpServer(root);
    const client = new Client({ name: 'schema-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const invalidCalls = [
        { name: 'list_archives', arguments: { directory: root } },
        { name: 'search_archive', arguments: { query: 'q', limit: 0 } },
        { name: 'search_archive', arguments: { query: 'q', limit: 101 } },
        { name: 'search_archive', arguments: { query: 'q', roles: [''] } },
        { name: 'read_archived_turn', arguments: { turn_idx: -1 } },
        { name: 'read_archived_turn', arguments: { turn_idx: 1.5 } },
      ];
      for (const call of invalidCalls) {
        const result = await client.callTool(call);
        assert.equal(result.isError, true, JSON.stringify(call));
      }
    } finally {
      await client.close();
    }
  });
});
