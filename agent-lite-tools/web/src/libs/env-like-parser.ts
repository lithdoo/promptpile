export type ParsedAiEnv = {
  model?: string
  apiKey?: string
  apiBaseUrl?: string
}

export type ParsedSearxngEnv = {
  baseUrl?: string
  searchPath?: string
  timeoutMs?: number
  defaultLimit?: number
  maxLimit?: number
  defaultLanguage?: string
  defaultSafeSearch?: 0 | 1 | 2
  defaultCategories?: string[]
  defaultEngines?: string[]
}

export type ParsedWebEnv = {
  ai: ParsedAiEnv
  searxng: ParsedSearxngEnv
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function toNumber(value: string): number | undefined {
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function toSafeSearch(value: string): 0 | 1 | 2 | undefined {
  if (value === '0' || value === '1' || value === '2') {
    return Number(value) as 0 | 1 | 2
  }
  return undefined
}

function toCsv(value: string): string[] {
  return value
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
}

export function parseWebEnvLike(content: string): ParsedWebEnv {
  const out: ParsedWebEnv = {
    ai: {},
    searxng: {},
  }
  const lines = content.split(/\r?\n/g)
  for (const raw of lines) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const idx = line.indexOf('=')
    if (idx <= 0) continue
    const key = line.slice(0, idx).trim()
    const value = unquote(line.slice(idx + 1).trim())
    if (key === 'AI_MODEL') out.ai.model = value
    if (key === 'AI_API_KEY') out.ai.apiKey = value
    if (key === 'AI_API_BASE_URL') out.ai.apiBaseUrl = value

    if (key === 'SEARXNG_BASE_URL') out.searxng.baseUrl = value
    if (key === 'SEARXNG_SEARCH_PATH') out.searxng.searchPath = value
    if (key === 'SEARXNG_TIMEOUT_MS') out.searxng.timeoutMs = toNumber(value)
    if (key === 'SEARXNG_DEFAULT_LIMIT') out.searxng.defaultLimit = toNumber(value)
    if (key === 'SEARXNG_MAX_LIMIT') out.searxng.maxLimit = toNumber(value)
    if (key === 'SEARXNG_DEFAULT_LANGUAGE') out.searxng.defaultLanguage = value
    if (key === 'SEARXNG_DEFAULT_SAFE_SEARCH') {
      out.searxng.defaultSafeSearch = toSafeSearch(value)
    }
    if (key === 'SEARXNG_DEFAULT_CATEGORIES') out.searxng.defaultCategories = toCsv(value)
    if (key === 'SEARXNG_DEFAULT_ENGINES') out.searxng.defaultEngines = toCsv(value)
  }
  return out
}

export function parseAiEnvLike(content: string): ParsedAiEnv {
  return parseWebEnvLike(content).ai
}
