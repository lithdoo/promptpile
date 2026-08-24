import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { McpFileConfig } from '../mcp-config';
import { createMcpGatewayBackend } from './mcp-backend';

const fixturePath = path.resolve(__dirname, '../../../test-fixtures/stdio-server.cjs');

function config(options: {
  allowedTools?: string[];
  flatNames?: boolean;
  retrySafeTools?: string[];
  env?: Record<string, string>;
} = {}): McpFileConfig {
  return {
    version: 1,
    gateway: {},
    defaults: { init_timeout_ms: 5_000, list_timeout_ms: 5_000 },
    behavior: { failure_policy: 'strict', flat_names: options.flatNames ?? false },
    execution: {
      concurrency: 1,
      call_timeout_ms: 5_000,
      failure_policy: 'continue',
      retry_max_attempts: 1,
      retry_base_delay_ms: 0,
      retry_safe_tools: options.retrySafeTools ?? [],
    },
    servers: {
      fixture: {
        command: process.execPath,
        args: [fixturePath],
        allowed_tools: options.allowedTools,
        env: options.env,
      },
    },
  };
}

function call(name: string, args: Record<string, unknown> = {}) {
  return {
    id: 'call-1',
    type: 'function' as const,
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('MCP server allowed_tools', () => {
  it('preserves the current expose-all behavior when omitted', async () => {
    const backend = await createMcpGatewayBackend(config());
    try {
      const exported = await backend.exportTools();
      assert.deepEqual(
        exported.tools.map((tool) => tool.function.name),
        ['mcp__fixture__echo', 'mcp__fixture__counter', 'mcp__fixture__slow'],
      );
    } finally {
      await backend.dispose?.();
    }
  });

  it('exports and executes only exact allowlisted tools', async () => {
    const callLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promptpile-mcp-allowlist-'));
    const callLog = path.join(callLogDir, 'calls.log');
    const backend = await createMcpGatewayBackend(
      config({
        allowedTools: ['echo'],
        env: { PROMPTPILE_MCP_FIXTURE_CALL_LOG: callLog },
      }),
    );
    try {
      const exported = await backend.exportTools();
      assert.deepEqual(exported.tools.map((tool) => tool.function.name), ['mcp__fixture__echo']);

      const allowed = await backend.execCalls([call('mcp__fixture__echo', { text: 'ok' })]);
      assert.equal(allowed.results[0].ok, true);
      assert.equal(allowed.results[0].content, 'ok');

      const denied = await backend.execCalls([call('mcp__fixture__counter')]);
      assert.equal(denied.results[0].ok, false);
      assert.equal(denied.results[0].error, 'tool_not_allowed');
      assert.equal(fs.readFileSync(callLog, 'utf8'), 'echo\n');
    } finally {
      await backend.dispose?.();
      fs.rmSync(callLogDir, { recursive: true, force: true });
    }
  });

  it('blocks prefixed fallback from bypassing a flat-name allowlist', async () => {
    const backend = await createMcpGatewayBackend(
      config({ allowedTools: ['echo'], flatNames: true }),
    );
    try {
      const denied = await backend.execCalls([call('mcp__fixture__counter')]);
      assert.equal(denied.results[0].error, 'tool_not_allowed');
    } finally {
      await backend.dispose?.();
    }
  });

  it('fails closed when an allowlisted upstream tool is missing', async () => {
    await assert.rejects(
      createMcpGatewayBackend(config({ allowedTools: ['does_not_exist'] })),
      /did not list allowed_tools: does_not_exist/,
    );
  });

  it('rejects retry-safe tools that are not exported and allowed', async () => {
    await assert.rejects(
      createMcpGatewayBackend(
        config({ allowedTools: ['echo'], retrySafeTools: ['mcp__fixture__counter'] }),
      ),
      /retry_safe_tools are not exported/,
    );
  });

  it('preserves best-effort startup when a retry-safe tool belongs to a down server', async () => {
    const value = config({ retrySafeTools: ['mcp__offline__read'] });
    value.behavior.failure_policy = 'best-effort';
    value.servers.offline = {
      command: process.execPath,
      args: ['-e', 'process.exit(1)'],
      allowed_tools: ['read'],
    };

    const backend = await createMcpGatewayBackend(value);
    try {
      assert.deepEqual(await backend.health(), {
        ok: true,
        servers: { fixture: 'up', offline: 'down' },
      });
    } finally {
      await backend.dispose?.();
    }
  });
});
