import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  parsePrefixedGatewayToolName,
  resolveFlatToolName,
  routeExecToolName,
  toGatewayToolName,
} from './tool-name';

describe('toGatewayToolName / parsePrefixedGatewayToolName round-trip', () => {
  const cases: [string, string][] = [
    ['fs', 'read_file'],
    ['mySrv', 'tool_with_underscores'],
    ['a', 'x__y'],
  ];
  for (const [sid, tool] of cases) {
    it(`round-trip ${sid} / ${tool}`, () => {
      const openAi = toGatewayToolName(sid, tool, false);
      const parsed = parsePrefixedGatewayToolName(openAi);
      assert.ok(parsed);
      assert.equal(parsed!.serverId, sid);
      assert.equal(parsed!.mcpToolName, tool);
    });
  }

  it('flat_names returns bare MCP name', () => {
    assert.equal(toGatewayToolName('fs', 'read_file', true), 'read_file');
  });
});

describe('parsePrefixedGatewayToolName', () => {
  it('returns null without prefix', () => {
    assert.equal(parsePrefixedGatewayToolName('read_file'), null);
  });
  it('returns null without separator', () => {
    assert.equal(parsePrefixedGatewayToolName('mcp__only'), null);
  });
  it('returns null for empty server or tool segment', () => {
    assert.equal(parsePrefixedGatewayToolName('mcp____tool'), null);
  });
});

describe('resolveFlatToolName', () => {
  const idx = new Map<string, ReadonlySet<string>>([
    ['a', new Set(['t1'])],
    ['b', new Set(['t2'])],
    ['c', new Set(['dup'])],
    ['d', new Set(['dup'])],
  ]);

  it('single hit', () => {
    const r = resolveFlatToolName('t1', idx);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.serverId, 'a');
  });
  it('unknown', () => {
    const r = resolveFlatToolName('nope', idx);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'unknown_tool');
  });
  it('ambiguous', () => {
    const r = resolveFlatToolName('dup', idx);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.reason, 'ambiguous_tool');
  });
});

describe('routeExecToolName', () => {
  const flatIdx = new Map<string, ReadonlySet<string>>([
    ['fs', new Set(['read_file'])],
  ]);

  it('prefix mode parses mcp__', () => {
    const r = routeExecToolName('mcp__fs__read_file', {
      flatNames: false,
      flatIndex: flatIdx,
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.serverId, 'fs');
      assert.equal(r.mcpToolName, 'read_file');
    }
  });

  it('prefix mode invalid', () => {
    const r = routeExecToolName('read_file', { flatNames: false, flatIndex: flatIdx });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, 'invalid_tool_name');
  });

  it('flat mode resolves by MCP tool name', () => {
    const r = routeExecToolName('read_file', { flatNames: true, flatIndex: flatIdx });
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.serverId, 'fs');
  });

  it('flat mode falls back to prefixed when unknown_tool', () => {
    const r = routeExecToolName('mcp__fs__read_file', {
      flatNames: true,
      flatIndex: flatIdx,
      allowPrefixedUnderFlat: true,
    });
    assert.ok(r.ok);
    if (r.ok) {
      assert.equal(r.serverId, 'fs');
      assert.equal(r.mcpToolName, 'read_file');
    }
  });

  it('flat mode no fallback when disabled', () => {
    const r = routeExecToolName('mcp__fs__read_file', {
      flatNames: true,
      flatIndex: flatIdx,
      allowPrefixedUnderFlat: false,
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, 'unknown_tool');
  });

  it('ambiguous_tool does not try prefix', () => {
    const amb = new Map<string, ReadonlySet<string>>([
      ['a', new Set(['dup'])],
      ['b', new Set(['dup'])],
    ]);
    const r = routeExecToolName('dup', { flatNames: true, flatIndex: amb });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, 'ambiguous_tool');
  });
});
