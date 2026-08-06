# 成熟度与范围

> 层级：00 · Overview  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：当前 main 分支各能力的成熟度边界  
> 最近复核：2026-08-06

| 组件 | 状态 | 说明 |
| --- | --- | --- |
| `promptpile` | Beta / active | 公开 CLI、conversation artifacts、LLM profile、tool call 持久化已有回归测试 |
| `promptpile-react` | Beta / active | 已完成 CLI-first 边界重构，production code 不依赖 `promptpile/dist/*` |
| `promptpile-mcp` | Beta / active | gateway、export-tools、exec-calls、check 已形成清晰边界 |
| `promptpile-compress` | Experimental / private | lifecycle、semantic summary、context budget、orchestrator boundary 与平台 CI 已实现；继续积累真实集成后再评估发布 |
| `promptpile-compress-grep-search` | Foundation / private | archive discovery 与 read-turn 已实现并有跨包测试；grep query surface 尚未实现 |
| `promptpile-plan` | Scaffold | 只有 CLI/包骨架，尚未接线完整 runtime |
| `agent-lite-tools` | Supporting | MCP/tool 实现集合，不定义 Promptpile 核心协议 |

## Beta 阶段兼容原则

`Normative + Evolving` 表示生态内部当前必须一致，但不等价于长期 semver 稳定承诺。Archive Protocol 当前仍是 **Experimental draft contract**：producer/consumer conformance 已建立，但在 breaking-change 迁移经过真实版本演练前不承诺长期稳定。

当前重点是协议稳定、conformance tests、CI/release engineering、文档与实现同步，而不是继续把不同职责收进共享 core 或单一 context package。
