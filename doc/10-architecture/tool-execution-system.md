# 工具执行系统

> 层级：10 · Architecture
> 状态：Frozen v1
> 最近复核：2026-08-12

```text
.tools.toml → promptpile → LLM → *.calls.jsonl → executor → *.result.jsonl → next promptpile run
```

## Ownership

- `promptpile-protocol` 定义跨包的 `ToolCallV1` / `ToolResultLineV1` 数据形状。
- `promptpile` 正确执行一次模型补全，发布 durable model artifacts。
- `promptpile-mcp` 持有 MCP sessions、工具执行策略、execution claim 与 result publication。
- `promptpile-react` 持有 orchestration 状态机；`promptpile-fork` 持有 Conversation snapshot transaction。

MCP 不读取 Promptpile 私有 runtime、Conversation scanner、Receipt、Fork 或 React FSM。

## Execution transaction

对一个 resolved result target，cooperative executor 使用同目录：

```text
<result>.promptpile-mcp.exec.claim
```

执行顺序固定为：

```text
observe result → exclusive claim → re-observe → parse calls
→ execute gateway → validate exact result vector → atomic publish → release claim
```

claim 在任何真实 `tools/call` 前创建。它通过 `wx` exclusive create 保证同一 result target 最多有一个 cooperative owner，并用随机 owner token 防止错误进程清理。

## Indeterminate execution

timeout、connection reset、5xx、malformed/incomplete 2xx、取消或 publication failure 都可能发生在外部副作用之后。此时不发布成功 witness，并保留 claim；后续 executor 必须拒绝自动重放。v1 不按 TTL 或本机 PID 自动偷取 claim。

只有 calls/parser 等可证明发生在 gateway dispatch 前的失败、contract-defined pre-execution 4xx，或成功 durable publication 才释放 claim。result 已发布但 claim cleanup 失败时保留 result 并告警。

## Retry 与 publication

重试只适用于显式列入 `retry_safe_tools` 的工具；非白名单工具在一个 owner 内也不会自动重试。gateway 2xx 必须为每个 input call 返回且仅返回一个 validated result，并恢复原 call 顺序。writer 不补造缺失结果。正式 result 仍通过同目录临时文件、`fsync` 和原子 rename 发布。
