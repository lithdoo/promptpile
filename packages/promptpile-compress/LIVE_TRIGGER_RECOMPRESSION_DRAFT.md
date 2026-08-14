# promptpile-compress Live Trigger 重压缩草案

> Status: Design Draft / Upstream prerequisite  
> Date: 2026-08-14  
> Target: `promptpile-compress`  
> Affects: `runCompressionBeforeCompletion()`

## 1. 问题

当前 `promptpile-compress` 在存在 archive 时重新进入 compression，会先 restore 完整原历史，再计算 threshold。

这保证了 fresh summary 基于原始 Conversation，而不是基于旧 summary；但它也意味着一旦 Conversation 第一次越过 threshold，之后每次 automated completion 都可能出现：

```text
compact live Conversation
→ restore full original history
→ full history 仍超过 threshold
→ regenerate semantic summary
→ recompress
→ completion
```

因此第一次 compression 之后，即使 Agent 当前实际看到的 live Conversation 只有很小的 `semantic summary + recent turns`，下一次 completion 仍会重复 full restore + semantic summary。

这不是数据正确性问题，但不是理想的 automatic compression trigger semantics。

## 2. 目标语义

自动编排的 trigger 必须基于 **当前 live Conversation**；只有当前 live Conversation 再次达到 threshold 时，才 restore 完整原历史并生成 fresh summary。

冻结目标：

```text
trigger basis
= current live Conversation

summary source when triggered
= restored original Conversation
```

因此正常生命周期应为：

```text
第一次：
original history 40k
→ live >= 32k
→ compress
→ summary 2k + recent 6k
→ live ≈ 8k

后续：
live 8k → 12k → 18k → 25k → 30k
→ 每次都直接 completion
→ 不 restore
→ 不调用 semantic provider

再次：
live 33k
→ threshold reached
→ restore previous archive
→ delete previous live summary
→ full original history + all newer original turns
→ generate fresh semantic summary
→ recompress
→ live 再次降到 compact state
→ completion
```

## 3. 为什么不会 summary 套 summary

本草案并不要求在旧 summary 上继续 summary。

recompression 真正触发后仍使用现有 reversible archive 语义：

```text
archive(original turns 0..N)
+
live summary1
+
new original turns N+1..M

→ delete summary1
→ restore original turns 0..N
→ obtain original turns 0..M
→ semantic summarize original turns
→ summary2
```

因此：

```text
original history → summary1
original history + newer original turns → summary2
```

而不是：

```text
summary1 + newer turns → summary2
```

fresh summary 仍然具有原文 source indices，不引入 summary-of-summary 漂移。

## 4. Ownership

该语义属于 `promptpile-compress`，不是上层应用 policy。

```text
promptpile-compress
→ scan current live Conversation
→ 判断 automatic lifecycle 是否需要进入 recompression
→ restore / recovery
→ fresh selection / summary / archive commit
→ release lifecycle lock

caller (例如 Dayloom Core2)
→ 每次 completion 前调用 runCompressionBeforeCompletion()
→ 提供 threshold / tokenizer / summary provider
→ 不自行扫描 archive
→ 不自行决定 restore
```

上层不得为了规避当前行为而实现：

```text
scan live tokens
inspect archive layout
manual restore
manual compress
```

否则会形成第二套 lifecycle ownership。

## 5. `runCompressionBeforeCompletion()` 目标流程

自动 orchestrator 固定为两阶段判断。

### 5.1 Provider-free live gate

首先只观察当前 Conversation 顶层 live message artifacts，并识别 lifecycle state：

```text
serialize per resolved directory
→ inspect current live Conversation
→ estimate live tokens
→ inspect whether recovery is required
```

如果：

```text
live tokens < trigger
AND lifecycle state is healthy
```

则：

```text
不 restore existing archive
不调用 semantic provider
不创建 staging
不改变 Conversation bytes
→ 直接进入 completion callback
```

健康的 existing archive 是正常 compact state，不应仅因为 archive 存在而强制 recompress。

### 5.2 Triggered recompression

如果：

```text
live tokens >= trigger
```

则：

```text
acquire filesystem lifecycle lock
→ re-check live generation / trigger under ownership
→ recover staging if required
→ restore existing archive
→ remove previous live summary through restore lifecycle
→ scan full restored original Conversation
→ fresh selection
→ semantic summary exactly once
→ archive commit
→ release lock
→ completion callback
```

如果 lock 内重新检查发现 live state 已变化且不再需要 compression，应按最新状态 fail closed 或 no-op；不得根据 stale outer plan 盲目 restore。

## 6. Recovery 不能被 live gate 绕过

`below threshold` 只允许跳过**正常 recompression**，不能跳过必要 recovery。

例如存在：

```text
.promptpile-compress.staging/
ambiguous archive/staging state
invalid lifecycle metadata
```

时，orchestrator 必须进入既有 recovery / validation 边界或 fail closed。

不得因为当前顶层 live token 很小就直接 completion，从而永久忽略未完成 mutation。

健康 archive + 对应 live summary 则是正常 steady state，不属于 recovery-required。

## 7. `compressDirectory()` 与 orchestrator 的边界

本草案只要求改变 automated orchestrator 的 trigger semantics。

显式手动 API：

```ts
compressDirectory(...)
```

可以继续保持：

```text
显式调用 compress
→ restore existing archive
→ recompute from original history
→ recompress
```

因为显式 `compressDirectory()` 表达的是“执行一次 compression lifecycle”，而 `runCompressionBeforeCompletion()` 表达的是“在 completion 前按需维护 live context”。

不要为了统一两者而牺牲 automated caller 的 live-trigger 语义。

## 8. Report 语义

below-threshold fast path 的 `CompressionOperationReport` 应描述当前 live Conversation，而不是 restore 后的原始历史：

```text
plan.outcome = below_threshold
budget.tokensBefore = current live token estimate
commit.state = skipped
semantic provider = not invoked
archive = unchanged
```

triggered path 的最终 report 继续描述实际 fresh recompression 的 selection / budget / commit。

报告不得把未发生的 restore/recompression 表述为已执行。

## 9. Concurrency 与 generation

保持现有 per-directory orchestrator serialization 与 filesystem lifecycle lock。

live gate 只是 cheap preflight，不是 mutation authority：

```text
outer live gate
→ 决定是否值得进入 exclusive lifecycle

exclusive phase
→ 重新确认 conversation generation / lifecycle state
→ 才允许 restore / mutation
```

不得把 preflight token count 当成跨 writer 的事务保证。

## 10. Semantic summary 输入边界

本草案解决的是“何时重新 summary”，不是无限历史问题。

真正 trigger recompression 时，semantic summary 仍基于 restored original history。随着原始历史长期增长，summary request 也可能增长并最终超过 provider context capacity。

该情况继续：

```text
semantic provider rejects / exceeds budget
→ SUMMARY_PROVIDER_FAILED or budget failure
→ no new archive commit
→ caller fail closed
```

不要通过 summary-of-summary 来隐藏该问题；如果未来需要无限增长 Conversation，应单独设计 rolling/incremental compaction contract。

## 11. 非目标

本草案不增加：

- multi-level archive；
- rolling summary chain；
- retrieval tool；
- vector/grep search；
- background scheduler；
- caller-side archive inspection；
- new public trigger API；
- model context registry。

## 12. Acceptance tests

必须新增至少以下行为测试：

```text
live-trigger
------------
existing-archive-live-below-threshold-does-not-restore
existing-archive-live-below-threshold-does-not-call-semantic-provider
existing-archive-live-below-threshold-preserves-conversation-byte-for-byte
existing-archive-live-below-threshold-enters-completion-directly

recompression
-------------
existing-archive-live-reaches-threshold-restores-original-history
recompression-removes-old-live-summary-before-fresh-summary
recompression-provider-receives-original-turns-not-previous-summary
recompression-generates-semantic-summary-once
recompression-commits-one-fresh-archive

recovery
--------
below-threshold-with-staging-does-not-bypass-recovery
ambiguous-lifecycle-state-fails-closed-before-completion

report
------
below-threshold-report-uses-live-token-count
below-threshold-report-marks-commit-skipped
triggered-report-describes-fresh-recompression

concurrency
-----------
live-gate-is-rechecked-before-exclusive-mutation
completion-never-overlaps-active-lifecycle-mutation
```

高价值回归场景：

```text
1. 创建 > threshold 的 original Conversation。
2. 第一次 runCompressionBeforeCompletion() → compressed。
3. append 少量新 turns，使 compact live 仍 < threshold。
4. 第二次 runCompressionBeforeCompletion()：
   - archive byte-for-byte unchanged；
   - old summary unchanged；
   - semantic provider call count 不增加；
   - completion 正常执行。
5. 继续 append 直到 compact live >= threshold。
6. 下一次调用：
   - restore original history；
   - provider 输入不含旧 summary 作为 source turn；
   - fresh summary + fresh archive committed；
   - completion 在 lock release 后执行。
```

## 13. 完成定义

只有满足以下关系，automatic recompression 才算闭环：

```text
current compact live history
→ 决定何时需要再次 compression

restored original history
→ 决定再次 compression 时总结什么
```

核心原则：

> **Live state 决定 trigger，original state 决定 fresh summary。**

这样既避免每轮重复 full-history summarization，也避免 summary-of-summary 漂移，同时保持 archive / restore ownership 完整留在 `promptpile-compress`。