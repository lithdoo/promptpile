# promptpile-compress 当前设计

> 类型：Package Design  
> 状态：Active Design  
> 稳定程度：Experimental  
> 主要职责：conversation compression / archive commit / restore / recovery  
> 上层契约：`../../doc/15-contracts/conversation-protocol-v1.md`、`../../doc/15-contracts/archive-protocol-v1.md`  
> 最近复核：2026-08-06

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
│   ├── lock.ts
│   └── mutation.ts
├── compress/
│   ├── index.ts
│   ├── scanner.ts
│   ├── strategy.ts
│   ├── summary.ts
│   ├── tokenizer.ts
│   └── types.ts
└── restore/
    ├── index.ts
    ├── scanner.ts
    └── types.ts
```

当前 CLI：

```bash
promptpile-compress compress -d <directory> [--threshold N] [--keep-recent N] [--dry-run]
promptpile-compress restore -d <directory> [--dry-run]
```

当前唯一策略是 `sliding-window`。它按 idx group 保留 system turns 与最近 N 个 non-system turns，把更早历史归档。

Turn selection 与 summary generation 是独立接口。默认 `archive-pointer` generator 是纯本地、确定性的协议指针，不读取 API key，也不访问网络。程序化调用可显式注入 `semantic` provider；CLI 当前仍使用默认 generator，避免隐式外部副作用。

Semantic provider 输入按 idx 与文件名排序，保留 role、idx、message/calls/result/extra 的内容和输入/输出 token 预算。返回的 v1 document 必须完整包含 goal、stable facts、constraints、decisions、important tool findings、completed work、unresolved work、failed approaches 与 next actions 数组；每个非空条目必须引用真实 archived idx。结构、来源、空输出、超时和预算在创建 staging 前校验。

## 3. Archive commit

Compress 先把待归档 message artifacts 移入 `.promptpile-compress.staging/`，写入 `compression.json` 与 `.summary.md`，再把 staging rename 为 `[N]system.md.archive/`，最后写顶层 `[N]system.md`。

Archive 对外格式以 [Archive Protocol v1](../../doc/15-contracts/archive-protocol-v1.md) 为准；`.summary.md` 与 staging 是 package-private recovery artifacts，不是 consumer contract。

## 4. Restore / recovery

Restore 在修改文件前校验 manifest、duplicate idx/file 与目标冲突；正式执行时先删除对应 summary，再逐个恢复 archive 中的 conversation files，最后清理 archive。

`recover()` 处理残留 staging。已有 archive 时重新 compress 会先 restore 完整历史，再从完整 conversation 重新计算，避免层层叠加 summary/archive。

### 4.1 Writer coordination

Compress、restore 与 recover 使用 conversation 顶层 `.promptpile-compress.lock` 协调 cooperating lifecycle writers。Lock 通过 exclusive create 获取，记录 owner id、PID、hostname、operation 与创建时间。公开入口不可重入；顶层 operation 只通过 package-private 内部函数复用已经持有的锁，mutation hook 不能绕过锁启动嵌套公开操作。

同一主机上 owner PID 已不存在的有效 lock 可以自动恢复。跨主机 lock、仍存活的 PID 或损坏 metadata 均 fail closed，不按时间猜测并删除。Lock 是 package-private coordination artifact，read-only Archive Protocol consumer 必须忽略。

Lock 不能阻止不遵守该约定的 writer。Compress 在 scan 前后以及 summary 后计算 SHA-256 conversation generation，覆盖 live message 内容、archive 和 staging；generation 变化时在创建 staging 前拒绝提交。校验与首次 mutation 之间仍不存在跨进程原子事务，因此 orchestrator 必须保证 active completion 与 lifecycle mutation 不并行。

### 4.2 Mutation 与 durability 边界

所有关键 filesystem mutation 都经过可注入 hook，覆盖 staging 创建、文件移动、manifest/summary 写入、archive commit、restore 与 cleanup，可用于 deterministic fault injection。

Atomic file write 使用同目录唯一临时文件，写入后先 sync file 再 rename；失败时清理未提交临时文件。POSIX 在 rename 后额外 sync parent directory；Windows 当前只承诺 file sync + same-directory rename，不宣称 directory fsync 保证。Directory archive rename 在 POSIX 同样 sync conversation directory。

### 4.3 Dry-run

普通 dry-run 直接计算 selection。存在 staging 或 archive 时，在 OS 临时目录中的隔离副本执行真实 recover → restore → recompress 模拟，并在 `finally` 清理；目标 conversation 前后 byte-for-byte 不变。结果包含 recovery actions、待恢复 archive 数、planned outcome 以及与随后真实执行一致的 turn/token 统计。

## 5. 当前能力边界

已实现：

- turn-aware scanning；
- system preservation；
- threshold / dry-run；
- sliding-window archive selection；
- 可注入的 semantic summary provider、稳定 schema、来源 idx 与预算/超时校验；
- staging / atomic single-file writes；
- directory-level cooperating-writer lock 与 same-host stale-lock recovery；
- conversation generation precondition；
- deterministic mutation fault injection 与 retry coverage；
- compression manifest；
- restore / recovery / recompress；
- staging/archive-aware dry-run planning；
- filesystem behavior tests；
- Archive Protocol v1 共享 conformance corpus 与 producer/restore/read-only consumer 验证。

尚未完成：

- 精确 context-budget tokenizer；
- orchestrator 与不遵守 lifecycle lock 的 active writer 之间的 exclusive-phase integration。

## 6. 明确非目标

以下能力不再属于本 package：

- `lookup_archive` / grep implementation；
- `read_archived_turn` query surface；
- embedding / vector index；
- retrieval ranking；
- archive-search MCP server。

第一个独立 consumer scaffold 是 `../promptpile-compress-grep-search/`。

## 7. Retrieval 边界

默认 archive-pointer summary 只声明原文已按 Archive Protocol 归档，并明确检索能力取决于上层是否配置兼容的只读 consumer。Semantic summary 只保留带 archived idx 来源的 compact context，同样不承诺任何 retrieval tool 存在。

## 8. 文档治理

- 当前设计：本文件；
- 尚未完成的优化工作与验收标准：`OPTIMIZATION_PLAN.md`；
- 跨 package 语义：`../../doc/15-contracts/`；
- 被取代的设计、阶段性 status 与已完成 implementation plans 不在 package 内保留副本，使用 Git 历史追溯。
