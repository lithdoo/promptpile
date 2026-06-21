/**
 * CLI 层校验（不含业务 I/O）；与 DESIGN.md §3 对齐。
 */

export function assertHttpUrl(raw: string): void {
  const t = raw.trim();
  if (!t) {
    throw new Error('promptpile-mcp: --base-url 不能为空');
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new Error('promptpile-mcp: --base-url 不是合法 URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('promptpile-mcp: base-url 仅支持 http: 或 https: 协议');
  }
}

/** `--port` 若传入则须为 1–65535 的整数（字符串形式）。 */
export function parsePortArg(raw: string): number {
  const trimmed = raw.trim();
  const n = Number.parseInt(trimmed, 10);
  if (Number.isNaN(n) || String(n) !== trimmed) {
    throw new Error('promptpile-mcp: --port 须为整数');
  }
  if (n < 1 || n > 65535) {
    throw new Error('promptpile-mcp: --port 须在 1–65535 范围内');
  }
  return n;
}
