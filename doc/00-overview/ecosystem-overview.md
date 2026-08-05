# 生态总览

> 层级：00 · Overview  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：Promptpile ecosystem 的能力分区  
> 最近复核：2026-08-05

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
          ┌──────────┴───────────┐
          │                      │
   promptpile-mcp       promptpile-compress
   tool execution        context lifecycle
          │
          ▼
   MCP servers / agent-lite-tools
```

## 能力分区

| 区域 | 当前实现 | 职责 |
| --- | --- | --- |
| Execution primitive | `promptpile` | 装配文件消息、解析 LLM profile、单次 completion、持久化回复/calls |
| Orchestration | `promptpile-react` | Thought → Observe → Check → Final 的 ReAct 编排 |
| Tool bridge | `promptpile-mcp` | MCP 会话、工具导出、calls 执行、result 写回 |
| Context lifecycle | `promptpile-compress` | conversation 压缩、索引、restore/retrieval 方向 |
| Plan orchestration | `promptpile-plan` | 当前仍是 scaffold |
| Tool implementations | `agent-lite-tools/*` | file/search/shell/web 等工具能力 |

跨组件真正共享的是 `promptpile` CLI、conversation 文件协议、tool artifacts 与 `.tools.toml`。这些内容集中在 [15 · 正式契约](../15-contracts/README.md)。
