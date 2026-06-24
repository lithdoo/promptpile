import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createWebTools } from '../dist/index.js'

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('failed to bind test server')
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

test('searxngSearchTool: returns parsed results', async () => {
  const server = await withServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    assert.equal(url.pathname, '/search')
    assert.equal(url.searchParams.get('format'), 'json')
    assert.equal(url.searchParams.get('q'), 'cursor')
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        results: [
          {
            title: 'Cursor docs',
            url: 'https://example.com/cursor',
            content: 'snippet',
            engine: 'duckduckgo',
          },
        ],
        suggestions: ['cursor ide'],
      }),
    )
  })

  const tools = createWebTools({
    searxngConfig: {
      baseUrl: server.url,
      searchPath: '/search',
    },
  })
  const out = await tools.searxngSearchTool.execute(
    { query: 'cursor', limit: 5 },
    {},
  )
  assert.equal(out.query, 'cursor')
  assert.equal(out.results.length, 1)
  assert.equal(out.results[0]?.title, 'Cursor docs')
  assert.equal(out.summaryApplied, false)
  await tools.dispose()
  await server.close()
})

test('createWebTools.setWebConfigFile loads both ai and searxng settings', async () => {
  const server = await withServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ results: [] }))
  })
  const fs = await import('node:fs/promises')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'webcfg-'))
  const file = path.join(dir, '.web.env')
  await fs.writeFile(
    file,
    [
      `SEARXNG_BASE_URL=${server.url}`,
      'SEARXNG_SEARCH_PATH=/search',
      'AI_MODEL=gpt-4o-mini',
      'AI_API_KEY=sk-test',
      'AI_API_BASE_URL=http://127.0.0.1:1/v1',
    ].join('\n'),
    'utf8',
  )

  const tools = createWebTools()
  await tools.setWebConfigFile(file)
  assert.equal(tools.isSearxngEnabled(), true)
  assert.equal(tools.isAiSummaryEnabled(), true)
  const out = await tools.searxngSearchTool.execute(
    { query: 'x', summaryPrompt: '总结' },
    {},
  )
  assert.equal(out.summaryApplied, false)
  assert.ok(out.summaryError)
  await tools.dispose()
  await fs.rm(dir, { recursive: true, force: true })
  await server.close()
})
