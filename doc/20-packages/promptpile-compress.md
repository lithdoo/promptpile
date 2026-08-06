# promptpile-compress

> 类型：package  
> 状态：experimental / private  
> 主要职责：conversation compression / archive commit / restore / recovery / semantic compaction  
> 最近复核：2026-08-06

`promptpile-compress` 独立处理 Promptpile conversation directory，当前 package 标记 `private: true`。它是 [Context Lifecycle System](../10-architecture/context-lifecycle-system.md) 中负责**有副作用 lifecycle mutation** 的实现，也是 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 当前 producer/restore implementation。

当前已经实现：

- turn-level scan 与 sliding-window selection；
- 默认 archive pointer 与显式注入的 semantic summary provider；
- semantic summary v1 schema、来源 idx、输入/输出预算及 timeout/error 校验；
- threshold / keepRecent / dry-run；
- staging → archive commit；
- `compression.json`；
- restore / recovery / recompress；
- cooperating-writer directory lock、same-host stale-lock recovery 与 conversation generation precondition；
- staging/archive-aware dry-run planning；
- mutation fault-injection 与 retry regression tests；
- 对应 filesystem regression tests。

默认模式仍生成不联网的 archive pointer。程序化 API 可显式注入 semantic provider，生成带 archived idx 来源的目标、事实、约束、决策、工具发现、进展和后续动作；CLI 不隐式读取 API key 或访问外部服务。历史 grep / vector retrieval **不属于本 package 的目标职责**。

程序化调用通过 `CompressOptions.summary` 注入 provider：

```ts
await compressDirectory({
  directory,
  summary: {
    kind: 'semantic',
    provider: { id: 'my-provider', summarize },
    maxInputTokens: 24_000,
    maxOutputTokens: 2_048,
    timeoutMs: 60_000,
  },
});
```

`summarize(request, signal)` 必须返回公开 `SemanticSummaryDocument` 结构；调用方负责模型选择、凭据和网络行为。

```text
P0 contract / public semantics
    ↓
P1 mutation safety / recoverability
    ↓
P2 semantic summary
    ↓
P3 context budget / performance
    ↓
P4 orchestrator integration / maturity
```

其中 P1 明确先于 semantic summary：先保护 authoritative conversation state，再扩大 provider/LLM 参与的 mutation surface。

`promptpile-compress` 不实现或拥有：

- grep/search engine；
- `lookup_archive` / `read_archived_turn` retrieval surface；
- embedding/vector index；
- query ranking；
- archive retrieval MCP server。

这些能力应作为 Archive Protocol consumer 独立实现。第一个计划 consumer 是 [promptpile-compress-grep-search](./promptpile-compress-grep-search.md)。

## Package 主动文档

Package 内只维护两份主动设计文档：

- [DESIGN.md](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress/DESIGN.md) — 当前职责、边界与已存在行为；
- [OPTIMIZATION_PLAN.md](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress/OPTIMIZATION_PLAN.md) — 尚未完成、按阶段验收的优化工作。

已完成 implementation plan、阶段性 status snapshot 和被取代设计不在 package 内保留副本；历史追溯使用 Git history。
