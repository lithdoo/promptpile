# Package 目录

> 层级：20 · Packages  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：当前 monorepo package 如何承担系统职责  
> 最近复核：2026-08-12

Package 文档描述 **ownership 与实现入口**；跨 package 协议以 [15 · Contracts](../15-contracts/README.md) 为准。

| Component | 系统角色 | 成熟度 |
| --- | --- | --- |
| [promptpile-protocol](./promptpile-protocol.md) | Pure protocol executable projection | Beta / v1 surface stable |
| [promptpile](./promptpile.md) | Single Chat Completions execution primitive | Beta / active |
| [promptpile-fork](./promptpile-fork.md) | Byte-exact Conversation prefix snapshot | Beta / Fork v1 frozen |
| [promptpile-react](./promptpile-react.md) | ReAct orchestration + Agent Event producer | Beta / active, event v1 frozen |
| [promptpile-mcp](./promptpile-mcp.md) | MCP tool bridge/executor | Beta / active |
| [promptpile-compress](./promptpile-compress.md) | Context lifecycle mutation / Archive producer | Beta |
| [promptpile-compress-grep-search](./promptpile-compress-grep-search.md) | Archive Protocol read-only consumer | Beta |
| [promptpile-plan](./promptpile-plan.md) | Plan/Exec orchestration | Scaffold |
| [agent-lite-tools](./agent-lite-tools.md) | Tool implementations | Supporting |

## Ownership rule

Package 文档只回答“这个实现拥有什么、显式不拥有什么、通过什么 public boundary 互操作”。已经完成的 migration/freeze plan 不再作为 package 设计入口；长期事实进入本目录、Architecture 或 Contracts，过程保留在 Git history。
