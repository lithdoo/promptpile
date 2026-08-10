# 系统架构总览

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：Promptpile 系统分层、状态归属与主要数据流  
> 依赖：[产品定位](../00-overview/product-vision.md)  
> 最近复核：2026-08-10

```text
Execution System ── conversation/calls artifacts ──► Tool Execution System
      ▲
      │ public CLI
Orchestration System

Conversation Protocol
      │
      ▼
Context Lifecycle Mutation ──► Archive Protocol ──► Retrieval Consumers
      ▲                              │
      └──────── restore ─────────────┘
```

## Execution System

拥有“如何从 conversation artifacts 形成一次模型请求”的语义。一次运行只发起一次 completion；工具调用只生成 artifacts，不在 core 内执行。

## Orchestration System

拥有多阶段、多轮策略。React 的 Thought/Observe/Check/Final 属于这里。Orchestrator 可以选择 profile、sidecar、tool policy，但不能依赖 Promptpile 私有实现。

## Tool Execution System

拥有工具目录、调用执行、retry/failure policy 与 result 写回。Promptpile core 只认识 tool definitions 与 call/result artifacts。

## Context Lifecycle System

拥有长对话的生命周期策略，但不要求由一个 package 实现所有能力：

- `promptpile-compress` 执行有副作用的 compress / restore / recovery；
- Archive Protocol 定义压缩历史的跨实现表示；
- grep/vector 等 retrieval consumer 只读 Archive Protocol，可以独立演化。

Context lifecycle 操作 conversation artifacts，但不成为普通 completion 的隐式副作用。

## 关键不变量

- Conversation 的持久状态在文件系统。
- Promptpile core 不执行工具。
- Orchestrator 与 Promptpile 的运行时边界是公开 CLI + artifacts。
- MCP executor 与 Promptpile 通过 tool artifacts 解耦。
- 压缩实现与历史检索实现通过 Archive Protocol 解耦。
- Layered completion 只有一个可写 output directory；工具执行与 lifecycle mutation 不跨 input layers 猜测或联合写入。
- Package 布局可以演化，但系统职责不能因代码复用需要而反向改变。
