# promptpile-compress Live Trigger Recompression 冻结实施契约

> Status: **Frozen Implementation Contract — Revision 2**  
> Date: 2026-08-14  
> Target: `packages/promptpile-compress`  
> Primary API: `runCompressionBeforeCompletion()`  
> Manual API preserved: `compressDirectory()`  
> Supersedes: `LIVE_TRIGGER_RECOMPRESSION_DRAFT.md`  
> Change policy: 实施过程中如需改变本文的状态机、触发语义、恢复语义、filesystem coordination、summary source 或 report 语义，必须先修改本文并重新评审，不能在代码中隐式改变。

## 1. 冻结结论

当前问题不是 archive / restore 本身错误，而是 **automatic orchestrator 复用了 manual compression 的 restore-first 语义**。

当前 `compressDirectoryWithLockHeld()` 的主要顺序是：

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

本次修改把两个问题严格拆开：

```text
是否允许为了 normal automatic recompression 展开 compact state？
→ 看 lock 内 authoritative current live Conversation

真正执行 fresh compression 时总结什么？
→ 看 restored/current original Conversation
```

冻结 invariant：

> **Live state decides when. Original state decides what.**
>
> **Archive is durable source state, not an automatic trigger.**
>
> **Recovery normalizes state; recovery itself is not a compression trigger.**

---

## 2. 本次优化目标

优化目标固定为：

```text
below live trigger
→ zero healthy-archive restore
→ zero semantic provider call
→ zero Conversation/archive mutation
```

本次 **不把 “zero filesystem lock acquisition” 作为优化目标**。

Automatic API 继续经过现有 filesystem lifecycle coordination，再由 lock 内权威 live state 决定是否允许 restore / recompress。

原因：filesystem lock 是轻量 coordination boundary；真正需要消除的结构性成本是：

```text
full original restore
+ semantic provider
+ repeated recompression
```

同时保留现有安全性质：completion 只能在本次 orchestrator 已经完成 filesystem lifecycle coordination 并释放其 lock 后运行。

---

## 3. 保持不变的 contract

以下 ownership 与实现语义保持：

- Archive Protocol v1；
- Conversation Protocol v1；
- reversible restore；
- staging recovery；
- filesystem lifecycle lock；
- conversation generation precondition；
- semantic provider schema / timeout / sourceTurnIndices validation；
- sliding-window selection；
- archive commit format；
- `compressDirectory()` manual restore-first 语义；
- manual dry-run restore-first simulation；
- completion callback 必须在本次 lifecycle lock release 后执行；
- 同一 resolved directory 的 `serializeOrchestratorPhase()` 继续覆盖 completion callback；
- 不新增 caller-side archive inspection；
- 不新增 public trigger API。

本次不增加跨进程 completion transaction。另一进程可以在本次 orchestrator release lock 后、completion 期间获得 lifecycle lock；这是现有能力边界，不在本次修改范围。

---

## 4. 精确 token 口径

### 4.1 Current live Conversation

`liveTurns` 只指 resolved conversation directory **顶层**、被当前 Conversation Protocol scanner 识别的 message artifacts。

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

- archive 内 archived artifacts 不计入 `liveTokens`；
- staging 内 artifacts 不计入 `liveTokens`，staging 只影响 lifecycle classification；
- 顶层 compact `[N]system.md` summary 计入 `liveTokens`；
- 顶层 recent/new original turns 计入；
- 顶层 system turns 与现有 `scanTurns()` 规则一致计入；
- outer 与 inner inspection 使用同一 resolved budget 与 tokenizer adapter；
- trigger 比较固定使用 `>=`。

### 4.2 Original Conversation

original Conversation 指：

```text
restored archived original turns
+
compression 之后新增的 original top-level turns
```

或在从未 compact 的 `healthy_plain` 状态下，当前顶层 Conversation 本身。

Semantic provider source 必须来自 fresh selection 的 original turns，不得把旧 compact summary 作为 source turn。

---

## 5. Lifecycle state 使用 discriminated union

Package-private inspection 必须把状态显式建模，不使用：

```text
state + recoveryRequired boolean + helper predicate guessing
```

冻结建议类型：

```ts
interface LiveSnapshot {
  turns: Turn[];
  tokens: number;
  triggerTokens: number;
  triggerReached: boolean;
}

interface InspectedArchive {
  idx: number;
  path: string;
  summaryPresent: boolean;
}

type LiveCompressionInspection =
  | {
      state: 'healthy_plain';
      live: LiveSnapshot;
    }
  | {
      state: 'healthy_compacted';
      live: LiveSnapshot;
      archives: InspectedArchive[];
    }
  | {
      state: 'recovery_required';
      reason: 'staging' | 'incomplete_archive_commit';
      live: LiveSnapshot;
      archives: InspectedArchive[];
    }
  | {
      state: 'invalid';
      reason: string;
    };
```

内部实现可以使用更精确的 invalid reason union，但不得让非法状态组合依赖一组独立 boolean 才能解释。

---

## 6. Exhaustive state classification

分类优先级固定为：

```text
1. staging/archive structural conflict
2. archive validity
3. archive/live-summary completeness
4. plain vs compact healthy state
```

状态表：

| staging | archive set | archive metadata | top-level matching summary | state |
|---|---|---|---|---|
| no | none | — | — | `healthy_plain` |
| no | present | valid | all present | `healthy_compacted` |
| yes | none | — | — | `recovery_required: staging` |
| yes | present | any | any | `invalid` |
| no | present | invalid | any | `invalid` |
| no | present | valid | any missing | `recovery_required: incomplete_archive_commit` |

### 6.1 Summary correspondence 只检查 presence

本次冻结：

```text
archive [N]system.md.archive
对应 summary complete
=
top-level [N]system.md file exists
```

多 archive set 中，只要任一 archive 缺少对应顶层 summary，即为 `incomplete_archive_commit`。

本次不：

- byte-compare `[N]system.md` 与 archive 私有 `.summary.md`；
- 校验 semantic marker；
- 将 `.summary.md` 提升为 Archive Protocol public contract。

Summary content integrity 属于后续 hardening，不属于 live-trigger 修复。

### 6.2 Valid archive + missing summary 是 recoverable

冻结决定：

```text
valid archive
+ missing matching top-level summary
= recoverable incomplete commit
```

不是 archive corruption。

这是现有 commit 顺序：

```text
rename staging → archive
→ write live summary
```

之间崩溃时的合法 incomplete state。

恢复统一采用：

```text
restore archived originals
→ return to authoritative plain Conversation
→ re-inspect / re-gate
```

不直接从 `.summary.md` 补顶层 summary。

---

## 7. Shared archive inspection

冻结新增：

```text
src/restore/inspection.ts
```

package-private：

```ts
inspectArchiveSet(directory)
```

它是 archive validity 的唯一 source of truth，负责 read-only：

- `compression.json` version；
- `archivedTurnIndices` 非空、非负整数、无重复；
- archive directory idx 与 max archived idx 一致；
- 跨 archive duplicate idx；
- 跨 archive duplicate archived message files；
- restore target conflict 所需信息；
- archive summary idx / matching top-level summary presence 所需信息。

`restoreArchivedTurnsWithLockHeld()` 与 `inspectLiveCompressionState()` 必须共同使用该模块，不复制 validator。

---

## 8. Live inspection

冻结新增：

```text
src/compress/live-state.ts
```

package-private：

```ts
inspectLiveCompressionState(...): Promise<LiveCompressionInspection>
```

职责：

```text
receive resolved budget/tokenizer
→ inspect staging/archive shape
→ call inspectArchiveSet()
→ inspect matching top-level summary presence
→ scan top-level live Conversation
→ estimate live tokens
→ classify discriminated state
```

必须保持 read-only，不允许：

```text
restore
recover mutation
semantic provider
staging mutation
archive commit
unlink/rename
```

---

## 9. Four-layer automatic lifecycle

`runCompressionBeforeCompletion()` 冻结为四层职责：

```text
Observation
→ Coordination
→ Normalization
→ Compression decision/execution
```

### 9.1 Observation

仍在：

```text
serializeOrchestratorPhase(resolvedDirectory)
```

内执行 outer `inspectLiveCompressionState()`。

Outer inspection 只用于：

- tentative `report.plan`；
- observability；
- deterministic stale-plan tests。

冻结原则：

> **Outer inspection has planning authority only. It has no lifecycle-exit authority, mutation authority, or final-invalid authority.**

因此 automatic API 不因为 outer `healthy + below trigger` 直接跳过 filesystem coordination。

### 9.2 Coordination

所有合法 automatic invocation 在 outer inspection 后都进入：

```text
withDirectoryLifecycleLock(directory, 'compress', ...)
```

lock acquisition 继续负责：

- cooperating writer exclusion；
- stale same-host lock cleanup；
- malformed/foreign/live blocker fail closed；
- mutation authority。

### 9.3 Normalization

拿锁后重新做 authoritative inspection。

Recoverable state 必须通过一个收敛循环归一化：

```ts
let current = await inspectLiveCompressionState(...);

for (let step = 0; step < MAX_NORMALIZATION_STEPS; step += 1) {
  if (current.state === 'invalid') {
    throw archiveStateInvalid();
  }

  if (current.state !== 'recovery_required') {
    break;
  }

  switch (current.reason) {
    case 'staging':
      recoveryActions.push(...await recoverWithLockHeld(...));
      break;

    case 'incomplete_archive_commit': {
      const restored = await restoreArchivedTurnsWithLockHeld(...);
      archivesRestored += restored.archivesRestored ?? 0;
      break;
    }
  }

  current = await inspectLiveCompressionState(...);
}
```

归一化必须最终收敛到：

```text
healthy_plain
or
healthy_compacted
```

否则 fail closed 为 `ARCHIVE_STATE_INVALID`。

`MAX_NORMALIZATION_STEPS` 只用于防御实现 bug / 非收敛状态；当前状态空间正常最多需要很少步骤，不应形成无限循环。

### 9.4 Authoritative live gate

**只有 normalization 完成后的 lock 内 live state 才拥有 automatic trigger authority。**

```text
if inner live < trigger
→ no healthy archive restore
→ no semantic provider
→ no archive/Conversation mutation beyond any required recovery already completed
→ return skipped result
```

如果：

```text
inner live >= trigger
```

才允许 normal recompression path 继续。

---

## 10. Compression engine 解耦

冻结从当前 `compressDirectoryWithLockHeld()` 提取：

```text
src/compress/index.ts

compressCurrentConversationWithLockHeld()
```

前置条件：

> 当前顶层 Conversation 已经是本次 compression 的 authoritative source state。

职责：

```text
capture generation
→ scan source turns
→ calculate source threshold / selection
→ generate summary if selection requires
→ generation re-check
→ prepare staging
→ commit archive
```

不负责：

```text
recovery
restore existing healthy archive
automatic outer planning
```

### 10.1 Manual wrapper

`compressDirectoryWithLockHeld()` 保持：

```text
recoverWithLockHeld()
→ restore existing archive if present
→ compressCurrentConversationWithLockHeld()
```

因此 CLI/manual semantics 不变。

### 10.2 Automatic path

Normalization 后：

```text
inner healthy_plain + live >= trigger
→ compressCurrentConversationWithLockHeld()

inner healthy_compacted + live >= trigger
→ restoreArchivedTurnsWithLockHeld()
→ compressCurrentConversationWithLockHeld()
```

关键 invariant：

> **Healthy compact archive 只有在 filesystem lock 内 current live trigger 被确认后，才允许为了 normal recompression 被 restore。**

---

## 11. Restore 后允许不重新压缩

Compact live 达到 trigger，只代表：

> 允许展开 durable original source，并重新判断 fresh compression 是否值得发生。

它 **不承诺一定生成 fresh archive**。

因此：

```text
healthy_compacted
inner live >= trigger
→ restore original
→ compressCurrentConversationWithLockHeld()
```

合法结果为：

```text
compressed
→ fresh healthy_compacted

below_threshold
→ healthy_plain

no_turns_to_compress
→ healthy_plain
```

如果 restored/current original source 在共享 engine 中低于 threshold，或没有可压缩 turns：

- 不调用 semantic provider（如果 selection 不要求）；
- 不提交新 archive；
- 保留 restored plain original Conversation；
- release lock；
- completion 正常运行。

因此状态机不依赖：

```text
summaryTokens < archivedOriginalTokens
```

之类尚未冻结的 effective-compaction invariant 才能闭合。

---

## 12. Fresh summary source invariant

Triggered recompression：

```text
archive(original 0..N)
+
live summary1
+
new original N+1..M

→ inner live trigger confirmed
→ restore lifecycle deletes summary1
→ restore original 0..N
→ top-level original 0..M
→ fresh selection
→ semantic summary2
```

Provider 只能看到 fresh selected original turns。

不得：

```text
summary1 + newer turns → summary2
```

现有 `normalizeArchive()`、`validateSemanticSummary()` 与 sourceTurnIndices validation 全部保留。

---

## 13. Dry-run 语义

### Manual dry-run

```ts
compressDirectory({ dryRun: true })
```

继续模拟 manual restore-first lifecycle；archive/staging 存在时仍可在 temp copy 中执行：

```text
recover → restore → selection
```

### Automatic orchestrator

不再调用 manual dry-run 作为 trigger planner。

Outer `estimate_plan` 只来自 read-only live inspection。

冻结：

```text
manual dry-run != automatic live planning
```

---

## 14. Report：plan 与 execution fact 分离

现有 public phase 名称保持：

```text
estimate_plan
acquire_exclusive
compress
release_exclusive
completion
```

### 14.1 `report.plan`

定义为：

> **outer tentative live observation，不是 execution prediction，也不是 commit fact。**

如果 outer state 为 healthy：

```text
outer live < trigger
→ plan.outcome = below_threshold

outer live >= trigger
→ plan.outcome = compressed
```

这里 `compressed` 只是为了保持现有 enum；语义为：

> outer live observation indicates the compression path should be considered.

如果 outer state 为：

```text
recovery_required
invalid-looking
```

`report.plan` 可以省略，因为现有 type 本来就是 optional；不要强行把 recovery/corruption 映射为 compression outcome。

Outer `plan.selection` / `plan.budget` 只描述 outer current-live snapshot。

### 14.2 Final execution fields

这些字段必须只描述 lock 内权威事实：

```text
report.budget
report.selection
report.commit
report.recoveryActions
report.archivesRestored
```

Outer plan stale 时不保留旧 execution conclusion。

### 14.3 Phase 语义

冻结：

```text
estimate_plan
= outer read-only observation

acquire_exclusive
= filesystem lifecycle coordination

compress
= lock-held automatic lifecycle body
  (normalization + authoritative gate + optional restore/compression)

release_exclusive
= release this orchestrator's lifecycle lock

completion
= callback after release
```

因此 automatic API 正常路径均会：

```text
estimate_plan       completed
acquire_exclusive   completed
compress            completed | failed
release_exclusive   completed | failed
completion          completed | failed | skipped
```

即使 lock 内最终：

```text
live < trigger
commit skipped
```

`compress` phase 仍为 `completed`，因为 lock-held lifecycle body 已成功完成。

是否生成 fresh archive 只看：

```text
commit.state = committed | skipped
```

### 14.4 Public additive field

`CompressionOperationReport` 增加：

```ts
archivesRestored: number;
```

默认 `0`。

用于表达：

```text
recovery/normalization restore happened
但 fresh compression commit skipped
```

### 14.5 Intentional report semantic changes

本次除了 additive field，还明确包含以下 public observable semantic changes：

- `plan.budget.tokensBefore` 从旧 archive-aware restored simulation 改为 outer current-live token count；
- `plan` 变成 tentative live observation；
- final `budget/selection/commit` 以 inner authoritative execution 为准；
- healthy below-trigger automatic path仍会经过 filesystem coordination，但不会 restore archive/provider/recompress；
- recovery-only 与 restored-source-below-threshold 路径可以 `compress phase = completed` 且 `commit = skipped`。

因此 compatibility 不是“只有新增字段”，而是：

```text
public type mostly compatible
+
intentional operation-report semantic refinement
```

---

## 15. Concurrency / generation

### 15.1 Outer state 不具事务权威

Outer inspection 可能在 acquire lock 前 stale。

这是正常情况：

```text
outer 8k → inner 35k
outer 35k → inner 8k
```

全部由 inner state 决定。

### 15.2 Filesystem lock 是 cooperating-writer authority

Automatic lifecycle 始终经过现有 `withDirectoryLifecycleLock()`，避免在另一个 cooperating lifecycle writer 已持锁但尚未产生可见 mutation 时直接启动 completion。

### 15.3 Generation precondition 保持

一旦 current/restored original Conversation 成为 compression source，继续使用：

```text
captureConversationGeneration()
assertConversationGeneration()
```

保护 source scan / semantic provider 到 first staging mutation 之间的 non-cooperating writer 变化。

### 15.4 Completion 边界

```text
release this orchestrator's lifecycle lock
→ completion callback
```

同进程 orchestrator queue 继续覆盖 completion。

不宣称 completion 与其他进程随后获得 lifecycle lock 的 mutation 互斥。

---

## 16. Deterministic stale-plan test seam

允许 package-private：

```ts
runCompressionBeforeCompletionInternal(options, hooks?)
```

至少支持：

```ts
interface CompressionOrchestratorTestHooks {
  afterOuterInspection?: (
    inspection: LiveCompressionInspection
  ) => Promise<void>;
}
```

Public `runCompressionBeforeCompletion()` 不暴露 hooks。

典型 deterministic test：

```text
outer sees trigger=true
→ hook blocks
→ test changes current live state below trigger
→ resume
→ acquire lock
→ inner sees below
→ no healthy archive restore
→ provider not invoked
→ commit skipped
→ release
→ completion
```

---

## 17. 文件与职责冻结

### `src/restore/inspection.ts` — 新增

```text
read-only archive-set validation / prepared metadata
```

### `src/restore/index.ts`

```text
restore mutation path reuses inspection.ts
public restore contract unchanged
```

### `src/compress/live-state.ts` — 新增

```text
read-only top-level live scan
token estimate
staging/archive/summary classification
discriminated lifecycle state
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

使用：

```text
outer observation
→ filesystem coordination
→ recovery normalization
→ inner live gate
→ optional healthy archive restore
→ shared compression engine
```

### `src/compress/types.ts`

- `LiveSnapshot` / `LiveCompressionInspection` 保持 package-private；
- `CompressionOperationReport` additive `archivesRestored: number`；
- 不新增 public trigger/options flags。

---

## 18. Compatibility

保持：

```text
Archive Protocol version          v1 unchanged
compression.json version          1 unchanged
Conversation Protocol             unchanged
archive directory naming          unchanged
CLI compress semantics            unchanged
compressDirectory semantics       unchanged
manual dry-run semantics          unchanged
restoreArchivedTurns API          unchanged
semantic provider request schema  unchanged
semantic document schema          unchanged
sourceTurnIndices contract        unchanged
new public trigger API            none
```

Public observable changes：

```text
CompressionOperationReport.archivesRestored added
automatic report plan token basis changes to current live state
plan becomes tentative observation
final execution fields become inner-authoritative
```

本次不是 storage migration，不需要 manifest v2。

---

## 19. Normative acceptance tests

### 19.1 Healthy compact steady state

```text
existing-archive-live-below-threshold-does-not-restore
existing-archive-live-below-threshold-does-not-call-semantic-provider
existing-archive-live-below-threshold-preserves-conversation-byte-for-byte
existing-archive-live-below-threshold-preserves-archive-byte-for-byte
existing-archive-live-below-threshold-preserves-old-summary-byte-for-byte
existing-archive-live-below-threshold-acquires-and-releases-lifecycle-coordination
existing-archive-live-below-threshold-enters-completion-after-release
below-threshold-plan-uses-live-token-count
```

### 19.2 Triggered recompression

```text
existing-archive-live-reaches-threshold-restores-original-history
recompression-deletes-old-live-summary-through-restore-lifecycle
recompression-provider-input-excludes-previous-summary
recompression-provider-input-includes-restored-original-turns
recompression-provider-called-exactly-once
recompression-commits-one-fresh-archive
recompression-completion-runs-after-lock-release
```

### 19.3 Triggered restore but no fresh compression

```text
triggered-compact-state-restored-source-below-threshold-stays-plain
triggered-compact-state-restored-source-no-turns-stays-plain
restored-source-skip-does-not-call-semantic-provider
restored-source-skip-reports-commit-skipped
restored-source-skip-reports-archives-restored
```

### 19.4 Recovery normalization

```text
staging-enters-exclusive-recovery
recovery-rechecks-live-trigger-after-rollback
recovery-that-remains-below-threshold-skips-recompression
recovery-that-crosses-threshold-continues-to-recompression
valid-archive-missing-summary-restores-original-before-regating
valid-archive-missing-summary-restored-below-threshold-stays-plain
archive-plus-staging-fails-closed-before-completion
invalid-archive-metadata-fails-closed-before-completion
normalization-converges-or-fails-closed
```

### 19.5 Concurrency / stale plan

```text
outer-live-plan-is-rechecked-under-lock
outer-trigger-true-inner-trigger-false-does-not-restore-healthy-archive
outer-trigger-false-inner-trigger-true-follows-inner-state
cooperating-writer-lock-blocks-automatic-lifecycle-before-completion
completion-never-runs-before-this-lifecycle-release
same-process-next-orchestrator-waits-for-active-completion
```

### 19.6 Report

```text
outer-healthy-plan-uses-current-live-budget
outer-recovery-required-may-omit-plan
recovery-only-report-records-archives-restored
stale-outer-plan-final-report-uses-inner-authoritative-budget
triggered-report-uses-restored-original-selection
lock-held-below-threshold-has-compress-phase-completed-and-commit-skipped
invalid-state-report-skips-completion
```

### 19.7 Manual regression

```text
compressDirectory-existing-archive-still-restores-before-manual-recompress
compressDirectory-dry-run-existing-archive-still-simulates-restore
restoreArchivedTurns-contract-unchanged
archive-protocol-conformance-unchanged
```

---

## 20. Five critical Given / When / Then scenarios

### 20.1 Compact steady state

**Given**

```text
healthy_compacted
current compact live < trigger
previous providerCalls = 1
```

**When**

```text
runCompressionBeforeCompletion()
```

**Then**

```text
outer tentative plan = below_threshold
acquire lifecycle coordination
inner authoritative live still below trigger
no archive restore
no provider call
no Conversation/archive mutation
release lifecycle lock
completion runs
archive + summary bytes unchanged
providerCalls remains 1
```

### 20.2 Threshold crossing

**Given**

```text
healthy_compacted
current compact live >= trigger
```

**When** automatic lifecycle runs.

**Then**

```text
acquire lock
inner confirms trigger
restore previous source archive
fresh engine evaluates original source
if compression warranted:
  provider sees original selected turns
  provider called once
  fresh archive committed
release
completion
```

### 20.3 Restored source no longer warrants compression

**Given**

```text
healthy_compacted
compact live >= trigger
but no effective-compaction invariant guarantees restored original >= trigger
```

**When**

```text
inner trigger authorizes restore
→ restore original
→ shared engine returns below_threshold or no_turns_to_compress
```

**Then**

```text
final state = healthy_plain
no fresh archive commit
commit.state = skipped
archivesRestored reflects restore
release lock
completion runs
```

### 20.4 Incomplete archive commit

**Given**

```text
valid [N]system.md.archive
missing top-level [N]system.md
no staging
```

**Then**

```text
classify recovery_required: incomplete_archive_commit
acquire lock
restore original archive
re-inspect
below → stay plain
reached → compress from originals
never fail merely because summary is missing
```

### 20.5 Stale outer plan

**Given** outer sees live >= trigger, then test hook changes live below trigger before lock acquisition.

**Then**

```text
inner state wins
no healthy archive restore
no provider
commit skipped
report final budget uses inner state
release
completion
```

---

## 21. High-value end-to-end loop

```text
1. original Conversation > trigger
2. runCompressionBeforeCompletion()
   → filesystem coordination
   → fresh compression
   → providerCalls = 1
   → healthy_compacted

3. append a few new original turns
   → compact live still below trigger

4. runCompressionBeforeCompletion() repeatedly
   → each call coordinates through filesystem lock
   → inner live below trigger
   → no restore
   → no provider
   → archive/summary unchanged
   → completion

5. append until compact live >= trigger

6. next call
   → inner confirms trigger
   → restore original source
   → shared compression engine
   → if warranted, providerCalls = 2 and fresh archive commit
   → otherwise remain healthy_plain
   → release
   → completion
```

这个循环覆盖 normal steady state、threshold crossing 与 restored-source skip 三种合法终态，才算真正闭环。

---

## 22. Explicit non-solutions

拒绝：

```text
caller scans live tokens
summary-of-summary
outer-only token if + existing manual compress path
skipRestore / skipRecovery / trustOuterPlan flags
missing summary = corruption
no-lock automatic fast path as a required optimization
```

原因分别是 ownership 泄漏、summary drift、inner restore-before-trigger 仍存在、非法状态组合爆炸、削弱 crash recovery、以及引入不必要的跨进程 coordination race。

---

## 23. Optional hardening intentionally deferred

以下不属于本次 implementation gate：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
tokensAfter < triggerTokens
summary byte integrity validation
rolling/incremental summary
```

未来可以单独形成 effective-compaction / integrity hardening contract。

本次状态机必须在没有这些假设时也闭合。

---

## 24. Recommended implementation commits

### Commit 1 — behavior-preserving refactor

```text
refactor(compress): extract archive inspection and current-source engine
```

- add `restore/inspection.ts`；
- restore reuses inspection；
- extract `compressCurrentConversationWithLockHeld()`；
- all existing manual tests green；
- no public behavior change。

### Commit 2 — automatic live-trigger semantics

```text
feat(compress): gate healthy archive restore on authoritative live state
```

- add discriminated live-state inspection；
- outer tentative plan；
- automatic filesystem coordination；
- normalization loop；
- inner authoritative live gate；
- missing-summary recovery；
- restored-source skip path；
- report semantics / `archivesRestored`；
- deterministic stale-plan seam。

### Commit 3 — acceptance / active design

```text
test(docs): activate live-trigger recompression semantics
```

- full acceptance matrix；
- update `DESIGN.md` only after implementation is green；
- frozen contract retained as implementation history；
- Active Design becomes `DESIGN.md`。

---

## 25. Freeze checklist

- [x] current live token formula frozen；
- [x] trigger comparison `>=` frozen；
- [x] lifecycle state discriminated union frozen；
- [x] exhaustive state classification frozen；
- [x] summary correspondence = presence only；
- [x] missing summary = recoverable incomplete commit；
- [x] archive validation single source of truth frozen；
- [x] outer authority = tentative planning only；
- [x] automatic API always crosses filesystem coordination boundary；
- [x] lock inner inspection = trigger authority；
- [x] recovery normalization loop frozen；
- [x] normalization must converge to healthy or fail closed；
- [x] recovery is not trigger；
- [x] healthy archive restore only after inner trigger confirmation；
- [x] restored source may legitimately skip fresh compression；
- [x] semantic source remains original turns；
- [x] manual restore-first semantics frozen；
- [x] manual dry-run semantics frozen；
- [x] phase semantics frozen；
- [x] plan vs final execution fact semantics frozen；
- [x] report semantic changes explicitly documented；
- [x] `archivesRestored` additive field frozen；
- [x] deterministic stale-plan seam frozen；
- [x] protocol compatibility impact frozen；
- [x] effective-compaction hardening explicitly deferred；
- [x] acceptance paths cover all healthy/recovery/invalid terminal states。

---

## 26. Definition of done

Automatic lifecycle 必须满足：

```text
outer live inspection
→ tentative plan only

filesystem lifecycle lock
→ establish cooperating-writer authority

recovery normalization
→ recoverable state converges to healthy

inner current live Conversation
→ decides whether healthy compact source may be restored

restored/current original Conversation
→ independently decides fresh compression selection and summary source

release lifecycle lock
→ completion callback
```

最终合法终态只有：

```text
healthy_compacted
healthy_plain
failed closed
```

Normal steady state：

```text
healthy_compacted + live below trigger
→ coordinate
→ no restore
→ no provider
→ no mutation
→ completion
```

Triggered path：

```text
healthy_compacted + live reaches trigger
→ coordinate
→ inner confirm
→ restore original
→ shared engine
   ├─ fresh compact commit → healthy_compacted
   └─ compression skipped  → healthy_plain
→ release
→ completion
```

核心原则最终冻结为：

> **Coordinate first; mutate only from authoritative state.**
>
> **Live state decides when; original state decides what.**
>
> **Recovery normalizes; compression remains an independent decision.**
