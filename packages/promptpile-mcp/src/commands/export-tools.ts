import fs from 'fs';
import path from 'path';
import type { OpenAiToolEntry } from '../http/types';
import { normalizeGatewayBaseUrl } from '../export/url';
import { openAiToolsToFlat } from '../export/map-tools';
import { writeToolsToml } from '../export/write-tools-toml';

export type ExportToolsCliOptions = {
  baseUrl: string;
  output: string;
  /** 可选；请求网关时在 Authorization 中发送 Bearer token */
  token?: string;
};

const FETCH_TIMEOUT_MS = 60_000;
const BODY_SNIPPET_MAX = 500;

function truncateBody(text: string): string {
  if (text.length <= BODY_SNIPPET_MAX) return text;
  return `${text.slice(0, BODY_SNIPPET_MAX)}...`;
}

/**
 * GET 网关 `/v1/tools/export`，将嵌套 OpenAI tools 转为扁平 `.tools.toml`。
 */
export async function runExportTools(
  opts: ExportToolsCliOptions
): Promise<number> {
  try {
    const base = normalizeGatewayBaseUrl(opts.baseUrl);
    const exportUrl = `${base}/v1/tools/export`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts.token !== undefined && opts.token !== '') {
      headers.Authorization = `Bearer ${opts.token}`;
    }

    const res = await fetch(exportUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error(
        `promptpile-mcp: export-tools HTTP ${res.status}: ${truncateBody(text)}`
      );
      return 1;
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      console.error('promptpile-mcp: export-tools 响应不是合法 JSON');
      return 1;
    }

    if (!data || typeof data !== 'object' || !('tools' in data)) {
      console.error('promptpile-mcp: export-tools 响应缺少 tools 字段');
      return 1;
    }

    const toolsRaw = (data as { tools: unknown }).tools;
    if (!Array.isArray(toolsRaw)) {
      console.error('promptpile-mcp: export-tools 响应中 tools 须为数组');
      return 1;
    }

    const flatTools = openAiToolsToFlat(toolsRaw as OpenAiToolEntry[]);

    const warnings = (data as { warnings?: unknown }).warnings;
    if (warnings !== undefined) {
      if (!Array.isArray(warnings)) {
        console.error('promptpile-mcp: export-tools 响应中 warnings 须为数组');
        return 1;
      }
      for (let i = 0; i < warnings.length; i++) {
        const w = warnings[i];
        if (typeof w === 'string') {
          console.error(`promptpile-mcp: warning: ${w}`);
        }
      }
    }

    const outputAbs = path.resolve(opts.output);
    fs.mkdirSync(path.dirname(outputAbs), { recursive: true });
    writeToolsToml(outputAbs, flatTools);

    console.log(`promptpile-mcp: 已写入 ${outputAbs}`);
    return 0;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`promptpile-mcp: export-tools 失败: ${msg}`);
    return 1;
  }
}
