# promptpile

> 类型：package  
> 状态：implemented / beta  
> 主要职责：单次 Chat Completions execution primitive  
> 代码入口：`packages/promptpile/src/index.ts`  
> 最近复核：2026-08-12

## 核心定位

```text
promptpile
= resolve one invocation
+ assemble Conversation
+ issue exactly one Chat Completions request
+ publish explicit artifacts
≠ tool executor
≠ agent loop
```

模型返回 tool calls 后，执行工具、写 result、再次 completion 必须由上层显式组合。

## Runtime ownership

`promptpile` owns：

- CLI/TOML/profile canonical resolution 与 strict type validation；
- API key resolution；
- layered Conversation scan/assembly 与唯一 writable output directory；
- tools declaration、tool_choice 与 missing-result policy；
- request authority：`extra_body` 不能覆盖 `model/messages/stream/temperature/tools/tool_choice`；
- exactly one streaming Chat Completions invocation；
- fail-closed stream terminal witness；
- Invocation ID；
- Conversation optimistic concurrency；
- output artifact policy / output pile；
- after-hook resolution/execution/failure policy；
- Completion Receipt builder、ledger 与 atomic publication。

它不拥有 tool execution、React FSM、Fork transaction、MCP transport 或 context compression/restore。

## Root completion lifecycle

```text
resolve config
→ invocation + API key
→ output/hook/OCC preflight
→ tools/tool_choice/sidecars validation
→ optional durable --input append
→ scan + assemble messages
→ exactly one callAIStream()
→ require non-empty finish_reason or [DONE]
→ publish output/calls/optional assistant artifact
→ after-hook decision
→ Completion Receipt last
```

known deterministic preflight failure 不应在 `--input` 前制造 user artifact；user append 一旦成功则独立 durable，不因之后的模型/network failure 回滚。

## Public surface

- binary：`promptpile`
- root completion CLI
- `promptpile conversation append-user`
- `promptpile conversation inspect`
- `promptpile conversation fingerprint`
- layered `-d/--directory` + `--output-dir`
- `--invocation-id` / `--receipt`
- Conversation / Tool / Receipt artifacts

规范入口：[CLI Contract v1](../15-contracts/cli-contract-v1.md)、[Conversation Protocol v1](../15-contracts/conversation-protocol-v1.md)、[Tool Artifacts v1](../15-contracts/tool-artifacts-v1.md)。Execution success theorem 见 [执行系统](../10-architecture/execution-system.md)。
