# promptpile-compress-grep-search

> 类型：workspace package
> 状态：Beta / P4 complete
> 主要职责：基于 Archive Protocol 的只读 grep history retrieval  
> 最近复核：2026-08-10

`packages/promptpile-compress-grep-search/` 是独立的 Archive Protocol read-only consumer，实现 archive discovery、v1 manifest validation、`readArchivedTurn()`、Node.js 流式 literal search、`promptpile-archive` CLI 和 stdio MCP adapter。Producer/consumer integration test 使用公开 package 边界创建并读取 archive，architecture guard 禁止 production reader 或 adapter 依赖 compress implementation。

Layered Conversation I/O 不改变它的单目录读取边界：CLI/domain/MCP 启动参数必须明确选择一个 physical Conversation Directory，通常是 session output。Reader 不联合搜索其它 input layers；跨目录查询由调用方分别发起。

## 目标边界

```text
Archive Protocol
      │ read-only
      ▼
promptpile-compress-grep-search
      ├── TypeScript domain API
      ├── promptpile-archive list / search / read
      └── promptpile-archive mcp
             ├── list_archives
             ├── search_archive
             └── read_archived_turn
```

当前边界：

- 只依据 [Archive Protocol v1](../15-contracts/archive-protocol-v1.md) 发现和解析 archive；
- 不 import `promptpile-compress` 私有源码或构建产物；
- 不修改 archive authoritative state；
- literal search 使用有界 Node.js file stream，不依赖 `@agent-tool-lite/search`、ripgrep 或平台二进制；
- CLI 与 MCP 都只调用相同 domain API，不重复实现 discovery、filtering 或 result mapping；
- MCP server 启动时固定 conversation directory，tool input 不接受 filesystem path；
- MCP 提供 `list_archives` / `search_archive` / `read_archived_turn`，并声明 read-only、non-destructive annotations。

Vector / embedding search 不属于本项目；如果 grep retrieval 的实际效果不足，再新增独立 vector consumer。

[查看项目 TODO](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-compress-grep-search/TODO.md)
