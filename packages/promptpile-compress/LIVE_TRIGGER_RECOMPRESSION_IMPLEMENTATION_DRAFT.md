# promptpile-compress Live Trigger Recompression 冻结实施契约

> Status: **Frozen Implementation Contract — Revision 4 / Final Freeze**  
> Date: 2026-08-14  
> Target: `packages/promptpile-compress`  
> Primary API: `runCompressionBeforeCompletion()`  
> Manual API preserved: `compressDirectory()`  
> Supersedes: `LIVE_TRIGGER_RECOMPRESSION_DRAFT.md` and Revision 1–3 of this contract  
> Change policy: 实施过程中如需改变本文的状态机、trigger authority、recovery/restore 语义、filesystem coordination、summary source、commit fact、error taxonomy 或 operation report v2，必须先修改本文并重新评审。

> 文件名暂时保留 `IMPLEMENTATION_DRAFT.md` 以避免 implementation 前发生无价值的 path churn；**Status header 是规范性状态**。实现验收并同步 `DESIGN.md` 后，可单独做文档治理 rename。

## 1. 冻结结论

当前问题不是 archive / restore 错误，而是 automatic orchestrator 复用了 manual compression 的 restore-first trigger 语义：

```text
recover
→ restore existing archive
→ scan restored Conversation
→ threshold
→ select
→ summarize
→ commit
```

存在 archive 时，automatic completion 因而先展开 full original history，再判断是否需要 compression。第一次 compression 后，即使 compact live Conversation 很小，后续 call 仍可能反复 restore + semantic summary + recompress。

Revision 4 将 automatic lifecycle 收敛为唯一 authority chain：

```text
prepare request
→ serialize per directory
→ acquire filesystem lifecycle lock
→ authoritative lifecycle inspection
→ optional exactly-once recovery normalization
→ authoritative healthy live gate
→ optional healthy archive restore
→ independent original-source compression evaluation
→ release lock
→ completion
```

核心原则：

> **One coordination boundary. One trigger authority. One original-source compression engine.**
>
> **Coordinate first; mutate only from authoritative state.**
>
> **Live state decides when; original state decides what.**
>
> **Recovery normalizes; it never implicitly triggers compression.**
>
> **Archive is durable source state, not an automatic trigger.**

---

## 2. 优化目标与非目标

对已经 healthy 且 live below trigger 的 automatic call：

```text
zero healthy-archive restore
zero semantic-provider call
zero Conversation/archive mutation
```

filesystem lifecycle lock 的创建/释放是 coordination，不属于 Conversation/archive mutation，也不是本次要消除的成本。

本次明确不追求：

```text
zero lock acquisition
pre-lock live gate
summary-of-summary
rolling/incremental summary
cross-process completion transaction
```

真正要消除的是：

```text
full restore
+ semantic provider
+ repeated recompression
```

---

## 3. 保持不变与有意收紧

### 3.1 保持不变

```text
Archive Protocol                 v1
compression.json                version 1
Conversation Protocol            unchanged
archive naming                   unchanged for valid archives
semantic provider schema         unchanged
sourceTurnIndices                unchanged
compressDirectory manual API     restore-first unchanged
manual dry-run                   restore-first simulation unchanged
filesystem lifecycle lock        unchanged
same-process orchestrator queue  unchanged
```

Completion 仍然只在本次 lifecycle lock release 后运行；本次不承诺与另一进程在 release 之后取得 lock 的 lifecycle mutation 互斥。

### 3.2 有意 safety tightening

对 malformed/private lifecycle paths 明确 fail closed，包括：

- reserved staging path 不是真实 directory；
- archive-shaped path 不是真实 directory；
- matching live summary path 存在但不是 regular file；
- staging rollback target conflict；
- archive restore target conflict。

这是 malformed-state handling 的安全收紧，不是 storage format migration。

---

## 4. Automatic lifecycle 不存在 pre-lock live scan

Automatic 入口固定为：

```text
assert/resolve directory + options
→ serializeOrchestratorPhase(directory)
→ acquire lifecycle lock
→ first authoritative inspection
```

因此：

- lock 前不扫描/tokenize Conversation；
- 不生成 tentative plan；
- 不存在 outer/inner trigger 分歧；
- 不需要 stale-plan test seam；
- cooperating lifecycle writer 的 authority 只由 filesystem lock 决定。

Trigger authority 唯一存在于：

> **lock 内、recovery normalization 完成后的 healthy live snapshot。**

---

## 5. Lifecycle state 基于磁盘事实建模

State machine 不猜测“之前发生了什么 crash”，只描述当前可观察事实和允许动作。

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

Recovery/invalid variants 不携带 `LiveSnapshot`：recovery 完成前的 token count 没有 trigger authority。

不得退化成：

```text
state + independent booleans + caller guessing combinations
```

---

## 6. Exhaustive lifecycle classification

### 6.1 Reserved staging path

`.promptpile-compress.staging` 必须按 **lstat / directory-entry type** 语义检查，不跟随 symlink 把外部 directory 当成 lifecycle state。

```text
absent
→ continue

real directory
→ inspect staging

symlink / regular file / other type
→ invalid: staging_path_invalid
```

### 6.2 Staging

```text
staging + committed archive
→ invalid: staging_archive_conflict

staging + no archive + rollback targets clear
→ recovery_required: staging_recovery

staging + no archive + rollback target conflict
→ invalid: staging_target_conflict
```

Staging-only 不天然等于 recoverable。

### 6.3 Archive-shaped paths

任何匹配：

```text
[N]system.md.archive
```

的 lifecycle path 必须是 real directory。

```text
matching real directory
→ archive validation

matching symlink / regular file / other type
→ invalid: archive_path_invalid
```

不得因为 legacy discovery 只返回 directories 就把 malformed archive-shaped path 当成“不存在 archive”。

### 6.4 Archive set

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

valid/restorable archive + all matching top-level summaries are regular files
→ healthy_compacted

valid/restorable archive + any matching summary path absent
→ recovery_required: archive_recovery

matching summary path exists but is not a regular file
→ invalid: archive_summary_path_invalid
```

`archive_recovery` 不区分它来自 commit-side interruption 还是 restore-side interruption；两者当前安全动作相同：restore authoritative originals。

### 6.5 Summary correspondence

本次只验证：

```text
archive [N]system.md.archive
has live representation
=
top-level [N]system.md is a regular file
```

本次不做：

- summary byte comparison；
- semantic marker integrity；
- `.summary.md` public contract。

No archive 时，单独存在的 `[N]system.md` 只是普通 Conversation artifact，不足以推断 compact lifecycle state。

---

## 7. Shared read-only lifecycle inspection

新增 package-private：

```text
src/restore/inspection.ts
```

至少提供等价职责：

```ts
inspectStagingState(directory)
inspectArchiveSet(directory)
```

它们是 recovery/restore mutation preconditions 的唯一 source of truth。

### Staging inspection

负责：

- reserved path type；
- staging message discovery；
- rollback targets；
- staging/archive conflict 所需事实。

### Archive inspection

负责：

- strict archive-shaped path discovery/type；
- `compression.json` version；
- archivedTurnIndices validity；
- archive idx 与 max archived idx；
- duplicate idx / duplicate archived message file；
- restore targets；
- matching live summary path type/presence。

`recoverWithLockHeld()`、`restoreArchivedTurnsWithLockHeld()` 与 automatic lifecycle 必须复用这些规则，不允许复制 validator。

Domain-invalid 返回结构化 invalid state；真实 stat/read/permission failure 抛 tagged IO error。

---

## 8. Authoritative inspection 与 live token

新增 package-private：

```text
src/compress/live-state.ts

inspectCompressionLifecycleState(...)
```

顺序固定：

```text
structural inspection
→ recovery/invalid classification if applicable
→ only if healthy: scan top-level Conversation
→ calculate live snapshot
```

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
- system turns 沿用 scanner；
- trigger 固定 `>=`。

Inspection 必须 read-only。

---

## 9. Recovery normalization：exactly once

按冻结状态空间，正常 recoverable state 只有两种，且各自执行成功后都应回到 `healthy_plain`：

```text
staging_recovery
→ rollback staging
→ healthy_plain

archive_recovery
→ restore archive originals
→ healthy_plain
```

因此不使用通用 recovery loop / `MAX_NORMALIZATION_STEPS`。

规范性流程：

```ts
let current = await inspectCompressionLifecycleState(...);

if (current.state === 'invalid') {
  throw archiveStateInvalid(current.reason);
}

if (current.state === 'recovery_required') {
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

  if (current.state !== 'healthy_plain') {
    throw archiveStateInvalid('recovery_did_not_normalize');
  }
}
```

如果一次规范 recovery 后仍不是 `healthy_plain`，不继续猜测/循环 mutation，直接 fail closed。

Recovery 本身永远不是 compression trigger；recovery 后必须重新读取 healthy live state。

---

## 10. Authoritative live gate

Normalization 后：

```text
healthy live < trigger
→ decision = skip
→ below_threshold CompressResult
→ no healthy archive restore
→ no semantic provider
→ no further Conversation/archive mutation
```

Trigger reached：

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

## 11. Shared original-source compression engine

从当前 `compressDirectoryWithLockHeld()` 提取：

```ts
compressCurrentConversationWithLockHeld(...)
```

前置条件：

> 当前 top-level Conversation 是 authoritative plain/original source。

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

拒绝使用：

```text
skipRestore
alreadyRecovered
trustPlan
forceCompression
```

等 mode flags 合并两套 lifecycle policy。

---

## 12. Trigger reached 不保证 fresh commit

Live trigger 只决定是否允许进入 source evaluation。

```text
healthy_compacted trigger reached
→ restore original
→ source engine
```

Source engine 合法结果：

```text
compressed
→ healthy_compacted

below_threshold
→ healthy_plain

no_turns_to_compress
→ healthy_plain
```

因此状态机不依赖：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
```

Automatic wrapper 必须把 recovery/normal restore 的 `recoveryActions` 与 `archivesRestored` 合并进最终 `CompressResult`。

---

## 13. Fresh summary source invariant

Triggered compact recompression：

```text
archive(original 0..N)
+
live summary1
+
new original N+1..M

→ lock-held live trigger
→ restore removes summary1
→ restore original 0..N
→ original 0..M
→ fresh selection
→ semantic summary2
```

Provider 只能看到 fresh selected original turns。

禁止：

```text
summary1 + newer turns → summary2
```

现有 semantic normalization、document validation 与 sourceTurnIndices validation 保留。

---

## 14. Fresh commit progress 与 failure 闭环

当前 publication protocol 是：

```text
prepare staging
→ rename staging to committed archive
→ publish matching live summary
```

因此 fresh commit attempt 必须显式跟踪 package-private progress：

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
  但本次 commit protocol 没有确认完整成功

complete
= publish protocol 完整返回成功
```

Mutation hook 的 `after` 回调发生在 mutation 已完成后，因此 progress 必须在真正 mutation 完成的边界更新，而不是只在 wrapper `await` 正常返回后更新。

如果 `archive_published` 后发生任何 error，本次 report 的 commit fact 为 `incomplete`。这不声称磁盘一定缺少 summary；例如 post-mutation observability hook 失败时，磁盘可能已经看起来完整。**下一次 lifecycle 仍以 authoritative filesystem inspection 为准。**

`commit.state` 描述的是本次 invocation 的 fresh commit protocol outcome，不替代 lifecycle state classifier。

---

## 15. Operation Report v2

Automatic lifecycle 的 observability contract 明确升级：

```text
CompressionOperationReport.version = 2
```

这是 public operation-report breaking revision，不是 storage migration。

### 15.1 v2 phases

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
+ optional recovery
+ healthy live gate
+ optional healthy archive restore
+ optional source evaluation/compression
```

Phase 回答 lifecycle step 是否成功；fresh commit 是否产生由 `commit.state` 单独回答。

### 15.2 Authoritative decision

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

`decision` 只有在 lifecycle 已归一化到 healthy 后才存在。

### 15.3 v2 shape

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

  commit: {
    state:
      | 'not_started'
      | 'skipped'
      | 'incomplete'
      | 'committed';
    summaryIdx?: number;
  };

  error?: {
    code: LifecycleErrorCode;
    message: string;
    retryable: boolean;
  };
}
```

`archivesRestored` required，默认 `0`。

`selection` optional 是有意的：lock failure、invalid lifecycle、healthy live skip 等路径没有进行 original-source selection，不应伪造空 selection。

### 15.4 Budget / selection authority

```text
decision
→ trigger-authoritative healthy live snapshot

healthy live skip:
  budget = live decision budget
  selection absent

source engine ran:
  budget = source-engine budget
  selection = source-engine selection
```

这样 report 同时保留“为什么触发”的 live fact 和“实际压缩了什么”的 source fact，不混用 token basis。

### 15.5 Commit state

```text
not_started
= lifecycle failed/ended before fresh archive publication，
  或 source evaluation failure 未进入 fresh commit publication

skipped
= lifecycle 正常完成，但权威决策/engine 正常决定不生成 fresh commit

incomplete
= fresh commit publication 已开始，
  但本次 commit protocol 未确认 complete

committed
= fresh commit protocol 完整成功
```

Completion failure 不改变已经确定的 commit fact。

### 15.6 Pre-lifecycle preparation failure

Directory/options/tokenizer 等在 lifecycle phase 启动前失败时：

```text
status = failed
phases = []
decision absent
selection absent
budget absent
recoveryActions = []
archivesRestored = 0
commit.state = not_started
error = tagged INVALID_OPTIONS | IO_ERROR | ...
```

不新增假的 `validate` phase，也不把 request preparation failure 伪装成 lock failure。

### 15.7 Phase matrix

一旦开始 filesystem lifecycle，phase list 按 v2 顺序稳定记录，未执行 phase 标 `skipped`：

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

---

## 16. Error taxonomy

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

## 17. Concurrency 与 atomicity 边界

### 17.1 Cooperating writers

Automatic lifecycle 先 acquire filesystem lock，再读取 trigger-authoritative state。因此 cooperating lifecycle writers 共享唯一 mutation authority。

### 17.2 Non-cooperating source writers

一旦 original source 进入 shared compression engine，继续使用：

```text
captureConversationGeneration
→ scan/provider
→ assertConversationGeneration
→ first staging mutation
```

防止 source planning 后被不遵守 lifecycle API 的 writer 静默改变。

### 17.3 Recovery/restore 的既有 TOCTOU 边界

Recovery/restore 的 read-only target-conflict precondition 与后续 rename/unlink 之间，filesystem lock 只能排斥 **cooperating lifecycle writers**。

本次不承诺对完全绕过 lifecycle API 的 filesystem writer 提供 restore/recovery transaction atomicity，也不把 compression generation guard 扩张为 recovery/restore CAS。

因此文档中的：

```text
restore target conflict checked
```

表示 lock-holder 对当前 state 做 fail-closed precondition，不表示对 non-cooperating writer 的永久保证。

### 17.4 Completion

```text
release this lifecycle lock
→ completion callback
```

同进程 orchestrator queue 继续覆盖 active completion；跨进程 completion transaction 不在本次范围。

---

## 18. Manual dry-run 与 automatic lifecycle 分离

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

## 19. 文件与职责

### Commit 1 所需结构（behavior-preserving）

`src/restore/inspection.ts`

- 提取现有 archive validation / target precondition 的共享 read-only primitive；
- 先不切换 malformed-path 新语义。

`src/compress/index.ts`

- 提取 `compressCurrentConversationWithLockHeld()`；
- manual / automatic 当前外部行为保持；
- existing tests 全绿。

### Commit 2 所需结构（semantic + safety switch）

`src/restore/scanner.ts` / `inspection.ts`

- strict reserved-path / archive-shaped-path type inspection；
- staging/summary path hardening；
- recover/restore 复用 shared inspection；
- tagged domain errors。

`src/compress/live-state.ts`

- `inspectCompressionLifecycleState()`；
- structural-first / healthy-only token scan；
- discriminated state。

`src/compress/index.ts`

```text
serialize
→ acquire lock
→ inspect
→ optional exactly-once recovery
→ live gate
→ optional restore
→ shared source engine
→ release
→ completion
```

同时删除 automatic dry-run planner。

### Commit 3

`src/compress/types.ts`

- report v2；
- new phases；
- `decision?`；
- `selection?`；
- required `archivesRestored`；
- `commit.incomplete`；
- no `plan` / `estimate_plan`。

并加入完整 acceptance tests、release-note migration note；实现 green 后再更新 `DESIGN.md` 为 Active Design。

---

## 20. Compatibility / migration

### Storage / protocol

无需 migration：

```text
Archive Protocol v1 unchanged
compression.json v1 unchanged
Conversation Protocol unchanged
```

### Valid-state APIs

```text
compressDirectory manual semantics unchanged
manual dry-run unchanged
restore valid-state data semantics unchanged
semantic provider schema unchanged
```

### Intentional behavioral tightening

Malformed private lifecycle paths / target conflicts 更早 fail closed。

### Operation observability

```text
CompressionOperationReport v1 → v2
```

迁移：

```text
remove plan
remove estimate_plan
rename compress phase → maintain_context
add authoritative decision
make selection optional
add required archivesRestored
add commit.incomplete
```

当前 package 为 beta；实现该契约的下一个 beta release notes 必须明确 report v2 breaking change。

---

## 21. Normative acceptance tests

### Healthy steady state

```text
healthy-compacted-live-below-threshold-does-not-restore
healthy-compacted-live-below-threshold-does-not-call-provider
healthy-compacted-live-below-threshold-preserves-conversation-bytes
healthy-compacted-live-below-threshold-preserves-archive-bytes
healthy-below-threshold-still-coordinates-through-lock
healthy-skip-decision-uses-live-token-basis
healthy-skip-report-selection-is-absent
completion-runs-after-release
```

### Triggered recompression

```text
healthy-compacted-trigger-restores-original
provider-input-excludes-previous-summary
provider-input-includes-restored-original-turns
provider-called-exactly-once
fresh-commit-returns-healthy-compacted
```

### Trigger reached but source skips

```text
restored-source-below-threshold-stays-plain
restored-source-no-turns-stays-plain
source-skip-commit-is-skipped
source-skip-selection-is-source-engine-selection
archives-restored-is-aggregated
```

### Staging classification

```text
staging-nondirectory-is-invalid
staging-symlink-is-invalid
staging-plus-archive-is-invalid
staging-target-conflict-is-invalid
recoverable-staging-rolls-back-once
staging-recovery-must-reinspect-to-healthy-plain
staging-recovery-nonhealthy-after-reinspect-fails-closed
```

### Archive classification

```text
archive-shaped-regular-file-is-invalid
archive-shaped-symlink-is-invalid
invalid-metadata-fails-closed
duplicate-idx-or-file-fails-closed
archive-restore-target-conflict-fails-closed
matching-summary-nonregular-path-is-invalid
missing-summary-classifies-archive-recovery
archive-recovery-restores-once
archive-recovery-must-reinspect-to-healthy-plain
```

### Commit failure facts

```text
failure-before-archive-publication-commit-not-started
failure-after-archive-publication-commit-incomplete
write-live-summary-before-failure-commit-incomplete
post-mutation-hook-failure-after-archive-publication-does-not-report-skipped
next-lifecycle-reclassifies-filesystem-independently-of-previous-incomplete-report
successful-publication-commit-committed
completion-failure-preserves-committed-fact
```

### Report v2

```text
report-version-is-2
report-has-no-plan-or-estimate-plan
pre-lifecycle-failure-has-empty-phases
lock-failure-phase-matrix-stable
invalid-maintain-context-skips-completion
healthy-skip-has-decision-but-no-selection
source-evaluation-has-selection
maintain-context-completed-with-commit-skipped-is-valid
```

### Error taxonomy

```text
domain-invalid-uses-archive-state-invalid
lock-blocker-uses-lifecycle-locked
io-error-is-not-reclassified-by-message-text
new-inspection-errors-prefer-tagged-code
```

### Manual regression

```text
compressDirectory-existing-archive-still-restore-first
manual-dry-run-still-simulates-restore
valid restore contract unchanged
archive protocol conformance unchanged
```

---

## 22. Critical end-to-end flows

### 22.1 Compact steady state

```text
healthy_compacted + live < trigger
→ lock
→ authoritative decision skip
→ no restore
→ no provider
→ no Conversation/archive mutation
→ commit skipped
→ release
→ completion
```

### 22.2 Compact threshold crossing

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

### 22.3 Recovery

```text
recoverable state
→ lock
→ exactly one prescribed recovery
→ re-inspect
   ├─ healthy_plain → live gate
   └─ anything else → fail closed
```

### 22.4 Commit interrupted

```text
source engine starts fresh publication
→ archive published
→ later commit step fails
→ report.status failed
→ commit incomplete
→ release lock

next automatic lifecycle
→ ignore prior report as state authority
→ inspect filesystem
   ├─ archive_recovery → restore originals → live gate
   ├─ healthy_compacted → normal live gate
   └─ invalid → fail closed
```

这保证 report 与 recovery state machine 解耦但闭合。

---

## 23. Explicit non-solutions

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
archive-shaped malformed path silently ignored
preserve report v1 by redefining misleading fields
required empty selection on paths that never selected
commit failure reported as skipped
```

---

## 24. Deferred hardening

不属于本次 gate：

```text
summaryTokens < archivedOriginalTokens
tokensAfter < tokensBefore
tokensAfter < triggerTokens
summary byte-integrity verification
rolling/incremental summary
cross-process completion transaction
non-cooperating restore/recovery transaction protocol
```

状态机必须在没有这些假设时闭合。

---

## 25. Recommended implementation commits

### Commit 1 — pure behavior-preserving refactor

```text
refactor(compress): extract lifecycle inspection primitives and source engine
```

- extract existing validation primitives；
- extract `compressCurrentConversationWithLockHeld()`；
- no malformed-state behavior switch；
- all existing tests green。

### Commit 2 — authoritative live-trigger + safety semantics

```text
feat(compress): gate archive restore on authoritative live state
```

- strict lifecycle path inspection；
- discriminated lifecycle state；
- no pre-lock scan；
- exactly-once recovery；
- healthy-only live gate；
- archive recovery；
- source skip；
- tagged errors；
- commit progress tracking；
- automatic dry-run planner removed。

### Commit 3 — report v2 + acceptance / active design

```text
test(docs): activate live-trigger lifecycle and report v2
```

- v2 report / phases / decision；
- optional selection；
- commit incomplete；
- acceptance matrix；
- beta migration release note；
- after green: update `DESIGN.md` to Active Design。

---

## 26. Final freeze checklist

- [x] one filesystem coordination boundary；
- [x] no pre-lock live scan；
- [x] one lock-held trigger authority；
- [x] lifecycle state is discriminated and fact-based；
- [x] staging/archive/summary path types are explicit；
- [x] staging rollback conflicts fail closed；
- [x] archive restore conflicts fail closed；
- [x] recovery is exactly once then re-inspect；
- [x] non-normalized recovery fails closed；
- [x] recovery never acts as trigger；
- [x] healthy archive restore requires live trigger；
- [x] original source independently decides fresh compression；
- [x] restored source may legitimately skip；
- [x] semantic source excludes previous summary；
- [x] fresh commit progress is explicit；
- [x] report can represent incomplete commit；
- [x] report selection is optional by execution depth；
- [x] pre-lifecycle failure phase semantics frozen；
- [x] phase / decision / selection / commit responsibilities are distinct；
- [x] domain errors are tagged before regex fallback；
- [x] cooperating vs non-cooperating writer boundary explicit；
- [x] manual restore-first semantics preserved；
- [x] manual dry-run preserved；
- [x] malformed-state safety tightening explicitly documented；
- [x] report v2 breaking migration explicit；
- [x] storage protocol unchanged；
- [x] acceptance coverage spans healthy/recovery/invalid/partial-commit/report/error/manual paths。

---

## 27. Definition of done

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

失败后磁盘可能处于 recoverable intermediate state；下一次 lifecycle 必须通过 filesystem inspection 重新分类，**不得相信上一次 report 作为 state authority**。

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
> **Reports describe invocation facts; filesystem inspection defines lifecycle truth.**