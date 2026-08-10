# 生态总览

> 层级：00 · Overview  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：Promptpile ecosystem 的能力分区  
> 最近复核：2026-08-10

```text
                     Orchestration
               ┌──────────┴──────────┐
               │                     │
        promptpile-react       promptpile-plan
             ReAct              Plan / Exec
               │                     │
               └──────────┬──────────┘
                          │ public CLI
                          ▼
                    ┌────────────┐
                    │ promptpile │
                    └────────────┘
                     │          │
              artifacts        LLM API
                     │
          ┌──────────┴──────────────────────────┐
          │                                     │
   promptpile-mcp                       Context Lifecycle
   tool execution                       │
          │                              ├─ promptpile-compress
          ▼                              │   compress / restore
   MCP servers /                        │
   agent-lite-tools                     └─ Archive Protocol
                                             ├─ read-only archive reader
                                             └─ future vector consumer
```

## 能力分区

| 区域 | 当前实现 | 职责 |
| --- | --- | --- |
| Execution primitive | `promptpile` | 装配文件消息、解析 LLM profile、单次 completion、持久化回复/calls |
| Orchestration | `promptpile-react` | Thought → Observe → Check → Final 的 ReAct 编排 |
| Tool bridge | `promptpile-mcp` | MCP 会话、工具导出、calls 执行、result 写回 |
| Context lifecycle mutation | `promptpile-compress` | conversation 压缩、archive commit、restore/recovery |
| Archive retrieval | `promptpile-compress-grep-search` | Archive Protocol 的只读 reader、literal search CLI 与 MCP adapter |
| Plan orchestration | `promptpile-plan` | 当前仍是 scaffold |
| Tool implementations | `agent-lite-tools/*` | file/search/shell/web 等通用工具能力 |

跨组件共享的是公开 CLI 与 versioned artifacts，而不是彼此的私有实现。Conversation、Archive、tool artifacts 与 `.tools.toml` 的互操作定义集中在 [15 · 正式契约](../15-contracts/README.md)。

## Layered Conversation I/O 的生态边界

```text
base/context layers (read-only) ──┐
                                  ├─► Promptpile completion
session output (read/write) ──────┘          │
                                             ├─ calls/result: promptpile-mcp
                                             ├─ compress/restore: promptpile-compress
                                             └─ archive read/search: promptpile-archive
```

只有 `promptpile` / orchestrator 组合有序输入 layers。生态 consumer 不继承“联合多目录”能力：MCP executor 接收 output 中的精确 calls 文件或单个 output directory；Compress/Restore 以 output 为完整生命周期边界；Archive Search 查询调用方明确指定的一个 Conversation Directory。
