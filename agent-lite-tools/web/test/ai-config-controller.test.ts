import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createAiConfigController } from '../dist/index.js'

test('ai config controller: manual and file config merge', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ai-config-'))
  const envFile = join(dir, '.ai.env')
  await writeFile(
    envFile,
    'AI_MODEL=file-model\nAI_API_KEY=file-key\nAI_API_BASE_URL=https://file/v1\n',
    'utf8',
  )

  const controller = createAiConfigController({
    model: 'manual-model',
  })
  await controller.setAiConfigFile(envFile)
  const merged = controller.getAiConfig()
  assert.equal(merged.model, 'manual-model')
  assert.equal(merged.apiKey, 'file-key')
  assert.equal(merged.apiBaseUrl, 'https://file/v1')
  assert.equal(controller.isAiSummaryEnabled(), true)
  await controller.dispose()
  await rm(dir, { recursive: true, force: true })
})
