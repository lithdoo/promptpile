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

const POWERSHELL_DESCRIPTION = `Run a **PowerShell** command in a **subprocess** (\`-NoProfile -NonInteractive -Command\`) and return stdout/stderr.

- **Windows only** in this package: on other platforms, \`execute\` throws (use \`bashTool\` or a host-specific runner instead).
- **Synchronous**: waits until exit, **timeout**, or \`options.signal\` aborts.
- **Working directory**: \`options.cwd\` per call only; **no** session cwd persistence here.
- **Not included**: sandbox, background tasks, notifications, UI/analytics.
- Prefer **@agent-tool-lite/file** for file read/write/search when applicable; use PowerShell for git/npm/docker/cmdlets as needed.
- **Optional** \`description\` is for host logging only.

**Edition note**: both PowerShell 7 (\`pwsh\`) and Windows PowerShell 5.1 may be chosen from PATH; script compatibility is the caller’s responsibility.`

type PowerShellToolInput = {
  command?: unknown
  timeout?: unknown
  description?: unknown
}

const POWERSHELL_INPUT_SCHEMA: JsonObjectSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    command: {
      type: 'string',
      description: 'PowerShell script or expression (-Command).',
    },
    timeout: {
      type: 'number',
      description:
        'Optional timeout in milliseconds (same clamp as Bash / Claude bash tool).',
    },
    description: {
      type: 'string',
      description: 'Optional short summary for host logs. Max 2000 characters.',
    },
  },
  required: ['command'],
}

export const powershellTool: AgentToolDefinition<
  PowerShellToolInput,
  ShellRunResult,
  ShellToolExecuteContext
> = {
  name: 'PowerShell',
  description: POWERSHELL_DESCRIPTION,
  inputSchema: POWERSHELL_INPUT_SCHEMA,
  async execute(
    args: PowerShellToolInput,
    context: ShellToolExecuteContext,
  ): Promise<ShellRunResult> {
    if (process.platform !== 'win32') {
      throw new Error(
        'powershellTool is only supported on Windows in @agent-tool-lite/shell',
      )
    }
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
      kind: 'powershell',
      command,
      cwd,
      timeoutMs,
      signal: context.signal,
    })
  },
}
