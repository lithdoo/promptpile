import type { GatewayFileConfig } from './gateway-config';
import { loadConfigDocument, parseGatewayTable } from './gateway-config';

const DEFAULT_INIT_MS = 30_000;
const DEFAULT_LIST_MS = 30_000;
const DEFAULT_EXEC_CONCURRENCY = 4;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

export type FailurePolicy = 'strict' | 'best-effort';
export type ExecFailurePolicy = 'continue' | 'fail_fast';

export type McpServerTransport = 'stdio';

export type McpServerEntry = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  init_timeout_ms?: number;
  list_timeout_ms?: number;
  /** 缺省与 `"stdio"` 等价；非 stdio 在解析阶段拒绝。 */
  transport?: McpServerTransport;
};

export type McpDefaults = {
  init_timeout_ms: number;
  list_timeout_ms: number;
};

export type McpBehavior = {
  failure_policy: FailurePolicy;
  flat_names: boolean;
};

export type McpExecution = {
  concurrency: number;
  call_timeout_ms: number;
  failure_policy: ExecFailurePolicy;
  retry_max_attempts: number;
  retry_base_delay_ms: number;
  /** Exact gateway tool names that may be retried after transient failures. */
  retry_safe_tools: string[];
};

/** Full config file shape: gateway + MCP servers and behavior. */
export type McpFileConfig = {
  /** 顶层 `version`，缺省为 1；非 1 时告警。 */
  version: number;
  gateway: GatewayFileConfig;
  defaults: McpDefaults;
  behavior: McpBehavior;
  execution: McpExecution;
  servers: Record<string, McpServerEntry>;
};

function parseVersion(raw: unknown): number {
  if (raw === undefined) return 1;
  if (raw !== 1) throw new Error('promptpile-mcp: version 须为整数 1');
  return 1;
}

function table(raw: unknown, context: string): Record<string, unknown> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`promptpile-mcp: ${context} 须为表`);
  return raw as Record<string, unknown>;
}
function knownKeys(value: Record<string, unknown>, allowed: string[], context: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`promptpile-mcp: ${context} 未知字段: ${key}`);
}

function parseDefaults(raw: unknown): McpDefaults {
  const d = table(raw, '[defaults]');
  if (!d) {
    return { init_timeout_ms: DEFAULT_INIT_MS, list_timeout_ms: DEFAULT_LIST_MS };
  }
  knownKeys(d, ['init_timeout_ms', 'list_timeout_ms'], '[defaults]');
  const init = positiveInteger(d.init_timeout_ms, DEFAULT_INIT_MS, 'defaults.init_timeout_ms');
  const list = positiveInteger(d.list_timeout_ms, DEFAULT_LIST_MS, 'defaults.list_timeout_ms');
  return { init_timeout_ms: init, list_timeout_ms: list };
}

function parseBehavior(raw: unknown): McpBehavior {
  const b = table(raw, '[behavior]');
  if (!b) {
    return { failure_policy: 'best-effort', flat_names: false };
  }
  knownKeys(b, ['failure_policy', 'flat_names'], '[behavior]');
  const fp = b.failure_policy;
  let failure_policy: FailurePolicy;
  if (fp === undefined) {
    failure_policy = 'best-effort';
  } else if (fp === 'strict') {
    failure_policy = 'strict';
  } else if (fp === 'best-effort') {
    failure_policy = 'best-effort';
  } else {
    throw new Error(
      `promptpile-mcp: behavior.failure_policy 须为 "strict" 或 "best-effort"，收到: ${JSON.stringify(fp)}`,
    );
  }
  if (b.flat_names !== undefined && typeof b.flat_names !== 'boolean') throw new Error('promptpile-mcp: behavior.flat_names 须为 boolean');
  return {
    failure_policy,
    flat_names: b.flat_names === true,
  };
}

function positiveInteger(
  value: unknown,
  fallback: number,
  context: string,
  minimum = 1
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < minimum
  ) {
    throw new Error(`promptpile-mcp: ${context} 须为 >= ${minimum} 的整数`);
  }
  return value;
}

function parseExecution(raw: unknown): McpExecution {
  const e = table(raw, '[execution]');
  if (!e) {
    return {
      concurrency: DEFAULT_EXEC_CONCURRENCY,
      call_timeout_ms: DEFAULT_CALL_TIMEOUT_MS,
      failure_policy: 'continue',
      retry_max_attempts: 1,
      retry_base_delay_ms: DEFAULT_RETRY_BASE_DELAY_MS,
      retry_safe_tools: [],
    };
  }
  knownKeys(e, ['concurrency','call_timeout_ms','failure_policy','retry_max_attempts','retry_base_delay_ms','retry_safe_tools'], '[execution]');
  const failure = e.failure_policy ?? 'continue';
  if (failure !== 'continue' && failure !== 'fail_fast') {
    throw new Error('promptpile-mcp: execution.failure_policy 须为 "continue" 或 "fail_fast"');
  }
  const safe = e.retry_safe_tools;
  if (
    safe !== undefined &&
    (!Array.isArray(safe) ||
      !safe.every((x) => typeof x === 'string' && x.trim() !== ''))
  ) {
    throw new Error('promptpile-mcp: execution.retry_safe_tools 须为非空字符串数组');
  }
  if (safe && new Set((safe as string[]).map((x) => x.trim())).size !== safe.length) throw new Error('promptpile-mcp: execution.retry_safe_tools 不得重复');
  return {
    concurrency: positiveInteger(e.concurrency, DEFAULT_EXEC_CONCURRENCY, 'execution.concurrency'),
    call_timeout_ms: positiveInteger(e.call_timeout_ms, DEFAULT_CALL_TIMEOUT_MS, 'execution.call_timeout_ms'),
    failure_policy: failure,
    retry_max_attempts: positiveInteger(e.retry_max_attempts, 1, 'execution.retry_max_attempts'),
    retry_base_delay_ms: positiveInteger(
      e.retry_base_delay_ms,
      DEFAULT_RETRY_BASE_DELAY_MS,
      'execution.retry_base_delay_ms',
      0
    ),
    retry_safe_tools: (safe as string[] | undefined)?.map((x) => x.trim()) ?? [],
  };
}

function parseEnvTable(raw: unknown, context: string): Record<string, string> | undefined {
  const env = table(raw, `${context}.env`);
  if (!env) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === 'string') {
      out[k] = v;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = String(v);
    } else if (typeof v === 'boolean') {
      out[k] = v ? 'true' : 'false';
    } else {
      throw new Error(`promptpile-mcp: ${context} env.${k} 须为 string、finite number 或 boolean`);
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** TOML `[servers.<id>]` key: no `__` (breaks `mcp__<id>__<tool>` parsing); ASCII letters, digits, `_`, `-`. */
const SERVER_ID_RE = /^[A-Za-z0-9_-]+$/;

export function validateServerId(serverId: string): void {
  if (serverId.length === 0) {
    throw new Error('promptpile-mcp: server id 不能为空');
  }
  if (serverId.includes('__')) {
    throw new Error(
      `promptpile-mcp: [servers.${serverId}] 表键不得包含 "__"（与网关工具名前缀协议冲突，见 DESIGN §7）`,
    );
  }
  if (!SERVER_ID_RE.test(serverId)) {
    throw new Error(
      `promptpile-mcp: [servers.${serverId}] 表键仅允许字母、数字、下划线与连字符 [A-Za-z0-9_-]`,
    );
  }
}

function parseTransport(serverId: string, raw: unknown): McpServerTransport | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (raw === 'stdio') return 'stdio';
  throw new Error(
    `promptpile-mcp: [servers.${serverId}] transport "${String(raw)}" 尚未支持（当前仅支持 stdio）`,
  );
}

function parseServerEntry(serverId: string, raw: unknown): McpServerEntry {
  const s = table(raw, `[servers.${serverId}]`);
  if (!s) {
    throw new Error(`promptpile-mcp: [servers.${serverId}] 须为表`);
  }
  knownKeys(s, ['command','args','env','cwd','init_timeout_ms','list_timeout_ms','transport'], `[servers.${serverId}]`);
  const command = s.command;
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error(`promptpile-mcp: [servers.${serverId}] 缺少非空 command`);
  }
  const args = s.args;
  if (args !== undefined) {
    if (!Array.isArray(args) || !args.every((x) => typeof x === 'string')) {
      throw new Error(`promptpile-mcp: [servers.${serverId}] args 须为字符串数组`);
    }
  }
  const cwd = s.cwd;
  if (cwd !== undefined && typeof cwd !== 'string') {
    throw new Error(`promptpile-mcp: [servers.${serverId}] cwd 须为字符串`);
  }
  let init_timeout_ms: number | undefined;
  let list_timeout_ms: number | undefined;
  if (s.init_timeout_ms !== undefined) {
    if (!Number.isInteger(s.init_timeout_ms) || (s.init_timeout_ms as number) <= 0) {
      throw new Error(`promptpile-mcp: [servers.${serverId}] init_timeout_ms 无效`);
    }
    init_timeout_ms = s.init_timeout_ms as number;
  }
  if (s.list_timeout_ms !== undefined) {
    if (!Number.isInteger(s.list_timeout_ms) || (s.list_timeout_ms as number) <= 0) {
      throw new Error(`promptpile-mcp: [servers.${serverId}] list_timeout_ms 无效`);
    }
    list_timeout_ms = s.list_timeout_ms as number;
  }
  const transport = parseTransport(serverId, s.transport);
  const entry: McpServerEntry = {
    command,
    args: args as string[] | undefined,
    env: parseEnvTable(s.env, `[servers.${serverId}]`),
    cwd: typeof cwd === 'string' ? cwd : undefined,
    init_timeout_ms,
    list_timeout_ms,
  };
  if (transport !== undefined) entry.transport = transport;
  return entry;
}

function parseServers(raw: unknown): Record<string, McpServerEntry> {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object') {
    throw new Error('promptpile-mcp: servers 须为表');
  }
  const out: Record<string, McpServerEntry> = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (id.startsWith('__')) continue;
    validateServerId(id);
    out[id] = parseServerEntry(id, entry);
  }
  return out;
}

/** Read `[gateway]`, `[defaults]`, `[behavior]`, `[servers.*]` from the same file as launch. */
export function readMcpConfig(configPath: string): McpFileConfig {
  const doc = loadConfigDocument(configPath);
  knownKeys(doc, ['version','gateway','defaults','behavior','execution','servers'], '顶层配置');
  return {
    version: parseVersion(doc.version),
    gateway: parseGatewayTable(doc.gateway),
    defaults: parseDefaults(doc.defaults),
    behavior: parseBehavior(doc.behavior),
    execution: parseExecution(doc.execution),
    servers: parseServers(doc.servers),
  };
}

/** True when at least one MCP server block is defined. */
export function hasMcpServers(config: McpFileConfig): boolean {
  return Object.keys(config.servers).length > 0;
}
