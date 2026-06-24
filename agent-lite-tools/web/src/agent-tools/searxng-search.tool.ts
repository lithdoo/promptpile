import { applySummaryByAi } from '../libs/apply-summary'
import { searchSearxng } from '../libs/search-searxng'
import type { AiConfigController } from '../factory/ai-config-controller'
import type { SearxngConfigController } from '../factory/searxng-config-controller'
import type {
  AgentToolDefinition,
  JsonObjectSchema,
  SearxngSearchInput,
  SearxngSearchResult,
  WebToolExecuteContext,
} from './types'

const SEARXNG_SEARCH_DESCRIPTION = `通过本地 SearXNG 实例执行搜索并返回结构化结果。

- 支持 categories / engines / language / safeSearch 等参数。
- 结果可选使用 AI 进行二次摘要（配置齐全时启用）。
- 摘要失败会降级，不影响搜索结果返回。`

const SEARXNG_SEARCH_INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', description: '搜索关键词' },
    page: { type: 'integer', description: '页码（从 1 开始）' },
    limit: { type: 'integer', description: '返回条数上限' },
    categories: {
      type: 'array',
      items: { type: 'string' },
      description: '分类列表',
    },
    engines: {
      type: 'array',
      items: { type: 'string' },
      description: '搜索引擎列表',
    },
    language: { type: 'string', description: '语言（例如 zh、en-US）' },
    safeSearch: { type: 'integer', description: '安全搜索等级 0/1/2' },
    timeRange: {
      type: 'string',
      enum: ['day', 'month', 'year'],
      description: '时间范围过滤',
    },
    summaryPrompt: {
      type: 'string',
      description: '可选摘要提示词；仅在 AI 配置完整时生效',
    },
  },
  required: ['query'],
}

function expectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Tool input must be a JSON object')
  }
  return value as Record<string, unknown>
}

function parseStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${field}: expected string[]`)
  }
  const out = value
    .map(v => {
      if (typeof v !== 'string') {
        throw new Error(`Invalid ${field}: expected string[]`)
      }
      return v.trim()
    })
    .filter(Boolean)
  return out.length ? out : undefined
}

function parseInput(input: SearxngSearchInput) {
  const o = expectRecord(input)
  const query = typeof o.query === 'string' ? o.query.trim() : ''
  if (!query) throw new Error('Missing or empty query')
  const safeSearch =
    o.safeSearch === 0 || o.safeSearch === 1 || o.safeSearch === 2
      ? (o.safeSearch as 0 | 1 | 2)
      : undefined
  const timeRange: 'day' | 'month' | 'year' | undefined =
    o.timeRange === 'day' || o.timeRange === 'month' || o.timeRange === 'year'
      ? o.timeRange
      : undefined
  return {
    query,
    page: typeof o.page === 'number' ? o.page : undefined,
    limit: typeof o.limit === 'number' ? o.limit : undefined,
    categories: parseStringArray(o.categories, 'categories'),
    engines: parseStringArray(o.engines, 'engines'),
    language: typeof o.language === 'string' ? o.language.trim() || undefined : undefined,
    safeSearch,
    timeRange,
    summaryPrompt:
      typeof o.summaryPrompt === 'string' ? o.summaryPrompt.trim() || undefined : undefined,
  }
}

function summarizeInputForModel(result: SearxngSearchResult): string {
  const top = result.results.slice(0, 10)
  return top
    .map(
      (r, i) =>
        `${i + 1}. ${r.title}\nURL: ${r.url}\nSnippet: ${r.content ?? ''}\nEngine: ${r.engine ?? ''}`,
    )
    .join('\n\n')
}

export function createSearxngSearchTool(
  searxngConfigController: SearxngConfigController,
  aiConfigController: AiConfigController,
): AgentToolDefinition<SearxngSearchInput, SearxngSearchResult, WebToolExecuteContext> {
  return {
    name: 'SearxngSearch',
    description: SEARXNG_SEARCH_DESCRIPTION,
    inputSchema: SEARXNG_SEARCH_INPUT_SCHEMA,
    async execute(input, context) {
      const parsed = parseInput(input)
      const cfg = searxngConfigController.getSearxngConfig()
      const base = await searchSearxng(parsed, cfg, context.signal)

      if (!parsed.summaryPrompt || !aiConfigController.isAiSummaryEnabled()) {
        return { ...base, summaryApplied: false }
      }

      try {
        const aiCfg = aiConfigController.getAiConfig()
        const summary = await applySummaryByAi(
          summarizeInputForModel(base),
          parsed.summaryPrompt,
          aiCfg,
          context.signal,
        )
        return {
          ...base,
          summaryApplied: true,
          summary,
          summaryModel: aiCfg.model,
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
