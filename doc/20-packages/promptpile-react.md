# promptpile-react

> 类型：package  
> 状态：implemented / beta / Agent Event Protocol v1 frozen  
> 主要职责：ReAct-style orchestration  
> 代码入口：`packages/promptpile-react/src/index.ts`  
> 最近复核：2026-08-12

## 边界

`promptpile-react` 只通过 Promptpile public CLI、stdin 和 artifacts 执行模型工作；production code 不依赖 `promptpile/src/*` 或 `promptpile/dist/*`。通用 Check ToolCall 可以通过 `promptpile-protocol/tool` 校验，但 profile、Conversation I/O、SSE、OCC、Receipt 与 artifact publication 仍由 Promptpile CLI 拥有。

## Frozen runtime FSM

一个完整 iteration：

```text
Thought → Observe → Check
```

runtime state：

```text
running | final | max_step | error
```

- 三个阶段都成功后 `currentStep += 1`。
- Check false → `final`。
- Check true 且达到上限 → `max_step`。
- Thought/Observe/Check failure → `error`，不再 Final。
- 非空 Final prompt 是 required phase；空 Final prompt 显式 skipped。
- 进程成功终态只能是 `final|max_step`。

## Config ownership

React 解析 `[promptpile-react]` 与少量 orchestration defaults，但不解析 `[[llm_api]]` 内容。phase 只把 config path、profile selector 与显式 override 传给 Promptpile。兼容的 phase-specific model/key/base/temperature/extra-body 字段保留为 beta surface，但不再扩张 ownership。

## Output modes

公开 output mode 只有：

```text
terminal | stream-json
```

默认 `terminal` 保持 human-facing compatibility。

`stream-json` 将 stdout 专用于 [Agent Event Protocol v1](../15-contracts/agent-event-protocol-v1.md)。v1 只有 6 个 event types，只公开 phase lifecycle、Check boolean、Final deltas、terminal/result/error；不公开 Thought/Observe/Check 正文、tool arguments 或 hidden reasoning。

Final streaming 使用 Promptpile fd3 private output-pile transport。required Final success 需要 private stream done witness + child exit 0；malformed/incomplete stream fail-closed。machine schema 由本 package 发布在 `schema/agent-event-v1.schema.json`，不归 `promptpile-protocol` 所有。

## Executable evidence

package tests 覆盖 architecture boundary、strict React config、real Promptpile config boundary、FSM、ToolCall protocol、Agent Event schema/writer、stream-json CLI、real streaming E2E 与 packed install smoke。专用 workflow 在 Node 20/22 × Ubuntu/Windows 验证 streaming/publication boundary。
