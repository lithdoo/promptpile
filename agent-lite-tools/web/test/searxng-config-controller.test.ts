import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSearxngConfigController } from '../dist/index.js'

test('searxng config controller: file and manual merge', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'searxng-config-'))
  const envFile = join(dir, '.web.env')
  await writeFile(
    envFile,
    [
      'SEARXNG_BASE_URL=http://127.0.0.1:8080',
      'SEARXNG_DEFAULT_LANGUAGE=zh',
      'SEARXNG_DEFAULT_ENGINES=bing,duckduckgo',
    ].join('\n'),
    'utf8',
  )

  const controller = createSearxngConfigController({
    defaultLanguage: 'en',
  })
  await controller.setSearxngConfigFile(envFile)
  const cfg = controller.getSearxngConfig()
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:8080')
  assert.equal(cfg.defaultLanguage, 'en')
  assert.deepEqual(cfg.defaultEngines, ['bing', 'duckduckgo'])
  assert.equal(controller.isSearxngEnabled(), true)
  await controller.dispose()
  await rm(dir, { recursive: true, force: true })
})
