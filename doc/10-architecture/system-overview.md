# 系统架构总览

> 层级：10 · Architecture  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：Promptpile 系统分层、状态归属与主要数据流  
> 依赖：[产品定位](../00-overview/product-vision.md)  
> 最近复核：2026-08-12

```text
                         public CLI / artifacts
Orchestration System ─────────────────────────────► Execution System
 promptpile-react                                  promptpile
       │                                               │
       │ Agent Event Protocol                         │ one Chat Completion
       ▼                                               ▼
 machine consumers                                 LLM endpoint

                     Conversation Protocol
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
        Execution       Fork System   Tool Execution
        promptpile      promptpile-fork  MCP/executors
                            │
                            └─ independent physical snapshot

Context Lifecycle Mutation ──► Archive Protocol ──► read-only retrieval consumers
```

`promptpile-protocol` 位于运行时系统之外：它是 Conversation/Fingerprint/Tool/Receipt 的**纯可执行协议投影**，供多个 package 共享稳定 parser/formatter/schema；它不拥有 filesystem、HTTP、CLI、锁、hook、orchestration 或 lifecycle policy。

## 系统职责

### Execution System

`promptpile` 拥有“一次 invocation 如何从 config + Conversation 形成一次 Chat Completions 请求并发布结果”。一次 root completion 只调用一次模型；工具调用只产生 artifacts，不在 core 内执行。

### Orchestration System

拥有多阶段/多轮策略。`promptpile-react` 的 Thought/Observe/Check/Final FSM 属于这里；它通过 Promptpile public CLI 和 artifacts 组合 execution primitive，并可把可观察状态投影为 Agent Event Protocol v1。

### Fork System

`promptpile-fork` 拥有 Conversation prefix snapshot 的 filesystem transaction：只读 source、selected-prefix observation、private staging、验证、source re-observation 和 terminal directory publication。它不组装模型消息，也不 materialize layered Conversation。

### Tool Execution System

拥有工具目录、调用执行、retry/failure policy 与 result 写回。Promptpile core 只认识 tool definitions 与 calls/results artifacts。

### Context Lifecycle System

`promptpile-compress` 负责有副作用的 compress/restore/recovery；Archive Protocol 定义历史表示；grep/vector 等 consumer 只读协议并可独立演化。Lifecycle mutation 不成为普通 completion 的隐式副作用。

## 系统不变量

- Conversation 的持久状态在文件系统。
- `promptpile` = one invocation → at most one Chat Completions request；不执行工具，不自动第二次 completion。
- Orchestrator 与 Promptpile 的 runtime boundary 是 public CLI/stdin/files；不穿透 `src/*` / `dist/*`。
- Layered completion 只有一个可写 output directory；下游 mutator 不跨所有 input layers 联合写入。
- Fork source 保持只读，final target 只由一次 terminal directory rename 发布。
- `promptpile-protocol` 只接纳纯 data/function protocol semantics，不吸收 runtime ownership。
- 跨 package 的 machine compatibility 由 `doc/15-contracts` 定义并由 schemas/fixtures/tests/CI 证明。
