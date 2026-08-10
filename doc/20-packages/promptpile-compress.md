# promptpile-compress

> 类型：package  
> 状态：Beta
> 主要职责：conversation compression / archive commit / restore / recovery / semantic compaction  
> 最近复核：2026-08-10

`promptpile-compress` 独立处理 Promptpile conversation directory，当前以 `0.1.0-beta.0` 公开预发布。它是 [Context Lifecycle System](../10-architecture/context-lifecycle-system.md) 中负责**有副作用 lifecycle mutation** 的实现，也是 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 当前 producer/restore implementation。

Layered Conversation I/O 中只把 session output directory 交给 Compress/Restore。base/reference 输入层不参与同一个压缩事务；archive、summary、staging、lock 和 recovery 全部保持在 output directory 内。回归测试验证 compress → restore 后 output byte-for-byte 恢复，同时只读 base layer 不变。

当前已经实现：

- turn-level scan 与 sliding-window selection；
- 默认 archive pointer 与显式注入的 semantic summary provider；
- semantic summary v1 schema、来源 idx、输入/输出预算及 timeout/error 校验；
- context budget、兼容 threshold、keepRecent、dry-run 与结构化预算报告；
- 显式 heuristic fallback 与可选 tiktoken adapter；
- staging → archive commit；
- `compression.json`；
- restore / recovery / recompress；
- cooperating-writer directory lock、same-host stale-lock recovery 与 conversation generation precondition；
- staging/archive-aware dry-run planning；
- mutation fault-injection 与 retry regression tests；
- 对应 filesystem regression tests。
- `runCompressionBeforeCompletion` orchestrator queue 与脱敏 operation report；
- Node 18/22 × Windows/Linux filesystem CI；
- 独立 Archive Protocol reader 的跨 package integration test。

默认模式仍生成不联网的 archive pointer。程序化 API 可显式注入 semantic provider，生成带 archived idx 来源的目标、事实、约束、决策、工具发现、进展和后续动作；CLI 不隐式读取 API key 或访问外部服务。历史 grep / vector retrieval **不属于本 package 的目标职责**。

程序化调用通过 `CompressOptions.summary` 注入 provider：

```ts
await compressDirectory({
  directory,
  budget: {
    modelContextTokens: 128_000,
    reservedOutputTokens: 8_000,
    systemToolOverheadTokens: 2_000,
    targetLiveHistoryTokens: 32_000,
    summaryOutputTokens: 2_048,
    safetyMarginTokens: 4_000,
  },
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

默认 tokenizer 是明确标记为 fallback 的 `heuristicTokenizer`。需要按模型精确计数时使用 `await createTiktokenTokenizer(model)`，并在完成后调用 `dispose()`。`CompressResult.budget` 解释 trigger、压缩前 tokens、kept history、summary、固定开销、completion 预留、safety margin、总计划占用与剩余 context；`summaryTokenBasis` 区分真实执行的 `actual` 与 dry-run 的保守 `upper-bound`。旧 `threshold` 仍可单独使用，但不能和 `budget` 组合。

Orchestrator 应调用 `runCompressionBeforeCompletion({ compression, completion })`。它按目录串行 plan → acquire → compress → release → completion：plan 只计算待归档 selection 并使用 summary token 上限，不调用 semantic provider；provider 仅在实际 compress phase 调用一次。返回的 `CompressionOperationReport` 包含 phase、recovery、selection、budget、commit 与稳定错误码，不记录 conversation 正文或 provider 原始错误。

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
