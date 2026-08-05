# 工具执行系统

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：tool generation、execution 与 result persistence 的分工  
> 最近复核：2026-08-05

```text
.tools.toml → promptpile → LLM → *.calls.jsonl → executor → *.result.jsonl → next promptpile run
```

## Promptpile 的职责

读取显式 `.tools.toml`、将工具发送给模型、持久化 tool calls、在后续扫描中把 result 组装为 `tool` message，并按 `missing_tool_results` 处理缺失结果。

## Executor 的职责

解析 calls artifact、找到真实工具、管理 timeout/concurrency/retry/failure policy、写 result artifact，不改变 Promptpile 的 message assembly 规则。

## MCP 实现

`promptpile-mcp launch` 常驻持有 stdio MCP sessions，并提供 localhost HTTP gateway；`export-tools` 生成 Promptpile 工具 TOML；`exec-calls` 执行 calls；`check` 判断 complete/pending/partial/invalid。
