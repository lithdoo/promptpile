# promptpile-compress 当前实现评估

> 类型：Current implementation assessment  
> 状态：Reference  
> 稳定程度：Experimental  
> 适用代码：`main` 当前实现  
> 最近复核：2026-08-05

## 1. 结论

当前 package 已形成较可靠的 **reversible conversation compaction / archive lifecycle foundation**。文件生命周期层明显比语义压缩层成熟。

```text
文件生命周期 / restore / recovery：约 8/10
语义 summary：约 2/10
Archive Protocol 稳定度：draft / experimental
```

历史搜索不再评价为“compress package 缺失功能”，而被明确拆为独立 Archive Protocol consumer。当前新增 `promptpile-compress-grep-search` scaffold；vector search 只有在 grep 的真实效果不足时再单独立项。

## 2. 已完成能力

- Conversation 顶层扫描与同 idx turn 聚合；
- assistant message / calls / result / extra 同组归档；
- system turn 保留；
- threshold / keepRecent / dry-run；
- staging → archive commit；
- `compression.json`；
- restore / conflict preflight；
- staging rollback；
- partial restore retry；
- existing archive → restore → recompress；
- damaged metadata、duplicate idx、target conflict 等测试。

Restore / recovery 仍是当前最成熟部分。

## 3. 当前仍不是真正的语义压缩

唯一 `sliding-window` strategy 的 summary 只记录归档范围与粗略 token 数，没有把历史中的目标、事实、用户约束、关键决策、重要工具发现和未完成工作提炼进 live context。

因此当前行为更接近：

```text
old context → archive outside live scan → small archive pointer
```

而不是 semantic distillation。

## 4. 当前协议过渡问题

现有 summary 仍硬编码 `lookup_archive` 工具名，但仓库中没有对应实现。这是旧“compress 内建 retrieval”设计留下的过渡项，与新的协议边界不一致。

目标状态应是：

```text
promptpile-compress      writes Archive Protocol
promptpile-compress-grep-search   reads Archive Protocol
future vector consumer           reads Archive Protocol
```

因此 compress summary 不应假设某个特定 search implementation 一定存在。

## 5. Token budget

当前 tokenizer 使用字符估算：约 `content.length / 3.5`，再按文件增加固定 wrapper 开销。它适合作为粗略 threshold trigger，但不足以承担精确 context-window budgeting。`tiktoken` 虽是 optional dependency，当前实现尚未使用。

## 6. Crash safety 与 concurrency

Staging、archive rename、恢复预检让进程中断后的可恢复性较好；但逐文件 rename 不等于并发 reader/writer 的跨文件事务。当前仍应把 compress/restore 视为对 conversation directory 的 exclusive lifecycle mutation。

## 7. 下一阶段

优先级：

1. 让代码与 Archive Protocol draft 对齐，并移除 summary 对具体 `lookup_archive` implementation 的假设；
2. 实现 semantic summary strategy；
3. 增加 producer/consumer conformance fixtures；
4. grep consumer 启动实现后再决定是否需要 vector consumer；
5. 最后处理精确 tokenizer 与并发协调。

当前 package 继续保持 `private / experimental` 是合理的。
