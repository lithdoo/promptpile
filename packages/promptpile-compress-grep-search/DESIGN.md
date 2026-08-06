# promptpile-compress-grep-search 设计

> 状态：Active Design  
> 稳定性：Experimental  
> 类型：Archive Protocol read-only consumer  
> 最近复核：2026-08-06

## 1. 产品定位

`promptpile-compress-grep-search` 为 Promptpile 已归档历史提供只读检索能力。

它不是一个要求使用者编写 TypeScript 的 library-first 产品。核心实现保留可复用的 domain API，但主要用户入口应是 CLI，使普通用户、shell、CI 和 CLI agent 在不写集成代码的情况下即可搜索与读取历史；MCP 作为后续 Agent 无编码集成面，复用同一套 domain semantics。

推荐的用户侧命令名为：

```text
promptpile-archive
```

package 名称可以继续使用 `promptpile-compress-grep-search`；CLI 名称不需要暴露内部实现分工。

职责关系：

```text
Archive Protocol files
        │
        ▼
archive search domain
  discover / search / read
        │
        ├── promptpile-archive CLI   ← 主产品面
        ├── TypeScript API           ← 实现复用面
        └── MCP adapter              ← 后续 Agent 集成面
```

v1 使用 package 内置的 Node.js 流式 literal scanner。对外接口只表达 Promptpile 的 archive / turn / artifact 领域语义，不暴露底层文件扫描参数。若真实基准证明超大 archive 需要更高吞吐，可以在保持 domain API 不变的前提下增加可替换 backend。

## 2. 设计原则

### 2.1 协议驱动

production code 只依据 Archive Protocol 与其中复用的 Conversation Protocol 文件语义实现，不 import `promptpile-compress` 的源码、`dist/*` 或私有类型。

只有通过 Archive Protocol discovery 与 manifest 校验的 archive 才进入搜索范围。

### 2.2 只读

本 package 不执行 restore、recovery、archive migration 或任何 lifecycle mutation。

搜索与读取前后，authoritative archive artifacts 必须 byte-for-byte 不变。

### 2.3 CLI first，API shared

CLI 是普通用户的主要入口；TypeScript API 用于复用实现，而不是要求用户写代码才能使用。

CLI、未来 MCP 与其他 adapter 必须调用同一套 domain API，不能各自重新实现 archive discovery、artifact filtering 或 result mapping。

### 2.4 search 返回 turn，read 返回 artifacts

搜索结果的外部单位是 Promptpile turn，而不是 raw filesystem hit。

`read` 返回该 turn 的 authoritative archived artifacts，不再创造另一套 conversation storage protocol。

因此：

```text
search = 帮用户找到相关 turn
read   = 完整读取该 turn 的 authoritative artifacts
```

### 2.5 专用 literal scanner，不泄漏实现细节

v1 不依赖 `@agent-tool-lite/search` 或外部 `ripgrep` 二进制，也不把 glob、regex engine、max columns 等扫描参数暴露为产品 API。

默认 query 是 literal text。regex、复杂上下文窗口和 ranking 只有出现真实需求后再增加。

scanner 使用 Node.js 文件流逐行读取明确枚举的 artifacts，不一次性把全部 archive 内容载入内存，也不为每个文件启动子进程。内部实现必须支持取消、timeout、有限并发与资源上限。

## 3. Domain API

### 3.1 Archive discovery

现有接口继续保留：

```ts
interface ArchiveDescriptor {
  idx: number;
  name: string;
  path: string;
  archivedTurnIndices: number[];
}

function discoverArchives(
  directory: string
): Promise<ArchiveDescriptor[]>;
```

它负责：

- 发现合法 `[N]system.md.archive/`；
- 校验 Archive Protocol v1 最小 manifest；
- 拒绝 duplicate / ambiguous archive state；
- 不执行恢复或修复。

### 3.2 Read archived turn

现有 `readArchivedTurn()` 作为精确读取接口：

```ts
interface ArchivedArtifact {
  name: string;
  path: string;
  turnIdx: number;
  role: string;
  fileKind: 'message' | 'calls' | 'result' | 'extra';
  content: string;
}

interface ArchivedTurn {
  idx: number;
  archiveIdx: number;
  artifacts: ArchivedArtifact[];
}

interface ReadArchivedTurnOptions {
  includeToolResults?: boolean;
}

function readArchivedTurn(
  directory: string,
  turnIdx: number,
  options?: ReadArchivedTurnOptions
): Promise<ArchivedTurn>;
```

`readArchivedTurn()` 返回 artifact 边界，不把 `assistant.md`、calls、extra、results 强行重编码成新的存储格式。

`read` 默认包含 tool results。artifact 顺序遵循 Conversation Protocol v1：普通非 assistant message、assistant message、calls、extra、result；同一类别内按 role / source file 稳定排序。

### 3.3 Search archive

新增核心接口建议为：

```ts
interface ArchiveSearchMatch {
  role: string;
  fileKind: 'message' | 'calls' | 'result' | 'extra';
  sourceFile: string;
  snippet: string;
  line?: number;
}

interface ArchiveSearchResult {
  turnIdx: number;
  archiveIdx: number;
  matches: ArchiveSearchMatch[];
}

interface ArchiveSearchOptions {
  query: string;
  limit?: number;
  roles?: string[];
  includeToolResults?: boolean;
  caseSensitive?: boolean;
}

interface ArchiveSearchResponse {
  results: ArchiveSearchResult[];
  truncated: boolean;
}

function searchArchive(
  directory: string,
  options: ArchiveSearchOptions
): Promise<ArchiveSearchResponse>;
```

语义约束：

- `query` v1 按 literal text 搜索；
- 空字符串或纯空白 query 返回 `INVALID_QUERY`；
- `limit` 限制返回的 turn 数，而不是 raw grep hit 数；
- `limit` 默认 20，必须是 1 到 100 的整数；
- 同一 turn 的多个文件命中聚合到一个 `ArchiveSearchResult`；
- `role` 属于具体 match，而不是强行放到 turn 顶层，因为同 idx 可以包含不同 artifact/role；
- `roles` 省略或为空数组表示不按 role 过滤，role 比较大小写敏感；
- `includeToolResults` 控制 `assistant.result.jsonl` 是否进入搜索范围，search 默认不包含 tool results；
- 默认大小写不敏感；
- 结果排序必须 deterministic：按 `turnIdx` 降序、`archiveIdx` 降序；同 turn 内按 Conversation Protocol artifact 顺序、source file、line 稳定排序；
- `truncated` 是成功响应状态，表示还有命中因 turn limit 或内部安全上限没有返回；它不是错误；
- timeout 不返回不完整成功结果，而是失败并返回 `SEARCH_TIMEOUT`。

第一版不定义 score。grep 没有稳定的 semantic relevance score，不应制造虚假的 ranking 语义。

## 4. Searchable artifacts

搜索范围必须先经过 archive discovery，再明确枚举 Archive Protocol authoritative files。

允许搜索：

```text
[idx]{role}.md
[idx]{role}.json
[idx]assistant.calls.jsonl
[idx]assistant.extra.json
[idx]assistant.result.jsonl
```

scanner 不递归搜索 archive directory。它只接收 discovery 后按 manifest 和 Conversation Protocol 明确生成的 `SearchableArtifact[]`；文件名中的 turn 必须存在于该 archive 的 `archivedTurnIndices` 中。

必须忽略：

```text
compression.json
.summary.md
.promptpile-compress.*
其他 metadata / private / derived files
```

filepath 命中必须映射回：

```text
archiveIdx
turnIdx
role
fileKind
sourceFile
snippet
line
```

### 4.1 Node.js 流式 scanner

内部建立最小 backend 边界，但 v1 只实现 Node.js backend：

```ts
interface SearchableArtifact {
  archiveIdx: number;
  turnIdx: number;
  role: string;
  fileKind: 'message' | 'calls' | 'result' | 'extra';
  name: string;
  path: string;
}

interface ArchiveSearchBackend {
  search(
    artifacts: SearchableArtifact[],
    options: BackendSearchOptions
  ): AsyncIterable<ArchiveSearchMatch>;
}
```

默认 backend 使用 `fs.createReadStream()` 与 `readline` 逐行扫描，以 `String.includes()` 实现 literal match。大小写不敏感搜索使用稳定的 `toLowerCase()` 规范化，不使用 locale-dependent 转换。

内部安全限制必须与用户侧 turn `limit` 分离，至少包括：

```ts
interface ArchiveSearchSafetyLimits {
  timeoutMs: number;
  maxMatchesPerTurn: number;
  maxTotalMatches: number;
  maxSnippetCharacters: number;
  maxLineCharacters: number;
}
```

安全上限使用 package 内部保守默认值，不作为 v1 CLI 参数暴露。达到 match/snippet/line 上限时返回已有完整 match 并设置 `truncated: true`；timeout 抛出 `SEARCH_TIMEOUT`。实现不得使用无界 `Promise.all(readFile(...))`。

增加其他 backend 的条件是可复现 benchmark 证明 Node backend 在目标规模下不能满足性能目标。替换 backend 不得改变 literal、排序、limit、truncation 或错误语义。

## 5. CLI

CLI 是 v1 的主要产品接口。

### 5.1 list

```bash
promptpile-archive list -d ./messages
promptpile-archive list -d ./messages --json
```

用途：查看当前 conversation 下有哪些 archive 与 archived turn。

默认 human-readable 输出；`--json` 输出稳定机器结构。

### 5.2 search

```bash
promptpile-archive search -d ./messages "postgres migration"
```

第一版参数：

```text
-d, --directory <dir>
--limit <n>
--role <role>              可重复或等价表达多个 role
--include-tool-results
--no-tool-results
--case-sensitive
--json
```

默认输出以 turn 聚合：

```text
Turn 31
  [assistant/message] [31]assistant.md
  ...决定先迁移 postgres schema，再处理旧数据...

  [assistant/result] [31]assistant.result.jsonl
  ...migration completed with warnings...
```

CLI 不暴露底层 scanner 参数。

`--include-tool-results` 与 `--no-tool-results` 互斥；search 默认等价于 `--no-tool-results`。`--limit` 采用 domain API 的相同范围校验。

### 5.3 read

```bash
promptpile-archive read -d ./messages 31
promptpile-archive read -d ./messages 31 --json
```

用途：用户在 `search` 找到 turn 后读取完整 authoritative artifacts。

human-readable 输出可以按 message / calls / extra / results 分段；`--json` 保留 artifact 边界与原始 content。

read 默认包含 tool results；`--no-tool-results` 可显式排除。输出 artifact 顺序必须与 domain API 一致。

### 5.4 核心用户流程

```text
不知道历史在哪
    │
    ▼
search "关键词"
    │
    ▼
得到 turnIdx
    │
    ▼
read <turnIdx>
    │
    ▼
获得完整历史 artifacts
```

CLI v1 的验收重点是这个闭环，而不是提供通用文件搜索参数集。

## 6. JSON 输出与错误语义

CLI `--json`、TypeScript API 和未来 MCP 应复用同一 domain result / error semantics。

稳定错误码包括：

```text
NO_ARCHIVE
TURN_NOT_FOUND
INVALID_ARCHIVE
INVALID_QUERY
SEARCH_TIMEOUT
IO_ERROR
```

human CLI 显示可读错误；machine surface 返回稳定 code，不要求调用方解析自然语言。domain implementation 使用带 `code` 的结构化 error，不以自然语言消息作为机器判断依据。

无 archive 是 `NO_ARCHIVE`；search 无命中是成功空结果；read 未找到 turn 是 `TURN_NOT_FOUND`；非法 manifest/冲突 archive 是 `INVALID_ARCHIVE`。

`truncated` 只作为 `ArchiveSearchResponse` 的成功状态，不定义 `SEARCH_TRUNCATED` 错误码。CLI `--json` 成功与失败都输出稳定 envelope；成功写 stdout，失败写 stderr 并以非零状态退出。具体 JSON schema 与 exit code mapping 在 CLI 阶段冻结并加入 contract tests。

## 7. MCP

MCP 在 CLI/search domain 稳定后增加，不阻塞第一版 literal lookup。

建议只提供两个主要 tool：

```text
search_archive
read_archived_turn
```

MCP server 启动时配置 conversation directory：

```bash
promptpile-archive mcp -d ./messages
```

这样 agent 调用 tool 时不需要每次传任意 filesystem path：

```json
{
  "query": "authentication bug",
  "limit": 20
}
```

`search_archive` 与 `read_archived_turn` 只是 domain API 的薄 adapter。工具名属于 retrieval product surface，不属于 Archive Protocol。

第一版不要求单独维护 generic Agent Tool surface；如果未来某个 runtime 有明确需求，再基于同一 domain API 增加薄 adapter。

## 8. 非目标

当前不做：

- embedding / vector database；
- semantic reranker；
- relevance score；
- archive mutation / restore；
- summary generation；
- raw filesystem search / ripgrep compatibility surface；
- interactive TUI；
- 多种重复实现的 CLI / MCP / tool search engine。

Vector search 如有真实需求，应作为另一个独立 Archive Protocol consumer，而不是把 grep consumer 逐步演化成通用 retrieval framework。

## 9. 阶段落地计划

### P3.0 · 契约收口

- 固定 read/search 的 tool-result 默认值与 artifact 顺序；
- 定义 domain error class、稳定 error code、`truncated` 与 timeout 语义；
- 定义 CLI JSON envelope、exit code mapping 与参数校验规则；
- 修正现有 `readArchivedTurn()` 的排序并增加 Conversation Protocol 顺序测试。

完成标准：Domain API 不再依赖调用方解析自然语言错误；read 行为与 Conversation Protocol 一致。

### P3.1 · Search domain 与 artifact enumeration

- 定义 search response、backend 和内部 safety-limit 类型；
- 从已校验 archive 明确枚举 `SearchableArtifact[]`；
- 排除未在 manifest 声明的 turn、private metadata 与 derived files；
- 固定多 archive、role、tool-result 和 deterministic ordering 行为。

完成标准：不读取文件内容即可得到唯一、确定、协议合规的搜索输入集合。

### P3.2 · Node.js 流式 literal scanner

- 使用 file stream + readline 实现 UTF-8 literal search；
- 支持大小写选项、取消、timeout、有限并发与内部安全上限；
- 将行命中直接映射为 domain match，不产生 raw grep 中间协议；
- 聚合为 turn result，并正确计算 limit 与 `truncated`。

完成标准：中文 Markdown、JSON/JSONL、长行、大文件、多 archive 均有 deterministic tests；搜索前后 archive byte-for-byte 不变。

### P3.3 · `promptpile-archive` CLI

- 实现 `list`、`search`、`read`；
- 增加 package `bin` entry、Node-compatible shebang 与 workspace build 配置；
- human-readable 与 `--json` 都只调用 domain API；
- 覆盖 stdin/stdout/stderr、exit code、冲突参数和安装后 binary smoke test。

完成标准：普通用户无需 TypeScript，即可完成 `search → read` 闭环；CLI contract tests 在 Node 18/22 和 Windows/Linux filesystem matrix 通过。

### P3.4 · 性能与发布验证

- 建立小型、1,000 turns 和大 JSONL archive benchmark；
- 记录首次查询延迟、吞吐、峰值内存与提前终止行为；
- 验证 npm/package 安装后的 CLI 与无外部二进制运行；
- 只有 benchmark 证明 Node backend 不满足目标时，才设计可选的高吞吐 backend。

完成标准：确定性能基线和回归阈值，确认是否具备解除 `private` 的发布条件。

### P4 · Optional MCP adapter

- CLI/search domain 经真实使用稳定后再实现；
- 只提供 `search_archive` / `read_archived_turn` 薄 adapter；
- server 启动时固定 conversation directory，不向 tool 暴露任意 filesystem path。

P3 总完成定义：API 与 CLI 使用相同 domain semantics；全部路径保持 Archive Protocol read-only；无 `@agent-tool-lite/search`、`ripgrep` 或平台二进制依赖；普通用户可以完成稳定的 `search → read` 历史检索闭环。
