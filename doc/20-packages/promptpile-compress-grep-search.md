# promptpile-compress-grep-search

> 类型：workspace package
> 状态：archive reader foundation / private
> 主要职责：基于 Archive Protocol 的只读 grep history retrieval  
> 最近复核：2026-08-06

`packages/promptpile-compress-grep-search/` 已成为 npm workspace package，实现独立的 Archive Protocol discovery、v1 manifest validation 与 `readArchivedTurn()`。Producer/consumer integration test 使用公开 package 边界创建并读取 archive，architecture guard 禁止 production reader 依赖 compress implementation。

## 目标边界

```text
Archive Protocol
      │ read-only
      ▼
promptpile-compress-grep-search
      │
      └── generic grep mechanism → @agent-tool-lite/search
```

当前边界：

- 只依据 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 发现和解析 archive；
- 不 import `promptpile-compress` 私有源码或构建产物；
- 不修改 archive authoritative state；
- 优先复用 `@agent-tool-lite/search` 的 ripgrep mechanism，而不是重写 grep runner；
- 当前输出 turn/role/fileKind/content；grep snippet/query surface 尚未实现。

Vector / embedding search 不属于本项目；如果 grep retrieval 的实际效果不足，再新增独立 vector consumer。

[查看项目 TODO](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress-grep-search/TODO.md)
