# promptpile-compress 当前设计

> 类型：Package Design  
> 状态：Active Design  
> 稳定程度：Experimental  
> 主要职责：conversation compression / archive commit / restore / recovery / semantic compaction  
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

本 package 的职责是把 live conversation 安全转换为 Archive Protocol 状态，并支持恢复；下一阶段进一步承担 semantic compaction 与 context-budget planning。

历史搜索不属于本 package。grep、vector、remote retrieval 都应作为 Archive Protocol 的独立只读 consumer。

## 2. 当前实现

源码当前分为：

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

当前唯一 selection strategy 是 `sliding-window`。它按 idx group 保留 system turns 与最近 N 个 non-system turns，把更早历史归档。

## 3. Archive commit

Compress 先把待归档 message artifacts 移入 `.promptpile-compress.staging/`，写入 `compression.json` 与 `.summary.md`，再把 staging rename 为 `[N]system.md.archive/`，最后写顶层 `[N]system.md`。

Archive 对外格式以 [Archive Protocol v1](../../doc/15-contracts/archive-protocol-v1.md) 为准；`.summary.md` 与 staging 是 package-private recovery artifacts，不是 consumer contract。

下一阶段必须把 producer 与 restore 对 Archive Protocol 的理解收敛到可验证的 conformance corpus，而不是依赖彼此私有实现。

## 4. Restore / recovery

Restore 在修改文件前校验 manifest、duplicate idx/file 与目标冲突；正式执行时先删除对应 summary，再逐个恢复 archive 中的 conversation files，最后清理 archive。

`recover()` 处理残留 staging。已有 archive 时重新 compress 会先 restore 完整历史，再从完整 conversation 重新计算，避免层层叠加 summary/archive。

后续 safety 优化的原则是：任何无效 archive、目录变化或 summary/provider failure，都必须在 destructive mutation 前 fail closed；恢复路径必须能通过 fault-injection tests 证明。

## 5. 当前能力边界

已实现：

- turn-aware scanning；
- system preservation；
- threshold / keepRecent / dry-run；
- sliding-window archive selection；
- staging / archive commit；
- compression manifest；
- restore / recovery / recompress；
- filesystem behavior tests。

下一阶段需要完成：

- Archive Protocol v1 producer/restore conformance；
- directory mutation safety、generation/fingerprint 检查与 fault injection；
- 真正保留 goal / facts / constraints / decisions / unresolved work 的 semantic summary；
- 可解释且统一的 context budget / tokenizer model；
- 结构化 operation report 与 orchestrator lifecycle integration。

具体顺序与验收标准只在 [`OPTIMIZATION_PLAN.md`](./OPTIMIZATION_PLAN.md) 中维护。

## 6. 明确非目标

以下能力不属于本 package：

- grep / `lookup_archive` implementation；
- `read_archived_turn` query surface；
- embedding / vector index；
- retrieval ranking；
- archive-search MCP server。

独立 grep consumer scaffold 位于 `../promptpile-compress-grep-search/`。

## 7. 关键设计原则

1. **协议优先**：Archive Protocol 与 Conversation Protocol 是上层契约；实现不能私自要求 consumer 理解额外私有格式。
2. **authoritative state 优先**：summary 生成、预算计算、外部 provider 调用失败都不能损伤原 conversation artifacts。
3. **mutation 与 retrieval 分离**：本 package 可以改变 archive/live state；consumer 默认只读。
4. **预算可解释**：trigger、selection、summary output 和 operation report 最终必须共享同一 context-budget model。
5. **自动化显式**：普通 Promptpile completion 不隐式触发 compress/restore；orchestrator 必须显式安排 exclusive lifecycle phase。
6. **单 archive 优先**：没有明确收益与迁移方案前，不增加分层/堆叠 archive 模型。

## 8. 文档治理

本 package 只维护两份主动设计文档：

- `DESIGN.md`：描述当前职责、边界和已经存在的行为；
- `OPTIMIZATION_PLAN.md`：描述尚未完成、可验收的优化工作。

协议语义以 `../../doc/15-contracts/` 为准。完成的 implementation plan、阶段性 status snapshot 和被取代设计不在 package 内保留副本，历史追溯使用 Git history。
