# promptpile-compress 当前设计

> 类型：Package Design  
> 状态：Active Design  
> 稳定程度：Beta
> 主要职责：conversation compression / archive commit / restore / recovery  
> 上层契约：`../../doc/15-contracts/conversation-protocol-v1.md`、`../../doc/15-contracts/archive-protocol-v1.md`  
> 最近复核：2026-08-14

## 1. 定位

`promptpile-compress` 是 Context Lifecycle System 中负责**有副作用状态迁移**的实现：

```text
Conversation Protocol
      │
      ├── compress ──► Archive Protocol + compact summary
      │
      └◄─ restore  ─── Archive Protocol
```

Package 不拥有历史搜索。grep、vector、remote retrieval 都应作为 Archive Protocol 的独立只读 consumer。

## 2. 当前实现

源码分为：

```text
src/
├── index.ts
├── lifecycle/
│   ├── directory.ts
│   ├── lock.ts
│   ├── errors.ts
│   └── mutation.ts
├── compress/
│   ├── index.ts
│   ├── live-state.ts
│   ├── budget.ts
│   ├── scanner.ts
│   ├── strategy.ts
│   ├── summary.ts
│   ├── tokenizer.ts
│   └── types.ts
└── restore/
    ├── index.ts
    ├── inspection.ts
    ├── scanner.ts
    └── types.ts
```

当前 CLI：

```bash
promptpile-compress compress -d <directory> [budget options] [--keep-recent N] [--dry-run]
promptpile-compress restore -d <directory> [--dry-run]
```

当前唯一策略是 `sliding-window`。它按 idx group 保留 system turns 与最近 N 个 non-system turns，把更早历史归档。

Turn selection 与 summary generation 是独立接口。默认 `archive-pointer` generator 是纯本地、确定性的协议指针，不读取 API key，也不访问网络。程序化调用可显式注入 `semantic` provider；CLI 当前仍使用默认 generator，避免隐式外部副作用。

Semantic provider 输入按 idx 与文件名排序，保留 role、idx、message/calls/result/extra 的内容和输入/输出 token 预算。返回的 v1 document 必须完整包含 goal、stable facts、constraints、decisions、important tool findings、completed work、unresolved work、failed approaches 与 next actions 数组；每个非空条目必须引用真实 archived idx。结构、来源、空输出、超时和预算在创建 staging 前校验。

默认 context budget 由 128k model context、8k completion 预留、2k system/tool 固定开销、32k 目标 live history、2,048 summary 上限和 4k safety margin 组成。Trigger、连续 recent suffix selection、summary limit 与 `ContextBudgetReport` 使用同一 resolved budget。`threshold` 仅作为显式兼容模式保留，不能与 `budget` 同时使用。

默认 tokenizer 是带版本标识的 `promptpile-unicode-heuristic-v1` fallback；需要模型精确计数时，调用方可显式创建 `tiktoken@1.0.22` adapter 并指定 model。误差 corpus 位于 `fixtures/tokenizer-benchmark-v1/`，不会把 heuristic 结果描述为精确 token 数。

## 3. Archive commit

Compress 先把待归档 message artifacts 移入 `.promptpile-compress.staging/`，写入 `compression.json` 与 `.summary.md`，再把 staging rename 为 `[N]system.md.archive/`，最后写顶层 `[N]system.md`。

Archive 对外格式以 [Archive Protocol v1](../../doc/15-contracts/archive-protocol-v1.md) 为准；`.summary.md` 与 staging 是 package-private recovery artifacts，不是 consumer contract。

## 4. Restore / recovery

Restore 在修改文件前校验 manifest、duplicate idx/file 与目标冲突；正式执行时先删除对应 summary，再逐个恢复 archive 中的 conversation files，最后清理 archive。

`recover()` 处理残留 staging。手动 `compressDirectory()` 保持 recover → restore → source evaluation 的 restore-first 语义。自动 `runCompressionBeforeCompletion()` 则先在 lock 内检查 authoritative lifecycle state：recovery 只执行一次规定的归一化动作并重新检查；healthy archive 只有在 compact live Conversation 达到 trigger 后才会 restore。Restore 后的压缩选择独立基于完整 original Conversation 重新计算，semantic provider 不会看到旧 summary。

`restore/inspection.ts` 是 staging/archive mutation precondition 的唯一事实来源。reserved staging、archive-shaped path 与 matching summary 使用不跟随 symlink 的类型语义；malformed path、metadata/set contradiction、rollback/restore target conflict 均 fail closed。正常 lifecycle terminal state 只有 `healthy_plain` 与 `healthy_compacted`，失败后的磁盘状态必须由下一次 inspection 重新分类，不能从 operation report 反推。

### 4.1 Writer coordination

Compress、restore 与 recover 使用 conversation 顶层 `.promptpile-compress.lock.<host>.<pid>.<owner>` 唯一锁文件集合协调 cooperating lifecycle writers。所有公开入口先把目录解析为存在后的 filesystem `realpath`；队列、锁与 mutation 共享这个 physical identity，因此 symlink/junction 等路径别名不能形成独立 writer lane。每个 contender 原子发布完整 metadata，清理同机死进程的不可复用锁路径后重新扫描；只有自己的锁是唯一有效锁时才进入 mutation。活锁、异机锁、损坏锁以及旧版固定 `.promptpile-compress.lock` 一律 fail closed。公开入口不可重入；顶层 operation 只通过 package-private 内部函数复用已经持有的锁，mutation hook 不能绕过锁启动嵌套公开操作。

同一主机上 owner PID 已不存在的有效 lock 可以自动恢复。跨主机 lock、仍存活的 PID 或损坏 metadata 均 fail closed，不按时间猜测并删除。Lock 是 package-private coordination artifact，read-only Archive Protocol consumer 必须忽略。

Lock 不能阻止不遵守该约定的 writer。Automatic lifecycle 获取 lock 后才进行 authoritative inspection、live token scan 与 trigger decision，不存在 pre-lock automatic plan。Original-source engine 在 scan 前后以及 summary 后计算 SHA-256 conversation generation，覆盖 live message、archive 和 staging；generation 变化时在创建 staging 前拒绝提交。校验与首次 mutation 之间仍不存在跨进程原子事务，因此 orchestrator 必须保证 active completion 与 lifecycle mutation 不并行。

### 4.2 Mutation 与 durability 边界

所有关键 filesystem mutation 都经过可注入 hook，覆盖 staging 创建、文件移动、manifest/summary 写入、archive commit、restore 与 cleanup，可用于 deterministic fault injection。

Atomic file write 使用同目录唯一临时文件，写入后先 sync file 再 rename；失败时清理未提交临时文件。POSIX 在 rename 后额外 sync parent directory；Windows 当前只承诺 file sync + same-directory rename，不宣称 directory fsync 保证。Directory archive rename 在 POSIX 同样 sync conversation directory。

### 4.3 Dry-run

手动 `compressDirectory({ dryRun: true })` 直接计算 selection。存在 staging 或 archive 时，在 OS 临时目录中的隔离副本执行 recover → restore → selection 模拟，并在 `finally` 清理；目标 conversation 前后 byte-for-byte 不变。规划阶段不调用 summary provider，`summaryTokens` 使用 resolved summary output limit 作为保守上限，并以 `summaryTokenBasis: 'upper-bound'` 标识。Automatic lifecycle 不调用 manual dry-run，也不生成 pre-lock plan。

### 4.4 I/O 与性能基准

Live artifacts 在 scan 中并行读取一次并缓存，tokenizer 与 semantic provider 共享内容；generation hash 仍在 mutation 前独立复核，但同一轮的 live-file 读取改为并行且保持确定性 hash 顺序。可用 `npm run benchmark -w promptpile-compress` 复现 1,000 turns / 3,000 artifacts 基准，`PPC_BENCHMARK_TURNS` 可调整规模。2026-08-06 的 Windows 样本中，当前单次缓存路径 median 244.17 ms，旧式 tokenize + provider reread 两遍路径 median 967.53 ms（3.96×）；数值只作本机趋势记录，不作为跨机器 pass/fail 门槛。

### 4.5 Orchestrator boundary 与 operation report

自动化调用使用 `runCompressionBeforeCompletion()`，唯一 authority chain 是：prepare request → per-directory queue → acquire lock → inspect → optional one-shot recovery → healthy live decision → optional archive restore → original-source engine → release → completion。Prepare 在第一次异步等待前把 budget、tokenizer、selector、summary generator、hook 与 dry-run policy 解析为不可变 execution snapshot；caller-owned tokenizer 与 semantic provider 被复制为捕获 identity 和 bound method 的 package-owned frozen façade，排队期间调用方修改原 options 或替换 capability method 不会改变本次 decision 或 execution。Compact live state 未达到 trigger 时只承担 coordination 成本，不 restore archive、不调用 semantic provider，也不修改 Conversation/archive。队列以 physical `realpath` 为 key 并覆盖 callback 完成，因此目录别名共享同一条 lane，下一次 lifecycle phase 不会与 active completion 重叠。

Automatic orchestrator 整体不可重入：active invocation 的 completion callback 内发起任何 nested automatic invocation（无论目录是否相同）都会在 lifecycle 启动前以 non-retryable `LIFECYCLE_LOCKED` fail fast，从而同时排除 self-deadlock 与跨目录 queue cycle。Async context 保存带 `active` lifetime 的 invocation token；外层结束后 token 置为 inactive，因此从 completion 派生但延后运行的 detached descendant 不会被 stale context 错误拒绝。独立 invocation 仍按 physical-directory queue 正常等待。

`CompressionOperationReport` 当前固定为 v2。Phase 为 `acquire_exclusive`、`maintain_context`、`release_exclusive`、`completion`；request-preparation failure（包括目录解析与 nested invocation 拒绝）的 phases 为空，lifecycle 开始后未执行 phase 显式记为 `skipped`。`decision` 是 lock-held live fact 的 discriminated union；automatic gate skip 时 report `selection` 缺省，source engine 执行后才记录 original-source selection。`commit` 区分 `not_started`、`skipped`、`incomplete(summaryIdx)` 与 `committed(summaryIdx)`；archive publication 后的失败不会伪装成 skip。Maintain 与 release 同时失败时 maintain error 保持 primary，phase 仍保留 release failure fact。Tagged lifecycle error 优先，其次任何带 filesystem `code` 的 error 归为 `IO_ERROR`，message regex 只作为无 code 的 legacy fallback。Non-reentrant rejection 的公开文案与 `retryable: false` 保持一致，不使用 retry-later 提示。

Report 只描述已向 builder 确认的 invocation facts，不是 mutation journal，也不是后续 lifecycle state authority。报告不包含 message/tool result、semantic summary 正文或 provider 原始错误文本。`compressDirectory` / `restoreArchivedTurns` 继续作为手动 lifecycle API。

## 5. 当前能力边界

已实现：

- turn-aware scanning；
- system preservation；
- context budget、兼容 threshold 与可解释 budget report；
- heuristic/tiktoken tokenizer adapters 与误差 corpus；
- sliding-window archive selection；
- 可注入的 semantic summary provider、稳定 schema、来源 idx 与预算/超时校验；
- staging / atomic single-file writes；
- directory-level cooperating-writer lock 与 same-host stale-lock recovery；
- conversation generation precondition；
- deterministic mutation fault injection 与 retry coverage；
- compression manifest；
- restore / recovery / recompress；
- staging/archive-aware manual dry-run planning；
- strict authoritative lifecycle inspection 与 one-shot recovery；
- lock-held live trigger、original-source recompression 与 compact steady-state fast path；
- fresh commit progress 与 Operation Report v2；
- orchestrator lifecycle queue 与脱敏 structured operation report；
- filesystem behavior tests；
- Node 18/22 × Windows/Linux filesystem matrix；
- Archive Protocol v1 共享 conformance corpus 与独立 consumer 跨包验证。

继续保持 experimental 的事项：真实上层应用接线、跨进程非 cooperating writer，以及长期版本迁移演练。

## 6. 明确非目标

以下能力不再属于本 package：

- `lookup_archive` / grep implementation；
- `read_archived_turn` query surface；
- embedding / vector index；
- retrieval ranking；
- archive-search MCP server。

第一个独立 consumer 是 `../promptpile-compress-grep-search/`；当前已实现 archive discovery/read-turn、literal search、CLI 与只读 MCP adapter，并继续与 producer 保持公开协议边界。

## 7. Retrieval 边界

默认 archive-pointer summary 只声明原文已按 Archive Protocol 归档，并明确检索能力取决于上层是否配置兼容的只读 consumer。Semantic summary 只保留带 archived idx 来源的 compact context，同样不承诺任何 retrieval tool 存在。

## 8. 文档治理

- 当前设计：本文件；
- 尚未完成的优化工作与验收标准：`OPTIMIZATION_PLAN.md`；
- 跨 package 语义：`../../doc/15-contracts/`；
- 被取代的设计、阶段性 status 与已完成 implementation plans 不在 package 内保留副本，使用 Git 历史追溯。
