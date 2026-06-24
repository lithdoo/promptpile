import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { executeToolCall } from './execute-tool-call'

type ToolCall = {
  id: string
  type?: string
  function: {
    name: string
    arguments: string
  }
}

type IdxFiles = {
  call?: string
  result?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

const isToolCall = (value: unknown): value is ToolCall => {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  const fn = value.function
  if (!isRecord(fn)) return false
  if (typeof fn.name !== 'string' || fn.name.length === 0) return false
  if (typeof fn.arguments !== 'string') return false
  return true
}

const parseCallFile = (absPath: string): ToolCall[] => {
  const raw = stripBom(readFileSync(absPath, 'utf8')).trim()
  if (!raw) return []

  // Try as a single JSON value first (covers root-object or root-array forms).
  try {
    const value = JSON.parse(raw) as unknown
    if (Array.isArray(value)) {
      return value.filter((v): v is ToolCall => {
        if (isToolCall(v)) return true
        console.warn(`[skip] ${absPath}: invalid tool call entry`)
        return false
      })
    }
    if (isRecord(value) && Array.isArray(value.tool_calls)) {
      return value.tool_calls.filter((v): v is ToolCall => {
        if (isToolCall(v)) return true
        console.warn(`[skip] ${absPath}: invalid tool call entry inside tool_calls`)
        return false
      })
    }
    // Fall through: maybe it's a single-line JSONL object that isn't tool_calls wrapper.
    if (isToolCall(value)) {
      return [value]
    }
  } catch {
    // Not a single JSON value; treat as JSONL below.
  }

  const lines = raw.split(/\r?\n/)
  const calls: ToolCall[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      console.warn(`[skip] ${absPath}: line ${i + 1} not valid JSON`)
      continue
    }
    if (isToolCall(parsed)) {
      calls.push(parsed)
    } else {
      console.warn(`[skip] ${absPath}: line ${i + 1} is not a valid tool call`)
    }
  }
  return calls
}

const collectFilesByIdx = (messagesDir: string): Map<number, IdxFiles> => {
  const pattern = /^\[(\d+)\]assistant\.(call|result)\.jsonl$/
  const map = new Map<number, IdxFiles>()
  for (const entry of readdirSync(messagesDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue
    const m = entry.name.match(pattern)
    if (!m) continue
    const idx = Number(m[1])
    const kind = m[2] as 'call' | 'result'
    const absPath = join(messagesDir, entry.name)
    const slot = map.get(idx) ?? {}
    slot[kind] = absPath
    map.set(idx, slot)
  }
  return map
}

const formatResultLine = (call: ToolCall, content: string): string =>
  JSON.stringify({
    tool_call_id: call.id,
    name: call.function.name,
    content,
  })

const debugToolResults = (): boolean => {
  const v = process.env.PROMPTPILE_DEBUG?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

const main = async (): Promise<number> => {
  const thisFileDir = dirname(fileURLToPath(import.meta.url))
  const messagesDir = resolve(thisFileDir, '..', 'messages')
  if (!existsSync(messagesDir)) {
    console.error(`[error] messages dir not found: ${messagesDir}`)
    return 1
  }

  if (debugToolResults()) {
    console.error(`[promptpile-tool-test] generate-tool-results messagesDir=${messagesDir}`)
  }

  const filesByIdx = collectFilesByIdx(messagesDir)
  const targets = [...filesByIdx.entries()]
    .filter(([, files]) => files.call && !files.result)
    .sort(([a], [b]) => a - b)

  if (debugToolResults()) {
    console.error(
      `[promptpile-tool-test] generate-tool-results pending_idxs=${targets.map(([i]) => i).join(',') || '(none)'}`,
    )
  }

  let processedFiles = 0
  let skipped = 0
  let executeErrors = 0
  let totalCalls = 0

  for (const [, files] of filesByIdx) {
    if (files.call && files.result) skipped += 1
  }

  for (const [idx, files] of targets) {
    const callPath = files.call as string
    const resultPath = join(messagesDir, `[${idx}]assistant.result.jsonl`)
    const calls = parseCallFile(callPath)
    if (debugToolResults()) {
      console.error(
        `[promptpile-tool-test] idx=${idx} parsed_calls=${calls.length} ${callPath} -> ${resultPath}`,
      )
    }
    if (calls.length === 0) {
      console.warn(`[warn] ${callPath}: no valid tool calls; skipping write`)
      continue
    }

    const lines: string[] = []
    for (const call of calls) {
      let content: string
      try {
        content = await executeToolCall({
          name: call.function.name,
          arguments: call.function.arguments,
          toolCallId: call.id,
        })
      } catch (err) {
        executeErrors += 1
        const message = err instanceof Error ? err.message : String(err)
        content = `[execute error] ${message}`
      }
      lines.push(formatResultLine(call, content))
      totalCalls += 1
    }

    writeFileSync(resultPath, lines.join('\n') + '\n', 'utf8')
    processedFiles += 1
    console.log(`[ok] wrote ${lines.length} results: ${resultPath}`)
  }

  console.log(
    `[summary] processed_files=${processedFiles} skipped_existing=${skipped} total_calls=${totalCalls} execute_errors=${executeErrors}`,
  )

  return executeErrors > 0 ? 1 : 0
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
