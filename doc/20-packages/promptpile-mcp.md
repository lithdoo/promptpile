# promptpile-mcp

> 类型：package  
> 状态：implemented / beta  
> 主要职责：MCP session gateway 与 tool artifact executor  
> 最近复核：2026-08-10

## Architecture

`launch` 常驻进程读取 MCP config，建立 stdio MCP sessions，并监听 localhost HTTP gateway。短生命周期命令通过 HTTP 使用 gateway：

- `export-tools`：`tools/list` → Promptpile `.tools.toml`
- `exec-calls`：calls JSONL → `tools/call` → result JSONL
- `check`：只读检查 calls/result 完整性

Promptpile core 不因此引入 MCP SDK，也不执行工具。

Layered Conversation I/O 下，`exec-calls` 仍以一个明确目录或 calls 文件为 mutation 边界。推荐 after-hook 传 `PROMPTPILE_ASSISTANT_CALL_FILE` 给 `--input`；result 原子写回同一 output directory。`check` 只配对该 calls 文件的同目录 result，不跨 base/reference layers 搜索。

## Failure model

MCP config 支持启动 failure policy；execution 层拥有 concurrency、timeout、retry 与 `continue | fail_fast` 等策略。`check` 用 complete/pending/partial/invalid 明确 artifact 状态。

## Security boundary

Gateway 默认绑定 loopback；可配置 bearer token。工具执行权限最终仍取决于被启动 MCP server 的 command、cwd、env 与 server 自身能力。

[查看 DESIGN](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-mcp/DESIGN.md)
