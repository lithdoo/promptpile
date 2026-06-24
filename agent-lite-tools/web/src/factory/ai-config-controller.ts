import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { parseAiEnvLike, type ParsedAiEnv } from '../libs/env-like-parser'

export type AiSummaryConfig = {
  model?: string
  apiKey?: string
  apiBaseUrl?: string
}

export type AiConfigSources = {
  manual: AiSummaryConfig
  file: AiSummaryConfig
  merged: AiSummaryConfig
  aiConfigFile?: string
}

export type AiConfigController = {
  setAiConfig(config: AiSummaryConfig): void
  getAiConfig(): AiSummaryConfig
  setAiConfigFile(filePath?: string): Promise<void>
  getAiConfigSources(): AiConfigSources
  isAiSummaryEnabled(): boolean
  dispose(): Promise<void>
}

function cleanValue(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

function mergeConfig(a: AiSummaryConfig, b: AiSummaryConfig): AiSummaryConfig {
  return {
    model: cleanValue(b.model) ?? cleanValue(a.model),
    apiKey: cleanValue(b.apiKey) ?? cleanValue(a.apiKey),
    apiBaseUrl: cleanValue(b.apiBaseUrl) ?? cleanValue(a.apiBaseUrl),
  }
}

function normalizeConfig(parsed: ParsedAiEnv): AiSummaryConfig {
  return {
    model: cleanValue(parsed.model),
    apiKey: cleanValue(parsed.apiKey),
    apiBaseUrl: cleanValue(parsed.apiBaseUrl),
  }
}

export function createAiConfigController(initial: AiSummaryConfig = {}): AiConfigController {
  let manual: AiSummaryConfig = normalizeConfig(initial)
  let file: AiSummaryConfig = {}
  let merged: AiSummaryConfig = mergeConfig(file, manual)
  let aiConfigFile: string | undefined
  let watcher: FSWatcher | undefined

  const recompute = () => {
    // Manual overrides file values.
    merged = mergeConfig(file, manual)
  }

  const closeWatcher = async () => {
    if (!watcher) return
    const w = watcher
    watcher = undefined
    await w.close()
  }

  const loadConfigFile = async (filePath: string) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8')
      file = normalizeConfig(parseAiEnvLike(content))
      recompute()
    } catch (error) {
      const enoent = (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (enoent) {
        file = {}
        recompute()
      }
    }
  }

  const setupWatcher = async (filePath: string) => {
    await closeWatcher()
    watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 },
    })
    const refresh = async () => {
      if (aiConfigFile !== filePath) return
      await loadConfigFile(filePath)
    }
    watcher.on('add', refresh)
    watcher.on('change', refresh)
    watcher.on('unlink', () => {
      if (aiConfigFile !== filePath) return
      file = {}
      recompute()
    })
  }

  return {
    setAiConfig(config: AiSummaryConfig) {
      manual = normalizeConfig(config)
      recompute()
    },
    getAiConfig() {
      return { ...merged }
    },
    async setAiConfigFile(filePath?: string) {
      if (!filePath) {
        aiConfigFile = undefined
        file = {}
        recompute()
        await closeWatcher()
        return
      }
      aiConfigFile = path.resolve(filePath)
      await loadConfigFile(aiConfigFile)
      await setupWatcher(aiConfigFile)
    },
    getAiConfigSources() {
      return {
        manual: { ...manual },
        file: { ...file },
        merged: { ...merged },
        ...(aiConfigFile ? { aiConfigFile } : {}),
      }
    },
    isAiSummaryEnabled() {
      return Boolean(merged.model && merged.apiKey && merged.apiBaseUrl)
    },
    async dispose() {
      await closeWatcher()
    },
  }
}
