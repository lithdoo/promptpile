# @agent-tool-lite/file

面向 Agent 运行时的轻量文件工具包，读写与编辑语义参考 Claude Code，适合在 hostra 中按需组合使用。

## 导出结构

- 总工厂：`createFileTools(config?)`
- 单工具工厂：
  - `createReadFileInRangeTool(accessController)`
  - `createFileWriteTool(accessController)`
  - `createFileEditTool(accessController)`
- 控制器与低层函数：
  - `createAccessController(...)`
  - `readFileInRange`、`writeTextFile`、`editTextFile`、`safeResolvePath` 等

## 快速开始（总工厂）

```ts
import { createFileTools } from '@agent-tool-lite/file'

const tools = createFileTools({ roots: [process.cwd()] })
const readFileState: import('@agent-tool-lite/file').FileReadStateMap = new Map()

await tools.readFileTool.execute(
  { file_path: 'a.txt' },
  { cwd: process.cwd(), readFileState },
)
```

`createFileTools()` 返回：

- `readFileTool`（`read_file`）
- `writeFileTool`（`Write`）
- `editFileTool`（`Edit`）
- `setRoots` / `getRoots`
- `setRootsFile` / `getRootsSources`
- `dispose`

## 单工具工厂（高级用法）

```ts
import {
  createAccessController,
  createReadFileInRangeTool,
} from '@agent-tool-lite/file'

const access = createAccessController([process.cwd()])
const readTool = createReadFileInRangeTool(access)
```

## Roots 权限控制

- 最终权限集合：`manual ∪ file`
- `setRoots(roots)`：设置手工 roots
- `setRootsFile(filePath?)`：从文件加载 roots 并监听变更
- `getRootsSources()`：查看 `manual` / `file` / `merged`
- `merged` 为空时默认拒绝全部访问（deny-all）
- 结束时建议调用 `dispose()` 释放 watcher

`setRootsFile` 文件格式：

- 每行一个路径
- 空行忽略
- `#` 注释行忽略
- 相对路径相对于 roots 文件所在目录

## 执行上下文与状态约束

- 上下文字段：`cwd`、`signal`、`readFileState`
- `writeFileTool` / `editFileTool` 对已有文件要求先读后写
- `readFileState` 需在同一会话共享

## 低层 API

- `readFileInRange(...)`
- `readFileSync(...)`
- `readFileSyncWithMetadata(...)`
- `writeTextFile(...)`
- `editTextFile(...)`
- `safeResolvePath(...)`
- `formatFileSize(...)`

## 构建与测试

```bash
cd agent-lite-tools/file
npm install
npm run build
npm test
```

## 许可证

本包当前标记为 ISC（与仓库内同类包一致）。如需分发，请自行确认上游依赖与迁移代码的许可证要求。
# 临时测试
# @agent-tool-lite/file

面向 Agent 运行时的轻量文件工具包，读写与编辑语义参考 Claude Code，适合在 hostra 中按需组合使用。

## 导出结构

- 总工厂：`createFileTools(config?)`
- 单工具工厂：
  - `createReadFileInRangeTool(accessController)`
  - `createFileWriteTool(accessController)`
  - `createFileEditTool(accessController)`
- 控制器与低层函数：
  - `createAccessController(...)`
  - `readFileInRange`、`writeTextFile`、`editTextFile`、`safeResolvePath` 等

## 快速开始（总工厂）

```ts
import { createFileTools } from '@agent-tool-lite/file'

const tools = createFileTools({ roots: [process.cwd()] })
const readFileState: import('@agent-tool-lite/file').FileReadStateMap = new Map()

await tools.readFileTool.execute(
  { file_path: 'a.txt' },
  { cwd: process.cwd(), readFileState },
)
```

`createFileTools()` 返回：

- `readFileTool`（`read_file`）
- `writeFileTool`（`Write`）
- `editFileTool`（`Edit`）
- `setRoots` / `getRoots`
- `setRootsFile` / `getRootsSources`
- `dispose`

## 单工具工厂（高级用法）

```ts
import {
  createAccessController,
  createReadFileInRangeTool,
} from '@agent-tool-lite/file'

const access = createAccessController([process.cwd()])
const readTool = createReadFileInRangeTool(access)
```

## Roots 权限控制

- 最终权限集合：`manual ∪ file`
- `setRoots(roots)`：设置手工 roots
- `setRootsFile(filePath?)`：从文件加载 roots 并监听变更
- `getRootsSources()`：查看 `manual` / `file` / `merged`
- `merged` 为空时默认拒绝全部访问（deny-all）
- 结束时建议调用 `dispose()` 释放 watcher

`setRootsFile` 文件格式：

- 每行一个路径
- 空行忽略
- `#` 注释行忽略
- 相对路径相对于 roots 文件所在目录

## 执行上下文与状态约束

- 上下文字段：`cwd`、`signal`、`readFileState`
- `writeFileTool` / `editFileTool` 对已有文件要求先读后写
- `readFileState` 需在同一会话共享

## 低层 API

- `readFileInRange(...)`
- `readFileSync(...)`
- `readFileSyncWithMetadata(...)`
- `writeTextFile(...)`
- `editTextFile(...)`
- `safeResolvePath(...)`
- `formatFileSize(...)`

## 构建与测试

```bash
cd agent-lite-tools/file
npm install
npm run build
npm test
```

## 许可证

本包当前标记为 ISC（与仓库内同类包一致）。如需分发，请自行确认上游依赖与迁移代码的许可证要求。
# @agent-tool-lite/file

面向 Agent 运行时的轻量文件工具包，读写与编辑语义参考 Claude Code，适合在 hostra 中按需组合使用。

## 导出结构

本包对外分三层：

- 总工厂：`createFileTools(config?)`
- 单工具工厂：
  - `createReadFileInRangeTool(accessController)`
  - `createFileWriteTool(accessController)`
  - `createFileEditTool(accessController)`
- 控制器与低层函数：
  - `createAccessController(...)`
  - `readFileInRange`、`writeTextFile`、`editTextFile`、`safeResolvePath` 等

## 快速开始（总工厂）

```ts
import { createFileTools } from '@agent-tool-lite/file'

const tools = createFileTools({ roots: [process.cwd()] })
const readFileState: import('@agent-tool-lite/file').FileReadStateMap = new Map()

await tools.readFileTool.execute(
  { file_path: 'a.txt' },
  { cwd: process.cwd(), readFileState },
)

await tools.writeFileTool.execute(
  { file_path: 'a.txt', content: 'hello\n' },
  { cwd: process.cwd(), readFileState },
)
```

`createFileTools()` 返回：

- `readFileTool`（工具名：`read_file`）
- `writeFileTool`（工具名：`Write`）
- `editFileTool`（工具名：`Edit`）
- `setRoots(roots: string[])`
- `getRoots()`
- `setRootsFile(filePath?)`
- `getRootsSources()`
- `dispose()`

## 单工具工厂（高级用法）

当你只想注册某一个工具，或自行管理权限控制时，可直接使用单工具工厂。

```ts
import {
  createAccessController,
  createReadFileInRangeTool,
} from '@agent-tool-lite/file'

const access = createAccessController([process.cwd()])
const readTool = createReadFileInRangeTool(access)
```

适用场景：

- 只暴露只读能力；
- 多工具共享同一套权限状态；
- 宿主已有自定义工具装配层。

## Roots 权限控制

`createAccessController` 提供统一的文件路径授权。

### `setRoots(roots)`

- 设置手工 roots 列表；
- 自动标准化并去重。

### `setRootsFile(filePath?)`

- 从文件加载 roots，并监听 `add/change/unlink` 自动更新；
- 文件格式规则：
  - 每行一个路径；
  - 空行忽略；
  - `#` 注释行忽略；
  - 相对路径相对于 roots 文件所在目录。

### `getRootsSources()`

返回：

- `manual`：手工 roots
- `file`：文件 roots
- `merged`：最终生效 roots
- `rootsFile`：当前 roots 文件路径（可选）

### 生效语义

- 最终权限 = `manual ∪ file`；
- `merged` 为空时，默认拒绝全部访问（deny-all）；
- 结束时建议 `await dispose()` 释放 watcher。

## 执行上下文与状态约束

工具执行上下文支持：

- `cwd`
- `signal`
- `readFileState`（写入/编辑必需）

约束说明：

- `writeFileTool` 与 `editFileTool` 对已有文件要求先读后写；
- `readFileState` 需在同一会话共享，才能保持行为一致。

## 低层 API

常用低层函数：

- `readFileInRange(...)`
- `readFileSync(...)`
- `readFileSyncWithMetadata(...)`
- `writeTextFile(...)`
- `editTextFile(...)`
- `safeResolvePath(...)`
- `formatFileSize(...)`

适用于不通过工具层、直接集成库函数的场景。

## 构建与测试

```bash
cd agent-lite-tools/file
npm install
npm run build
npm test
```

## 许可证

本包当前标记为 ISC（与仓库内同类包一致）。如需分发，请自行确认上游依赖与迁移代码的许可证要求。
# @agent-tool-lite/file

面向 Agent 运行时的轻量文件工具包，核心语义参考 Claude Code 的读写/编辑流程，适合在 hostra 体系中按需注册与组合。

## 导出总览

本包对外分为三层能力：

- **总工厂**
  - `createFileTools(config?)`
- **单工具工厂**
  - `createReadFileInRangeTool(accessController)`
  - `createFileWriteTool(accessController)`
  - `createFileEditTool(accessController)`
- **控制器与低层库**
  - `createAccessController(...)`
  - `readFileInRange`、`writeTextFile`、`editTextFile` 等底层函数

完整导出请以 `src/index.ts` 为准。

## 快速开始（总工厂）

```ts
import { createFileTools } from '@agent-tool-lite/file'

const tools = createFileTools({
  roots: [process.cwd()],
})

const readFileState: import('@agent-tool-lite/file').FileReadStateMap = new Map()

await tools.readFileTool.execute(
  { file_path: 'a.txt' },
  { cwd: process.cwd(), readFileState },
)

await tools.writeFileTool.execute(
  { file_path: 'a.txt', content: 'hello\n' },
  { cwd: process.cwd(), readFileState },
)
```

`createFileTools()` 返回：

- `readFileTool`（工具名：`read_file`）
- `writeFileTool`（工具名：`Write`）
- `editFileTool`（工具名：`Edit`）
- `setRoots(roots: string[])`
- `getRoots()`
- `setRootsFile(filePath?)`
- `getRootsSources()`
- `dispose()`

## 单工具工厂（高级用法）

当你只想注册某一个工具，或要自己管理权限控制器时，使用单工具工厂：

```ts
import {
  createAccessController,
  createReadFileInRangeTool,
} from '@agent-tool-lite/file'

const access = createAccessController([process.cwd()])
const readTool = createReadFileInRangeTool(access)
```

这种模式适合：

- 只暴露 `read_file`，不暴露写入/编辑；
- 多个工具共享同一套权限控制状态；
- 宿主框架已经有自己的工具组合层。

## 权限控制（Roots）

`file` 包的访问控制由 `AccessController` 负责。

### `setRoots(roots)`

- 设置手工 roots 列表。
- roots 会标准化并去重。

### `setRootsFile(filePath?)`

- 从文件加载 roots，并监听文件变化（`add/change/unlink`）。
- 文件格式：
  - 每行一个路径；
  - 空行忽略；
  - `#` 注释行忽略；
  - 相对路径相对于该配置文件所在目录。

### `getRootsSources()`

返回：

- `manual`：手工 roots
- `file`：来自 roots 文件
- `merged`：最终生效 roots
- `rootsFile`：当前配置文件路径（可选）

### 生效规则

- 最终权限 = `manual ∪ file`（并集）。
- 若 `merged` 为空，默认拒绝全部访问（deny-all）。
- 调用结束时建议 `await dispose()` 释放 watcher。

## 执行上下文与 readFileState 约束

工具执行上下文支持：

- `cwd`
- `signal`
- `readFileState`（写/编辑场景必需）

约束说明：

- `writeFileTool` / `editFileTool` 对已有文件要求先读后写；
- `readFileState` 需在同一会话内共享；
- 这是对齐 Claude `Write/Edit` 行为的关键约束。

## 低层 API（库函数）

常用函数包括：

- `readFileInRange(...)`
- `readFileSync(...)`
- `readFileSyncWithMetadata(...)`
- `writeTextFile(...)`
- `editTextFile(...)`
- `safeResolvePath(...)`
- `formatFileSize(...)`

适用于你不走工具层、直接集成库能力的场景。

## 构建与测试

```bash
cd agent-lite-tools/file
npm install
npm run build
npm test
```

## 许可证

本包当前标记为 ISC（与仓库内同类包一致）。若你分发基于上游迁移的实现，请自行确认上游许可证条款。
# @agent-tool-lite/file

面向 hostra 仓库的轻量文件工具集，能力参考 Claude Code 的文件读写/编辑语义，适用于自定义 Agent 运行时。

## 工具使用（工厂模式）

通过 `createFileTools` 创建工具实例。每个实例拥有独立的权限状态。

- `createFileTools({ roots })` 返回：
  - `readFileTool`（`name: 'read_file'`）
  - `writeFileTool`（`name: 'Write'`）
  - `editFileTool`（`name: 'Edit'`）
  - `setRoots(roots: string[])`
  - `getRoots()`
  - `setRootsFile(filePath?)`（从文件加载 roots，并通过 chokidar 自动监听更新）
  - `getRootsSources()`（查看 `manual/file/merged` 三类 roots）
  - `dispose()`（关闭 watcher）
- 当 roots 为空时，默认拒绝全部路径访问（deny-all）。
- `setRootsFile` 文件格式：每行一个路径；相对路径相对于该文件所在目录；空行和 `#` 注释行会被忽略。
- 有效权限集合为：`setRoots` 手工 roots 与 `setRootsFile` 文件 roots 的并集。
- `writeFileTool` / `editFileTool` 需要共享同一个 `readFileState`。

示例：

```ts
import { createFileTools } from '@agent-tool-lite/file'

const tools = createFileTools({ roots: [process.cwd()] })
const readFileState: import('@agent-tool-lite/file').FileReadStateMap = new Map()

// 注册 tools.readFileTool / tools.writeFileTool / tools.editFileTool
// 调用时传 execute(input, { readFileState, cwd, signal })

// 动态调整手工 roots
tools.setRoots([process.cwd()])

// 可选：从文件加载 roots 并自动跟随变更
await tools.setRootsFile('./roots.txt')
const rootsSnapshot = tools.getRootsSources()

// 运行时结束时释放 watcher
await tools.dispose()
```

## 低层库 API

### `readFileInRange(filePath, offset?, maxLines?, maxBytes?, signal?, options?)`

按行异步读取，返回：
`{ content, lineCount, totalLines, totalBytes, readBytes, mtimeMs, truncatedByBytes? }`

- 小于 **10MB** 的常规文件走快速路径（`fs.readFile` + 内存切行）。
- 更大文件、管道或设备走流式读取（`createReadStream`）。
- 自动移除 UTF-8 BOM；返回内容中的换行统一为 LF。
- 当超过 `maxBytes` 时抛出 **`FileTooLargeError`**（除非 `options.truncateOnByteLimit === true`）。

### `readFileSyncWithMetadata(filePath, options?)` / `readFileSync(filePath)`

同步整文件读取，包含 BOM/编码处理与 CRLF->LF 归一化，并返回行尾类型（`CRLF` / `LF`）。

### `writeTextFile(filePath, content, { readFileState, cwd?, signal? })`

整文件写入，包含读后写约束与 mtime 校验（与 Claude `FileWriteTool` 语义对齐）。

## 许可证

本包标记为 ISC（与 hostra 兄弟包一致）。若你分发基于 Claude Code 迁移的实现，请自行确认上游仓库许可证条款。

## 构建与测试

```bash
cd agent-lite-tools/file
npm install
npm run build
npm test
```
# @agent-tool-lite/file

Small filesystem utilities adapted from **Claude Code** (`anthropic/claude-code` or your local checkout). Intended for use inside the hostra monorepo.

## Agent tools (factory-first)

Create tool instances with `createFileTools`. Each instance owns its own access rules.

- `createFileTools({ roots })` returns:
  - `readFileTool` (`name: 'read_file'`)
  - `writeFileTool` (`name: 'Write'`)
  - `editFileTool` (`name: 'Edit'`)
  - `setRoots(roots: string[])`
  - `getRoots()`
  - `setRootsFile(filePath?)` (load roots from file and watch with chokidar)
  - `getRootsSources()` (manual/file/merged snapshot)
  - `dispose()` (close file watcher)
- Default behavior is **deny-all** when roots are empty.
- `setRootsFile` file format: one path per line; relative lines are resolved against the roots file directory; blank lines and `#` comment lines are ignored.
- Effective permissions are the union of manual roots and roots loaded from file.
- `writeFileTool` / `editFileTool` require shared `readFileState`.

Example:

```ts
import { createFileTools } from '@agent-tool-lite/file'

const tools = createFileTools({ roots: [process.cwd()] })
const readFileState: import('@agent-tool-lite/file').FileReadStateMap = new Map()

// register tools.readFileTool / tools.writeFileTool / tools.editFileTool
// invoke with execute(input, { readFileState, cwd, signal })

// tighten permissions at runtime
tools.setRoots([process.cwd()])

// optional: load extra roots from file and auto-refresh on file changes
await tools.setRootsFile('./roots.txt')
const roots = tools.getRootsSources()
// when shutting down your host runtime
await tools.dispose()
```

## Library API (low-level)

### `readFileInRange(filePath, offset?, maxLines?, maxBytes?, signal?, options?)`

Async, line-oriented read: returns `{ content, lineCount, totalLines, totalBytes, readBytes, mtimeMs, truncatedByBytes? }`.

- Regular files under **10 MB**: fast path (`fs.readFile` + in-memory line split).
- Larger files, pipes, devices: streaming path (`createReadStream`).
- Strips UTF-8 BOM; normalizes CRLF to LF in returned lines.
- Throws **`FileTooLargeError`** when `maxBytes` is exceeded (unless `options.truncateOnByteLimit` is `true`).

Upstream reference: `src/utils/readFileInRange.ts`.

### `readFileSyncWithMetadata(filePath, options?)` / `readFileSync(filePath)`

Synchronous full-file read with BOM/encoding handling and CRLF→LF normalization, plus detected `lineEndings` (`CRLF` | `LF`). Uses `safeResolvePath` (symlink / UNC / special-file guards) from the same upstream design.

- `options.onSymlinkTraverse` replaces Claude’s `logForDebugging` when reading through a symlink.

Upstream reference: `src/utils/fileRead.ts`, `src/utils/fsOperations.ts` (`safeResolvePath`).

### `formatFileSize(bytes)`

Human-readable size string for errors.

### `writeTextFile` / `FileReadStateMap` (Claude `FileWriteTool` core)

- **`writeTextFile(filePath, content, { readFileState, cwd?, signal? })`**: full-file write with `readFileState` guards and `getFileModificationTime` checks (see `FileWriteTool` in Claude Code). Does not run LSP, skills, or permission UIs.
- Use **`setStateFromReadInRange`**, or pass **`readFileState`** to **`readFileInRangeTool.execute`** so the map stays aligned with `writeTextFile` / **`fileWriteTool`**.

## License

Confirm the license of your Claude Code source tree before redistributing copied code. This package is marked **ISC** to match sibling hostra packages; upstream terms may differ.

## Build

```bash
cd agent-lite-tools/file
npm install
npm run build
npm test
```

There is no npm `workspaces` field at the hostra repository root; link this package from siblings with `"@agent-tool-lite/file": "file:../../agent-lite-tools/file"` (see the standalone `promptpile` repository when integrating across repositories).
