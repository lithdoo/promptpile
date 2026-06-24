# @agent-tool-lite/shell

面向 Agent 运行时的轻量 Shell 工具包，提供 `Bash` 与 `PowerShell` 两个工具，按 `@agent-tool-lite/base` 的 `AgentToolDefinition` 契约实现，适合在宿主系统中按需组合注册。

## 导出总览

本包对外分为三层能力：

- **总工厂**
  - `createShellTools(config?)`
- **单工具**
  - `bashTool`
  - `powershellTool`
- **类型与低层能力**
  - 类型：`AgentToolDefinition`、`ToolExecuteContext`、`ShellToolExecuteContext`、`JsonObjectSchema`
  - 执行：`runShell(...)`
  - 超时：`getDefaultBashTimeoutMs()`、`getMaxBashTimeoutMs()`、`clampTimeoutMs(...)`

完整导出请以 `src/index.ts` 为准。

## 快速开始（总工厂）

```ts
import { createShellTools } from '@agent-tool-lite/shell'

const tools = createShellTools()
const context = { cwd: process.cwd() }

const bashOut = await tools.bashTool.execute(
  { command: 'echo hello', timeout: 30_000 },
  context,
)

const psOut = await tools.powershellTool.execute(
  { command: 'Write-Output 42' },
  context,
)
```

`createShellTools()` 返回：

- `bashTool`
- `powershellTool`

## 单工具用法（按需装配）

当宿主只想注册其中一个工具时，可直接使用单工具导出：

```ts
import { bashTool } from '@agent-tool-lite/shell'

const out = await bashTool.execute(
  { command: 'node -v' },
  { cwd: process.cwd() },
)
```

## 输入参数（两种工具一致）

`inputSchema` 均为对象，字段如下：

| 字段 | 必填 | 说明 |
|---|---|---|
| `command` | 是 | 要执行的命令字符串（bash 使用 `-lc`，PowerShell 使用 `-Command`） |
| `timeout` | 否 | 超时毫秒数；内部会按最大值钳制 |
| `description` | 否 | 仅用于宿主日志，不参与执行逻辑（最大 2000 字符） |

## 执行上下文（ShellToolExecuteContext）

`tool.execute(input, context)` 支持：

- `cwd`：本次调用的工作目录（不在工具内部持久化）
- `signal`：中断信号（`AbortSignal`）

## 行为说明

- **同步执行模型**：调用后会等待到进程退出、超时或中断。
- **Bash**：执行 `bash -lc <command>`（解析为 zsh 时会按 zsh 路径执行）。
- **PowerShell**：Windows 下使用 `pwsh` 或 `powershell`，参数为 `-NoProfile -NonInteractive -Command`。
- **输出结构**：返回 `stdout`、`stderr`、`exitCode`、`interrupted`。
- **输出上限**：`stdout/stderr` 各自最多 512 KiB（UTF-8 字节数），超限会截断并在 `stderr` 附加提示。

## 边界与限制

- 不提供会话级 cwd 持久化；如需固定目录，请每次传入 `context.cwd`。
- 不包含沙箱、后台任务、通知、UI/分析埋点等宿主能力。
- `powershellTool` 在非 Windows 平台会直接抛错（设计如此）。
- 工具 `inputSchema` 不包含某些 Claude 专用扩展字段（如 `run_in_background` 等）；若上层模型仍传入此类字段，建议在宿主侧先过滤。

## 环境变量

- `BASH_DEFAULT_TIMEOUT_MS`：默认超时毫秒数（未显式传 `timeout` 时生效）。
- `BASH_MAX_TIMEOUT_MS`：最大允许超时毫秒数（用于钳制上限）。
- `CLAUDE_CODE_SHELL`：可用于指定 Bash 可执行文件路径（若宿主环境需要）。

## 构建与测试

```bash
cd agent-lite-tools/shell
npm install
npm run build
npm test
```

## 许可证

本包当前标记为 ISC（与仓库内同类包一致）。Shell 行为参考 Claude Code 的公开行为模型，这里是宿主侧的轻量实现。
