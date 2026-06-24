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
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to start test server')
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

test('webFetchTool: input schema requires url and prompt', async () => {
  const tools = createWebTools()
  const schema = tools.webFetchTool.inputSchema as { required?: string[] }
  assert.deepEqual(schema.required, ['url', 'prompt'])
  await tools.dispose()
})

test('webFetchTool: fetches html and returns markdown-like content', async () => {
  const server = await withServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<h1>Hello</h1><p>World</p>')
  })

  const tools = createWebTools()
  const out = await tools.webFetchTool.execute(
    { url: `${server.url}/page`, prompt: '总结' },
    {},
  )
  assert.equal(out.code, 200)
  assert.equal(out.summaryApplied, false)
  assert.match(out.content, /Hello/)
  assert.match(out.content, /World/)
  await tools.dispose()
  await server.close()
})

test('webFetchTool: binary content persisted to tmp path', async () => {
  const server = await withServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/pdf')
    res.end(Buffer.from('%PDF-sample-binary', 'utf8'))
  })
  const tools = createWebTools()
  const out = await tools.webFetchTool.execute(
    { url: `${server.url}/binary`, prompt: '提取要点' },
    {},
  )
  assert.equal(out.code, 200)
  assert.ok(out.persistedPath)
  assert.equal(out.summaryApplied, false)
  await tools.dispose()
  await server.close()
})

test('webFetchTool: summary enabled but failure degrades gracefully', async () => {
  const server = await withServer((_req, res) => {
    res.statusCode = 200
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end('plain text body')
  })
  const tools = createWebTools({
    aiConfig: {
      model: 'gpt-4o-mini',
      apiKey: 'sk-test',
      apiBaseUrl: 'http://127.0.0.1:1/v1',
    },
  })
  const out = await tools.webFetchTool.execute(
    { url: `${server.url}/text`, prompt: '一句话总结' },
    {},
  )
  assert.equal(out.summaryApplied, false)
  assert.ok(out.summaryError)
  assert.match(out.content, /plain text body/)
  await tools.dispose()
  await server.close()
})
