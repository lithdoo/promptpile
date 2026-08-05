# Archive Protocol v1

> 层级：15 · Contracts  
> 状态：Active Design  
> 稳定程度：Experimental  
> 主要定义：Promptpile 压缩归档的跨 package 发现、读取与兼容语义  
> 当前 producer/restore implementation：`promptpile-compress`  
> 计划 consumer：`promptpile-compress-grep-search`  
> 最近复核：2026-08-05

Archive Protocol 把“压缩实现如何保存历史”从 `promptpile-compress` 私有代码提升为可被独立 consumer 读取的文件契约。当前是 v1 draft：描述现有实现，并约束下一步 grep consumer，但尚未承诺长期稳定兼容。

## 1. 与 Conversation Protocol 的关系

Archive 内的历史消息文件继续使用 [Conversation Protocol v1](./conversation-protocol-v1.md) 的文件命名与 artifact 语义，例如：

```text
[1]user.md
[2]assistant.md
[2]assistant.calls.jsonl
[2]assistant.extra.json
[2]assistant.result.jsonl
```

Archive Protocol 不重新定义 role、tool call/result 或同 idx 语义。

## 2. Archive discovery

一个已提交 archive 目录使用：

```text
[N]system.md.archive/
```

其中 `N` 是该 archive 的 summary idx。正常压缩完成后，conversation 顶层通常存在对应 compact representation：

```text
[N]system.md
```

Consumer 不能依赖 conversation scanner 递归 archive；archive 必须由 consumer 显式发现。

## 3. `compression.json`

每个 archive 目录必须包含 `compression.json`。v1 consumer 可以依赖的最小字段是：

```json
{
  "version": 1,
  "archivedTurnIndices": [1, 2, 3]
}
```

约束：

- `version` 必须为 `1`；
- `archivedTurnIndices` 必须是非空、无重复的非负整数数组；
- `max(archivedTurnIndices)` 必须等于 archive 目录名中的 `N`。

当前 `promptpile-compress` 还写入以下 metadata：

```json
{
  "compressedAt": "ISO-8601 timestamp",
  "strategy": "sliding-window",
  "originalTokenCount": 12345,
  "compressedTokenCount": 42
}
```

这些字段当前属于 producer metadata。Consumer **必须忽略未知字段**，不得因为新增 metadata 字段而失败。

## 4. Authoritative 与 private artifacts

Archive 中的 authoritative historical state 是：

- `compression.json` 的 v1 最小字段；
- 匹配 Conversation Protocol 文件命名的 archived message/artifact files。

当前实现还保存 `.summary.md` 作为 commit/recovery 辅助文件。它不是 Archive Protocol v1 的 public contract，consumer 不得依赖其存在或内容。

`.promptpile-compress.staging/` 同样是 `promptpile-compress` 私有恢复状态，不属于 Archive Protocol，其他 consumer 必须忽略。

## 5. Producer / restore / consumer ownership

```text
Conversation Protocol
      │
      ▼
promptpile-compress   ← lifecycle mutation owner
      │ writes
      ▼
Archive Protocol
      │ reads
      ├── promptpile-compress-grep-search
      └── future independent consumers
```

- Producer 可以创建 archive 和对应 summary。
- Restore implementation 可以删除 summary、把 archived message files 移回 conversation 顶层并删除 archive。
- Retrieval consumer 是 **read-only**：不得修改 archive、manifest 或 archived message files。
- Consumer 不得 import `promptpile-compress` 私有源码、`dist/*` 或内部 TypeScript types 作为协议替代品。

## 6. Derived indexes

全文索引、embedding、vector index、cache 等属于可再生 derived state，不是 authoritative archive。Consumer SHOULD 把这些数据放在 archive 目录之外，并能在索引丢失时从 Archive Protocol 重建。

v1 不规定 derived-index 目录或数据库格式。

## 7. Incomplete states

Compress/restore 可能因进程崩溃留下需要 recovery 的状态。Recovery ownership 属于 lifecycle mutation implementation，而不是 retrieval consumer。

Retrieval consumer 应：

- 忽略 staging；
- 在读取前验证 archive 目录名和 `compression.json` 最小字段；
- 对无效或冲突 archive 明确报错，不自行“修复”文件；
- 不因为对应 `[N]system.md` 暂时缺失而修改 archive。

## 8. 下一步稳定条件

Archive Protocol v1 从 Experimental 提升前至少需要：

1. `promptpile-compress` producer/restore conformance fixtures；
2. 一个不 import compress 私有实现的独立 consumer；
3. archive discovery / manifest / archived-turn 读取的 cross-package tests；
4. 明确 v1 breaking-change 与迁移策略。
