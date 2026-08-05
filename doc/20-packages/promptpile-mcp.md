# promptpile-mcp

> 类型：package  
> 状态：implemented / beta  
> 主要职责：MCP session gateway 与 tool artifact executor  
> 最近复核：2026-08-05

## Architecture

`launch` 常驻进程读取 MCP config，建立 stdio MCP sessions，并监听 localhost HTTP gateway。短生命周期命令通过 HTTP 使用 gateway：

- `export-tools`：`tools/list` → Promptpile `.tools.toml`
- `exec-calls`：calls JSONL → `tools/call` → result JSONL
- `check`：只读检查 calls/result 完整性

Promptpile core 不因此引入 MCP SDK，也不执行工具。

## Failure model

MCP config 支持启动 failure policy；execution 层拥有 concurrency、timeout、retry 与 `continue | fail_fast` 等策略。`check` 用 complete/pending/partial/invalid 明确 artifact 状态。

## Security boundary

Gateway 默认绑定 loopback；可配置 bearer token。工具执行权限最终仍取决于被启动 MCP server 的 command、cwd、env 与 server 自身能力。

[查看 DESIGN](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-mcp/DESIGN.md)
