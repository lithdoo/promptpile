# agent-lite-tools

> 类型：supporting packages  
> 状态：implemented / supporting  
> 主要职责：供 agent/MCP 使用的轻量工具实现  
> 最近复核：2026-08-05

Workspace 当前包含 `base`、`file`、`search`、`shell`、`web` 等工具包。它们属于 tool implementation 层，不定义 Promptpile conversation 或 CLI contract。

根 package 已提供 `build:agent-tools` 与 `test:agent-tools` scripts。Pages/CI 验证应把这些 supporting workspaces 纳入显式检查，避免“root test green”与“全部 workspace green”混淆。
