import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { parseWebEnvLike, type ParsedSearxngEnv } from '../libs/env-like-parser'

export type SearxngConfig = {
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

export type SearxngConfigSources = {
  manual: SearxngConfig
  file: SearxngConfig
  merged: SearxngConfig
  searxngConfigFile?: string
}

export type SearxngConfigController = {
  setSearxngConfig(config: SearxngConfig): void
  getSearxngConfig(): SearxngConfig
  setSearxngConfigFile(filePath?: string): Promise<void>
  getSearxngConfigSources(): SearxngConfigSources
  isSearxngEnabled(): boolean
  dispose(): Promise<void>
}

function cleanString(value: string | undefined): string | undefined {
  const v = value?.trim()
  return v ? v : undefined
}

function cleanNumber(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  return Number.isFinite(value) ? value : undefined
}

function cleanList(value: string[] | undefined): string[] | undefined {
  if (!value) return undefined
  const out = value.map(v => v.trim()).filter(Boolean)
  return out.length > 0 ? out : undefined
}

function normalizeConfig(config: ParsedSearxngEnv): SearxngConfig {
  return {
    baseUrl: cleanString(config.baseUrl),
    searchPath: cleanString(config.searchPath),
    timeoutMs: cleanNumber(config.timeoutMs),
    defaultLimit: cleanNumber(config.defaultLimit),
    maxLimit: cleanNumber(config.maxLimit),
    defaultLanguage: cleanString(config.defaultLanguage),
    defaultSafeSearch: config.defaultSafeSearch,
    defaultCategories: cleanList(config.defaultCategories),
    defaultEngines: cleanList(config.defaultEngines),
  }
}

function mergeConfig(file: SearxngConfig, manual: SearxngConfig): SearxngConfig {
  return {
    baseUrl: manual.baseUrl ?? file.baseUrl,
    searchPath: manual.searchPath ?? file.searchPath,
    timeoutMs: manual.timeoutMs ?? file.timeoutMs,
    defaultLimit: manual.defaultLimit ?? file.defaultLimit,
    maxLimit: manual.maxLimit ?? file.maxLimit,
    defaultLanguage: manual.defaultLanguage ?? file.defaultLanguage,
    defaultSafeSearch: manual.defaultSafeSearch ?? file.defaultSafeSearch,
    defaultCategories: manual.defaultCategories ?? file.defaultCategories,
    defaultEngines: manual.defaultEngines ?? file.defaultEngines,
  }
}

export function createSearxngConfigController(
  initial: SearxngConfig = {},
): SearxngConfigController {
  let manual = normalizeConfig(initial)
  let file: SearxngConfig = {}
  let merged = mergeConfig(file, manual)
  let searxngConfigFile: string | undefined
  let watcher: FSWatcher | undefined

  const recompute = () => {
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
      file = normalizeConfig(parseWebEnvLike(content).searxng)
      recompute()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
      if (searxngConfigFile !== filePath) return
      await loadConfigFile(filePath)
    }
    watcher.on('add', refresh)
    watcher.on('change', refresh)
    watcher.on('unlink', () => {
      if (searxngConfigFile !== filePath) return
      file = {}
      recompute()
    })
  }

  return {
    setSearxngConfig(config: SearxngConfig) {
      manual = normalizeConfig(config)
      recompute()
    },
    getSearxngConfig() {
      return { ...merged }
    },
    async setSearxngConfigFile(filePath?: string) {
      if (!filePath) {
        searxngConfigFile = undefined
        file = {}
        recompute()
        await closeWatcher()
        return
      }
      searxngConfigFile = path.resolve(filePath)
      await loadConfigFile(searxngConfigFile)
      await setupWatcher(searxngConfigFile)
    },
    getSearxngConfigSources() {
      return {
        manual: { ...manual },
        file: { ...file },
        merged: { ...merged },
        ...(searxngConfigFile ? { searxngConfigFile } : {}),
      }
    },
    isSearxngEnabled() {
      return Boolean(merged.baseUrl)
    },
    async dispose() {
      await closeWatcher()
    },
  }
}
