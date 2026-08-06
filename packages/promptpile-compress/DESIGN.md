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
├── compress/
│   ├── index.ts
│   ├── scanner.ts
│   ├── strategy.ts
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

## 3. Archive commit

Compress 先把待归档 message artifacts 移入 `.promptpile-compress.staging/`，写入 `compression.json` 与 `.summary.md`，再把 staging rename 为 `[N]system.md.archive/`，最后写顶层 `[N]system.md`。

Archive 对外格式以 [Archive Protocol v1](../../doc/15-contracts/archive-protocol-v1.md) 为准；`.summary.md` 与 staging 是 package-private recovery artifacts，不是 consumer contract。

## 4. Restore / recovery

Restore 在修改文件前校验 manifest、duplicate idx/file 与目标冲突；正式执行时先删除对应 summary，再逐个恢复 archive 中的 conversation files，最后清理 archive。

`recover()` 处理残留 staging。已有 archive 时重新 compress 会先 restore 完整历史，再从完整 conversation 重新计算，避免层层叠加 summary/archive。

## 5. 当前能力边界

已实现：

- turn-aware scanning；
- system preservation；
- threshold / dry-run；
- sliding-window archive selection；
- staging / atomic single-file writes；
- compression manifest；
- restore / recovery / recompress；
- filesystem behavior tests；
- Archive Protocol v1 共享 conformance corpus 与 producer/restore/read-only consumer 验证。

尚未完成：

- 真正保留 goals / facts / constraints / decisions / unresolved work 的 semantic summary；
- 精确 context-budget tokenizer；
- lifecycle mutation 的并发协调。

## 6. 明确非目标

以下能力不再属于本 package：

- `lookup_archive` / grep implementation；
- `read_archived_turn` query surface；
- embedding / vector index；
- retrieval ranking；
- archive-search MCP server。

第一个独立 consumer scaffold 是 `../promptpile-compress-grep-search/`。

## 7. Retrieval 边界

`sliding-window` summary 只声明原文已按 Archive Protocol 归档，并明确检索能力取决于上层是否配置兼容的只读 consumer。Package 本身不承诺任何具体 retrieval tool 存在；实际 consumer 接线后，由上层显式注入可用能力。

## 8. 文档治理

- 当前设计：本文件；
- 尚未完成的优化工作与验收标准：`OPTIMIZATION_PLAN.md`；
- 跨 package 语义：`../../doc/15-contracts/`；
- 被取代的设计、阶段性 status 与已完成 implementation plans 不在 package 内保留副本，使用 Git 历史追溯。
