# promptpile-compress Live Trigger Recompression 实现草案

> Status: Implementation Draft / Superseding Design Candidate  
> Date: 2026-08-14  
> Target: `packages/promptpile-compress`  
> Primary API: `runCompressionBeforeCompletion()`  
> Manual API preserved: `compressDirectory()`

## 1. 结论

当前问题不是 archive / restore 本身错误，而是 **automatic orchestrator 复用了 manual compression 的 restore-first 语义**。

当前 `compressDirectoryWithLockHeld()` 的顺序是：

```text
recover
→ find archive
→ restore existing archive
→ scan restored Conversation
→ calculate tokensBefore
→ compare threshold
→ select
→ summarize
→ commit
```

因此 archive 一旦存在，`runCompressionBeforeCompletion()` 的 trigger 实际基于 restored original Conversation，而不是 Agent 当前真正使用的 compact live Conversation。

目标不是改变 fresh summary 的 source，而是把两个问题拆开：

```text
是否需要进入 recompression lifecycle？
→ 看 current live Conversation

真正 recompress 时总结什么？
→ 看 restored original Conversation
```

核心 invariant：

> **Live state decides when. Original state decides what.**

---

## 2. 当前实现为什么会重复 recompression

当前 orchestrator 的 plan 阶段：

```ts
const planned = await compressDirectory({
  ...options.compression,
  directory,
  dryRun: true,
  mutationHook: undefined,
});
```

这不是 live preflight，而是完整 compression lifecycle 的无副作用模拟。

存在 archive 时，dry-run 会：

```text
copy Conversation to temporary directory
→ recover
→ restore archive
→ scan restored original Conversation
→ calculate threshold / selection
```

随后 orchestrator 不论 plan 是 `below_threshold` 还是 `compressed`，仍进入：

```text
acquire filesystem lifecycle lock
→ compressDirectoryWithLockHeld()
→ release lock
→ completion
```

而实际 compress phase 又会先 restore archive，再计算 threshold。

因此典型生命周期变成：

```text
original 40k
→ trigger 32k
→ compress
→ live summary + recent ≈ 8k

next completion
→ dry-run restores original 40k in temp copy
→ plan says compression required
→ acquire lock
→ real restore original 40k
→ semantic provider
→ recompress
→ live ≈ 8k

next completion
→ repeat
```

这保证了 summary 不会 summary-of-summary，但 automatic trigger semantics 不正确。

---

## 3. 设计边界

### 3.1 保持不变

以下能力继续保持现有 ownership 与实现语义：

- Archive Protocol；
- reversible restore；
- staging recovery；
- filesystem lifecycle lock；
- generation precondition；
- semantic provider schema / timeout / sourceTurnIndices validation；
- sliding-window selection；
- archive commit；
- `compressDirectory()` 的显式 lifecycle 语义；
- completion 必须在 lifecycle lock release 后执行；
- 同一 resolved directory 的 orchestrator queue 继续覆盖 completion callback。

### 3.2 只改变 automated orchestration

`runCompressionBeforeCompletion()` 不再把 `compressDirectory(dryRun=true)` 当成 trigger planner。

它获得独立的 package-private **live inspection / gate**。

不要增加新的 public trigger API，不让 caller 理解 archive layout，也不把 lifecycle policy 上移到 Dayloom 或其他应用。

---

## 4. 状态模型

建议把 orchestrator 看到的目录状态显式归一为四类。

```ts
type LiveLifecycleState =
  | 'healthy_plain'
  | 'healthy_compacted'
  | 'recovery_required'
  | 'invalid';
```

### 4.1 `healthy_plain`

```text
no staging
no archive
normal top-level Conversation artifacts
```

这是从未压缩或已经显式 restore 后的正常状态。

### 4.2 `healthy_compacted`

```text
no staging
valid archive set
corresponding live summary artifact(s) present
normal newer live turns may follow
```

这是 compression 成功后的 **steady state**。

关键变化：

> healthy archive 不再等价于“下一次 automatic call 必须 restore”。

### 4.3 `recovery_required`

例如：

```text
.promptpile-compress.staging/ exists
```

且状态可由现有 recovery contract 唯一恢复。

这类状态不得因为 live tokens 低于 trigger 而跳过 recovery。

### 4.4 `invalid`

例如：

```text
staging + archive simultaneously exist
malformed compression.json
archive idx != max archivedTurnIndices
missing/ambiguous lifecycle metadata
archive/live-summary relationship invalid
```

必须 fail closed；不得直接进入 completion。

---

## 5. 新的内部抽象

不要给 `compressDirectoryWithLockHeld()` 增加一组难以推理的布尔参数，例如：

```text
skipRestore
alreadyRecovered
trustOuterPlan
forceCompression
```

更干净的实现是把 **inspection / normalization / compression execution** 分层。

### 5.1 `inspectLiveCompressionState()`

建议新增 package-private helper，位置可放在：

```text
src/compress/live-state.ts
```

或如果希望 lifecycle ownership 更集中：

```text
src/lifecycle/live-state.ts
```

建议返回：

```ts
interface LiveCompressionInspection {
  lifecycleState: LiveLifecycleState;
  liveTokens: number;
  triggerTokens: number;
  triggerReached: boolean;
  turns: Turn[];
  archives: Array<{
    idx: number;
    path: string;
  }>;
  recoveryRequired: boolean;
}
```

该 helper 只做 read-only 工作：

```text
resolve budget/tokenizer
→ inspect staging/archive shape
→ validate archive metadata needed to classify healthy vs invalid
→ scan current top-level live message artifacts
→ estimate current live tokens
→ return state
```

明确禁止：

```text
restore archive
invoke semantic provider
create staging
rename/unlink files
commit archive
```

### 5.2 复用 restore validation，而不是复制协议规则

当前 `restore/index.ts` 已经拥有：

```text
readCompressionMetadata()
prepareArchives()
duplicate idx/file validation
archive idx validation
```

这些规则不应在 live gate 中重新实现第二份。

建议提取 read-only archive inspection 到 package-private 模块，例如：

```text
src/restore/inspection.ts
```

提供：

```ts
inspectArchiveSet(directory)
```

由：

```text
restoreArchivedTurnsWithLockHeld()
inspectLiveCompressionState()
```

共同使用。

这样 archive validity 只有一个 source of truth。

### 5.3 `compressCurrentConversationWithLockHeld()`

当前 `compressDirectoryWithLockHeld()` 同时负责：

```text
recovery
restore
threshold
selection
summary
commit
```

建议把“当前顶层 Conversation 已经是待压缩 source”的部分抽出：

```ts
compressCurrentConversationWithLockHeld(...)
```

职责：

```text
capture generation
→ scan top-level turns
→ threshold / selection
→ generate summary
→ generation re-check
→ prepare staging
→ commit archive
```

它 **不负责主动 restore existing archive**。

然后 manual API 仍然组合成：

```text
compressDirectoryWithLockHeld()
→ recoverWithLockHeld()
→ restore existing archives if present
→ compressCurrentConversationWithLockHeld()
```

而 automatic orchestrator 则组合成另一条路径：

```text
live gate
→ only when triggered/recovery-needed enter exclusive lifecycle
→ recover if needed
→ re-inspect live state
→ restore only if live trigger is still reached
→ compressCurrentConversationWithLockHeld()
```

这样两个 public API 共享 compression engine，但不再错误共享 trigger semantics。

---

## 6. `runCompressionBeforeCompletion()` 目标算法

### 6.1 Outer serialized live gate

保持当前：

```text
serializeOrchestratorPhase(resolvedDirectory)
```

队列继续覆盖 lifecycle + completion callback。

然后执行：

```text
inspectLiveCompressionState(directory)
```

#### Case A: healthy + below trigger

```text
lifecycleState ∈ { healthy_plain, healthy_compacted }
liveTokens < triggerTokens
```

直接：

```text
report plan = below_threshold
commit = skipped
archive unchanged
provider not invoked
→ completion callback
```

不进入：

```text
compressDirectory(dryRun=true)
filesystem lifecycle lock
restore
staging
semantic provider
```

这是 steady-state fast path。

#### Case B: recovery required

进入 exclusive lifecycle。

不能因为：

```text
liveTokens < trigger
```

而直接 completion。

#### Case C: invalid

立即 fail closed，或者在 exclusive phase 内完成一次权威 validation 后 fail closed。

不得调用 completion。

#### Case D: live trigger reached

进入 exclusive lifecycle。

---

## 7. Exclusive phase：必须二次判断

Outer gate 不是 mutation authority。

正确流程：

```text
acquire filesystem lifecycle lock
→ inspect/recover/re-inspect under ownership
→ only then decide whether restore/mutation is allowed
```

建议逻辑：

```ts
withDirectoryLifecycleLock(directory, 'compress', async () => {
  // 1. recovery has priority
  const recoveryActions = await recoverWithLockHeld(directory, ...);

  // 2. recovery may change live files, so always re-inspect
  const current = await inspectLiveCompressionState(directory, ...);

  // 3. invalid state is fail-closed
  if (current.lifecycleState === 'invalid') {
    throw archiveStateInvalid();
  }

  // 4. stale outer trigger is allowed to collapse to no-op
  if (!current.triggerReached) {
    return skippedLiveResult(current, recoveryActions);
  }

  // 5. only now restore existing healthy archive
  if (current.lifecycleState === 'healthy_compacted') {
    await restoreArchivedTurnsWithLockHeld(...);
  }

  // 6. restored top-level Conversation is the authoritative original source
  return compressCurrentConversationWithLockHeld(...);
});
```

关键 invariant：

> 在 lock 内确认 current live trigger 之前，不允许 delete live summary / restore archive。

因此 stale outer plan 永远不能导致盲目 restore。

---

## 8. Recovery 后为什么必须重新 gate

假设外层看到：

```text
staging exists
live top-level tokens = 6k
```

进入 lock 后 recovery 可能把 staging 中的 original files 移回顶层，得到：

```text
recovered live tokens = 35k
```

此时应该继续 compression。

反过来 recovery 后也可能仍然：

```text
live tokens = 8k
```

此时 recovery 已完成，但不应为了“既然拿到 lock 了”继续 restore/recompress。

所以 recovery 与 trigger 的顺序应是：

```text
recover if required
→ re-scan live
→ re-evaluate trigger
→ decide restore/recompress
```

而不是：

```text
recover
→ unconditional restore
→ threshold
```

---

## 9. Trigger 与 fresh summary source 必须严格分离

Triggered recompression 的 source 继续保持当前 reversible archive 语义：

```text
archive(original 0..N)
+
live summary1
+
new original N+1..M

→ delete summary1
→ restore original 0..N
→ original 0..M
→ selection
→ semantic summary2
```

因此 provider 看到：

```text
original turns
```

而不是：

```text
previous semantic summary as a source turn
```

现有：

```text
normalizeArchive()
validateSemanticSummary()
sourceTurnIndices validation
```

全部继续沿用。

---

## 10. `compressDirectory()` 保持 restore-first

显式 API：

```ts
compressDirectory(...)
```

继续表达：

> 执行一次 compression lifecycle。

因此它可以继续：

```text
recover
→ restore existing archive
→ recompute from original Conversation
→ compress if current manual API rules require
```

不要把 live-gate semantics 下沉到 `compressDirectory()`，否则会改变 CLI / manual caller 的现有含义。

目标结构：

```text
public compressDirectory
  └── manual restore-first lifecycle

public runCompressionBeforeCompletion
  └── automatic live-trigger lifecycle

shared internal compression engine
  └── selection + summary + commit
```

这比在一个函数里堆 mode flags 更容易维护和测试。

---

## 11. Dry-run 语义重新定位

### 11.1 Manual `compressDirectory({ dryRun: true })`

保持现有语义：

```text
模拟 manual restore-first lifecycle
```

因此有 archive 时仍可在 temp copy 中：

```text
recover → restore → selection
```

不需要为 orchestrator 修改它。

### 11.2 Orchestrator 不再使用 manual dry-run 作为 trigger plan

`runCompressionBeforeCompletion()` 的 `estimate_plan` 改为 live inspection report。

因此：

```text
manual dry-run
!=
automatic live gate
```

两者语义明确分离。

如果 phase 名称需要保持兼容，可以继续叫：

```text
estimate_plan
```

但其内部含义改为：

```text
read-only live lifecycle inspection
```

如果 operation report 尚未冻结，也可更明确地重命名为：

```text
inspect_live
```

但不建议为了命名改动扩大 public report contract。

---

## 12. Report 语义

### 12.1 Healthy below-threshold fast path

报告必须描述 **current live Conversation**：

```text
plan.outcome = below_threshold
plan.budget.tokensBefore = current live token estimate
budget.tokensBefore = current live token estimate
selection.archivedTurnIndices = []
selection.keptTurnIndices = current live turn indices
commit.state = skipped
recoveryActions = []
semantic provider = not invoked
archive = unchanged
```

不要报告一个只存在于 temp simulation 中的 restored-original token count。

### 12.2 Triggered path

最终 report 描述真实 fresh recompression：

```text
recovery actions actually executed
restored original selection
actual summary token count
actual commit state
fresh summary idx
```

### 12.3 Outer trigger stale，lock 内降级 no-op

report 应以 **lock 内最终权威状态** 为准：

```text
commit.state = skipped
budget.tokensBefore = rechecked live token count
```

不能继续保留 outer stale plan 的“will compress”描述。

---

## 13. Generation / concurrency

### 13.1 Outer live inspection 不提供事务保证

它只回答：

> 现在看来是否值得进入 exclusive lifecycle？

不要把 outer scan hash 当作跨 writer CAS。

### 13.2 Lock 内重新 scan 是权威判断

只要进入 exclusive phase：

```text
recover if needed
→ re-inspect current live state
→ re-evaluate trigger
```

然后才允许 restore。

### 13.3 保持现有 generation precondition

一旦 restore 完成并开始基于 original Conversation 做 selection/summary，继续使用当前：

```text
captureConversationGeneration()
assertConversationGeneration()
```

保护：

```text
scan / summary
→ first staging mutation
```

之间的非 cooperating writer 变化。

### 13.4 不扩大跨进程 completion 保证

当前 filesystem lock 保护 lifecycle mutation，不覆盖 completion callback。

同进程通过 `serializeOrchestratorPhase()` 保证下一次 orchestrated lifecycle 不与 active completion 重叠；不遵守 orchestrator API 的外部 writer 继续属于现有能力边界。

本草案不宣称新增跨进程 completion transaction。

---

## 14. 建议增加一个“有效压缩”硬化 invariant

这是推荐项，不是 live-trigger 修复的前置条件，但能让状态机更容易证明。

成功 compression 最好保证：

```text
summaryTokens < archivedOriginalTokens
AND
tokensAfter < tokensBefore
```

更强的 automatic steady-state 条件可以要求：

```text
tokensAfter < triggerTokens
```

原因：

1. 防止 pathological summary 比被归档原文更大；
2. 保证 restore 不会因为替换 summary 而反向减少 token；
3. 让“live 达到 trigger → restored original 仍值得 compression”更接近可证明 invariant；
4. 避免刚 compress 完就仍处于 trigger 上方导致立即重压缩。

如果当前 budget/selection 无法生成有效 compact state，应 fail closed 为 budget/selection failure，而不是 commit 一个无法形成 steady state 的 archive。

该项可单独实现，不应阻塞 live-trigger 第一阶段修复。

---

## 15. 建议的代码重构范围

### `src/compress/index.ts`

拆出：

```text
compressCurrentConversationWithLockHeld()
```

保留：

```text
compressDirectoryWithLockHeld()
```

作为 manual restore-first wrapper。

重写：

```text
runCompressionBeforeCompletion()
```

使其使用 live inspection，而不是 `compressDirectory(dryRun=true)`。

### `src/restore/index.ts`

把 archive read-only validation 从 restore mutation 路径中抽离为共享 helper。

例如：

```text
inspectArchiveSet()
prepareArchivesForRestore()
```

其中前者无 mutation，后者可复用前者结果。

### 新增 `src/compress/live-state.ts`

负责：

```text
current live scan
live token estimate
archive/staging state classification
triggerReached
```

不要包含 summary generation 或 mutation。

### `src/compress/types.ts`

优先保持新增类型 package-private。

除非 operation report contract 必须表达新字段，否则不新增 public API surface。

---

## 16. 推荐实现顺序

### Phase 1 — 提取无副作用 inspection

- 提取 archive metadata validation；
- 新增 live lifecycle classification；
- 新增 live token gate 单元测试；
- 不改 public behavior。

### Phase 2 — 解耦 compression engine

- 提取 `compressCurrentConversationWithLockHeld()`；
- 保证 `compressDirectory()` 所有旧测试继续通过；
- manual dry-run 行为保持不变。

### Phase 3 — 切换 orchestrator trigger

- `runCompressionBeforeCompletion()` 改用 live gate；
- below-threshold healthy state 不再 acquire lifecycle lock；
- triggered/recovery state 才进入 exclusive phase；
- lock 内 re-inspect。

### Phase 4 — report / regression coverage

- 调整 orchestrator report；
- 新增 archive byte-for-byte steady-state test；
- 新增 semantic provider call-count test；
- 新增 stale outer trigger concurrency test。

### Phase 5 — optional effective-compaction hardening

- 增加 `summaryTokens < archivedOriginalTokens` / `tokensAfter < tokensBefore` 等 guard；
- 单独提交，避免和 trigger semantic 修复混成一个不可审查的大改动。

---

## 17. Acceptance tests

### 17.1 Live gate

```text
existing-archive-live-below-threshold-does-not-restore
existing-archive-live-below-threshold-does-not-acquire-exclusive-lifecycle
existing-archive-live-below-threshold-does-not-call-semantic-provider
existing-archive-live-below-threshold-preserves-conversation-byte-for-byte
existing-archive-live-below-threshold-preserves-archive-byte-for-byte
existing-archive-live-below-threshold-preserves-old-summary-byte-for-byte
existing-archive-live-below-threshold-enters-completion-directly
below-threshold-report-uses-live-token-count
```

### 17.2 Triggered recompression

```text
existing-archive-live-reaches-threshold-restores-original-history
recompression-deletes-old-live-summary-before-restoring-source-turns
recompression-provider-input-excludes-previous-summary
recompression-provider-input-includes-restored-original-turns
recompression-provider-called-exactly-once
recompression-commits-one-fresh-archive
recompression-completion-runs-after-lock-release
```

### 17.3 Recovery

```text
below-threshold-with-staging-enters-exclusive-recovery
recovery-rechecks-live-trigger-after-rollback
recovery-that-remains-below-threshold-skips-recompression
recovery-that-crosses-threshold-continues-to-recompression
archive-plus-staging-fails-closed-before-completion
invalid-archive-metadata-fails-closed-before-completion
```

### 17.4 Stale preflight / concurrency

```text
outer-live-trigger-is-rechecked-under-lock
outer-trigger-true-inner-trigger-false-does-not-restore
outer-trigger-false-healthy-state-does-not-enter-mutation
completion-never-runs-before-active-lifecycle-release
same-process-next-orchestrator-waits-for-active-completion
```

### 17.5 Manual API regression

```text
compressDirectory-existing-archive-still-restores-before-manual-recompress
compressDirectory-dry-run-existing-archive-still-simulates-restore
restoreArchivedTurns-contract-unchanged
archive-protocol-conformance-unchanged
```

---

## 18. 高价值端到端场景

使用 semantic provider call counter：

```text
1. original Conversation > trigger
2. runCompressionBeforeCompletion()
   → providerCalls = 1
   → fresh archive committed
   → compact live < trigger

3. snapshot:
   → live summary bytes
   → archive tree bytes

4. append 少量 new original turns
   → compact live still < trigger

5. runCompressionBeforeCompletion()
   → providerCalls still = 1
   → archive byte-for-byte unchanged
   → summary byte-for-byte unchanged
   → completion runs

6. repeat step 4/5 multiple times
   → no restore
   → no summary regeneration

7. append until current compact live >= trigger

8. runCompressionBeforeCompletion()
   → acquire lifecycle lock
   → inner live re-check still >= trigger
   → restore previous archive
   → old summary removed
   → provider receives original archived turns + newer original turns
   → providerCalls = 2
   → fresh summary + fresh archive committed
   → live returns below trigger
   → lock released
   → completion runs
```

这个场景完成后，automatic lifecycle 才真正闭环。

---

## 19. 不推荐的方案

### 19.1 Caller 先自己算 token

```text
Dayloom scans live
→ if threshold then call promptpile-compress
```

拒绝。

会把 archive / recovery / generation policy 泄漏到 caller，形成第二套 lifecycle ownership。

### 19.2 在旧 summary 上增量 summary

```text
summary1 + new turns → summary2
```

拒绝。

这解决 provider 成本，但破坏 original-source invariant，并引入 summary-of-summary drift。

### 19.3 仅在 orchestrator 外面加一个 token `if`

```text
outer scan < trigger → completion
outer scan >= trigger → existing compressDirectory()
```

不完整。

因为 outer scan 可能 stale；existing `compressDirectoryWithLockHeld()` 仍会 restore before inner trigger check。

必须有 lock 内 live re-check，并保证 restore 发生在该 re-check 之后。

### 19.4 给 `compressDirectoryWithLockHeld()` 堆 bypass flags

```text
skipRestore: true
skipRecovery: true
alreadyPlanned: true
```

不推荐。

这些 flag 很容易产生非法组合，使 lifecycle invariant 难以审查。

更好的方式是拆分单一职责的内部函数，然后由 manual / automatic 两个入口组合。

---

## 20. 完成定义

只有以下关系同时成立，才算完成：

```text
current live Conversation
→ 决定 automatic compression 是否触发

recovery state
→ 可以强制进入 exclusive lifecycle，但 recovery 后必须重新 gate

restored original Conversation
→ 决定 triggered recompression 的 fresh selection / semantic summary source

manual compressDirectory()
→ 继续保留 restore-first explicit lifecycle 语义
```

最终 steady-state 应是：

```text
healthy compact archive
+
live summary
+
recent/new turns

→ below trigger: zero mutation / zero provider call
→ reaches trigger: one restore + one fresh summary + one fresh archive commit
→ back to healthy compact state
```

核心原则：

> **Archive is durable source state, not an automatic trigger.**
>
> **Live state decides when; original state decides what.**

这使 `promptpile-compress` 同时保留：

- reversible original-source summarization；
- no summary-of-summary drift；
- recovery / lock / generation ownership；
- manual API 的显式 lifecycle；

并消除每轮 completion 重复 full restore + semantic summary 的结构性开销。