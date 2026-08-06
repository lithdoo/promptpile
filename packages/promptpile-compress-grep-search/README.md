# promptpile-compress-grep-search

> 状态：Archive reader foundation / private
> 类型：Archive Protocol read-only consumer  
> 最近复核：2026-08-06

这是一个独立、只读、协议驱动的 Archive Protocol consumer。当前已经成为 npm
workspace package，实现 archive discovery、v1 manifest 校验和 deterministic
`readArchivedTurn()`；下一阶段落地 grep search 与 CLI 产品面。

产品方向：

- 核心实现保留可复用 TypeScript domain API；
- 主要用户入口采用 `promptpile-archive` CLI，使使用者无需编码即可完成历史检索；
- CLI 第一版围绕 `list` / `search` / `read` 三个动作；
- `search` 返回 turn 级领域结果，不暴露 raw filesystem hit；
- MCP 在 search/CLI 稳定后作为 Agent 无编码集成面，并复用同一 domain API；
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
  readArchivedTurn,
} from 'promptpile-compress-grep-search';

const archives = await discoverArchives(directory);
const turn = await readArchivedTurn(directory, 12, {
  includeToolResults: true,
});
```

接口与 CLI 设计见 [`DESIGN.md`](./DESIGN.md)，实施进度见 [`TODO.md`](./TODO.md)。
