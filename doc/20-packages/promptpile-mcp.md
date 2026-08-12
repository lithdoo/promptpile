# promptpile-mcp

> 类型：CLI package
> 状态：Promptpile MCP Tool Execution v1 Frozen
> 最近复核：2026-08-12

`promptpile-mcp` 是 MCP session gateway 与 ToolCall artifact executor。Node.js contract 为 `>=20`。

## Commands

- `launch`：读取严格的 v1 config，建立 stdio MCP sessions，仅在 loopback 启动 HTTP gateway。
- `export-tools`：把 `tools/list` 导出为 Promptpile `.tools.toml`。
- `exec-calls`：执行一个明确 calls 文件或一个 physical directory 第一层的 calls 文件。
- `check`：只读报告 `complete | pending | partial | invalid`，并额外显示 execution claim 是否存在。

Conversation integration 推荐把 `PROMPTPILE_ASSISTANT_CALL_FILE` 作为 `exec-calls --input` 的精确路径。MCP 不做 layered union scan，也不从 cwd 猜 Conversation。

## Result semantics

- 已有 complete result 且未 overwrite：安全 skip。
- 已有 partial/invalid result 且未 overwrite：fail closed，退出非零且不执行工具。
- `--overwrite-results` 是显式 re-execution policy，仍不能绕过已有 claim。
- claim conflict 或 indeterminate execution：退出非零且不自动重放。
- 目录模式任一 selected item 失败，整体不能报告成功。

## Strict config

缺省字段使用 documented defaults；显式错误值立即失败。version 仅允许整数 `1`。顶层和各 known table 拒绝未知 key；table、boolean、integer、transport、server id、command、env 与 `retry_safe_tools` 都严格校验。env 仅允许 string、finite number、boolean，并规范化为 subprocess string。

## Package and security boundary

包只声明 CLI `bin`，不声明稳定 library `main`。CLI 与 MCP clientInfo 从 package metadata 读取同一版本。gateway 默认 loopback，可启用 bearer token；server command/cwd/env 等同本机代码执行权限。claim metadata 不包含 token、tool arguments 或 secret payload。

## Evidence

包测试包括 strict config、exact response contract、claim owner token、concurrent contention 与 lost-response replay blocking。composition witness 通过两次真实 Promptpile CLI、真实 calls/result artifacts 和真实 stdio MCP 执行证明 Promptpile → MCP → Promptpile 回放闭环；packed witness 从 protocol、Promptpile、MCP 三个 tarball 的 fresh consumer 重跑同一业务链。专用 CI 在 Node 20/22 × Ubuntu/Windows 上执行这些 witness。

公共 calls/result shape 见 [Tool Artifacts v1](../15-contracts/tool-artifacts-v1.md)，系统 ownership 见 [工具执行系统](../10-architecture/tool-execution-system.md)。
