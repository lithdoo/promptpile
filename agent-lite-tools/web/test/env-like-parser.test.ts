import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAiEnvLike, parseWebEnvLike } from '../dist/index.js'

test('parseAiEnvLike parses expected keys with comments', () => {
  const parsed = parseAiEnvLike(`
# comment
AI_MODEL=gpt-4o-mini
AI_API_KEY="sk-123"
AI_API_BASE_URL=https://api.example.com/v1
OTHER=ignored
`)
  assert.equal(parsed.model, 'gpt-4o-mini')
  assert.equal(parsed.apiKey, 'sk-123')
  assert.equal(parsed.apiBaseUrl, 'https://api.example.com/v1')
})

test('parseWebEnvLike parses searxng and ai keys', () => {
  const parsed = parseWebEnvLike(`
SEARXNG_BASE_URL=http://127.0.0.1:8080
SEARXNG_DEFAULT_ENGINES=bing,duckduckgo
SEARXNG_DEFAULT_SAFE_SEARCH=1
AI_MODEL=gpt-4o
`)
  assert.equal(parsed.searxng.baseUrl, 'http://127.0.0.1:8080')
  assert.deepEqual(parsed.searxng.defaultEngines, ['bing', 'duckduckgo'])
  assert.equal(parsed.searxng.defaultSafeSearch, 1)
  assert.equal(parsed.ai.model, 'gpt-4o')
})
