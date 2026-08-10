# Tool Artifacts v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：tool calls/result 的文件配对与完整性语义  
> 被以下组件实现：`promptpile`、`promptpile-mcp`  
> 最近复核：2026-08-10

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

## Physical-directory ownership

Conversation calls、result、assistant 正文与 extra 的 owner 是同一个 physical Conversation Directory 加同一个 idx：

```text
<directory>/[idx]assistant.md
<directory>/[idx]assistant.calls.jsonl
<directory>/[idx]assistant.extra.json
<directory>/[idx]assistant.result.jsonl
```

配对键至少包含 canonical directory identity、idx 和 call id。不同 layer 中相同的 idx、basename 或 call id 不形成配对；executor 和 scanner 都不得跨目录搜索 result 来补全 calls。`promptpile-mcp exec-calls` 应以明确 calls 文件或单个明确目录为 mutation 边界，第一版 layered I/O 不赋予它跨 layer 联合执行语义。

Root completion 产生的 Conversation calls 总是写在 CLI Contract v1 选定的唯一 output directory，并通过 `PROMPTPILE_ASSISTANT_CALL_FILE` 向 after-hook 暴露确切路径。executor 必须把 result 写回该 calls 文件的同目录 sibling `[idx]assistant.result.jsonl`；不得根据当前工作目录、全局最大 idx 或其他输入 layer 猜测目标。

推荐的 after-hook 交接是 `promptpile-mcp exec-calls --input "$PROMPTPILE_ASSISTANT_CALL_FILE"`。`--dir "$PROMPTPILE_OUTPUT_DIRECTORY"` 仍是合法的单目录批处理方式，但不得传入 input layer 或尝试把多个 layer 合并扫描。`promptpile-mcp check --input` 使用同一 physical-directory 配对规则。

使用 `-o` 生成的 `{basename}.calls.jsonl` 仍是普通主输出 sidecar，不属于 Conversation idx namespace；`PROMPTPILE_CALLS_FILE` 专指该文件。它与 `PROMPTPILE_ASSISTANT_CALL_FILE` 不得混用。

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
