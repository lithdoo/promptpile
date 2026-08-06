# Package 目录

> 层级：20 · Packages  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：当前 monorepo package / scaffold 如何承担系统职责  
> 最近复核：2026-08-05

Package 文档描述 **ownership 与实现入口**；跨 package 协议仍以 [15 · Contracts](../15-contracts/README.md) 为准。

| Component | 系统角色 | 成熟度 |
| --- | --- | --- |
| [promptpile](./promptpile.md) | Execution primitive | Beta / active |
| [promptpile-react](./promptpile-react.md) | ReAct orchestration | Beta / active |
| [promptpile-mcp](./promptpile-mcp.md) | MCP tool bridge | Beta / active |
| [promptpile-compress](./promptpile-compress.md) | Context lifecycle mutation / Archive producer | Beta |
| [promptpile-compress-grep-search](./promptpile-compress-grep-search.md) | Archive Protocol read-only consumer | Beta |
| [promptpile-plan](./promptpile-plan.md) | Plan/Exec orchestration | Scaffold |
| [agent-lite-tools](./agent-lite-tools.md) | Tool implementations | Supporting |
