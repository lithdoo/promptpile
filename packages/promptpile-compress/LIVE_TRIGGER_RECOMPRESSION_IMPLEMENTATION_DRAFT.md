# promptpile-compress Live Trigger Recompression 冻结实施契约

> Status: **Frozen Implementation Contract**  
> Date: 2026-08-14  
> Target: `packages/promptpile-compress`  
> Primary API: `runCompressionBeforeCompletion()`  
> Manual API preserved: `compressDirectory()`  
> Supersedes: `LIVE_TRIGGER_RECOMPRESSION_DRAFT.md`  
> Change policy: 实施过程中如需改变本文的状态机、触发语义、恢复语义、锁边界或 report 语义，必须先修改本文并重新评审，不能在代码中隐式改变。

## 1. 冻结结论

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

本次修改只拆开两个问题：

```text
是否需要进入 automatic recompression？
→ 看 current live Conversation

真正 recompress 时总结什么？
→ 看 restored original Conversation
```

冻结 invariant：

> **Live state decides when. Original state decides what.**
>
> **Archive is durable source state, not an automatic trigger.**

---

## 2. 本次范围

### 2.1 必须改变

只改变 `runCompressionBeforeCompletion()` 的 automatic orchestration semantics：

```text
healthy live below trigger
→ zero restore
→ zero provider call
→ zero archive mutation
→ completion

healthy live reaches trigger
→ exclusive re-check
→ restore original if compacted
→ fresh selection
→ fresh summary exactly once
→ fresh archive commit
→ completion after lock release
```

### 2.2 必须保持

以下 ownership 与 contract 不变：

- Archive Protocol v1；
- Conversation Protocol v1；
- reversible restore；
- staging recovery；
- filesystem lifecycle lock；
- generation precondition；
- semantic provider schema / timeout / `sourceTurnIndices` validation；
- sliding-window selection；
- archive commit layout；
- `compressDirectory()` 的显式 restore-first lifecycle 语义；
- manual `compressDirectory({ dryRun: true })` 的 restore-aware simulation；
- completion 必须在 lifecycle lock release 后执行；
- 同一 resolved directory 的 orchestrator queue 继续覆盖 completion callback。

### 2.3 非目标

本次不增加：

- summary-of-summary；
- rolling / incremental summary chain；
- multi-level archive；
- retrieval / grep / vector search；
- background scheduler；
- caller-side archive inspection；
- new public trigger API；
- model context registry；
- cross-process completion transaction；
- effective-compaction 新硬约束。

`summaryTokens < archivedOriginalTokens`、`tokensAfter < tokensBefore`、`tokensAfter < triggerTokens` 属于后续 hardening，不属于本冻结实施契约的 acceptance gate。

---

## 3. 当前问题的可验证路径

当前 orchestrator 的 plan 阶段调用：

```ts
const planned = await compressDirectory({
  ...options.compression,
  directory,
  dryRun: true,
  mutationHook: undefined,
});
```

这不是 live preflight，而是 manual compression lifecycle 的无副作用模拟。

存在 archive 时，dry-run 会：

```text
copy Conversation to temporary directory
→ recover
→ restore archive
→ scan restored original Conversation
→ calculate threshold / selection
```

随后 orchestrator 不论 plan 是否最终需要 mutation，仍进入 filesystem lifecycle lock 和真实 `compressDirectoryWithLockHeld()`；真实路径又先 restore archive 再计算 threshold。

因此典型循环是：

```text
original 40k
→ trigger 32k
→ compress
→ live summary + recent ≈ 8k

next completion
→ plan restores original 40k in temp copy
→ exclusive phase restores original 40k again
→ semantic provider
→ recompress
→ live ≈ 8k

next completion
→ repeat
```

本次冻结的目标是消除这个 automatic steady-state 循环，同时继续保证 fresh summary 来自 original turns。

---

## 4. 术语与精确 token 口径

### 4.1 Live Conversation

本文中的 current live Conversation 只指调用方传入的 resolved directory 顶层、由 Conversation Protocol scanner 识别的 message artifacts。

冻结定义：

```text
liveTurns
= scanTurns(resolvedDirectory, resolvedTokenizer)

liveTokens
= estimateTotalTokens(liveTurns)

triggerTokens
= resolveContextBudget(options).triggerTokens

triggerReached
= liveTokens >= triggerTokens
```

必须满足：

- archive 内 archived message artifacts **不计入** `liveTokens`；
- staging 内 artifacts **不计入** `liveTokens`，staging 只影响 lifecycle classification；
- 顶层 compact `[N]system.md` summary **计入** `liveTokens`；
- 顶层 recent/new original turns **计入** `liveTokens`；
- 顶层 system turns 与当前 `scanTurns()` 规则一致计入；
- outer inspection 与 lock 内 authoritative inspection 使用同一 resolved budget 和同一 tokenizer adapter；
- trigger 比较固定使用 `>=`。

### 4.2 Original Conversation

original Conversation 指通过现有 reversible restore lifecycle 恢复 archive 后，顶层可被 `scanTurns()` 读取的原始 Conversation artifacts，加上 compression 以后新增的 original live turns。

Triggered recompression 的 semantic provider source 必须来自该状态，而不是旧 live summary。

---

## 5. Exhaustive lifecycle state machine

Orchestrator 的 read-only inspection 必须把目录归一为以下四类，不允许新增隐式第五类：

```ts
type LiveLifecycleState =
  | 'healthy_plain'
  | 'healthy_compacted'
  | 'recovery_required'
  | 'invalid';
```

### 5.1 判定优先级

分类必须按以下优先级执行：

```text
1. staging/archive structural conflict
2. archive validity
3. archive/live-summary completeness
4. plain vs compact healthy state
```

后面的规则不能覆盖前面已经判定的 invalid/recovery 状态。

### 5.2 状态表

| staging | archive set | archive metadata | corresponding live summary | state | authoritative action |
|---|---|---|---|---|---|
| no | none | — | — | `healthy_plain` | live gate |
| no | present | valid | complete | `healthy_compacted` | live gate |
| yes | none | — | — | `recovery_required` | lock → rollback staging → re-inspect |
| yes | present | any | any | `invalid` | lock → authoritative validation → fail closed |
| no | present | invalid | any | `invalid` | lock → authoritative validation → fail closed |
| no | present | valid | missing/partial | `recovery_required` | lock → restore incomplete committed archive → re-inspect |

### 5.3 `healthy_plain`

```text
no staging
no archive
normal top-level Conversation artifacts
```

这是从未压缩、或显式 restore 后的正常状态。

### 5.4 `healthy_compacted`

```text
no staging
valid archive set
每个 archive 都存在对应顶层 [N]system.md
normal newer live turns may follow
```

这是 compression 成功后的正常 **steady state**。

冻结语义：

> healthy archive 不等价于“下一次 automatic call 必须 restore”。

### 5.5 `recovery_required`: staging-only

```text
.promptpile-compress.staging/ exists
no committed archive
```

必须进入 exclusive lifecycle，调用现有 staging recovery，然后重新 inspection / gate。

### 5.6 `recovery_required`: valid archive but missing live summary

冻结决定：

```text
valid [N]system.md.archive/
missing corresponding [N]system.md
```

属于 **recoverable incomplete commit**，不是 archive corruption。

原因：现有 commit 顺序是：

```text
rename staging → committed archive
→ write live summary
```

进程可在两步之间崩溃；同时 Archive Protocol 的 authoritative historical state 在 archive 中，顶层 summary 不是 archive 的 authoritative message source。

恢复动作固定为：

```text
acquire lifecycle lock
→ restore valid archive set to original Conversation
→ re-inspect
→ re-evaluate live trigger
```

不得尝试从 archive 内 `.summary.md` 直接补写顶层 summary 来猜测完成 commit；恢复统一回到 original Conversation，再按当前 trigger 决定是否重新压缩。

### 5.7 `invalid`

至少包括：

```text
staging + archive simultaneously exist
malformed / unsupported compression.json
archive idx != max archivedTurnIndices
duplicate archived idx across archive set
duplicate archived message file across archive set
restore target conflict
archive set cannot be uniquely interpreted
```

Invalid state 必须 fail closed；不得调用 completion。

---

## 6. Outer inspection 的 authority 冻结

Outer inspection 运行在现有：

```text
serializeOrchestratorPhase(resolvedDirectory)
```

内部，但不持有 filesystem lifecycle lock。

### 6.1 Outer inspection 唯一拥有的直接决定权

只有下面一个条件允许不进入 filesystem lifecycle：

```text
lifecycleState ∈ { healthy_plain, healthy_compacted }
AND
liveTokens < triggerTokens
```

此时：

```text
→ below-threshold fast path
→ completion
```

### 6.2 其他所有状态必须进入 exclusive phase

以下状态一律进入 filesystem lifecycle lock：

```text
healthy + trigger reached
recovery_required
invalid-looking outer state
```

Outer inspection 对 invalid 只有“值得进入权威校验”的提示权，不拥有最终 corruption authority。

冻结原则：

> **Outer gate has skip authority only. It has no mutation authority and no final invalid-state authority.**

这样可以避免 outer read 与另一个 cooperating lifecycle writer 的临界状态造成假 corruption 判断。

---

## 7. 共享 read-only archive inspection

当前 archive validation 规则主要位于 restore mutation 路径，不应在 live gate 中复制第二份。

冻结新增 package-private 模块：

```text
src/restore/inspection.ts
```

负责 read-only：

```ts
inspectArchiveSet(directory)
```

它必须成为以下规则的唯一 source of truth：

- `compression.json` version；
- `archivedTurnIndices` 非空 / 非负整数 / 无重复；
- archive idx 与 max archived idx 一致；
- 跨 archive duplicate idx；
- 跨 archive duplicate message file；
- restore target conflict 检查所需的 read-only 信息；
- archive 对应 summary idx 信息。

现有 restore 路径和新的 live-state inspection 必须共同使用它。

不得在 `src/compress/live-state.ts` 重新手写一套 archive protocol validator。

---

## 8. Live inspection 模块冻结

冻结新增：

```text
src/compress/live-state.ts
```

package-private API：

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
    summaryPresent: boolean;
  }>;
  recoveryRequired: boolean;
}

inspectLiveCompressionState(...): Promise<LiveCompressionInspection>
```

职责固定为：

```text
resolve/receive already-resolved budget + tokenizer
→ inspect staging/archive shape
→ call shared inspectArchiveSet()
→ inspect corresponding top-level summary presence
→ scan current top-level live message artifacts
→ estimate live tokens
→ classify lifecycle state
→ return inspection
```

明确禁止：

```text
restore archive
invoke semantic provider
create/remove staging
rename/unlink files
commit archive
```

该 helper 必须保持 read-only。

---

## 9. Compression engine 解耦冻结

当前 `compressDirectoryWithLockHeld()` 同时承担 recovery、restore、threshold、selection、summary、commit。

冻结提取：

```text
src/compress/index.ts

compressCurrentConversationWithLockHeld()
```

### 9.1 `compressCurrentConversationWithLockHeld()` 职责

前置条件：

> 当前顶层 Conversation 已经是本次 compression 的 authoritative source state。

职责：

```text
capture generation
→ scan top-level turns
→ calculate threshold / selection
→ generate summary if selected
→ generation re-check
→ prepare staging
→ commit archive
```

它不负责：

```text
recovery
restore existing archive
automatic outer gate
```

### 9.2 Manual wrapper 保持

`compressDirectoryWithLockHeld()` 继续表达 manual restore-first lifecycle：

```text
recoverWithLockHeld()
→ restore existing archives if present
→ compressCurrentConversationWithLockHeld()
```

因此 `compressDirectory()` / CLI 的现有显式语义保持不变。

---

## 10. Exclusive lifecycle normalization

Automatic orchestrator 进入 filesystem lock 后，必须执行以下固定算法。

伪代码为规范性描述：

```ts
withDirectoryLifecycleLock(directory, 'compress', async () => {
  let current = await inspectLiveCompressionState(directory, resolved);

  // 1. authoritative invalid check
  if (current.lifecycleState === 'invalid') {
    throw archiveStateInvalid();
  }

  // 2. normalize recoverable staging state
  if (hasStagingOnly(current)) {
    recoveryActions.push(
      ...(await recoverWithLockHeld(directory, ...))
    );
    current = await inspectLiveCompressionState(directory, resolved);
  }

  // 3. normalize incomplete committed archive
  if (hasValidArchiveMissingSummary(current)) {
    const restored = await restoreArchivedTurnsWithLockHeld(...);
    archivesRestored += restored.archivesRestored ?? 0;
    current = await inspectLiveCompressionState(directory, resolved);
  }

  // 4. normalization must converge to a healthy state
  if (
    current.lifecycleState !== 'healthy_plain' &&
    current.lifecycleState !== 'healthy_compacted'
  ) {
    throw archiveStateInvalid();
  }

  // 5. trigger is authoritative only after normalization
  if (!current.triggerReached) {
    return skippedLiveResult(current, recoveryActions, archivesRestored);
  }

  // 6. restore source only after authoritative trigger check
  if (current.lifecycleState === 'healthy_compacted') {
    const restored = await restoreArchivedTurnsWithLockHeld(...);
    archivesRestored += restored.archivesRestored ?? 0;
  }

  // 7. restored/current plain top-level Conversation is source
  return compressCurrentConversationWithLockHeld(...);
});
```

关键 invariant：

> **在 lock 内完成 recovery normalization 并确认 current live trigger 之前，不允许为了正常 recompression 删除 live summary / restore healthy archive。**

因此 stale outer plan 永远不能导致盲目 restore。

---

## 11. Recovery 后必须重新 gate

Recovery 是 state normalization，不是 compression trigger。

### 11.1 staging rollback 后

```text
outer:
staging exists
live top-level = 6k

exclusive:
rollback staging
→ recovered top-level = 35k
→ re-gate
→ trigger reached
→ compress
```

也可能：

```text
rollback staging
→ recovered top-level = 8k
→ re-gate
→ below trigger
→ no recompression
→ completion
```

### 11.2 incomplete archive restore 后

```text
archive valid
summary missing
→ restore original
→ re-gate original top-level
```

如果 restored original 达到 trigger，则重新压缩；否则保留 plain original Conversation 并进入 completion。

不得因为“已经拿到 lock / 已执行 recovery”而强制继续 compression。

---

## 12. Trigger 与 fresh summary source 严格分离

Triggered recompression source 继续使用当前 reversible archive 语义：

```text
archive(original 0..N)
+
live summary1
+
new original N+1..M

→ authoritative live trigger reached
→ delete summary1 through restore lifecycle
→ restore original 0..N
→ obtain original 0..M
→ fresh selection
→ semantic summary2
```

Provider 必须看到：

```text
original archived turns + newer original turns selected for summary
```

不得把旧 `[N]system.md` semantic summary 作为 source turn 交给 provider。

现有：

```text
normalizeArchive()
validateSemanticSummary()
sourceTurnIndices validation
```

全部继续沿用。

---

## 13. `compressDirectory()` 与 automatic orchestrator 的 API 边界

### 13.1 Manual API

```ts
compressDirectory(...)
```

语义保持：

> 显式执行一次 compression lifecycle。

因此已有 archive 时可以继续：

```text
recover
→ restore original
→ recompute threshold / selection
→ recompress or return manual skip result
```

### 13.2 Automatic API

```ts
runCompressionBeforeCompletion(...)
```

语义冻结为：

> 在 completion 前维护 live context；只有 current live Conversation 达到 trigger，或目录需要 lifecycle recovery/validation 时，才进入 exclusive lifecycle。

### 13.3 目标结构

```text
public compressDirectory
  └── manual restore-first lifecycle

public runCompressionBeforeCompletion
  └── automatic live-trigger lifecycle

shared package-private engine
  └── compressCurrentConversationWithLockHeld
```

不得通过以下 mode flags 模拟该边界：

```text
skipRestore
skipRecovery
alreadyPlanned
trustOuterPlan
forceCompression
```

---

## 14. Dry-run 语义冻结

### 14.1 Manual dry-run

```ts
compressDirectory({ dryRun: true })
```

保持现有含义：

```text
模拟 manual restore-first lifecycle
```

存在 staging/archive 时仍可在 temp copy 中：

```text
recover → restore → selection
```

### 14.2 Automatic orchestrator

`runCompressionBeforeCompletion()` 不再调用 manual dry-run 作为 trigger planner。

其 `estimate_plan` phase 内部改为：

```text
read-only live inspection
```

Phase 名称继续保留 `estimate_plan`，避免无必要扩大 public report contract。

冻结关系：

```text
manual dry-run != automatic live gate
```

---

## 15. Operation report 冻结语义

现有 public report phase 名称保持：

```text
estimate_plan
acquire_exclusive
compress
release_exclusive
completion
```

未执行 phase 必须显式记录 `status: 'skipped'`，使不同路径具有稳定可审计结构。

### 15.1 Public report additive field

`CompressionOperationReport` 增加：

```ts
archivesRestored: number;
```

这是 additive observability field，用来区分：

```text
recovery/restore mutation happened
但 fresh compression commit 未发生
```

默认值为 `0`。

`CompressResult.archivesRestored` 继续保留并与真实执行一致。

### 15.2 Healthy below-threshold fast path

Phase：

```text
estimate_plan       completed
acquire_exclusive   skipped
compress            skipped
release_exclusive   skipped
completion          completed | failed
```

返回真实 `CompressResult`：

```text
compressed = false
skipReason = below_threshold
turnsArchived = 0
turnsKept = current live turn count
tokensBefore = current liveTokens
tokensAfter = current liveTokens
archivesRestored = 0
recoveryActions = []
selection.archivedTurnIndices = []
selection.keptTurnIndices = current live turn indices
budget.tokensBefore = current liveTokens
```

Report：

```text
plan.outcome = below_threshold
plan.budget.tokensBefore = current liveTokens
budget.tokensBefore = current liveTokens
commit.state = skipped
archivesRestored = 0
```

Archive、summary、Conversation bytes 必须完全不变。

### 15.3 Healthy outer trigger reached

Outer plan 仍沿用现有 `plan.outcome = compressed` 枚举值，语义冻结为：

> outer live gate 观察到需要进入 compression path；它不表示已经 commit。

Outer plan 的 `budget.tokensBefore` 必须使用 current live token count。

最终 `report.budget`、`report.selection`、`commit` 以 lock 内实际执行结果为准。

### 15.4 Outer trigger stale，inner below threshold

Phase：

```text
estimate_plan       completed
acquire_exclusive   completed
compress            skipped
release_exclusive   completed
completion          completed | failed
```

最终 report 必须覆盖 stale outer execution expectation：

```text
commit.state = skipped
budget.tokensBefore = inner authoritative liveTokens
selection = inner authoritative live selection
archivesRestored = recovery 中真实发生的数量
```

不得 restore healthy archive。

### 15.5 Recovery required，恢复后 below threshold

Phase：

```text
estimate_plan       completed
acquire_exclusive   completed
compress            skipped
release_exclusive   completed
completion          completed | failed
```

Report 必须记录：

```text
recoveryActions = actually executed staging recovery actions
archivesRestored = actually restored incomplete archives
commit.state = skipped
budget.tokensBefore = post-recovery authoritative live token count
```

### 15.6 Triggered recompression

Phase：

```text
estimate_plan       completed
acquire_exclusive   completed
compress            completed
release_exclusive   completed
completion          completed | failed
```

最终 report 描述真实 fresh recompression：

```text
recoveryActions = actual
archivesRestored = actual
selection = restored-original selection
budget = actual summary token basis
commit.state = committed
commit.summaryIdx = fresh summary idx
```

### 15.7 Invalid lifecycle

Completion 不得执行。

如果 outer inspection 观察到 invalid-looking state，仍进入 lock 做一次 authoritative inspection；确认 invalid 后：

```text
estimate_plan       completed
acquire_exclusive   completed
compress            failed
release_exclusive   completed
completion          skipped
```

Error：

```text
code = ARCHIVE_STATE_INVALID
```

不得暴露 conversation content 或原始 provider/error payload。

---

## 16. Generation / concurrency 冻结

### 16.1 Outer gate 不是事务保证

Outer inspection 只回答：

> 当前看来是否可以安全直接 skip lifecycle？

它不是 CAS，也不是跨 writer transaction。

### 16.2 Lock 内 inspection 是 automatic lifecycle 的权威 trigger 判断

只要 outer 不能直接走 healthy-below-threshold fast path，就必须：

```text
acquire lock
→ authoritative inspect / normalize recovery
→ re-evaluate trigger
→ only then restore healthy archive or mutate
```

### 16.3 Generation precondition 保持

一旦 original/current plain Conversation 成为 compression source，继续使用当前：

```text
captureConversationGeneration()
assertConversationGeneration()
```

保护：

```text
scan / semantic provider
→ first staging mutation
```

之间的 non-cooperating writer 变化。

### 16.4 Completion 边界保持

Filesystem lifecycle lock 不覆盖 completion callback。

必须：

```text
release lifecycle lock
→ completion callback
```

同进程 `serializeOrchestratorPhase()` 继续覆盖 completion 完成，因此下一次 orchestrated lifecycle 不与 active completion 重叠。

本次不新增跨进程 completion transaction。

---

## 17. Deterministic stale-preflight 测试 seam

为避免 TOCTOU 测试依赖 timing，冻结允许新增 package-private internal wrapper：

```ts
runCompressionBeforeCompletionInternal(options, hooks?)
```

其中 test-only/package-private hook 至少允许：

```ts
interface CompressionOrchestratorTestHooks {
  afterOuterInspection?: (
    inspection: LiveCompressionInspection
  ) => Promise<void>;
}
```

Public API：

```ts
runCompressionBeforeCompletion(options)
```

只调用 internal wrapper，不暴露 hook。

该 seam 只用于 deterministic 测试：

```text
outer sees trigger=true
→ afterOuterInspection blocks
→ test changes live state below trigger
→ resume
→ acquire lock
→ inner re-check sees below trigger
→ archive untouched
```

不得把该 hook 变成 production policy API。

---

## 18. 文件与函数改动范围冻结

### `src/restore/inspection.ts` — 新增

```text
read-only archive-set validation / preparation metadata
```

### `src/restore/index.ts`

```text
restore mutation path reuses inspection.ts
existing public restore contract unchanged
```

### `src/compress/live-state.ts` — 新增

```text
current top-level live scan
live token estimate
staging/archive/summary relationship classification
triggerReached
```

### `src/compress/index.ts`

提取：

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

使用 live inspection + exclusive normalization，而不是 `compressDirectory(dryRun=true)`。

### `src/compress/types.ts`

- `LiveLifecycleState` / `LiveCompressionInspection` 优先保持 package-private，不从 package root export；
- `CompressionOperationReport` additive 增加 `archivesRestored: number`；
- 不新增 public trigger/options flag。

### `src/lifecycle/orchestrator.test.ts`

扩充 automatic lifecycle acceptance coverage，并使用 deterministic outer-inspection seam。

### `src/compress/index.test.ts`

继续覆盖 manual `compressDirectory()` restore-first regression。

---

## 19. Compatibility 冻结

本次实现的 compatibility 结论：

```text
Archive Protocol version          unchanged (v1)
compression.json version          unchanged (1)
Conversation Protocol             unchanged
archive directory naming          unchanged
CLI compress semantics            unchanged
compressDirectory semantics       unchanged
manual dry-run semantics          unchanged
restoreArchivedTurns semantics    unchanged
semantic provider request schema  unchanged
semantic summary document schema  unchanged
sourceTurnIndices contract        unchanged
new public trigger API            none
```

唯一有意的 public additive observability change：

```text
CompressionOperationReport.archivesRestored: number
```

本次不是 storage protocol migration，不需要 `compression.json` v2，也不需要 archive 原地升级。

---

## 20. 规范性 acceptance tests

以下测试是实现完成的硬 gate。

### 20.1 Live steady state

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

### 20.2 Triggered recompression

```text
existing-archive-live-reaches-threshold-restores-original-history
recompression-deletes-old-live-summary-before-restoring-source-turns
recompression-provider-input-excludes-previous-summary
recompression-provider-input-includes-restored-original-turns
recompression-provider-called-exactly-once
recompression-commits-one-fresh-archive
recompression-completion-runs-after-lock-release
```

### 20.3 Recovery

```text
below-threshold-with-staging-enters-exclusive-recovery
recovery-rechecks-live-trigger-after-rollback
recovery-that-remains-below-threshold-skips-recompression
recovery-that-crosses-threshold-continues-to-recompression
valid-archive-missing-summary-restores-original-before-regating
valid-archive-missing-summary-restored-below-threshold-stays-plain
archive-plus-staging-fails-closed-before-completion
invalid-archive-metadata-fails-closed-before-completion
```

### 20.4 Stale preflight / concurrency

```text
outer-live-trigger-is-rechecked-under-lock
outer-trigger-true-inner-trigger-false-does-not-restore
outer-trigger-false-healthy-state-does-not-enter-mutation
completion-never-runs-before-active-lifecycle-release
same-process-next-orchestrator-waits-for-active-completion
```

### 20.5 Report

```text
fast-path-emits-skipped-exclusive-phases
recovery-only-report-records-archives-restored
stale-outer-plan-final-report-uses-inner-live-budget
triggered-report-uses-restored-original-selection
invalid-state-report-skips-completion
```

### 20.6 Manual API regression

```text
compressDirectory-existing-archive-still-restores-before-manual-recompress
compressDirectory-dry-run-existing-archive-still-simulates-restore
restoreArchivedTurns-contract-unchanged
archive-protocol-conformance-unchanged
```

---

## 21. 五个关键 Given / When / Then 场景

### 21.1 Compact steady state

**Given**

```text
valid archive + corresponding live summary
current compact live < trigger
semantic provider call count = 1 from previous compression
```

**When**

```text
runCompressionBeforeCompletion()
```

**Then**

```text
no filesystem lifecycle lock acquired
no archive restore
no provider call
archive byte-for-byte unchanged
summary byte-for-byte unchanged
completion runs
provider call count remains 1
```

### 21.2 Threshold crossing

**Given**

```text
healthy_compacted
current compact live >= trigger
```

**When**

```text
runCompressionBeforeCompletion()
```

**Then**

```text
acquire lock
inner live re-check >= trigger
restore previous archive
remove previous live summary through restore lifecycle
provider receives original selected turns, not previous summary
provider called exactly once
fresh archive committed
release lock
completion runs
```

### 21.3 Crash after archive commit before live summary write

**Given**

```text
valid [N]system.md.archive/
missing [N]system.md
no staging
```

**When**

```text
runCompressionBeforeCompletion()
```

**Then**

```text
outer classifies recovery_required
acquire lock
authoritative validation confirms recoverable incomplete commit
restore archive to original Conversation
re-inspect / re-gate
if below trigger: remain plain and complete
if trigger reached: fresh compression from originals
never fail merely because live summary is missing
```

### 21.4 Staging recovery changes trigger outcome

**Given**

```text
staging-only recoverable state
```

**When**

```text
runCompressionBeforeCompletion()
```

**Then**

```text
acquire lock
rollback staging
re-scan top-level live
re-evaluate trigger
below → skip recompression
reached → compress
```

Recovery 本身不得被当作 compression trigger。

### 21.5 Stale outer trigger

**Given**

```text
outer inspection sees live >= trigger
```

通过 package-private test hook，在 acquire lock 前把 live state 改为 below trigger。

**When**

```text
exclusive lifecycle resumes
```

**Then**

```text
inner inspection sees live < trigger
no healthy archive restore
no semantic provider call
commit skipped
completion runs after lock release
final report uses inner live token count
```

---

## 22. 高价值端到端闭环

使用 semantic provider call counter：

```text
1. original Conversation > trigger
2. runCompressionBeforeCompletion()
   → providerCalls = 1
   → fresh archive committed
   → compact live below trigger

3. snapshot:
   → live summary bytes
   → archive tree bytes

4. append 少量 new original turns
   → compact live still below trigger

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
   → provider receives restored original turns + newer original turns
   → providerCalls = 2
   → fresh summary + fresh archive committed
   → release lock
   → completion runs
```

该场景通过后，normal automatic lifecycle 才算闭环。

---

## 23. 不允许的实现捷径

### 23.1 Caller 自己先算 token

拒绝：

```text
Dayloom scans live
→ if threshold then call promptpile-compress
```

这会形成第二套 lifecycle ownership。

### 23.2 Summary-of-summary

拒绝：

```text
summary1 + new turns → summary2
```

会破坏 original-source invariant。

### 23.3 只加 outer token `if`

拒绝：

```text
outer scan < trigger → completion
outer scan >= trigger → existing compressDirectory()
```

因为 existing manual path 仍 restore-first，且 outer scan 可能 stale。

### 23.4 Bypass flags

拒绝把一个复杂函数扩成：

```text
skipRestore
alreadyRecovered
trustOuterPlan
forceCompression
```

应通过职责拆分形成可证明组合。

### 23.5 Missing summary 直接判 corruption

拒绝。

Valid archive + missing corresponding live summary 是本契约明确支持的 recoverable incomplete commit。

---

## 24. 推荐提交顺序

### Commit 1 — behavior-preserving refactor

```text
refactor(compress): extract archive inspection and current-conversation engine
```

内容：

- `src/restore/inspection.ts`；
- restore 复用 inspection；
- `compressCurrentConversationWithLockHeld()`；
- `compressDirectory()` 所有既有测试保持通过；
- public behavior 不变。

### Commit 2 — live-trigger semantics

```text
feat(compress): gate automatic recompression on live conversation
```

内容：

- `src/compress/live-state.ts`；
- automatic outer live gate；
- exclusive normalization；
- inner authoritative re-gate；
- missing-summary recovery；
- `archivesRestored` report field；
- deterministic stale-preflight seam。

### Commit 3 — acceptance / active design

```text
test(docs): freeze live-trigger recompression behavior
```

内容：

- 完整 acceptance matrix；
- `DESIGN.md` 更新为新 active semantics；
- 原方向草案标记 Superseded；
- 本冻结契约在 implementation accepted 后保留为历史实施依据，Active Design 以 `DESIGN.md` 为准。

---

## 25. Freeze checklist

以下全部为已冻结决策：

- [x] lifecycle states exhaustive；
- [x] state precedence frozen；
- [x] valid archive + missing summary = recoverable incomplete commit；
- [x] live-token formula frozen；
- [x] trigger comparison uses `>=`；
- [x] outer authority = skip-only；
- [x] final invalid authority requires exclusive re-check；
- [x] recovery normalization order frozen；
- [x] recovery 后必须 re-gate；
- [x] healthy archive restore 只能发生在 inner trigger confirmation 之后；
- [x] internal module/function ownership frozen；
- [x] manual API semantics frozen；
- [x] manual dry-run semantics frozen；
- [x] semantic source remains restored original turns；
- [x] report phase behavior frozen；
- [x] `archivesRestored` additive report field frozen；
- [x] public/storage compatibility impact frozen；
- [x] deterministic stale-preflight test seam frozen；
- [x] critical acceptance scenarios specified；
- [x] effective-compaction hardening excluded from required scope。

---

## 26. 完成定义

实现只有同时满足以下关系才算完成：

```text
current live Conversation
→ 决定 normal automatic recompression 是否触发

outer inspection
→ 只有 healthy + below trigger 可以直接 skip lifecycle

recovery state
→ 强制进入 exclusive lifecycle
→ normalization 后重新 gate

inner authoritative live state
→ 决定是否允许 restore healthy archive

restored original Conversation
→ 决定 triggered recompression 的 fresh selection / semantic summary source

manual compressDirectory()
→ 继续保持 restore-first explicit lifecycle 语义
```

最终 steady state：

```text
healthy compact archive
+
live summary
+
recent/new turns

→ below trigger:
   zero restore
   zero provider call
   zero archive mutation

→ reaches trigger:
   one authoritative re-check
   one restore of previous source archive
   one fresh summary
   one fresh archive commit
   return to healthy compact state
```

核心原则：

> **Archive is durable source state, not an automatic trigger.**
>
> **Live state decides when; original state decides what.**

该契约冻结后，实施者不应再需要自行决定 trigger basis、missing-summary recovery、restore timing、lock authority、report path 或 manual/automatic API 边界。