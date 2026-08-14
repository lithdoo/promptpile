# promptpile-compress Live Trigger Recompression 冻结实施契约

> Status: **Frozen Implementation Contract — Revision 3**  
> Date: 2026-08-14  
> Target: `packages/promptpile-compress`  
> Primary API: `runCompressionBeforeCompletion()`  
> Manual API preserved: `compressDirectory()`  
> Supersedes: `LIVE_TRIGGER_RECOMPRESSION_DRAFT.md` and Revision 1/2 of this contract  
> Change policy: 实施过程中如需改变本文的状态机、触发语义、恢复语义、filesystem coordination、summary source、error taxonomy 或 operation report v2 语义，必须先修改本文并重新评审，不能在代码中隐式改变。

## 1. 冻结结论

当前问题不是 archive / restore 本身错误，而是 **automatic orchestrator 复用了 manual compression 的 restore-first trigger 语义**。

当前 `compressDirectoryWithLockHeld()` 的主要顺序是：

```text
recover
→ restore existing archive
→ scan restored Conversation
→ calculate threshold
→ select
→ summarize
→ commit
```

因此 archive 一旦存在，automatic completion path 会先展开 full original history，再决定是否需要 compression。第一次 compression 之后，即使 compact live Conversation 很小，后续 automatic call 仍可能反复 restore + semantic summary + recompress。

Revision 3 把 automatic lifecycle 收敛为唯一 authority 链：

```text
serialize per directory
→ acquire filesystem lifecycle lock
→ inspect authoritative lifecycle state
→ normalize recoverable state
→ inspect healthy live state
→ live gate
→ optional restore of healthy compact source
→ evaluate/compress original source
→ release lock
→ completion
```

核心 invariant：

> **Coordinate first; mutate only from authoritative state.**
>
> **Live state decides when; original state decides what.**
>
> **Recovery normalizes; compression remains an independent decision.**
>
> **Archive is durable source state, not an automatic trigger.**

---

## 2. 本次优化目标

对 **已经 healthy 且 live below trigger** 的 automatic call，必须满足：

```text
zero healthy-archive restore
zero semantic-provider call
zero Conversation/archive mutation
```

filesystem lifecycle lock 的创建/释放属于 coordination，不视为 Conversation/archive mutation，也不是本次优化目标。

本次明确不追求：

```text
zero lock acquisition
outer lock-free live gate
summary-of-summary
incremental rolling summary
```

真正要消除的结构性成本是：

```text
full restore
+ semantic provider
+ repeated recompression
```

---

## 3. 保持不变的 contract

以下 contract 与 ownership 保持：

- Archive Protocol v1；
- Conversation Protocol v1；
- `compression.json` version 1；
- archive directory naming；
- reversible restore；
- filesystem lifecycle lock；
- same-process `serializeOrchestratorPhase()`；
- conversation generation precondition；
- sliding-window selection；
- semantic provider request/document/sourceTurnIndices contract；
- archive commit format；
- `compressDirectory()` manual restore-first 语义；
- manual `compressDirectory({ dryRun: true })` restore-first simulation；
- completion callback 在本次 lifecycle lock release 后执行；
- 不新增 caller-side archive/recovery policy；
- 不新增 public trigger option/API。

本次不增加跨进程 completion transaction：本次 orchestrator release lock 后，另一进程可以在 completion 期间取得 lifecycle lock。这是现有能力边界。

---

## 4. Automatic lifecycle 不再做 outer live scan

Revision 2 的 outer live inspection 在所有 automatic call 都必须进入 filesystem coordination 后，不再拥有控制流价值，只会带来：

```text
extra full live scan
stale outer plan semantics
outer-vs-inner authority split
test-only stale-plan seam
```

Revision 3 删除该层。

冻结 automatic 入口：

```text
assert/resolve directory + options
→ serializeOrchestratorPhase(directory)
→ acquire lifecycle lock
→ first authoritative lifecycle inspection
```

因此：

- lock 前不扫描/tokenize Conversation；
- 不生成 tentative filesystem plan；
- 不存在 outer/inner trigger 分歧；
- 不新增 `afterOuterInspection` test hook；
- cooperating lifecycle writer 的 authority 只由现有 filesystem lock 决定。

这使 automatic trigger 只有一个权威位置：**lock 内、recovery normalization 完成后的 healthy live snapshot**。

---

## 5. 精确 live token 口径

只有 lifecycle 已经归一化为 healthy 时才计算 live tokens。

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

冻结规则：

- archive 内 archived artifacts 不计入；
- staging 内 artifacts 不计入；
- 顶层 `[N]system.md` compact summary 计入；
- 顶层 newer/original turns 计入；
- 顶层 system turns 按现有 scanner 规则计入；
- trigger 固定使用 `>=`；
- recovery/invalid state 在归一化前不需要 token scan，因为其 live snapshot 不具 trigger authority。

Original Conversation 指：

```text
restored archived original turns
+
compression 后新增的 original turns
```

或者未 compact 的 healthy plain Conversation 本身。

---

## 6. Lifecycle state 必须基于磁盘事实建模

不要根据“可能发生了哪次 crash”给状态命名。State machine 只描述当前可观察事实和当前允许的动作。

冻结 package-private 类型形态：

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

type RecoveryReason =
  | 'staging_recovery'
  | 'archive_recovery';

type InvalidLifecycleReason =
  | 'staging_path_invalid'
  | 'staging_archive_conflict'
  | 'staging_target_conflict'
  | 'archive_metadata_invalid'
  | 'archive_set_conflict'
  | 'archive_target_conflict';

type CompressionLifecycleInspection =
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
      reason: 'staging_recovery';
    }
  | {
      state: 'recovery_required';
      reason: 'archive_recovery';
      archives: InspectedArchive[];
    }
  | {
      state: 'invalid';
      reason: InvalidLifecycleReason;
    };
```

具体实现可以为 invalid reason 增加内部细分，但不得退化成：

```text
state + several independent booleans + caller guessing combinations
```

Recovery/invalid variant 不携带 `LiveSnapshot` 是有意设计：recovery 完成前的 token count 不参与 automatic trigger。

---

## 7. Exhaustive lifecycle classification

### 7.1 Reserved staging path

`.promptpile-compress.staging` 是 lifecycle owner 的保留路径。

分类必须先检查它：

```text
path absent
→ continue

path exists and is directory
→ inspect staging state

path exists but is not directory
→ invalid: staging_path_invalid
```

不得把“reserved path 存在但不是 directory”当成 no staging。

### 7.2 Staging classification

```text
staging directory + committed archive exists
→ invalid: staging_archive_conflict

staging directory + no archive + rollback targets clear
→ recovery_required: staging_recovery

staging directory + no archive + rollback target conflict
→ invalid: staging_target_conflict
```

因此 **staging-only 不天然等于 recoverable**。它只有在当前 restore/rollback precondition 可以唯一、安全执行时才是 `staging_recovery`。

对 staging 中非 Conversation message 的私有辅助文件，本次继续保持当前 recovery ownership；本契约不新增 staging manifest public contract。

### 7.3 Archive classification

没有 staging 时：

```text
no archive
→ healthy_plain

archive metadata/set invalid
→ invalid: archive_metadata_invalid | archive_set_conflict

archive valid but restore target conflict
→ invalid: archive_target_conflict

archive valid/restorable + every matching [N]system.md exists
→ healthy_compacted

archive valid/restorable + any matching [N]system.md missing
→ recovery_required: archive_recovery
```

`archive_recovery` 不推断它来自：

```text
commit archive 后、write live summary 前 crash
```

还是：

```text
delete live summary 后、restore message 前 crash
```

两者对当前磁盘状态和安全恢复动作相同，因此统一叫 `archive_recovery`。

### 7.4 Summary correspondence 只检查 presence

冻结：

```text
archive [N]system.md.archive
has matching live representation
=
top-level [N]system.md exists
```

本次不：

- byte-compare `[N]system.md` 与 archive 私有 `.summary.md`；
- 校验 semantic marker；
- 将 `.summary.md` 提升为 Archive Protocol contract。

Summary integrity 属于后续 hardening。

---

## 8. Shared read-only lifecycle inspection

冻结新增：

```text
src/restore/inspection.ts
```

它承载 restore/recovery mutation precondition 的 read-only source of truth，至少包含：

```ts
inspectStagingState(directory)
inspectArchiveSet(directory)
```

### `inspectStagingState()`

负责：

- reserved staging path 类型；
- staging message file discovery；
- rollback target conflict；
- staging/archive structural conflict 所需信息。

### `inspectArchiveSet()`

负责：

- `compression.json` version；
- `archivedTurnIndices` 非空、非负整数、无重复；
- archive idx 与 max archived idx；
- 跨 archive duplicate idx；
- 跨 archive duplicate message file；
- restore target conflict；
- archive idx 对应顶层 summary presence。

`recoverWithLockHeld()`、`restoreArchivedTurnsWithLockHeld()` 与 automatic lifecycle inspection 必须复用这些规则，不允许各写一套 validator。

Domain-invalid inspection 应返回结构化 invalid state；真实 filesystem read/stat/permission failure 继续抛 IO error。

---

## 9. Automatic authoritative inspection

冻结新增 package-private：

```text
src/compress/live-state.ts
```

提供：

```ts
inspectCompressionLifecycleState(...): Promise<CompressionLifecycleInspection>
```

执行顺序：

```text
inspect reserved staging path
→ inspect staging/archive structural validity
→ classify recovery/invalid if applicable
→ only if structurally healthy, scan live Conversation
→ calculate live snapshot
→ return healthy_plain | healthy_compacted
```

必须保持 read-only。

禁止：

```text
restore
rollback
semantic provider
rename/unlink
staging mutation
archive commit
```

---

## 10. Recovery normalization 是收敛过程

拿到 filesystem lifecycle lock 后：

```ts
let current = await inspectCompressionLifecycleState(...);

for (let step = 0; step < MAX_NORMALIZATION_STEPS; step += 1) {
  if (current.state === 'invalid') {
    throw archiveStateInvalid(current.reason);
  }

  if (current.state !== 'recovery_required') {
    break;
  }

  switch (current.reason) {
    case 'staging_recovery':
      recoveryActions.push(...await recoverWithLockHeld(...));
      break;

    case 'archive_recovery': {
      const restored = await restoreArchivedTurnsWithLockHeld(...);
      archivesRestored += restored.archivesRestored ?? 0;
      break;
    }
  }

  current = await inspectCompressionLifecycleState(...);
}
```

冻结 invariant：

```text
normalization success
→ healthy_plain | healthy_compacted

normalization cannot converge
→ ARCHIVE_STATE_INVALID
```

`MAX_NORMALIZATION_STEPS` 只防御实现 bug / 非预期磁盘变化，不是正常业务分支。

Recovery 本身不是 compression trigger。每次 recovery mutation 后必须重新 inspection；只有归一化后的 healthy snapshot 才进入 live gate。

---

## 11. Authoritative live gate

Normalization 后：

```text
healthy live < trigger
→ build below_threshold result
→ no healthy archive restore
→ no semantic provider
→ no further Conversation/archive mutation
```

如果：

```text
healthy live >= trigger
```

才进入 source evaluation。

冻结行为：

```text
healthy_plain + trigger reached
→ evaluate current plain source

healthy_compacted + trigger reached
→ restore healthy archive to original source
→ evaluate restored source
```

关键 invariant：

> **A healthy compact archive may be restored for normal recompression only after the lock-held healthy live trigger is confirmed.**

---

## 12. Shared compression engine

冻结从当前 `compressDirectoryWithLockHeld()` 提取：

```ts
compressCurrentConversationWithLockHeld(...)
```

前置条件：

> 当前顶层 Conversation 是本次 source evaluation 的 authoritative plain/original source。

职责：

```text
capture generation
→ scan source turns
→ calculate threshold / selection
→ generate summary if required
→ generation re-check
→ prepare staging
→ commit archive
```

它不负责：

```text
recovery normalization
restore existing healthy archive
automatic orchestration
filesystem lock acquisition
```

Manual API 继续组合：

```text
compressDirectoryWithLockHeld()
→ recover
→ restore existing archive
→ compressCurrentConversationWithLockHeld()
```

Automatic API 组合：

```text
coordinate
→ normalize
→ live gate
→ optional restore
→ compressCurrentConversationWithLockHeld()
```

不允许通过：

```text
skipRestore
alreadyRecovered
trustPlan
forceCompression
```

等 mode flags 模拟两个 lifecycle。

---

## 13. Trigger reached 不保证 fresh commit

Live compact trigger 只授权：

> 可以展开 durable original source，再由 source engine 独立判断 fresh compression 是否值得发生。

因此：

```text
healthy_compacted
→ live trigger reached
→ restore original
→ compressCurrentConversationWithLockHeld()
```

合法结果：

```text
compressed
→ fresh healthy_compacted

below_threshold
→ healthy_plain

no_turns_to_compress
→ healthy_plain
```

同样，`healthy_plain + trigger reached` 进入 engine 后，也允许因 engine 的权威 source scan 得出 skip，或因 generation conflict fail closed/retryable。

这使状态机不依赖：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
```

才能闭合。

Automatic wrapper 必须把 normalization / normal restore 产生的：

```text
recoveryActions
archivesRestored
```

合并进最终 `CompressResult`，即使 shared engine 自身不拥有这些动作。

---

## 14. Fresh semantic summary source invariant

Triggered compact recompression：

```text
archive(original 0..N)
+
live summary1
+
new original N+1..M

→ lock-held live trigger confirmed
→ restore lifecycle removes summary1
→ restore original 0..N
→ obtain original 0..M
→ fresh selection
→ semantic summary2
```

Provider 只能看到 fresh selected original turns。

明确禁止：

```text
summary1 + newer turns → summary2
```

现有 semantic normalization、document validation 与 `sourceTurnIndices` validation 全部继续使用。

---

## 15. Manual dry-run 与 automatic lifecycle 分离

```ts
compressDirectory({ dryRun: true })
```

继续表达：

```text
simulate manual restore-first lifecycle
```

存在 archive/staging 时仍可在 isolated temp copy 中：

```text
recover → restore → source selection
```

`runCompressionBeforeCompletion()` 不再使用 manual dry-run，也不再生成 pre-lock plan。

冻结关系：

```text
manual dry-run != automatic trigger decision
```

---

## 16. Operation Report 升级为 v2

当前 exported `CompressionOperationReport` 已经有 `version` 字段；本次 automatic lifecycle 语义发生实质变化，不继续用 v1 字段承载失真的含义。

冻结：

```text
CompressionOperationReport.version = 2
```

这是 **operation observability contract 的有意 breaking revision**，不是 Archive Protocol / storage migration。

当前 package 仍处于 beta 发布阶段，因此应在实现该契约的下一个 beta release notes 中明确 report v2 migration。

### 16.1 删除 v1 `plan`

Revision 3 不再存在 outer plan，因此 v2 删除：

```text
report.plan
estimate_plan phase
```

不再把 `compressed` 重新解释成“可能考虑 compression path”。

### 16.2 v2 authoritative decision

建议冻结：

```ts
type CompressionDecisionAction =
  | 'skip'
  | 'evaluate_current'
  | 'restore_then_evaluate';

interface CompressionDecisionReport {
  liveState: 'healthy_plain' | 'healthy_compacted';
  liveTokens: number;
  triggerTokens: number;
  triggerReached: boolean;
  action: CompressionDecisionAction;
}
```

`decision` 只在 lifecycle 已成功归一化到 healthy 后存在，并且全部来自 lock-held authoritative state。

映射：

```text
healthy + below trigger
→ action = skip

healthy_plain + trigger
→ action = evaluate_current

healthy_compacted + trigger
→ action = restore_then_evaluate
```

如果在 normalization 前确认 invalid / IO failure，则 `decision` 可以不存在。

### 16.3 v2 phases

冻结 phase：

```text
acquire_exclusive
maintain_context
release_exclusive
completion
```

其中：

```text
maintain_context
=
authoritative inspection
+ recovery normalization
+ healthy live gate
+ optional healthy archive restore
+ optional source compression
```

Phase 回答“lifecycle body 是否成功”；fresh archive 是否产生只看 `commit.state`。

因此 recovery-only / below-threshold 可以合法是：

```text
maintain_context = completed
commit.state = skipped
```

### 16.4 v2 report shape

规范性结构：

```ts
interface CompressionOperationReport {
  version: 2;
  operation: 'compress-before-completion';
  status: 'completed' | 'failed';
  phases: OperationPhaseReport[];
  decision?: CompressionDecisionReport;
  recoveryActions: string[];
  archivesRestored: number;
  selection: CompressResult['selection'];
  budget?: ContextBudgetReport;
  commit: {
    state: 'not_started' | 'committed' | 'skipped';
    summaryIdx?: number;
  };
  error?: {
    code: LifecycleErrorCode;
    message: string;
    retryable: boolean;
  };
}
```

`archivesRestored` 在 v2 中是 required field，默认 `0`。

`CompressionLifecycleResult<T>` 保持成功/失败 union 形态，但其 `report` 使用 v2。

### 16.5 Phase failure matrix

冻结：

```text
lock acquisition fails:
  acquire_exclusive failed
  maintain_context skipped
  release_exclusive skipped
  completion skipped

maintain_context fails after lock acquired:
  acquire_exclusive completed
  maintain_context failed
  release_exclusive completed | failed
  completion skipped

release fails after successful maintain:
  release_exclusive failed
  completion skipped

completion fails after successful release:
  completion failed
  report.status = failed
  commit preserves actual lifecycle fact
```

Invalid lifecycle 必须在 `maintain_context` fail，completion 不执行。

---

## 17. Error taxonomy 冻结

新的 shared inspection/recovery code 不应依赖 error message regex 才能表达 domain failure。

冻结 package-private tagged lifecycle error boundary，例如：

```ts
interface TaggedLifecycleError extends Error {
  lifecycleErrorCode: LifecycleErrorCode;
  retryable?: boolean;
}
```

至少保证：

```text
structural archive/staging contradiction
→ ARCHIVE_STATE_INVALID

active lifecycle lock blocker
→ LIFECYCLE_LOCKED

source generation changed
→ CONVERSATION_CHANGED

semantic provider failure
→ SUMMARY_PROVIDER_FAILED

budget/tokenizer/options invalid
→ existing corresponding code

filesystem stat/read/write/permission failure
→ IO_ERROR

completion callback failure
→ COMPLETION_FAILED
```

现有 `classifyLifecycleError()` 可以保留 legacy fallback，但**新提取的 inspection/normalization path 必须优先抛 tagged errors**，不得继续扩大基于文案 regex 的 domain classification。

Public report 继续只暴露 safe message，不暴露 conversation content、provider payload 或内部 path details。

---

## 18. Concurrency / generation

### Cooperating writers

Automatic lifecycle 始终先取得现有 filesystem lifecycle lock，再读取 trigger-authoritative state。

因此不存在：

```text
another cooperating writer already owns mutation authority
but automatic completion starts from a lock-free stale snapshot
```

### Non-cooperating writers

filesystem lock 不阻止不遵守 lifecycle API 的 writer。

一旦 current/restored original Conversation 进入 shared compression engine，继续使用：

```text
captureConversationGeneration()
assertConversationGeneration()
```

保护 source scan/provider 到 first staging mutation 之间的变化。

### Completion

```text
release this lifecycle lock
→ completion callback
```

同进程 orchestrator queue 继续覆盖 active completion。

本次不承诺跨进程 completion transaction。

---

## 19. 文件与职责冻结

### `src/restore/inspection.ts` — 新增

```text
inspectStagingState()
inspectArchiveSet()
shared read-only mutation preconditions
```

### `src/restore/index.ts`

```text
recover/restore reuse inspection rules
public restore API semantics unchanged
```

### `src/restore/scanner.ts`

reserved staging path discovery 必须能区分：

```text
absent
directory
present-but-invalid-type
```

不得继续把 non-directory reserved path 等价为 absent。

### `src/compress/live-state.ts` — 新增

```text
inspectCompressionLifecycleState()
structural classification first
healthy-only token scan
discriminated union
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

最终流程：

```text
serialize
→ acquire lock
→ inspect/normalize
→ authoritative live gate
→ optional restore
→ shared source engine
→ release
→ completion
```

删除：

```text
compressDirectory(dryRun=true) automatic planner
pre-lock live scan
stale-plan test seam
```

### `src/compress/types.ts`

- package-private lifecycle inspection types 不从 root export；
- `CompressionOperationReport` 升为 `version: 2`；
- `OperationPhaseReport.phase` 改为 v2 phases；
- 删除 public `plan`；
- 新增 `decision?`；
- `archivesRestored` 为 required；
- 不新增 public trigger/options flags。

---

## 20. Compatibility / migration

Storage/protocol 不变：

```text
Archive Protocol                 v1 unchanged
compression.json                version 1 unchanged
Conversation Protocol            unchanged
archive naming                   unchanged
restore data semantics           unchanged
semantic provider schema         unchanged
sourceTurnIndices                unchanged
compressDirectory manual API     unchanged
manual dry-run                   unchanged
```

Automatic API 的 **behavioral intent** 改变：

```text
trigger basis
restored original → lock-held current live
```

Operation observability 明确升级：

```text
CompressionOperationReport v1 → v2
```

v2 migration：

```text
remove report.plan
remove estimate_plan phase
rename compress lifecycle phase → maintain_context
add authoritative decision
add required archivesRestored
```

这不是 archive manifest migration，不需要 `compression.json` v2，也不需要 archive 原地升级。

---

## 21. Normative acceptance tests

### 21.1 Healthy steady state

```text
healthy-compacted-live-below-threshold-does-not-restore
healthy-compacted-live-below-threshold-does-not-call-semantic-provider
healthy-compacted-live-below-threshold-preserves-conversation-bytes
healthy-compacted-live-below-threshold-preserves-archive-bytes
healthy-compacted-live-below-threshold-preserves-summary-bytes
healthy-below-threshold-still-acquires-and-releases-lifecycle-lock
healthy-below-threshold-completion-runs-after-release
```

### 21.2 Triggered recompression

```text
healthy-compacted-live-trigger-restores-original
recompression-removes-old-live-summary-through-restore
recompression-provider-excludes-previous-summary
recompression-provider-includes-restored-original-turns
recompression-provider-called-exactly-once
recompression-commits-one-fresh-archive
```

### 21.3 Trigger reached but source skips

```text
triggered-compact-restored-source-below-threshold-stays-plain
triggered-compact-restored-source-no-turns-stays-plain
restored-source-skip-does-not-call-semantic-provider-when-not-required
restored-source-skip-reports-commit-skipped
restored-source-skip-reports-archives-restored
```

### 21.4 Staging recovery classification

```text
reserved-staging-path-nondirectory-is-invalid
staging-plus-archive-is-invalid
staging-target-conflict-is-invalid
recoverable-staging-rolls-back-under-lock
staging-recovery-reinspects-before-live-gate
staging-recovery-below-trigger-skips-compression
staging-recovery-above-trigger-enters-source-evaluation
```

### 21.5 Archive recovery classification

```text
invalid-archive-metadata-fails-closed
archive-set-duplicate-idx-fails-closed
archive-set-duplicate-file-fails-closed
archive-restore-target-conflict-fails-closed
valid-archive-missing-summary-classifies-archive-recovery
archive-recovery-restores-original-before-live-gate
archive-recovery-below-trigger-stays-plain
normalization-converges-or-fails-closed
```

### 21.6 Coordination / generation

```text
cooperating-writer-lock-blocks-automatic-lifecycle-before-inspection
completion-never-runs-before-this-lifecycle-release
same-process-next-orchestrator-waits-for-active-completion
noncooperating-source-change-still-triggers-conversation-changed
```

### 21.7 Operation report v2

```text
report-version-is-2
report-has-no-plan
report-has-no-estimate-plan-phase
healthy-skip-decision-is-authoritative
triggered-compacted-decision-is-restore-then-evaluate
recovery-only-report-records-archives-restored
maintain-context-completed-with-commit-skipped-is-valid
invalid-state-maintain-context-fails-and-completion-skips
lock-failure-phase-matrix-is-stable
completion-failure-preserves-commit-fact
```

### 21.8 Error taxonomy

```text
staging-domain-invalid-maps-to-archive-state-invalid
archive-domain-invalid-maps-to-archive-state-invalid
lock-blocker-maps-to-lifecycle-locked
io-error-does-not-become-archive-state-invalid-by-message-text
new-inspection-errors-use-tagged-code-before-regex-fallback
```

### 21.9 Manual regression

```text
compressDirectory-existing-archive-still-restores-before-manual-recompress
compressDirectory-dry-run-existing-archive-still-simulates-restore
restoreArchivedTurns-contract-unchanged
archive-protocol-conformance-unchanged
```

---

## 22. Critical end-to-end scenarios

### 22.1 Compact steady state

```text
Given:
  healthy_compacted
  live < trigger

When:
  runCompressionBeforeCompletion()

Then:
  acquire lock
  inspect healthy compact live
  decision = skip
  no restore
  no provider
  no Conversation/archive mutation
  release
  completion
```

### 22.2 Compact threshold crossing

```text
Given:
  healthy_compacted
  live >= trigger

Then:
  acquire lock
  decision = restore_then_evaluate
  restore original source
  evaluate original source
  if warranted: fresh compact commit
  else: remain healthy_plain
  release
  completion
```

### 22.3 Recoverable staging

```text
Given:
  staging directory
  no archive
  rollback targets clear

Then:
  acquire lock
  staging_recovery
  re-inspect
  healthy state obtained
  live gate decides independently
```

### 22.4 Archive without matching live summary

```text
Given:
  valid/restorable archive
  missing matching top-level summary

Then:
  archive_recovery
  restore original
  re-inspect
  live gate
  never infer whether historical crash was commit-side or restore-side
```

### 22.5 Invalid staging target conflict

```text
Given:
  staging contains [N]...
  same rollback target already exists top-level

Then:
  classify invalid before mutation
  maintain_context fails ARCHIVE_STATE_INVALID
  no overwrite
  completion skipped
```

---

## 23. High-value lifecycle loop

```text
1. original Conversation > trigger
2. automatic lifecycle
   → lock
   → healthy_plain trigger
   → source compression
   → healthy_compacted
   → providerCalls = 1

3. append small newer turns
   → compact live below trigger

4. repeat automatic completion calls
   → lock
   → decision skip
   → no restore
   → providerCalls stays 1
   → archive/summary unchanged

5. append until compact live reaches trigger

6. automatic lifecycle
   → lock
   → decision restore_then_evaluate
   → restore original
   → source engine
      ├─ compressed → fresh healthy_compacted, providerCalls = 2
      └─ skipped    → healthy_plain
   → release
   → completion
```

这条 loop 覆盖 normal steady state、threshold crossing、source skip 三个正常终态。

---

## 24. Explicit non-solutions

拒绝：

```text
caller scans tokens
summary-of-summary
pre-lock automatic live scan
outer-only trigger if + manual compress path
skipRestore / alreadyRecovered / trustPlan flags
missing summary = corruption
staging-only = automatically recoverable without target validation
preserving report v1 by redefining misleading field meanings
```

原因分别是 ownership 泄漏、semantic drift、重复扫描/双 authority、restore-before-trigger 仍存在、非法组合爆炸、错误 crash recovery、潜在覆盖、以及 public observability 失真。

---

## 25. Deferred hardening

以下不属于本次 implementation gate：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
tokensAfter < triggerTokens
summary byte integrity validation
rolling/incremental summary
cross-process completion transaction
```

本次状态机必须在没有这些假设时闭合。

---

## 26. Recommended implementation commits

### Commit 1 — behavior-preserving refactor

```text
refactor(compress): extract lifecycle inspection and current-source engine
```

- add shared restore/staging/archive inspection；
- make recover/restore reuse inspection rules；
- fix reserved staging path type detection；
- extract `compressCurrentConversationWithLockHeld()`；
- all existing manual tests remain green；
- no automatic semantic switch yet。

### Commit 2 — automatic live-trigger lifecycle

```text
feat(compress): gate archive restore on authoritative live state
```

- add discriminated lifecycle state；
- remove automatic dry-run planner；
- coordinate before inspection；
- recovery normalization loop；
- healthy-only live token gate；
- archive recovery semantics；
- source skip path；
- lifecycle action aggregation into `CompressResult`；
- tagged domain errors。

### Commit 3 — operation report v2 + acceptance

```text
test(docs): activate live-trigger lifecycle and report v2
```

- switch report to v2；
- remove plan / estimate_plan；
- add decision / maintain_context；
- full acceptance matrix；
- release-note migration note；
- only after green, update `DESIGN.md` to Active Design。

---

## 27. Freeze checklist

- [x] automatic trigger authority exists only under filesystem lock；
- [x] pre-lock live scan removed；
- [x] current live token formula frozen；
- [x] recovery/invalid states do not compute non-authoritative token decisions；
- [x] lifecycle state uses discriminated union；
- [x] state names describe observable facts/actions, not guessed crash history；
- [x] reserved staging path non-directory = invalid；
- [x] staging rollback target conflict = invalid；
- [x] staging + archive = invalid；
- [x] archive validation/restore-target conflicts frozen；
- [x] missing matching summary = archive_recovery；
- [x] summary correspondence = presence only；
- [x] shared read-only recovery/restore preconditions are single-source；
- [x] normalization must converge to healthy or fail closed；
- [x] recovery is not compression trigger；
- [x] healthy archive restore requires lock-held live trigger；
- [x] restored source may legitimately skip fresh compression；
- [x] semantic provider source remains original turns；
- [x] manual restore-first semantics preserved；
- [x] manual dry-run semantics preserved；
- [x] operation report intentionally upgraded to v2；
- [x] v2 removes misleading plan semantics；
- [x] v2 phase/decision/commit responsibilities are distinct；
- [x] domain error taxonomy uses tagged errors before regex fallback；
- [x] storage/archive protocol versions unchanged；
- [x] effective-compaction hardening deferred；
- [x] acceptance coverage spans healthy/recovery/invalid/report/error/manual paths。

---

## 28. Definition of done

Automatic lifecycle 只有这一条 authority chain：

```text
serialize
→ filesystem lifecycle coordination
→ authoritative lifecycle inspection
→ recovery normalization
→ authoritative healthy live gate
→ optional healthy archive restore
→ independent original-source compression decision
→ release
→ completion
```

最终合法 terminal state：

```text
healthy_compacted
healthy_plain
failed closed
```

Normal steady state：

```text
healthy_compacted + live below trigger
→ coordinate
→ decision skip
→ no restore
→ no provider
→ no Conversation/archive mutation
→ completion
```

Triggered compact state：

```text
healthy_compacted + live reaches trigger
→ coordinate
→ restore original
→ shared source engine
   ├─ fresh commit → healthy_compacted
   └─ skip         → healthy_plain
→ completion
```

Recovery state：

```text
recoverable
→ normalize
→ re-inspect
→ healthy live gate

invalid / ambiguous / conflicting
→ fail closed
→ no completion
```

最终原则：

> **One coordination boundary. One trigger authority. One original-source compression engine.**
>
> **Live state decides when; original state decides what.**
>
> **Recovery normalizes; it never implicitly triggers compression.**
