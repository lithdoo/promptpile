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

`ripgrep` 是内部搜索机制，不是产品接口。对外接口必须表达 Promptpile 的 archive / turn / artifact 领域语义。

## 2. 设计原则

### 2.1 协议驱动

production code 只依据 Archive Protocol 与其中复用的 Conversation Protocol 文件语义实现，不 import `promptpile-compress` 的源码、`dist/*` 或私有类型。

只有通过 Archive Protocol discovery 与 manifest 校验的 archive 才进入搜索范围。

### 2.2 只读

本 package 不执行 restore、recovery、archive migration 或任何 lifecycle mutation。

搜索与读取前后，authoritative archive artifacts 必须 byte-for-byte 不变。

### 2.3 CLI first，API shared

CLI 是普通用户的主要入口；TypeScript API 用于复用实现，而不是要求用户写代码才能使用。

CLI、未来 MCP 与其他 adapter 必须调用同一套 domain API，不能各自重新实现 archive discovery、grep filtering 或 result mapping。

### 2.4 search 返回 turn，read 返回 artifacts

搜索结果的外部单位是 Promptpile turn，而不是 raw filesystem grep hit。

`read` 返回该 turn 的 authoritative archived artifacts，不再创造另一套 conversation storage protocol。

因此：

```text
search = 帮用户找到相关 turn
read   = 完整读取该 turn 的 authoritative artifacts
```

### 2.5 不泄漏 ripgrep 实现细节

v1 不把 `--glob`、regex engine、max columns 等 ripgrep 参数直接暴露为产品 API。

默认 query 是 literal text。regex、复杂上下文窗口和 ranking 只有出现真实需求后再增加。

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
): Promise<ArchivedTurn | null>;
```

`readArchivedTurn()` 返回 artifact 边界，不把 `assistant.md`、calls、extra、results 强行重编码成新的存储格式。

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
- `limit` 限制返回的 turn 数，而不是 raw grep hit 数；
- 同一 turn 的多个文件命中聚合到一个 `ArchiveSearchResult`；
- `role` 属于具体 match，而不是强行放到 turn 顶层，因为同 idx 可以包含不同 artifact/role；
- `includeToolResults` 控制 `assistant.result.jsonl` 是否进入搜索范围；
- 默认大小写不敏感；
- 结果排序必须 deterministic，v1 推荐 `turnIdx` 从新到旧，同 turn 内按 source file / line 稳定排序；
- `truncated` 表示还有命中因 limit 或底层安全截断没有返回。

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

默认不得把整个 archive directory 直接递归交给 ripgrep。

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

底层优先复用 `@agent-tool-lite/search` 已公开的 `runRipgrep`、`buildGrepArgs`、`getRgPath` 与 timeout/process management 能力，不在本 package 重复实现 rg lifecycle。

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

CLI 不暴露 raw rg args。

### 5.3 read

```bash
promptpile-archive read -d ./messages 31
promptpile-archive read -d ./messages 31 --json
```

用途：用户在 `search` 找到 turn 后读取完整 authoritative artifacts。

human-readable 输出可以按 message / calls / extra / results 分段；`--json` 保留 artifact 边界与原始 content。

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

CLI v1 的验收重点是这个闭环，而不是提供完整 ripgrep 参数集。

## 6. JSON 输出与错误语义

CLI `--json`、TypeScript API 和未来 MCP 应复用同一 domain result / error semantics。

建议稳定错误码至少包括：

```text
NO_ARCHIVE
TURN_NOT_FOUND
INVALID_ARCHIVE
INVALID_QUERY
SEARCH_TIMEOUT
SEARCH_TRUNCATED
IO_ERROR
```

human CLI 显示可读错误；machine surface 返回稳定 code，不要求调用方解析自然语言。

`SEARCH_TRUNCATED` 可以作为结构化状态或错误使用，但必须与 `ArchiveSearchResponse.truncated` 的语义保持一致，避免同一条件有两套解释。实现前应选择一种并固定测试。

## 7. MCP

MCP 在 CLI/search domain 稳定后增加，不阻塞第一版 grep lookup。

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
- raw ripgrep compatibility surface；
- interactive TUI；
- 多种重复实现的 CLI / MCP / tool search engine。

Vector search 如有真实需求，应作为另一个独立 Archive Protocol consumer，而不是把 grep consumer 逐步演化成通用 retrieval framework。

## 9. 实施顺序

```text
P3.1 search domain types
  ↓
P3.2 searchable artifact enumeration
  ↓
P3.3 @agent-tool-lite/search adapter
  ↓
P3.4 raw hit → turn domain mapping / aggregation
  ↓
P3.5 limit / truncation / error semantics
  ↓
P3.6 Chinese / JSONL / tool-heavy / multi-archive tests
  ↓
P3.7 promptpile-archive list / search / read CLI
  ↓
P3.8 --json machine output
  ↓
P4   optional MCP adapter
```

P3 完成定义：普通用户无需编写代码，即可通过 CLI 完成 `search → read` 历史检索闭环；API、CLI 使用相同 domain semantics；全部路径保持 Archive Protocol read-only。