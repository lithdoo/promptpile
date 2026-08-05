# Tool Artifacts v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：tool calls/result 的文件配对与完整性语义  
> 被以下组件实现：`promptpile`、`promptpile-mcp`  
> 最近复核：2026-08-05

## Calls 文件

Conversation 内：

```text
[idx]assistant.calls.jsonl
```

使用 `-o <output>` 时，主输出旁也可能生成：

```text
{basename}.calls.jsonl
```

每行表示一个 tool call，需要稳定的 call id、function name 与 arguments 以便 executor 关联结果。

## Result 文件

```text
{stem}.result.jsonl
```

Conversation 中即 `[idx]assistant.result.jsonl`。每条 result 通过 tool call id 唯一对应一条调用；Promptpile 后续把结果转成 `tool` message。

## 完整性状态

`promptpile-mcp check` 当前定义：

| 状态 | exit | 含义 |
| --- | ---: | --- |
| `complete` | 0 | 每个 call id 恰有一条 result；工具执行失败的 result 仍算完成 |
| `pending` | 1 | result 不存在 |
| `partial` | 1 | result 存在但缺少部分 call id |
| `invalid` | 2 | JSONL/字段损坏、重复 id 或未知 result id |

`exec-calls` 遇到 partial/invalid 的已有 result 不静默拼补；恢复应显式 overwrite 后整批重执行。

## Missing results

Promptpile 可按 `missing_tool_results = warn | error | ignore` 处理 calls 缺少 result 的情况。executor 不应把“result 不存在”自动等价为“安全重试”。
