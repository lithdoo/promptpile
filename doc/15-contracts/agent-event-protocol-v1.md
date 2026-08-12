# Agent Event Protocol v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Stable  
> Owning package：`promptpile-react`  
> Machine schema：`packages/promptpile-react/schema/agent-event-v1.schema.json`  
> 最近复核：2026-08-12

Agent Event Protocol v1 是 `promptpile-react --output-format stream-json` 的 stdout JSONL contract。它是 ReAct session 的**可观察投影**，不是 hidden reasoning transcript。

默认 `terminal` 输出不受本协议改变。

## 1. Channel ownership

在 `stream-json` 模式：

- stdout 只允许 Agent Event Protocol JSONL；每行一个完整 JSON object。
- human diagnostics 与 child stderr 写 stderr。
- Promptpile child stdout 不得直接污染 machine stdout。
- `--quiet` 不抑制 protocol events。
- pipe/channel 写失败（包括 EPIPE）不能被报告为 protocol success。

## 2. Common fields

每个 event 必须包含：

```text
schema_version = 1
session_id     = non-empty string
sequence       = integer >= 0
```

同一 session 的 `session_id` 不变；`sequence` 从 0 开始连续递增，不跳号、不重复。

## 3. Frozen event vocabulary

`schema_version = 1` 只有以下 6 个 event types：

| type | required payload | semantics |
| --- | --- | --- |
| `session.started` | `max_steps` | session 已建立 |
| `phase.started` | `phase` + `step_index`，或 Final 的 `steps_completed` | required phase 开始 |
| `phase.completed` | `phase` + 对应 step/steps 字段；Check 另需 `continue` | required phase 成功完成 |
| `final.delta` | `content` | Final answer 的增量文本 |
| `session.completed` | `stop_reason`, `steps_completed`, `final` | 唯一成功 terminal event |
| `session.failed` | `phase`, `steps_completed`, `error` | 唯一失败 terminal event |

v1 vocabulary 是 closed set。新增任何 event type、改变既有字段语义或 terminal semantics 必须提升 `schema_version`。producer 可以 additive 新增 optional fields；consumer 必须忽略未知 optional fields。

## 4. Public enums

成功 stop reason：

```text
final | max_step
```

Final result：

```json
{"status":"completed","content":"..."}
```

或：

```json
{"status":"skipped"}
```

失败 phase：

```text
startup | thought | observe | check | final
```

v1 error code closed set：

```text
promptpile_spawn_failed
promptpile_exit_nonzero
phase_output_missing
check_decision_invalid
final_stream_invalid
internal_error
```

## 5. Privacy boundary

公开 stream 可以暴露 phase lifecycle、Check 的 boolean `continue`、steps counters、stop reason、Final answer delta 与结构化错误。

它**不得**公开 Thought/Observe/Check 正文、tool arguments、hidden reasoning、内部 Promptpile SSE 或私有 output-pile frames。`final.delta` 是唯一正文增量事件。

## 6. Final dual witness

非空 Final prompt 是 required phase。Final success 需要同时满足：

```text
private Final output stream reached a valid done witness
AND
Promptpile child exited with code 0
```

malformed/incomplete private stream、child non-zero exit 或 required Final output 缺失必须 fail-closed，不得发 `session.completed`。

空 Final prompt 可以明确得到 `final.status = skipped`，不伪造 Final content。

## 7. Terminal invariant

在 output channel 可写的前提下：

```text
session.started
→ zero or more non-terminal events
→ exactly one of session.completed | session.failed
→ EOF
```

terminal event 唯一且最后。成功 terminal 只能在 ReAct FSM 已到 `final|max_step`、required Final 处理完成后产生。

## 8. Machine schema 与证据

规范的 machine-readable projection 由 owning package 发布：

```text
packages/promptpile-react/schema/agent-event-v1.schema.json
```

schema fixtures、event-writer tests、stream-json CLI tests、real Promptpile E2E、packed fresh-install smoke 和专用 Node 20/22 × Ubuntu/Windows streaming CI 构成 executable evidence。该 schema 不进入 `promptpile-protocol`，因为 Agent Event 是 React orchestration 的 package-owned public contract。
