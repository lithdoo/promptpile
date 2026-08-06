# promptpile-compress

> 类型：package  
> 状态：experimental / private  
> 主要职责：conversation compression / archive commit / restore / recovery / semantic compaction  
> 最近复核：2026-08-06

`promptpile-compress` 独立处理 Promptpile conversation directory，当前 package 标记 `private: true`。它是 [Context Lifecycle System](../10-architecture/context-lifecycle-system.md) 中负责**有副作用 lifecycle mutation** 的实现，也是 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 当前 producer/restore implementation。

当前已经实现：

- turn-level scan 与 sliding-window selection；
- threshold / keepRecent / dry-run；
- staging → archive commit；
- `compression.json`；
- restore / recovery / recompress；
- cooperating-writer directory lock、same-host stale-lock recovery 与 conversation generation precondition；
- staging/archive-aware dry-run planning；
- mutation fault-injection 与 retry regression tests；
- 对应 filesystem regression tests。

当前尚未完成真正的 semantic summary；默认 sliding-window summary 仍只是 archive pointer。下一阶段按严格顺序推进：

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
