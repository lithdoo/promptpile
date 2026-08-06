const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const [cliEntry, messages] = process.argv.slice(2);
if (!cliEntry || !messages) throw new Error('usage: package-mcp-smoke <cli-entry> <messages>');

const run = async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve(cliEntry), 'mcp', '-d', path.resolve(messages)],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'packed-archive-mcp-smoke', version: '1.0.0' });
  await client.connect(transport);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map(({ name }) => name);
    if (names.join(',') !== 'list_archives,search_archive,read_archived_turn') {
      throw new Error(`unexpected installed MCP tools: ${names.join(',')}`);
    }
    const archives = await client.callTool({
      name: 'list_archives',
      arguments: {},
    });
    const listBlock = archives.content && archives.content[0];
    if (!listBlock || listBlock.type !== 'text') {
      throw new Error('installed MCP list returned no text');
    }
    const listEnvelope = JSON.parse(listBlock.text);
    if (!listEnvelope.ok || listEnvelope.data[0]?.archivedTurnIndices[0] !== 1) {
      throw new Error('installed MCP list result is invalid');
    }
    const result = await client.callTool({
      name: 'search_archive',
      arguments: { query: 'smoke-needle' },
    });
    const block = result.content && result.content[0];
    if (!block || block.type !== 'text') throw new Error('installed MCP returned no text');
    const envelope = JSON.parse(block.text);
    if (!envelope.ok || envelope.data.results[0]?.turnIdx !== 1) {
      throw new Error('installed MCP search result is invalid');
    }
  } finally {
    await client.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
