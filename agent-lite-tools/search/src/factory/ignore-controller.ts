import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'

type IgnoreRule = {
  pattern: string
  sourceDir?: string
}

export type IgnoreSources = {
  manual: string[]
  file: string[]
  merged: string[]
  ignoreFile?: string
}

export type IgnoreController = {
  setIgnoreRules(rules: string[]): void
  setIgnoreFile(filePath?: string): Promise<void>
  getIgnoreRules(): string[]
  getIgnoreSources(): IgnoreSources
  getIgnoreGlobs(cwd: string): string[]
  dispose(): Promise<void>
}

function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, '/')
}

function parseLines(content: string): string[] {
  return content
    .split(/\r?\n/g)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

function toAbsoluteRule(rule: IgnoreRule): string {
  if (!rule.sourceDir || path.isAbsolute(rule.pattern)) {
    return rule.pattern
  }
  return path.resolve(rule.sourceDir, rule.pattern)
}

function dedupeRules(rules: IgnoreRule[]): IgnoreRule[] {
  const seen = new Set<string>()
  const out: IgnoreRule[] = []
  for (const r of rules) {
    const key = `${r.sourceDir ?? ''}::${r.pattern}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export function createIgnoreController(initialIgnoreRules: string[] = []): IgnoreController {
  let manualRules: IgnoreRule[] = dedupeRules(
    initialIgnoreRules.map(pattern => ({ pattern })),
  )
  let fileRules: IgnoreRule[] = []
  let mergedRules: IgnoreRule[] = dedupeRules([...manualRules, ...fileRules])
  let ignoreFilePath: string | undefined
  let watcher: FSWatcher | undefined

  const recompute = () => {
    mergedRules = dedupeRules([...manualRules, ...fileRules])
  }

  const closeWatcher = async () => {
    if (!watcher) return
    const w = watcher
    watcher = undefined
    await w.close()
  }

  const loadIgnoreFile = async (filePath: string) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8')
      const baseDir = path.dirname(filePath)
      fileRules = dedupeRules(
        parseLines(content).map(pattern => ({ pattern, sourceDir: baseDir })),
      )
      recompute()
    } catch (error) {
      const enoent = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      if (enoent) {
        fileRules = []
        recompute()
      }
      // keep last good rules for transient errors
    }
  }

  const setupWatcher = async (filePath: string) => {
    await closeWatcher()
    watcher = chokidar.watch(filePath, {
      ignoreInitial: true,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 150,
        pollInterval: 50,
      },
    })

    const refresh = async () => {
      if (ignoreFilePath !== filePath) return
      await loadIgnoreFile(filePath)
    }

    watcher.on('add', refresh)
    watcher.on('change', refresh)
    watcher.on('unlink', () => {
      if (ignoreFilePath !== filePath) return
      fileRules = []
      recompute()
    })
  }

  return {
    setIgnoreRules(rules: string[]) {
      manualRules = dedupeRules(rules.map(pattern => ({ pattern })))
      recompute()
    },
    async setIgnoreFile(filePath?: string) {
      if (!filePath) {
        ignoreFilePath = undefined
        fileRules = []
        recompute()
        await closeWatcher()
        return
      }
      ignoreFilePath = path.resolve(filePath)
      await loadIgnoreFile(ignoreFilePath)
      await setupWatcher(ignoreFilePath)
    },
    getIgnoreRules() {
      return mergedRules.map(toAbsoluteRule)
    },
    getIgnoreSources() {
      return {
        manual: manualRules.map(toAbsoluteRule),
        file: fileRules.map(toAbsoluteRule),
        merged: mergedRules.map(toAbsoluteRule),
        ...(ignoreFilePath ? { ignoreFile: ignoreFilePath } : {}),
      }
    },
    getIgnoreGlobs(cwd: string) {
      return mergedRules
        .map(rule => {
          const candidate = toAbsoluteRule(rule)
          if (path.isAbsolute(candidate)) {
            const rel = path.relative(cwd, candidate)
            return normalizeSlashes(rel || '.')
          }
          return candidate
        })
        .filter(Boolean)
    },
    async dispose() {
      await closeWatcher()
    },
  }
}
