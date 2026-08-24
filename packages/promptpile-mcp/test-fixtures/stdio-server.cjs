const readline = require('node:readline');
const fs = require('node:fs');

let counter = 0;
function send(message) { process.stdout.write(JSON.stringify(message) + '\n'); }
function result(id, value) { send({ jsonrpc: '2.0', id, result: value }); }

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.method === 'initialize') {
    result(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'promptpile-mcp-fixture', version: '1.0.0' },
    });
  } else if (request.method === 'tools/list') {
    result(request.id, { tools: [
      { name: 'echo', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      { name: 'counter', inputSchema: { type: 'object' } },
      { name: 'slow', inputSchema: { type: 'object', properties: { delay_ms: { type: 'number' } } } },
    ] });
  } else if (request.method === 'tools/call') {
    const name = request.params.name;
    const args = request.params.arguments || {};
    if (process.env.PROMPTPILE_MCP_FIXTURE_CALL_LOG) {
      fs.appendFileSync(process.env.PROMPTPILE_MCP_FIXTURE_CALL_LOG, name + '\n');
    }
    if (name === 'slow') await new Promise((resolve) => setTimeout(resolve, args.delay_ms || 100));
    if (name === 'counter') counter++;
    const text = name === 'echo' ? String(args.text || '') : name === 'counter' ? String(counter) : 'slow';
    result(request.id, { content: [{ type: 'text', text }] });
  } else if (request.id !== undefined) {
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'not found' } });
  }
});
