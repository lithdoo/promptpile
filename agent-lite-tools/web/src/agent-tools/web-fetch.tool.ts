import {
  fetchUrlContent,
  type FetchUrlContentResult,
} from '../libs/fetch-url-content'
import { persistBinaryToTmp } from '../libs/persist-binary'
import { applySummaryByAi } from '../libs/apply-summary'
import type {
  AgentToolDefinition,
  JsonObjectSchema,
  WebFetchToolConfig,
  WebFetchToolInput,
  WebFetchToolResult,
  WebToolExecuteContext,
} from './types'
import type { AiConfigController } from '../factory/ai-config-controller'

const WEB_FETCH_DESCRIPTION = `抓取指定 URL 的网页内容并返回可读文本结果。

- 支持 HTML 转 Markdown。
- 对二进制内容会写入系统临时目录并返回路径。
- 可选启用二次模型摘要（当 AI_MODEL/AI_API_KEY/AI_API_BASE_URL 配置齐全时）。`

const WEB_FETCH_INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: {
      type: 'string',
      description: '要抓取的 URL（必须是完整 URL）',
    },
    prompt: {
      type: 'string',
      description: '可选摘要提示词；当启用 AI 摘要链路时生效',
    },
  },
  required: ['url', 'prompt'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool input must be a JSON object')
  }
  return value as Record<string, unknown>
}

function parseInput(input: WebFetchToolInput): { url: string; prompt: string } {
  const o = expectRecord(input)
  const url = typeof o.url === 'string' ? o.url.trim() : ''
  const prompt = typeof o.prompt === 'string' ? o.prompt.trim() : ''
  if (!url) throw new Error('Missing or empty url')
  if (!prompt) throw new Error('Missing or empty prompt')
  return { url, prompt }
}

async function toResult(
  fetched: FetchUrlContentResult,
): Promise<Omit<WebFetchToolResult, 'summaryApplied'>> {
  if (fetched.redirected) {
    const msg = `REDIRECT DETECTED: URL redirected to another host.\nOriginal: ${fetched.redirected.originalUrl}\nRedirect: ${fetched.redirected.redirectUrl}\nPlease call WebFetch again with redirect URL.`
    return {
      url: fetched.url,
      code: fetched.code,
      codeText: fetched.codeText,
      bytes: Buffer.byteLength(msg),
      contentType: 'text/plain; charset=utf-8',
      content: msg,
      truncated: false,
      redirected: fetched.redirected,
    }
  }

  if (fetched.isBinary && fetched.rawBuffer) {
    const persisted = await persistBinaryToTmp(fetched.rawBuffer, fetched.contentType)
    const msg = `Binary content saved to temp file: ${persisted.persistedPath}`
    return {
      url: fetched.url,
      code: fetched.code,
      codeText: fetched.codeText,
      bytes: fetched.bytes,
      contentType: fetched.contentType,
      content: msg,
      truncated: false,
      persistedPath: persisted.persistedPath,
      persistedSize: persisted.persistedSize,
      persistedMimeType: persisted.persistedMimeType,
    }
  }

  return {
    url: fetched.url,
    code: fetched.code,
    codeText: fetched.codeText,
    bytes: fetched.bytes,
    contentType: fetched.contentType,
    content: fetched.content,
    truncated: fetched.truncated,
  }
}

export function createWebFetchTool(
  aiConfigController: AiConfigController,
  config: WebFetchToolConfig = {},
): AgentToolDefinition<WebFetchToolInput, WebFetchToolResult, WebToolExecuteContext> {
  return {
    name: 'WebFetch',
    description: WEB_FETCH_DESCRIPTION,
    inputSchema: WEB_FETCH_INPUT_SCHEMA,
    async execute(input, context): Promise<WebFetchToolResult> {
      const parsed = parseInput(input)
      const fetched = await fetchUrlContent(parsed.url, {
        signal: context.signal,
        timeoutMs: config.timeoutMs,
        maxContentBytes: config.maxContentBytes,
        maxMarkdownChars: config.maxMarkdownChars,
      })
      const base = await toResult(fetched)

      if (!aiConfigController.isAiSummaryEnabled()) {
        return {
          ...base,
          summaryApplied: false,
        }
      }

      try {
        const merged = aiConfigController.getAiConfig()
        const summary = await applySummaryByAi(
          base.content,
          parsed.prompt,
          merged,
          context.signal,
        )
        return {
          ...base,
          summary,
          summaryModel: merged.model,
          summaryApplied: true,
        }
      } catch (error) {
        return {
          ...base,
          summaryApplied: false,
          summaryError: (error as Error).message,
        }
      }
    },
  }
}
