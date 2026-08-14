# promptpile-compress Live Trigger 重压缩草案

> Status: **Superseded**  
> Date: 2026-08-14  
> Target: `promptpile-compress`  
> Affects: `runCompressionBeforeCompletion()`  
> Superseded by: [`LIVE_TRIGGER_RECOMPRESSION_IMPLEMENTATION.md`](./LIVE_TRIGGER_RECOMPRESSION_IMPLEMENTATION.md)

本文件是 live-trigger recompression 的初始方向草案，已被冻结实施契约取代，不再作为实现或验收依据。

当前唯一实施 source of truth：

```text
LIVE_TRIGGER_RECOMPRESSION_IMPLEMENTATION.md
Status: Implemented and Accepted
```

冻结契约已经明确并取代本草案中尚未定死的事项，包括：

- exhaustive lifecycle state machine；
- valid archive + missing live summary 的 recoverable incomplete-commit 语义；
- current live Conversation 的精确 token / trigger 口径；
- outer inspection 的 skip-only authority；
- filesystem lock 内 authoritative validation / recovery normalization / re-gate；
- healthy archive 只有在 inner trigger confirmation 后才允许 restore；
- `compressDirectory()` manual restore-first 与 automatic live-trigger 的内部职责拆分；
- operation report 的逐路径语义；
- deterministic stale-preflight concurrency test seam；
- compatibility 与 acceptance test gate。

初始草案的完整历史内容保留在 Git 历史中。后续实现、review、测试与 `DESIGN.md` 更新均应以冻结实施契约为准。
