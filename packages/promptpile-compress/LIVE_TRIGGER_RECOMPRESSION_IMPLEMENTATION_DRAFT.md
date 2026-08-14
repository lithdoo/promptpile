# promptpile-compress Live Trigger Recompression 冻结实施契约

> Status: **Frozen Implementation Contract — Revision 4.1 / Final Freeze Errata**  
> Date: 2026-08-14  
> Target: `packages/promptpile-compress`  
> Primary API: `runCompressionBeforeCompletion()`  
> Manual API preserved: `compressDirectory()`  
> Supersedes: `LIVE_TRIGGER_RECOMPRESSION_DRAFT.md` and Revision 1–4 of this contract  
> Change policy: 实施过程中如需改变本文的 lifecycle state、trigger authority、recovery/restore 语义、filesystem coordination、summary source、fresh commit fact、error precedence 或 Operation Report v2，必须先修改本文并重新评审。

> 文件名暂时保留 `IMPLEMENTATION_DRAFT.md`，避免 implementation 前产生纯治理性的 path churn；**Status header 是规范性状态**。实现验收并同步 `DESIGN.md` 后，可单独 rename。

## 1. 最终冻结结论

当前问题不是 archive / restore 本身错误，而是 automatic orchestrator 复用了 manual compression 的 restore-first trigger 语义：

```text
recover
→ restore existing archive
→ scan restored Conversation
→ threshold
→ select
→ summarize
→ commit
```

一旦 archive 存在，automatic completion 会先展开 full original history，再决定是否需要 compression；因此第一次 compression 后，即使 Agent 当前真正使用的 compact live Conversation 很小，后续 call 仍可能反复 restore + provider + recompress。

Automatic lifecycle 最终只允许这一条 authority chain：

```text
prepare request
→ serialize per directory
→ acquire filesystem lifecycle lock
→ authoritative lifecycle inspection
→ optional exactly-once recovery
→ re-inspect after recovery
→ authoritative healthy live gate
→ optional healthy archive restore
→ independent original-source compression evaluation
→ release lock
→ completion
```

冻结原则：

> **One coordination boundary. One trigger authority. One original-source engine.**
>
> **Coordinate first; mutate only from authoritative state.**
>
> **Live state decides when; original state decides what.**
>
> **Recovery normalizes; it never implicitly triggers compression.**
>
> **Reports describe confirmed invocation facts; filesystem inspection defines lifecycle truth.**

---

## 2. 优化目标、非目标与兼容边界

### 2.1 目标

对已经 healthy 且 live below trigger 的 automatic call：

```text
zero healthy-archive restore
zero semantic-provider call
zero Conversation/archive mutation
```

filesystem lifecycle lock 的创建/释放属于 coordination，不属于 Conversation/archive mutation，也不是本次要消除的成本。

### 2.2 非目标

```text
zero lock acquisition
pre-lock live gate
summary-of-summary
rolling/incremental summary
summary effectiveness invariant
cross-process completion transaction
non-cooperating restore/recovery transaction protocol
```

本次真正消除的是：

```text
full original restore
+ semantic provider
+ repeated recompression
```

### 2.3 保持不变

```text
Archive Protocol                 v1
compression.json                version 1
Conversation Protocol            unchanged
valid archive naming             unchanged
semantic provider schema         unchanged
sourceTurnIndices                unchanged
compressDirectory manual API     restore-first unchanged
manual dry-run                   restore-first simulation unchanged
filesystem lifecycle lock        unchanged
same-process orchestrator queue  unchanged
```

### 2.4 有意 safety tightening

以下 malformed/private lifecycle state 统一 fail closed：

- reserved staging path 不是 real directory；
- archive-shaped path 不是 real directory；
- matching live summary path 存在但不是 regular file；
- staging rollback target conflict；
- archive restore target conflict。

这是 malformed-state handling 的安全收紧，不是 storage migration。

---

## 3. Automatic request preparation 与 phase boundary

Automatic 入口固定为：

```text
assert/resolve directory + options/tokenizer
→ serializeOrchestratorPhase(directory)
→ acquire lifecycle lock
→ first authoritative inspection
```

lock 前：

- 不扫描/tokenize Conversation；
- 不生成 tentative plan；
- 不存在 outer/inner trigger 分歧；
- 不需要 stale-plan test seam。

如果 directory/options/tokenizer 在任何 lifecycle phase 启动前失败，Operation Report v2 固定为：

```text
status = failed
phases = []
decision absent
selection absent
budget absent
recoveryActions = []
archivesRestored = 0
commit = { state: 'not_started' }
error = tagged INVALID_OPTIONS | IO_ERROR | ...
```

不新增假的 `validate` phase，也不把 request-preparation failure 伪装成 lock failure。

---

## 4. Lifecycle state 只描述磁盘事实

State machine 不猜测“之前发生了哪一种 crash”。

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
  | 'archive_path_invalid'
  | 'archive_metadata_invalid'
  | 'archive_set_conflict'
  | 'archive_target_conflict'
  | 'archive_summary_path_invalid';

type LifecycleFailureReason =
  | InvalidLifecycleReason
  | 'recovery_did_not_normalize';

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

`InvalidLifecycleReason` 只描述 observation。`recovery_did_not_normalize` 是 transition failure，因此属于更宽的 `LifecycleFailureReason`，不伪装成磁盘 observation。

Recovery/invalid variants 不携带 `LiveSnapshot`：归一化前的 token count 没有 trigger authority。

禁止退化成：

```text
state + independent booleans + caller guessing combinations
```

---

## 5. Exhaustive structural classification

### 5.1 Reserved staging path

`.promptpile-compress.staging` 必须使用 **lstat / directory-entry type** 语义，不跟随 symlink：

```text
absent
→ continue

real directory
→ inspect staging

symlink / regular file / other type
→ invalid: staging_path_invalid
```

### 5.2 Staging

```text
staging + committed archive
→ invalid: staging_archive_conflict

staging + no archive + rollback targets clear
→ recovery_required: staging_recovery

staging + no archive + rollback target conflict
→ invalid: staging_target_conflict
```

Staging-only 不天然等于 recoverable。

### 5.3 Archive-shaped paths

任何匹配：

```text
[N]system.md.archive
```

的 lifecycle path 必须是 real directory：

```text
matching real directory
→ archive validation

matching symlink / regular file / other type
→ invalid: archive_path_invalid
```

不得因为 legacy discovery 只返回 directories 就静默忽略 malformed archive-shaped path。

### 5.4 Archive set

没有 staging 时：

```text
no valid/malformed archive-shaped path
→ healthy_plain

archive metadata invalid
→ invalid: archive_metadata_invalid

duplicate idx/file or ambiguous archive set
→ invalid: archive_set_conflict

restore target conflict
→ invalid: archive_target_conflict

valid/restorable archive + all matching summaries are regular files
→ healthy_compacted

valid/restorable archive + any matching summary absent
→ recovery_required: archive_recovery

matching summary path exists but is not a regular file
→ invalid: archive_summary_path_invalid
```

`archive_recovery` 不区分 commit-side interruption 和 restore-side interruption；两者对当前磁盘事实的安全动作相同：restore authoritative originals。

### 5.5 Summary correspondence 与 orphan summary boundary

本次只验证：

```text
archive [N]system.md.archive
has live representation
=
top-level [N]system.md is a regular file
```

本次不做 summary byte comparison、semantic marker integrity，也不把 archive 私有 `.summary.md` 提升为 public contract。

如果 **没有 authoritative archive**，单独存在的 `[N]system.md` 只按普通 Conversation artifact 处理。外部删除/丢失 archive 后留下 orphan summary 属于 reversible-lifecycle guarantee 之外；orphan-summary detection 不在本次范围。

---

## 6. Shared read-only inspection ownership

新增 package-private：

```text
src/restore/inspection.ts
```

至少承载等价职责：

```ts
inspectStagingState(directory)
inspectArchiveSet(directory)
```

它们是 recovery/restore mutation preconditions 的唯一 source of truth，负责：

- strict staging/archive-shaped path type；
- staging message discovery；
- rollback target conflicts；
- `compression.json` validity；
- archive idx / archivedTurnIndices consistency；
- duplicate idx / archived message file；
- restore target conflicts；
- matching live summary path type/presence。

`recoverWithLockHeld()`、`restoreArchivedTurnsWithLockHeld()` 与 automatic lifecycle 必须复用这些规则，不复制 validator。

Domain-invalid inspection 返回结构化 invalid state；真实 stat/read/permission failure 抛 tagged IO error。

新增 package-private：

```text
src/compress/live-state.ts

inspectCompressionLifecycleState(...)
```

执行顺序：

```text
structural inspection
→ recovery/invalid classification if applicable
→ only if healthy: scan top-level Conversation
→ calculate live snapshot
```

Inspection 必须 read-only。

---

## 7. Live token 与唯一 trigger authority

只有 healthy state 计算：

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

规则：

- archive contents 不计入；
- staging contents 不计入；
- compact top-level summary 计入；
- newer/original top-level turns 计入；
- system turns 沿用现有 scanner；
- trigger 比较固定使用 `>=`。

Automatic trigger authority 唯一存在于：

> **filesystem lock 内、optional recovery 完成后的 healthy live snapshot。**

---

## 8. Recovery normalization：exactly once

正常 recoverable state 只有两种，且成功后都必须得到 `healthy_plain`：

```text
staging_recovery
→ rollback staging
→ healthy_plain

archive_recovery
→ restore archive originals
→ healthy_plain
```

规范流程：

```ts
let current = await inspectCompressionLifecycleState(...);

if (current.state === 'invalid') {
  throw archiveStateInvalid(current.reason);
}

if (current.state === 'recovery_required') {
  if (current.reason === 'staging_recovery') {
    recoveryActions.push(...await recoverWithLockHeld(...));
  } else {
    const restored = await restoreArchivedTurnsWithLockHeld(...);
    archivesRestored += restored.archivesRestored ?? 0;
  }

  current = await inspectCompressionLifecycleState(...);

  if (current.state !== 'healthy_plain') {
    throw archiveStateInvalid('recovery_did_not_normalize');
  }
}
```

不使用 generic recovery loop / `MAX_NORMALIZATION_STEPS`。一次规定 recovery 后仍未得到 `healthy_plain`，直接 fail closed；不继续猜测或循环 mutation。

Recovery 永远不是 compression trigger，recovery 后必须重新读取 healthy live state。

---

## 9. Healthy live gate 与 automatic `CompressResult`

### 9.1 Below trigger

```text
healthy live < trigger
→ decision = skip
→ no healthy archive restore
→ no semantic provider
→ no further Conversation/archive mutation
→ completion still receives a complete CompressResult
```

Automatic wrapper 必须构造以下语义的 `CompressResult`：

```ts
{
  compressed: false,
  skipReason: 'below_threshold',
  turnsArchived: 0,
  turnsKept: live.turns.length,
  tokensBefore: live.tokens,
  tokensAfter: live.tokens,
  compressibleTokens: estimateTotalTokens(
    live.turns.filter((turn) => !turn.isSystemTurn)
  ),
  budget: createBudgetReport(
    resolvedBudget,
    tokenizer,
    live.tokens,
    live.tokens,
    0
  ),
  recoveryActions,
  archivesRestored,
  selection: {
    archivedTurnIndices: [],
    keptTurnIndices: live.turns.map((turn) => turn.idx),
  }
}
```

`summaryIdx`、`archivePath`、`dryRunPlan` absent。

这里必须区分：

```text
CompressResult.selection
= completion-facing result contract，表达所有 current live turns 被保留

CompressionOperationReport.selection
= original-source selection fact；healthy live skip 时 absent
```

两者不是同一个 observability 语义。

### 9.2 Trigger reached

```text
healthy_plain
→ decision = evaluate_current
→ evaluate current original source

healthy_compacted
→ decision = restore_then_evaluate
→ restore healthy archive
→ evaluate restored original source
```

关键 invariant：

> **A healthy compact archive may be restored for normal recompression only after the lock-held healthy live trigger is confirmed.**

---

## 10. Shared original-source compression engine

从当前 `compressDirectoryWithLockHeld()` 提取：

```ts
compressCurrentConversationWithLockHeld(...)
```

前置条件：当前 top-level Conversation 是 authoritative plain/original source。

职责：

```text
capture generation
→ scan source turns
→ threshold / selection
→ semantic summary if required
→ generation re-check
→ prepare staging
→ publish archive
→ publish live summary
```

它不负责：

```text
recovery
restore existing healthy archive
automatic trigger policy
filesystem lock acquisition
```

Manual path：

```text
compressDirectoryWithLockHeld
→ recover
→ restore existing archive
→ compressCurrentConversationWithLockHeld
```

Automatic path：

```text
coordinate
→ optional recovery
→ live gate
→ optional restore
→ compressCurrentConversationWithLockHeld
```

禁止通过 `skipRestore` / `alreadyRecovered` / `trustPlan` / `forceCompression` 等 mode flags 模拟两套 lifecycle policy。

Automatic wrapper 必须把 recovery / normal restore 已确认得到的 `recoveryActions` 与 `archivesRestored` 合并进最终 `CompressResult`。

---

## 11. Trigger reached 不保证 fresh commit

Live trigger 只决定是否允许进入 source evaluation。

```text
healthy_compacted trigger reached
→ restore original
→ source engine
```

Source engine 合法结果：

```text
compressed
→ fresh healthy_compacted

below_threshold
→ healthy_plain

no_turns_to_compress
→ healthy_plain
```

因此状态机不依赖：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
tokensAfter < triggerTokens
```

才能闭合。

---

## 12. Fresh semantic summary source invariant

Triggered compact recompression：

```text
archive(original 0..N)
+
live summary1
+
new original N+1..M

→ lock-held live trigger confirmed
→ restore removes summary1
→ restore original 0..N
→ original 0..M
→ fresh selection
→ semantic summary2
```

Provider 只能看到 fresh selected original turns。

明确禁止：

```text
summary1 + newer turns → summary2
```

现有 semantic normalization、document validation 与 `sourceTurnIndices` validation 保留。

---

## 13. Fresh commit progress 与 invocation fact

当前 publication protocol：

```text
prepare staging
→ rename staging to committed archive
→ publish matching live summary
```

必须跟踪 package-private progress：

```ts
type FreshCommitProgress =
  | 'not_started'
  | 'archive_published'
  | 'complete';
```

语义：

```text
not_started
= committed archive 尚未成功 publish

archive_published
= archive publication mutation 已发生，
  但本次 invocation 尚未确认完整成功

complete
= publication protocol 完整返回成功
```

Mutation hook 的 `after` 回调发生在 mutation 完成后，因此 progress 必须在**真实 mutation 成功边界**更新，而不能只在 observability wrapper 正常返回后更新。

如果 `archive_published` 后发生任何 error，本次 fresh commit fact 为 `incomplete`。这不声称磁盘一定缺 summary；post-mutation hook failure 时，filesystem 甚至可能已经是 healthy compacted。下一次 lifecycle 仍必须重新 inspection。

---

## 14. Operation Report v2

### 14.1 Phases

```text
acquire_exclusive
maintain_context
release_exclusive
completion
```

```text
maintain_context
=
authoritative inspection
+ optional recovery
+ healthy live gate
+ optional healthy archive restore
+ optional source evaluation/compression
```

Phase 回答 lifecycle step 是否成功；fresh commit outcome 由 `commit` 单独回答。

### 14.2 Decision

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

`decision` 只有在 lifecycle 已经归一化到 healthy 后才存在。

### 14.3 Commit 必须是 discriminated union

禁止 `state + optional summaryIdx` 产生非法组合。冻结：

```ts
type CompressionCommitReport =
  | { state: 'not_started' }
  | { state: 'skipped' }
  | { state: 'incomplete'; summaryIdx: number }
  | { state: 'committed'; summaryIdx: number };
```

其中：

```text
not_started
= invocation 在 fresh archive publication 前结束/失败

skipped
= lifecycle 正常完成，但权威 gate/source engine 正常决定不产生 fresh commit

incomplete
= summaryIdx 已确定且 fresh archive publication 已发生，
  但本次 invocation 未确认 publication protocol complete

committed
= archive + matching live summary publication protocol 完整成功
```

Completion failure 不改变已经确定的 commit fact。

### 14.4 v2 shape

```ts
interface CompressionOperationReport {
  version: 2;
  operation: 'compress-before-completion';
  status: 'completed' | 'failed';
  phases: OperationPhaseReport[];

  decision?: CompressionDecisionReport;
  recoveryActions: string[];
  archivesRestored: number;

  selection?: CompressResult['selection'];
  budget?: ContextBudgetReport;

  commit: CompressionCommitReport;

  error?: {
    code: LifecycleErrorCode;
    message: string;
    retryable: boolean;
  };
}
```

`archivesRestored` required，默认 `0`。

### 14.5 Decision / budget / selection authority

```text
decision
→ trigger-authoritative healthy live snapshot

healthy live skip:
  budget = live decision budget
  report.selection absent

source engine ran:
  budget = source-engine budget
  report.selection = source-engine selection
```

`report.selection` optional 是 execution-depth contract；不要因为 `CompressResult.selection` 必填而伪造 report selection。

### 14.6 Phase matrix

一旦 lifecycle phase 开始，未执行 phase 明确记录 `skipped`：

```text
acquire fails:
  acquire_exclusive failed
  maintain_context skipped
  release_exclusive skipped
  completion skipped

maintain fails:
  acquire_exclusive completed
  maintain_context failed
  release_exclusive completed | failed
  completion skipped

release fails after maintain success:
  acquire_exclusive completed
  maintain_context completed
  release_exclusive failed
  completion skipped

completion fails after release:
  lifecycle facts preserved
  completion failed
  report.status = failed
```

### 14.7 双重 failure 的 error precedence

冻结 root-cause precedence：

```text
maintain_context fails
+ release_exclusive also fails
→ report.error = maintain_context primary error
→ release_exclusive phase = failed
→ release error 不覆盖 primary lifecycle failure

maintain_context succeeds
+ release_exclusive fails
→ report.error = release failure

release succeeds
+ completion fails
→ report.error = COMPLETION_FAILED
```

不要求新增 public `secondaryErrors`；phase status 已足以保留 release failure fact。

### 14.8 Failed maintain 不是 mutation journal

Recovery/restore/source publication 都可能包含多次 filesystem mutation。若 `maintain_context` 中途失败，只有**已经确认到 report builder 的 invocation facts**可以写入 `recoveryActions` / `archivesRestored` / `commit`。

冻结原则：

> **A failed `maintain_context` report is not a mutation journal.**

磁盘最终状态必须由下一次 authoritative inspection 判断；不得从上一次 report 反推完整 filesystem state。

---

## 15. Error taxonomy

新 inspection/normalization path 必须优先使用 tagged lifecycle errors，不继续扩大 message-regex domain classification。

```ts
interface TaggedLifecycleError extends Error {
  lifecycleErrorCode: LifecycleErrorCode;
  retryable?: boolean;
}
```

至少冻结：

```text
structural archive/staging contradiction
→ ARCHIVE_STATE_INVALID

recovery_did_not_normalize
→ ARCHIVE_STATE_INVALID

active lifecycle lock blocker
→ LIFECYCLE_LOCKED

source generation changed
→ CONVERSATION_CHANGED

semantic provider failure
→ SUMMARY_PROVIDER_FAILED

budget/tokenizer/options invalid
→ corresponding existing code

filesystem stat/read/write/permission failure
→ IO_ERROR

completion callback failure
→ COMPLETION_FAILED
```

现有 regex classifier 只作为 legacy fallback。

Public error message 继续脱敏，不暴露 Conversation content、provider payload 或内部敏感 path detail。

---

## 16. Concurrency 与 atomicity 边界

### 16.1 Cooperating writers

Automatic lifecycle 先 acquire filesystem lock，再读取 trigger-authoritative state。Cooperating lifecycle writers 共享唯一 mutation authority。

### 16.2 Non-cooperating source writers

一旦 original source 进入 shared compression engine，继续使用：

```text
captureConversationGeneration
→ scan/provider
→ assertConversationGeneration
→ first staging mutation
```

防止 source planning 后被绕过 lifecycle API 的 writer 静默改变。

### 16.3 Recovery/restore TOCTOU

Recovery/restore 的 target-conflict precondition 与后续 rename/unlink 之间，filesystem lock 只能排斥 cooperating lifecycle writers。

本次不承诺对完全绕过 lifecycle API 的 filesystem writer 提供 restore/recovery transaction atomicity，也不把 compression generation guard 扩张为 recovery/restore CAS。

### 16.4 Completion

```text
release this lifecycle lock
→ completion callback
```

same-process orchestrator queue 继续覆盖 active completion；跨进程 completion transaction 不在本次范围。

---

## 17. Manual dry-run 与 automatic lifecycle 分离

```ts
compressDirectory({ dryRun: true })
```

继续模拟 manual restore-first lifecycle：

```text
recover → restore → source selection
```

`runCompressionBeforeCompletion()`：

```text
不调用 manual dry-run
不生成 pre-lock plan
```

冻结：

```text
manual dry-run != automatic trigger decision
```

---

## 18. 文件与实施提交边界

### Commit 1 — pure behavior-preserving refactor

```text
refactor(compress): extract lifecycle inspection primitives and source engine
```

- 提取现有 archive validation / target precondition primitive；
- 提取 `compressCurrentConversationWithLockHeld()`；
- 不切换 malformed-state 新行为；
- existing tests 全绿。

### Commit 2 — authoritative live-trigger + safety semantics

```text
feat(compress): gate archive restore on authoritative live state
```

- strict staging/archive/summary path inspection；
- discriminated lifecycle state；
- no pre-lock scan；
- exactly-once recovery；
- healthy-only live gate；
- explicit automatic below-trigger `CompressResult`；
- archive recovery；
- source skip；
- tagged lifecycle errors；
- commit progress tracking；
- automatic dry-run planner removed。

### Commit 3 — report v2 + acceptance / active design

```text
test(docs): activate live-trigger lifecycle and report v2
```

- v2 phases / decision；
- optional report selection；
- discriminated commit report；
- error precedence tests；
- acceptance matrix；
- beta migration release note；
- implementation green 后更新 `DESIGN.md` 为唯一 Active Design。

---

## 19. Operation Report migration

```text
CompressionOperationReport v1 → v2
```

迁移：

```text
remove plan
remove estimate_plan
rename compress phase → maintain_context
add authoritative decision
make report.selection optional
add required archivesRestored
replace commit state+optional-summaryIdx with discriminated commit union
add incomplete commit fact
```

这是 public observability breaking change，不是 Archive Protocol / `compression.json` migration。当前 package 为 beta；实现该契约的下一个 beta release notes 必须明确迁移。

---

## 20. Normative acceptance tests

### 20.1 Healthy steady state

```text
healthy-compacted-live-below-threshold-does-not-restore
healthy-compacted-live-below-threshold-does-not-call-provider
healthy-compacted-live-below-threshold-preserves-conversation-bytes
healthy-compacted-live-below-threshold-preserves-archive-bytes
healthy-below-threshold-still-coordinates-through-lock
healthy-skip-compress-result-keeps-all-live-turns
healthy-skip-compress-result-uses-live-budget
healthy-skip-report-has-decision-but-no-selection
completion-receives-complete-compress-result
completion-runs-after-release
```

### 20.2 Triggered/source evaluation

```text
healthy-compacted-trigger-restores-original
provider-input-excludes-previous-summary
provider-input-includes-restored-original-turns
provider-called-exactly-once
fresh-commit-returns-healthy-compacted
restored-source-below-threshold-stays-plain
restored-source-no-turns-stays-plain
source-skip-commit-is-skipped
source-engine-report-selection-is-present
archives-restored-is-aggregated-into-compress-result
```

### 20.3 Recovery / invalid state

```text
staging-nondirectory-or-symlink-is-invalid
staging-plus-archive-is-invalid
staging-target-conflict-is-invalid
recoverable-staging-rolls-back-exactly-once
staging-recovery-reinspect-must-be-healthy-plain
archive-shaped-file-or-symlink-is-invalid
invalid-archive-metadata-or-set-fails-closed
archive-restore-target-conflict-fails-closed
matching-summary-nonregular-path-is-invalid
missing-summary-classifies-archive-recovery
archive-recovery-restores-exactly-once
archive-recovery-reinspect-must-be-healthy-plain
recovery-did-not-normalize-maps-to-archive-state-invalid
```

### 20.4 Commit facts

```text
failure-before-archive-publication-commit-not-started
failure-after-archive-publication-commit-incomplete-with-summary-idx
post-mutation-hook-failure-does-not-report-skipped
successful-publication-commit-committed-with-summary-idx
commit-union-does-not-allow-skipped-with-summary-idx
next-lifecycle-reclassifies-filesystem-independently-of-prior-report
completion-failure-preserves-committed-fact
```

### 20.5 Report v2 / error precedence

```text
report-version-is-2
report-has-no-plan-or-estimate-plan
pre-lifecycle-failure-has-empty-phases
lock-failure-phase-matrix-is-stable
healthy-skip-report-selection-is-absent
source-evaluation-report-selection-is-present
maintain-failure-primary-error-survives-release-failure
release-only-failure-becomes-report-error
completion-failure-is-completion-failed
failed-maintain-report-is-not-treated-as-mutation-journal
```

### 20.6 Manual regression

```text
compressDirectory-existing-archive-still-restore-first
manual-dry-run-still-simulates-restore
valid restore contract unchanged
archive protocol conformance unchanged
```

---

## 21. Critical end-to-end flows

### Compact steady state

```text
healthy_compacted + live < trigger
→ lock
→ authoritative decision skip
→ complete below_threshold CompressResult
→ no restore/provider/Conversation mutation
→ report selection absent
→ commit skipped
→ release
→ completion
```

### Compact threshold crossing

```text
healthy_compacted + live >= trigger
→ lock
→ decision restore_then_evaluate
→ restore original
→ source engine
   ├─ committed → healthy_compacted
   └─ skipped   → healthy_plain
→ release
→ completion
```

### Recovery

```text
recoverable state
→ exactly one prescribed recovery
→ re-inspect
   ├─ healthy_plain → live gate
   └─ anything else → ARCHIVE_STATE_INVALID
```

### Fresh commit interrupted

```text
source engine starts publication
→ archive published
→ later invocation step fails
→ maintain_context failed
→ commit incomplete(summaryIdx)
→ release attempt

next lifecycle
→ ignore prior report as state authority
→ inspect filesystem
   ├─ archive_recovery → restore originals → live gate
   ├─ healthy_compacted → normal live gate
   └─ invalid → fail closed
```

---

## 22. Explicit non-solutions / deferred hardening

拒绝：

```text
caller-side token gate
summary-of-summary
pre-lock automatic live scan
outer-only if + manual compression path
skipRestore / alreadyRecovered / trustPlan flags
generic multi-step recovery loop
missing summary = corruption
staging-only = automatically recoverable without target validation
malformed archive-shaped path silently ignored
preserve report v1 by redefining misleading fields
required empty report selection when no source selection happened
commit state + optional summaryIdx illegal combinations
commit failure reported as skipped
```

Deferred：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
tokensAfter < triggerTokens
summary byte-integrity verification
orphan-summary detection after external archive loss
rolling/incremental summary
cross-process completion transaction
non-cooperating restore/recovery transaction protocol
```

状态机必须在没有这些假设时闭合。

---

## 23. Final freeze checklist

- [x] one filesystem coordination boundary；
- [x] no pre-lock live scan；
- [x] one lock-held trigger authority；
- [x] lifecycle state is discriminated and fact-based；
- [x] lifecycle observation reason 与 transition failure reason 分离；
- [x] staging/archive/summary path type rules explicit；
- [x] recovery exactly once then re-inspect；
- [x] non-normalized recovery fails closed；
- [x] recovery never acts as trigger；
- [x] healthy archive restore requires live trigger；
- [x] automatic below-trigger `CompressResult` fully frozen；
- [x] completion-facing result 与 report selection semantics 分离；
- [x] original source independently decides fresh compression；
- [x] restored source may legitimately skip；
- [x] semantic source excludes previous summary；
- [x] fresh commit progress explicit；
- [x] commit report is discriminated union；
- [x] incomplete commit representable；
- [x] pre-lifecycle failure phases frozen；
- [x] dual-failure error precedence frozen；
- [x] failed maintain report explicitly not a mutation journal；
- [x] tagged domain errors precede regex fallback；
- [x] cooperating/non-cooperating writer boundary explicit；
- [x] external archive-loss/orphan-summary trust boundary explicit；
- [x] manual restore-first semantics preserved；
- [x] manual dry-run preserved；
- [x] malformed-state safety tightening documented；
- [x] report v2 migration explicit；
- [x] storage protocol unchanged；
- [x] acceptance coverage spans healthy/recovery/invalid/partial-commit/report/error/manual paths。

---

## 24. Definition of done

Automatic lifecycle 只有：

```text
prepare
→ serialize
→ coordinate
→ inspect
→ optional one-shot recovery
→ re-inspect if recovered
→ healthy live gate
→ optional restore
→ original-source engine
→ release
→ completion
```

正常 terminal state：

```text
healthy_compacted
healthy_plain
```

失败 terminal outcome：

```text
failed closed
```

失败后 filesystem 可能处于 recoverable intermediate state。下一次 lifecycle 必须通过 authoritative inspection 重新分类；不得相信上一次 report 作为 state authority，也不得把 failed report 当成完整 mutation journal。

最终 steady-state loop：

```text
large plain
→ compress once
→ healthy_compacted

compact live below trigger
→ repeated automatic calls
→ coordinate only
→ no restore/provider/recompression

compact live reaches trigger
→ restore original
→ source evaluation
   ├─ fresh compact commit
   └─ remain plain
```

最终原则：

> **One coordination boundary. One trigger authority. One original-source engine.**
>
> **Live state decides when; original state decides what.**
>
> **Recovery is one-shot normalization, not a trigger.**
>
> **Reports describe confirmed invocation facts; filesystem inspection defines lifecycle truth.**