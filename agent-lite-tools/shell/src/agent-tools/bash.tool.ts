import { clampTimeoutMs } from '../libs/timeouts'
import { runShell, type ShellRunResult } from '../libs/run-shell'
import {
  assertOnlyAllowedKeys,
  expectRecord,
  parseOptionalDescription,
  parseOptionalTimeout,
} from '../libs/parse-args'
import type {
  AgentToolDefinition,
  JsonObjectSchema,
  ShellToolExecuteContext,
} from './types'

const BASH_DESCRIPTION = `Run a **bash** (or resolved zsh) command in a **subprocess** and return stdout/stderr.

- **Synchronous**: waits until the process exits, the per-call **timeout** elapses, or \`options.signal\` aborts.
- **Working directory**: use \`options.cwd\` for each call. This package does **not** persist cwd across tool calls.
- **Not included**: sandbox, background execution, notifications, or UI/analytics hooks.
- Prefer **@agent-tool-lite/file** (or your host read/write tools) for reading, writing, and searching files instead of \`cat\`/\`sed\` when possible.
- **Timeouts** follow Claude defaults unless overridden by \`BASH_DEFAULT_TIMEOUT_MS\` / \`BASH_MAX_TIMEOUT_MS\` env vars (see README).
- **Optional** \`description\` is for host logging only; it does not change how the command runs.

**Windows**: bash is used if \`bash.exe\` is on PATH (e.g. Git for Windows) or common install paths; otherwise execution fails with a helpful error.`

type BashToolInput = {
  command?: unknown
  timeout?: unknown
  description?: unknown
}

const BASH_INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    command: {
      type: 'string',
      description: 'Shell command to run (passed to bash -lc).',
    },
    timeout: {
      type: 'number',
      description:
        'Optional timeout in milliseconds (clamped to max). Defaults from BASH_DEFAULT_TIMEOUT_MS or 2 minutes.',
    },
    description: {
      type: 'string',
      description:
        'Optional short summary for host logs (not shown to the shell). Max 2000 characters.',
    },
  },
  required: ['command'],
}

export const bashTool: AgentToolDefinition<
  BashToolInput,
  ShellRunResult,
  ShellToolExecuteContext
> = {
  name: 'Bash',
  description: BASH_DESCRIPTION,
  inputSchema: BASH_INPUT_SCHEMA,
  async execute(
    args: BashToolInput,
    context: ShellToolExecuteContext,
  ): Promise<ShellRunResult> {
    const o = expectRecord(args)
    assertOnlyAllowedKeys(o)
    const command = typeof o.command === 'string' ? o.command : ''
    if (!command.trim()) {
      throw new Error('Missing or empty command')
    }
    const timeoutMs = clampTimeoutMs(parseOptionalTimeout(o.timeout))
    parseOptionalDescription(o.description)
    const cwd = context.cwd ?? process.cwd()
    return runShell({
      kind: 'bash',
      command,
      cwd,
      timeoutMs,
      signal: context.signal,
    })
  },
}
