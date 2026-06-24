import axios from 'axios'
import type {
  SearxngSearchResult,
  SearxngSearchResultItem,
} from '../agent-tools/types'
import type { SearxngConfig } from '../factory/searxng-config-controller'

export type SearchSearxngInput = {
  query: string
  page?: number
  limit?: number
  categories?: string[]
  engines?: string[]
  language?: string
  safeSearch?: 0 | 1 | 2
  timeRange?: 'day' | 'month' | 'year'
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function normalizeList(value: string[] | undefined): string[] | undefined {
  if (!value) return undefined
  const out = value.map(v => v.trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

function normalizeUrl(baseUrl: string, searchPath: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const path = searchPath.startsWith('/') ? searchPath : `/${searchPath}`
  return `${base}${path}`
}

/**
 * When the caller and `SearXNG_DEFAULT_ENGINES` both omit engines, SearXNG would
 * otherwise use the instance default (often a single engine). Prefer broader,
 * higher-quality backends first (must be enabled in the instance `settings.yml`).
 * Override via `.env` or per-call `engines`.
 */
const DEFAULT_ENGINES_FALLBACK = [
  'google',
  'bing',
  'brave',
  'duckduckgo',
] as const

function mapResults(raw: unknown[]): SearxngSearchResultItem[] {
  const out: SearxngSearchResultItem[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const title = typeof r.title === 'string' ? r.title : ''
    const url = typeof r.url === 'string' ? r.url : ''
    if (!title || !url) continue
    out.push({
      title,
      url,
      content: typeof r.content === 'string' ? r.content : undefined,
      engine: typeof r.engine === 'string' ? r.engine : undefined,
      score: typeof r.score === 'number' ? r.score : undefined,
      publishedDate:
        typeof r.publishedDate === 'string'
          ? r.publishedDate
          : typeof r.publishedDate === 'number'
            ? String(r.publishedDate)
            : undefined,
    })
  }
  return out
}

export async function searchSearxng(
  input: SearchSearxngInput,
  config: SearxngConfig,
  signal?: AbortSignal,
): Promise<SearxngSearchResult> {
  if (!config.baseUrl) {
    throw new Error('SearXNG is not configured: missing baseUrl')
  }
  const searchPath = config.searchPath ?? '/search'
  const endpoint = normalizeUrl(config.baseUrl, searchPath)
  const page = clampInt(input.page ?? 1, 1, 50)
  const maxLimit = clampInt(config.maxLimit ?? 20, 1, 100)
  const limit = clampInt(input.limit ?? config.defaultLimit ?? 10, 1, maxLimit)
  const categories = normalizeList(input.categories ?? config.defaultCategories)
  let engines = normalizeList(input.engines ?? config.defaultEngines)
  if (!engines?.length) {
    engines = [...DEFAULT_ENGINES_FALLBACK]
  }
  const safeSearch = input.safeSearch ?? config.defaultSafeSearch
  const language = input.language ?? config.defaultLanguage
  const timeoutMs = config.timeoutMs ?? 10_000

  const response = await axios.get(endpoint, {
    signal,
    timeout: timeoutMs,
    params: {
      q: input.query,
      format: 'json',
      pageno: page,
      language,
      safesearch: safeSearch,
      categories: categories?.join(','),
      engines: engines?.join(','),
      time_range: input.timeRange,
    },
    validateStatus: () => true,
  })

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`SearXNG request failed: ${response.status} ${response.statusText}`)
  }

  const data = response.data as Record<string, unknown>
  const rawResults = Array.isArray(data.results) ? data.results : []
  const suggestions = Array.isArray(data.suggestions)
    ? data.suggestions.filter(s => typeof s === 'string') as string[]
    : undefined
  const answers = Array.isArray(data.answers)
    ? data.answers.filter(a => typeof a === 'string') as string[]
    : undefined

  return {
    query: input.query,
    page,
    limit,
    used: {
      baseUrl: config.baseUrl,
      searchPath,
      categories,
      engines,
      language,
      safeSearch,
      timeRange: input.timeRange,
    },
    results: mapResults(rawResults),
    suggestions,
    answers,
    summaryApplied: false,
  }
}
