# @agent-tool-lite/search

基于 `@vscode/ripgrep` 的轻量搜索工具包，提供 `Glob` 与 `Grep` 两个 Agent 工具，适合在宿主系统中按需组合注册。

## 导出总览

本包对外分为三层能力：

- **总工厂**
  - `createSearchTools(config?)`
- **单工具工厂**
  - `createGlobTool(ignoreController)`
  - `createGrepTool(ignoreController)`
- **控制器与低层库**
  - `createIgnoreController(...)`
  - `runRipgrep`、`buildGrepArgs`、`globFiles` 等

完整导出请以 `src/index.ts` 为准。

## 快速开始（总工厂）

```ts
import { createSearchTools } from '@agent-tool-lite/search'

const tools = createSearchTools({
  ignoreRules: ['**/dist/**'],
})

const globOut = await tools.globTool.execute(
  { pattern: '**/*.ts' },
  { cwd: '/repo' },
)

const grepOut = await tools.grepTool.execute(
  { pattern: 'TODO', output_mode: 'files_with_matches' },
  { cwd: '/repo', ignoreGlobs: ['**/coverage/**'] },
)

await tools.dispose()
```

`createSearchTools()` 返回：

- `globTool`
- `grepTool`
- `setIgnoreRules(rules)`
- `setIgnoreFile(filePath?)`
- `getIgnoreRules()`
- `getIgnoreSources()`
- `dispose()`

## 单工具工厂（高级用法）

当你只想注册某一个搜索工具时，可直接使用单工具工厂：

```ts
import {
  createIgnoreController,
  createGlobTool,
} from '@agent-tool-lite/search'

const ignore = createIgnoreController(['**/dist/**'])
const globTool = createGlobTool(ignore)
```

这种模式适合：

- 仅暴露 `Glob` 或仅暴露 `Grep`；
- 多工具共享同一套 ignore 规则状态；
- 宿主已有自己的工具装配层。

## Ignore 控制能力

`createIgnoreController` 负责 ignore 规则状态与监听。

### `setIgnoreRules(rules)`

- 设置手工 ignore 规则。
- 新规则会替换旧手工规则。

### `setIgnoreFile(filePath?)`

- 从文件加载 ignore 规则，并监听 `add/change/unlink`。
- 文件格式：
  - 每行一条规则；
  - 空行忽略；
  - `#` 注释行忽略；
  - 相对规则相对于 ignore 文件所在目录解析。

### `getIgnoreSources()`

返回：

- `manual`：手工规则
- `file`：文件规则
- `merged`：最终生效规则
- `ignoreFile`：当前规则文件路径（可选）

### 生效规则

- 最终 ignore = `manual ∪ file`（并集）。
- 工具执行时会把控制器规则与本次调用的 `context.ignoreGlobs` 合并去重。
- 使用完成后建议 `await dispose()` 释放 watcher。

## 执行上下文（SearchToolExecuteContext）

`globTool.execute` / `grepTool.execute` 的上下文支持：

- `cwd`：工作目录
- `signal`：中断信号
- `timeoutMs`：ripgrep 超时
- `maxStdoutBytes`：输出截断上限
- `ignoreGlobs`：本次调用追加 ignore 规则

## OpenAI 工具定义

如果你需要 OpenAI 风格 `tools[]` 定义，可使用：

- `searchToolsOpenAiDefinitions()`
- `agentToolToOpenAi(...)`

## 环境变量（仅 Glob）

- `CLAUDE_CODE_GLOB_NO_IGNORE`：默认按 `true` 处理（传 `--no-ignore`）
- `CLAUDE_CODE_GLOB_HIDDEN`：默认按 `true` 处理（传 `--hidden`）

## 构建与测试

```bash
cd agent-lite-tools/search
npm install
npm run build
npm test
```
