# 成熟度与范围

> 层级：00 · Overview  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：当前 main 分支各能力的成熟度边界  
> 最近复核：2026-08-12

| 组件 | 状态 | 当前边界 |
| --- | --- | --- |
| `promptpile-protocol` | Beta / v1 surface stable | 纯 TS 协议投影；公开 `conversation`、`fingerprint`、`tool`、`receipt`，Node >=18，无 runtime dependencies |
| `promptpile` | Beta / execution contracts hardened | 单次 Chat Completions primitive；request authority、terminal witness、OCC、artifact publication、after-hook 与 Completion Receipt 已形成闭环 |
| `promptpile-fork` | Beta / Conversation Fork v1 frozen | 单物理目录 selected prefix 的只读、byte-exact 独立 snapshot；唯一公开 commit point 为最终目录 rename |
| `promptpile-react` | Beta / orchestration + event v1 frozen | Thought/Observe/Check/Final FSM；默认 terminal 输出；`stream-json` 提供冻结的 Agent Event Protocol v1 |
| `promptpile-mcp` | Beta / active | gateway、export-tools、exec-calls、check；tool execution 明确位于 core 外 |
| `promptpile-compress` | Beta | context lifecycle mutation、semantic summary、budget、restore/recovery 与 Archive producer |
| `promptpile-compress-grep-search` | Beta | Archive Protocol 只读 discovery/read/search consumer |
| `promptpile-plan` | Scaffold | Plan/Exec 方向仍未形成与 React 等价的完整 runtime contract |
| `agent-lite-tools` | Supporting | MCP/tool 实现集合，不定义 Promptpile 核心协议 |

## 稳定性说明

`Normative + Evolving` 表示生态内部当前必须一致，但不等价于长期 semver 稳定承诺。Conversation Fork v1、Agent Event Protocol v1 和当前 protocol package public surface 已完成各自的 v1 freeze；后续 incompatible change 应通过版本提升，而不是在同一 v1 语义下静默改变。

Archive Protocol 仍是 **Experimental**：producer/consumer boundary 已存在，但其长期兼容策略仍允许在 beta 阶段版本化演进。

当前文档不维护“已完成/待完成”追踪列表；实现状态以 package、contracts 与 executable evidence 为准，未来工作进入 issue/backlog 或明确的 non-normative active design。
