# promptpile-compress

> 类型：package  
> 状态：experimental / private  
> 主要职责：conversation compression / archive commit / restore / recovery  
> 最近复核：2026-08-05

`promptpile-compress` 独立处理 Promptpile conversation directory，当前 package 标记 `private: true`。它是 [Context Lifecycle System](../10-architecture/context-lifecycle-system.md) 中负责**有副作用 lifecycle mutation** 的实现，也是 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 当前 producer/restore implementation。

当前已经实现：

- turn-level scan 与 sliding-window selection；
- threshold / dry-run；
- staging → archive commit；
- `compression.json`；
- restore / recovery / recompress；
- 对应 filesystem regression tests。

当前尚未完成真正的语义 summary；默认 sliding-window summary 只是 archive pointer。历史 grep / vector retrieval **不再属于本 package 的目标职责**。

`promptpile-compress` 不应实现或拥有：

- grep/search engine；
- embedding/vector index；
- query ranking；
- archive retrieval MCP server。

这些能力应作为 Archive Protocol consumer 独立实现。第一个计划 consumer 是 [promptpile-compress-grep-search](./promptpile-compress-grep-search.md)。

Package 内当前设计与代办：

- [DESIGN.md](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress/DESIGN.md)
- [CURRENT_IMPLEMENTATION_ASSESSMENT.md](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress/CURRENT_IMPLEMENTATION_ASSESSMENT.md)
- [TODO.md](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress/TODO.md)
