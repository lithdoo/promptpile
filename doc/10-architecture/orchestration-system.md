# 编排系统

> 层级：10 · Architecture  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：多阶段/多轮 orchestration 与 Promptpile execution 的关系  
> 最近复核：2026-08-12

```text
Orchestrator
  ├─ choose phase / prompt / profile selector / tool policy
  ├─ spawn promptpile public CLI
  ├─ observe explicit output/artifacts
  └─ decide next state
```

Orchestrator 不重新实现 Promptpile profile parser、Conversation scanner、SSE parser、OCC 或 Receipt semantics。

## promptpile-react v1 FSM

一个完整 iteration 固定为：

```text
Thought → Observe → Check ── continue=true ──► next iteration
                    │
                    └── continue=false ─────► final
```

运行时状态只有：

```text
running | final | max_step | error
```

三阶段都成功后 `currentStep` 才增加。Thought/Observe/Check 任一 required phase 失败立即进入 `error`，不会继续 Final。非空 Final prompt 是 required phase；空 Final prompt 明确 skipped。成功进程终态只能是 `final` 或 `max_step`。

## Phase ownership

- Thought：真实 Conversation，可启用 tools/hook。
- Observe：真实 Conversation，禁用工具，要求可读 observation output。
- Check：隔离临时 Conversation，只接收 check prompt 与 Observe report，通过通用 ToolCall + `react_check_decision` 决定 boolean `continue`。
- Final：只从 `final|max_step` 进入，禁用工具；machine streaming 使用 Promptpile private fd3 output-pile transport 获取正文增量，不让 child stdout 污染 protocol stdout。

React 只选择 profile 名称/phase override；`[[llm_api]]` 的内容和 provider validation 始终由 Promptpile 解析。

## Machine observable projection

默认输出仍是 human-facing `terminal`。`--output-format stream-json` 将 stdout 专用于 [Agent Event Protocol v1](../15-contracts/agent-event-protocol-v1.md)。该协议只暴露 orchestration facts 与 Final answer deltas，不公开 Thought/Observe/Check 正文、tool arguments 或 hidden reasoning。

Agent Event Protocol v1 是 6-event closed set；同一 session 的 sequence 连续，terminal event 唯一且为可写 channel 上的最后一条事件。`--quiet` 不抑制 machine events；EPIPE 不能被伪装成 protocol success。

`promptpile-plan` 当前仍是 scaffold，不应被本文视为已具备同等级 runtime contract。
