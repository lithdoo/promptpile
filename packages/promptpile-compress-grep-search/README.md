# promptpile-compress-grep-search

> 状态：P4 complete / beta
> 类型：Archive Protocol read-only consumer  
> 最近复核：2026-08-06

这是一个独立、只读、协议驱动的 Archive Protocol consumer。当前已经成为 npm
workspace package，实现 archive discovery、v1 manifest 校验、deterministic
`readArchivedTurn()`、authoritative artifact enumeration 和 Node.js 流式
`searchArchive()`，并已通过 `promptpile-archive` CLI 提供 `list / search / read` 闭环，以及固定 conversation directory 的 stdio MCP server。

运行时要求 Node.js 20 或更高版本。

产品方向：

- 核心实现保留可复用 TypeScript domain API；
- 主要用户入口采用 `promptpile-archive` CLI，使使用者无需编码即可完成历史检索；
- CLI 提供 `list` / `search` / `read`，并以 `mcp` 启动 Agent 集成面；
- `search` 返回 turn 级领域结果，不暴露 raw filesystem hit；
- MCP 作为 Agent 无编码集成面，提供 `list_archives` / `search_archive` / `read_archived_turn` 并复用同一 domain API；
- 不优先维护独立 generic tool surface。

核心原则：

- production code 只依据 Archive Protocol，不依赖 `promptpile-compress` 源码、
  `dist` 或私有类型；
- reader 不修改 archive、manifest、summary 或 archived artifacts；
- integration test 通过 producer 的公开 package API 创建 archive，再由本包读取，
  并验证读取前后 byte-for-byte 不变；
- v1 使用内置 Node.js 流式 literal scanner，不依赖外部搜索二进制；vector 能力保持独立。

```ts
import {
  discoverArchives,
  enumerateSearchableArtifacts,
  readArchivedTurn,
  searchArchive,
} from 'promptpile-compress-grep-search';

const archives = await discoverArchives(directory);
const searchable = await enumerateSearchableArtifacts(directory, {
  roles: ['assistant'],
});
const matches = await searchArchive(directory, {
  query: 'postgres migration',
  limit: 20,
});
const turn = await readArchivedTurn(directory, 12, {
  includeToolResults: true,
});
```

CLI：

```bash
promptpile-archive list -d ./session-conversation
promptpile-archive search -d ./session-conversation "postgres migration"
promptpile-archive read -d ./session-conversation 12
```

在 layered Conversation I/O 中，`-d` 应明确指向需要查询的单个 physical directory，通常是产生 archive 的 session output directory。本包不会跨 base/reference/output layers 联合发现 archive；切换目录必须由调用方显式完成。

三个命令均支持 `--json` machine envelope；search 还支持 `--limit`、可重复 `--role`、`--case-sensitive` 和 tool-result include/exclude flags。

MCP：

```bash
promptpile-archive mcp -d ./session-conversation
```

stdio server 只暴露三个 read-only tool：无参数的 `list_archives`、`search_archive` 和 `read_archived_turn`。conversation directory 在 server 启动时固定，不属于 tool input；tool 结果使用与 CLI 相同的 JSON success/failure envelope。MCP stdout 专用于协议帧，诊断信息只能写 stderr。

质量门：

```bash
npm test -w promptpile-compress-grep-search
npm run benchmark:check -w promptpile-compress-grep-search
npm run package:smoke -w promptpile-compress-grep-search
```

当前以 `0.1.0-beta.1` 公开预发布：实现、性能和隔离安装门已通过；Archive Protocol 仍处于演进期，继续通过真实使用与版本迁移演练验证兼容性。发布时使用 npm 的 `beta` dist-tag。

接口与 CLI 设计见 [`DESIGN.md`](./DESIGN.md)，实施进度见 [`TODO.md`](./TODO.md)。
