import axios from 'axios'
import TurndownService from 'turndown'

const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_MAX_MARKDOWN_CHARS = 100_000
const DEFAULT_MAX_REDIRECTS = 10
const DEFAULT_UA = 'agent-lite-webfetch/1.0'

const turndown = new TurndownService()

export type FetchRedirectInfo = {
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export type FetchUrlContentResult = {
  url: string
  code: number
  codeText: string
  bytes: number
  contentType: string
  content: string
  truncated: boolean
  isBinary: boolean
  rawBuffer?: Buffer
  redirected?: FetchRedirectInfo
}

export type FetchUrlContentOptions = {
  timeoutMs?: number
  maxContentBytes?: number
  maxMarkdownChars?: number
  signal?: AbortSignal
}

function stripWww(host: string): string {
  return host.replace(/^www\./i, '')
}

function isPermittedRedirect(originalUrl: string, redirectUrl: string): boolean {
  const a = new URL(originalUrl)
  const b = new URL(redirectUrl)
  if (a.protocol !== b.protocol) return false
  if (a.port !== b.port) return false
  if (b.username || b.password) return false
  return stripWww(a.hostname) === stripWww(b.hostname)
}

function isBinaryContentType(contentType: string): boolean {
  const normalized = contentType.split(';')[0].trim().toLowerCase()
  if (!normalized) return false
  if (normalized.startsWith('text/')) return false
  if (
    normalized === 'application/json' ||
    normalized === 'application/xml' ||
    normalized === 'application/javascript' ||
    normalized === 'application/xhtml+xml'
  ) {
    return false
  }
  return true
}

function validateUrl(url: string): URL {
  if (url.length > 2000) {
    throw new Error('Invalid URL: too long')
  }
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Invalid URL protocol: only http/https are supported')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Invalid URL: username/password are not allowed')
  }
  return parsed
}

function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false }
  return { content: content.slice(0, maxChars), truncated: true }
}

async function requestWithRedirectPolicy(
  url: string,
  opts: FetchUrlContentOptions,
  depth = 0,
): Promise<FetchUrlContentResult> {
  if (depth > DEFAULT_MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${DEFAULT_MAX_REDIRECTS})`)
  }
  try {
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxContentLength: opts.maxContentBytes ?? DEFAULT_MAX_BYTES,
      maxRedirects: 0,
      signal: opts.signal,
      headers: {
        Accept: 'text/markdown, text/html, */*',
        'User-Agent': DEFAULT_UA,
      },
      validateStatus: () => true,
    })

    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.location
      if (!location) throw new Error('Redirect missing Location header')
      const redirectUrl = new URL(location, url).toString()
      if (!isPermittedRedirect(url, redirectUrl)) {
        return {
          url,
          code: response.status,
          codeText: response.statusText,
          bytes: 0,
          contentType: '',
          content: '',
          truncated: false,
          isBinary: false,
          redirected: {
            originalUrl: url,
            redirectUrl,
            statusCode: response.status,
          },
        }
      }
      return requestWithRedirectPolicy(redirectUrl, opts, depth + 1)
    }

    const raw = Buffer.from(response.data)
    const contentType = String(response.headers['content-type'] ?? '')
    const binary = isBinaryContentType(contentType)
    if (binary) {
      return {
        url,
        code: response.status,
        codeText: response.statusText,
        bytes: raw.length,
        contentType,
        content: '',
        truncated: false,
        isBinary: true,
        rawBuffer: raw,
      }
    }

    const text = raw.toString('utf8')
    const markdown = contentType.includes('text/html') ? turndown.turndown(text) : text
    const truncated = truncateContent(markdown, opts.maxMarkdownChars ?? DEFAULT_MAX_MARKDOWN_CHARS)
    return {
      url,
      code: response.status,
      codeText: response.statusText,
      bytes: raw.length,
      contentType,
      content: truncated.content,
      truncated: truncated.truncated,
      isBinary: false,
    }
  } catch (error) {
    throw new Error(`Web fetch failed: ${(error as Error).message}`)
  }
}

export async function fetchUrlContent(
  url: string,
  options: FetchUrlContentOptions = {},
): Promise<FetchUrlContentResult> {
  const parsed = validateUrl(url)
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (parsed.protocol === 'http:' && !isLocalHost) {
    parsed.protocol = 'https:'
  }
  return requestWithRedirectPolicy(parsed.toString(), options)
}
