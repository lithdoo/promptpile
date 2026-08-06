# Archive Protocol v1

> 层级：15 · Contracts  
> 状态：Active Design  
> 稳定程度：Experimental  
> 主要定义：Promptpile 压缩归档的跨 package 发现、读取与兼容语义  
> 当前 producer/restore implementation：`promptpile-compress`  
> 计划 consumer：`promptpile-compress-grep-search`  
> 最近复核：2026-08-06

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
  "summaryKind": "semantic",
  "summaryProvider": "caller-provider-id",
  "tokenizer": { "id": "tiktoken@1.0.22", "model": "gpt-4o-mini", "kind": "exact" },
  "budget": { "mode": "context-budget", "triggerTokens": 32000 },
  "liveTokenCountBefore": 12345,
  "summaryTokenCount": 42,
  "liveTokenCountAfter": 4096
}
```

这些字段当前属于 producer metadata：

- `summaryKind` 标记 producer 使用 `archive-pointer` 或 `semantic` generator；
- `summaryProvider` 仅在 semantic 模式存在，用于标识调用方注入的 provider；
- `tokenizer` 与 `budget` 记录 producer 的计数身份和本次可解释预算报告；
- `liveTokenCountBefore` 是压缩前全部 live turns 的估算 token 数；
- `summaryTokenCount` 是新 summary message 的估算 token 数；
- `liveTokenCountAfter` 是 kept turns 加新 summary 的估算 token 数。

它们不是 v1 consumer contract。Consumer **必须忽略未知字段**，不得因为新增、删除或重命名 producer metadata 字段而失败。2026-08-06 之前的 archive 可能包含 `originalTokenCount` 与 `compressedTokenCount`；v1 consumer 同样应将它们视为未知字段。

协议 conformance corpus 位于 `../../fixtures/archive-protocol-v1/`。Producer、restore 与独立 consumer 应复用该 corpus，而不是各自复制协议样本。

## 4. Authoritative 与 private artifacts

Archive 中的 authoritative historical state 是：

- `compression.json` 的 v1 最小字段；
- 匹配 Conversation Protocol 文件命名的 archived message/artifact files。

当前实现还保存 `.summary.md` 作为 commit/recovery 辅助文件。它不是 Archive Protocol v1 的 public contract，consumer 不得依赖其存在或内容。

`.promptpile-compress.staging/` 同样是 `promptpile-compress` 私有恢复状态，不属于 Archive Protocol，其他 consumer 必须忽略。

`.promptpile-compress.lock` 是 lifecycle writer 的私有协调文件，也不属于 Archive Protocol。Consumer 必须忽略它，不得用 lock 的存在替代 archive/manifest 校验，也不得替 mutation implementation 清理 lock。

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

- [x] `promptpile-compress` producer/restore conformance fixtures；
- [x] 一个不 import compress 私有实现的独立 runtime consumer；
- [x] archive discovery / manifest / archived-turn 读取的 cross-package tests；
- [x] 明确 v1 breaking-change 与迁移策略。

## 9. Breaking change 与迁移

向 `compression.json` 增加 producer metadata 属于 additive change，v1 consumer 必须忽略。改变最小必需字段、目录发现规则、authoritative artifact 语义或 idx 约束属于 breaking change，必须使用新的 manifest `version`，旧 consumer 对未知 version fail closed。

当前不做 archive 原地升级。迁移由 lifecycle owner 使用对应旧版 restore 将 authoritative message artifacts 恢复到 Conversation Protocol 顶层，再由新版 producer 重新压缩；迁移前后必须通过 byte-for-byte artifact 校验。多版本 reader 只能在明确实现每个版本的独立 validator 后接受对应 version，不得猜测兼容。
