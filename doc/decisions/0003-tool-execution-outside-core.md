# ADR 0003 · Tool execution 保持在 Promptpile core 之外

> 状态：Accepted  
> 最近复核：2026-08-05

## Context

模型 tool calls 需要权限、超时、重试、并发、失败恢复与不同 transport，这些职责会显著扩大一次 completion primitive。

## Decision

Promptpile 只声明 tools、生成 calls、读取 results；真实执行由 `promptpile-mcp` 或其他 executor 完成。

## Consequences

Core 保持小而可组合；executor 可独立管理 MCP sessions 与 failure policy。代价是 calls/result artifact 必须成为正式 contract，并由调用方显式编排第二轮 completion。
