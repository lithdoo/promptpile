import fs from 'fs';
import path from 'path';
import TOML from '@iarna/toml';

export type GatewayFileConfig = {
  port?: number;
  token?: string;
};

const MIN_PORT = 1;
const MAX_PORT = 65535;

/**
 * Parse `[gateway].port`: integers, numeric strings, finite floats (floored).
 * Throws with `ctx` if present but invalid.
 */
export function parseOptionalPort(port: unknown, ctx: string): number | undefined {
  if (port === undefined || port === null) return undefined;
  if (typeof port === 'number') {
    if (!Number.isFinite(port)) throw new Error(`${ctx}: port 无效（非有限数字）`);
    const n = Math.floor(port);
    if (n < MIN_PORT || n > MAX_PORT) {
      throw new Error(`${ctx}: port 须在 ${MIN_PORT}-${MAX_PORT} 之间`);
    }
    return n;
  }
  if (typeof port === 'string') {
    const t = port.trim();
    if (t === '') return undefined;
    if (!/^\d+$/.test(t)) throw new Error(`${ctx}: port 须为整数或数字字符串`);
    const n = parseInt(t, 10);
    if (n < MIN_PORT || n > MAX_PORT) {
      throw new Error(`${ctx}: port 须在 ${MIN_PORT}-${MAX_PORT} 之间`);
    }
    return n;
  }
  throw new Error(`${ctx}: port 类型无效（期望 number 或 string）`);
}

export function parseGatewayTable(gw: unknown): GatewayFileConfig {
  if (gw === undefined) {
    return {};
  }
  if (!gw || typeof gw !== 'object' || Array.isArray(gw)) throw new Error('promptpile-mcp: [gateway] 须为表');
  const g = gw as Record<string, unknown>;
  for (const key of Object.keys(g)) if (!['port', 'token'].includes(key)) throw new Error(`promptpile-mcp: [gateway] 未知字段: ${key}`);
  if (g.port !== undefined && (!Number.isInteger(g.port) || (g.port as number) < MIN_PORT || (g.port as number) > MAX_PORT)) {
    throw new Error(`promptpile-mcp: [gateway] port 须为 ${MIN_PORT}-${MAX_PORT} 的整数`);
  }
  let port: number | undefined;
  port = g.port as number | undefined;
  const token = g.token;
  if (token !== undefined && typeof token !== 'string') {
    throw new Error('promptpile-mcp: [gateway] token 须为字符串');
  }
  return {
    port,
    token: typeof token === 'string' ? token : undefined,
  };
}

/** Read and parse config file to a plain object (TOML or JSON). */
export function loadConfigDocument(configPath: string): Record<string, unknown> {
  const abs = path.resolve(configPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`promptpile-mcp: 配置文件不存在: ${abs}`);
  }
  const ext = path.extname(abs).toLowerCase();
  const raw = fs.readFileSync(abs, 'utf8');
  let parsed: unknown;
  if (ext === '.toml') parsed = TOML.parse(raw) as unknown;
  else if (ext === '.json') parsed = JSON.parse(raw) as unknown;
  else throw new Error(`promptpile-mcp: 暂不支持的配置扩展名 ${ext}（请使用 .toml 或 .json）`);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('promptpile-mcp: 顶层配置须为表/object');
  }
  return parsed as Record<string, unknown>;
}

/** 读取配置文件中的 `[gateway]`（TOML）或 `gateway`（JSON）段落。 */
export function readGatewaySection(configPath: string): GatewayFileConfig {
  const doc = loadConfigDocument(configPath);
  return parseGatewayTable(doc.gateway);
}
