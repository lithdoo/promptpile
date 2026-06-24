import type {
  AgentToolDefinition,
  JsonObjectSchema,
  ToolExecuteContext,
} from '@agent-tool-lite/base'

export type { AgentToolDefinition, JsonObjectSchema, ToolExecuteContext }

export type WebToolExecuteContext = ToolExecuteContext

export type WebFetchToolInput = {
  url?: unknown
  prompt?: unknown
}

export type WebFetchToolResult = {
  url: string
  code: number
  codeText: string
  bytes: number
  contentType: string
  content: string
  truncated: boolean
  redirected?: {
    originalUrl: string
    redirectUrl: string
    statusCode: number
  }
  persistedPath?: string
  persistedSize?: number
  persistedMimeType?: string
  summary?: string
  summaryModel?: string
  summaryApplied: boolean
  summaryError?: string
}

export type WebFetchToolConfig = {
  timeoutMs?: number
  maxContentBytes?: number
  maxMarkdownChars?: number
}

export type SearxngSearchInput = {
  query?: unknown
  page?: unknown
  limit?: unknown
  categories?: unknown
  engines?: unknown
  language?: unknown
  safeSearch?: unknown
  timeRange?: unknown
  summaryPrompt?: unknown
}

export type SearxngSearchResultItem = {
  title: string
  url: string
  content?: string
  engine?: string
  score?: number
  publishedDate?: string
}

export type SearxngSearchResult = {
  query: string
  page: number
  limit: number
  used: {
    baseUrl: string
    searchPath: string
    categories?: string[]
    engines?: string[]
    language?: string
    safeSearch?: 0 | 1 | 2
    timeRange?: 'day' | 'month' | 'year'
  }
  results: SearxngSearchResultItem[]
  suggestions?: string[]
  answers?: string[]
  summaryApplied: boolean
  summary?: string
  summaryModel?: string
  summaryError?: string
}
