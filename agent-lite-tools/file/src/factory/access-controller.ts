import fs from 'node:fs'
import path from 'node:path'
import chokidar, { type FSWatcher } from 'chokidar'
import { expandPathForWrite } from '../libs/path-resolve'

export const ROOT_ACCESS_DENIED_ERROR = 'Access denied: file path is outside configured roots'

export type AccessController = {
  setRoots(roots: string[]): void
  getRoots(): string[]
  setRootsFile(filePath?: string): Promise<void>
  getRootsSources(): {
    manual: string[]
    file: string[]
    merged: string[]
    rootsFile?: string
  }
  dispose(): Promise<void>
  resolveAndAuthorize(filePath: string, cwd?: string): string
}

function normalizeForCompare(p: string): string {
  const normalized = path.normalize(p)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function toRealPathIfExists(p: string): string {
  try {
    return fs.realpathSync.native?.(p) ?? fs.realpathSync(p)
  } catch {
    return p
  }
}

function toRealPathForPotentiallyMissingPath(fullPath: string): string {
  const normalized = path.normalize(fullPath)
  let current = normalized
  const tail: string[] = []

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) {
      break
    }
    tail.unshift(path.basename(current))
    current = parent
  }

  const realExisting = toRealPathIfExists(current)
  return path.normalize(path.join(realExisting, ...tail))
}

function normalizeRoot(root: string): string {
  const expanded = expandPathForWrite(root)
  if (!expanded) {
    throw new Error('Root path cannot be empty')
  }
  return normalizeForCompare(toRealPathIfExists(expanded))
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  if (targetPath === rootPath) return true
  const withSep = rootPath.endsWith(path.sep) ? rootPath : rootPath + path.sep
  return targetPath.startsWith(withSep)
}

export function createAccessController(initialRoots: string[] = []): AccessController {
  let manualRoots = [...new Set(initialRoots.map(normalizeRoot))]
  let fileRoots: string[] = []
  let mergedRoots = [...manualRoots]
  let rootsFilePath: string | undefined
  let watcher: FSWatcher | undefined

  const recomputeMergedRoots = () => {
    mergedRoots = [...new Set([...manualRoots, ...fileRoots])]
  }

  const closeWatcher = async () => {
    if (!watcher) return
    const toClose = watcher
    watcher = undefined
    await toClose.close()
  }

  const parseRootsFileLines = (filePath: string, content: string): string[] => {
    const fileDir = path.dirname(filePath)
    const resolved = content
      .split(/\r?\n/g)
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .map(line => {
        const candidate = path.isAbsolute(line)
          ? line
          : path.resolve(fileDir, line)
        return normalizeRoot(candidate)
      })
    return [...new Set(resolved)]
  }

  const loadRootsFromFile = async (filePath: string) => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf8')
      fileRoots = parseRootsFileLines(filePath, content)
      recomputeMergedRoots()
    } catch (error) {
      const enoent = (error as NodeJS.ErrnoException)?.code === 'ENOENT'
      if (enoent) {
        fileRoots = []
        recomputeMergedRoots()
        return
      }
      // Keep the last known good file roots on transient read failures.
    }
  }

  const setupRootsFileWatcher = async (filePath: string) => {
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
      if (!rootsFilePath || rootsFilePath !== filePath) {
        return
      }
      await loadRootsFromFile(filePath)
    }
    watcher.on('add', refresh)
    watcher.on('change', refresh)
    watcher.on('unlink', async () => {
      if (!rootsFilePath || rootsFilePath !== filePath) {
        return
      }
      fileRoots = []
      recomputeMergedRoots()
    })
  }

  return {
    setRoots(nextRoots: string[]) {
      manualRoots = [...new Set(nextRoots.map(normalizeRoot))]
      recomputeMergedRoots()
    },
    getRoots() {
      return [...mergedRoots]
    },
    async setRootsFile(filePath?: string) {
      if (!filePath) {
        rootsFilePath = undefined
        fileRoots = []
        recomputeMergedRoots()
        await closeWatcher()
        return
      }

      const expanded = expandPathForWrite(filePath)
      if (!expanded) {
        throw new Error('Root file path cannot be empty')
      }
      rootsFilePath = path.normalize(expanded)

      await loadRootsFromFile(rootsFilePath)
      await setupRootsFileWatcher(rootsFilePath)
    },
    getRootsSources() {
      return {
        manual: [...manualRoots],
        file: [...fileRoots],
        merged: [...mergedRoots],
        ...(rootsFilePath ? { rootsFile: rootsFilePath } : {}),
      }
    },
    async dispose() {
      await closeWatcher()
    },
    resolveAndAuthorize(filePath: string, cwd?: string) {
      const expanded = expandPathForWrite(filePath, cwd)
      if (!expanded) {
        throw new Error('Empty file path after path expansion')
      }

      const normalizedTarget = normalizeForCompare(
        toRealPathForPotentiallyMissingPath(expanded),
      )

      if (mergedRoots.length === 0) {
        throw new Error(`${ROOT_ACCESS_DENIED_ERROR}: no roots configured`)
      }

      const allowed = mergedRoots.some(root => isWithinRoot(normalizedTarget, root))
      if (!allowed) {
        throw new Error(`${ROOT_ACCESS_DENIED_ERROR}: ${expanded}`)
      }
      return expanded
    },
  }
}
