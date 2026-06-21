#!/usr/bin/env node
/**
 * Smoke test: stdio MCP — connect, list tools, optional callTool, close.
 * Prefer explicit flags; env vars avoid shell quoting for simple cases.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Command } from 'commander';
import { StdioMcpSession } from '../src/mcp/stdio-session';

function parseArgsJson(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) {
    throw new Error('--args-json must be a JSON array of strings, e.g. ["-y","pkg"]');
  }
  const v = JSON.parse(trimmed) as unknown;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw new Error('--args-json must be a JSON array of strings');
  }
  return v as string[];
}

async function main(): Promise<number> {
  const program = new Command();
  program
    .name('mcp-smoke')
    .description('Connect to a stdio MCP server, list tools, optionally call one tool.')
    .option('--command <cmd>', 'Executable (required unless PROMPTPILE_MCP_SMOKE_COMMAND is set)')
    .option('--args <part>', 'Extra argv segment (repeatable)', collect, [] as string[])
    .option('--args-json <json>', 'JSON array of argv strings (alternative to repeated --args)')
    .option('--cwd <dir>', 'Working directory for the MCP server process')
    .option('--timeout-ms <n>', 'Timeout for connect and each RPC', (v) => parseInt(v, 10), 30_000)
    .option('--call <name>', 'If set, invoke tools/call with this name after listTools')
    .option('--call-args <json>', 'JSON object for callTool arguments (default {})', '{}')
    .option('--temp-dir <path>', 'When using default smoke with no --command: filesystem server root');

  program.parse(process.argv);
  const opts = program.opts<{
    command?: string;
    args: string[];
    argsJson?: string;
    cwd?: string;
    timeoutMs: number;
    call?: string;
    callArgs: string;
    tempDir?: string;
  }>();

  let command =
    opts.command ?? process.env.PROMPTPILE_MCP_SMOKE_COMMAND ?? process.env.PROMPTPILE_MCP_SMOKE_CMD;
  let args: string[] = [...opts.args];

  if (opts.argsJson) {
    args = parseArgsJson(opts.argsJson);
  } else if (process.env.PROMPTPILE_MCP_SMOKE_ARGS) {
    args = parseArgsJson(process.env.PROMPTPILE_MCP_SMOKE_ARGS);
  }

  /** Default: npx @modelcontextprotocol/server-filesystem <dir> — matches README smoke recipe. */
  if (!command) {
    const root =
      opts.tempDir ??
      process.env.PROMPTPILE_MCP_SMOKE_ROOT ??
      fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-smoke-'));
    command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    args = ['-y', '@modelcontextprotocol/server-filesystem', root];
    console.error(`mcp-smoke: using default server (no --command): ${command} ${args.join(' ')}`);
  }

  let callArgsObj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(opts.callArgs) as unknown;
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      callArgsObj = parsed as Record<string, unknown>;
    } else {
      throw new Error('not an object');
    }
  } catch {
    console.error('mcp-smoke: --call-args must be a JSON object, e.g. {}');
    return 1;
  }

  const session = new StdioMcpSession({
    command,
    args: args.length ? args : undefined,
    cwd: opts.cwd,
    timeoutMs: Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : 30_000,
  });

  try {
    await session.connect();
    const listed = await session.listTools();
    const tools = listed.tools ?? [];
    console.log(`tools: ${tools.length}`);
    for (const t of tools) {
      console.log(`  - ${t.name}`);
    }
    if (tools.length === 0) {
      console.error('mcp-smoke: expected at least one tool from listTools');
      return 1;
    }

    if (opts.call) {
      const result = await session.callTool(opts.call, callArgsObj);
      console.log('callTool result:', JSON.stringify(result, undefined, 2));
    }

    return 0;
  } catch (e) {
    console.error('mcp-smoke failed:', e);
    return 1;
  } finally {
    await session.close();
  }
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
