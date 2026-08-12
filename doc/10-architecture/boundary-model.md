# 边界模型

> 层级：10 · Architecture  
> 状态：Normative  
> 稳定程度：Stable  
> 主要定义：跨 package 的 ownership 与允许依赖方向  
> 依赖：[系统架构总览](./system-overview.md)  
> 最近复核：2026-08-12

## 允许的依赖方向

```text
doc/15-contracts
      │ normative semantics
      ▼
promptpile-protocol ─────► promptpile
      │                    ▲
      ├──────────────► promptpile-fork
      │                    │
      └──────────────► promptpile-react ── public CLI/stdin/files ──┘

promptpile-mcp ◄──── calls/results ────► Conversation artifacts

Conversation Protocol ──► promptpile-compress ──► Archive Protocol
Archive Protocol ── read-only ──► promptpile-compress-grep-search
```

`promptpile-protocol` 提供纯协议能力。它可以被 producer/consumer 依赖，但不得依赖任何运行时 owning package。

`promptpile-react` 可以直接依赖 `promptpile-protocol/tool` 校验通用 ToolCall，但执行模型、解析 provider profile、Conversation I/O、OCC、Receipt 与 SSE 都必须留给 `promptpile` public CLI。

`promptpile-fork` 可以依赖 protocol 的 Conversation/Fingerprint 纯语义，但 filesystem claim/staging/rename transaction 只属于 fork package。

## 明确禁止的边界

- `promptpile` 不拥有 tool execution 或 agent loop。
- `promptpile-protocol` 不拥有 scanner traversal、filesystem I/O、cwd/env、config、HTTP/SSE、OCC/lock、hook、Receipt publication、MCP、compression/restore 或 React FSM。
- Orchestrator 不 import `promptpile/src/*` 或 `promptpile/dist/*`。
- Archive consumer 不 import `promptpile-compress/src/*` 或 `dist/*`。
- Fork 不做 layered materialization、merge、overwrite、idx rewrite、archive clone、model/tool execution。
- Package-local public schema 的 ownership 不因其 human contract 位于 `doc/15-contracts` 而迁移到 protocol package。

## CLI-first 与 protocol-first

CLI-first 用于有生命周期/副作用的完整 domain operation，例如 completion、append-user、fork、tool execution。Protocol-first 用于独立 producer/consumer 需要共享的纯 machine semantics。只有同时满足“稳定 public protocol + pure data/function + 无 runtime effect + 有 normative contract + conformance evidence + 真实跨 package reuse”的能力才进入 `promptpile-protocol`。
