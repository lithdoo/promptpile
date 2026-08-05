# 成熟度与范围

> 层级：00 · Overview  
> 状态：Reference  
> 稳定程度：Evolving  
> 主要定义：当前 main 分支各能力的成熟度边界  
> 最近复核：2026-08-05

| 组件 | 状态 | 说明 |
| --- | --- | --- |
| `promptpile` | Beta / active | 公开 CLI、conversation artifacts、LLM profile、tool call 持久化已有回归测试 |
| `promptpile-react` | Beta / active | 已完成 CLI-first 边界重构，production code 不依赖 `promptpile/dist/*` |
| `promptpile-mcp` | Beta / active | gateway、export-tools、exec-calls、check 已形成清晰边界 |
| `promptpile-compress` | Experimental / private | 已有 compress/restore/index 相关实现和测试，尚未形成稳定生态契约 |
| `promptpile-plan` | Scaffold | 只有 CLI/包骨架，尚未接线完整 runtime |
| `agent-lite-tools` | Supporting | MCP/tool 实现集合，不定义 Promptpile 核心协议 |

## Beta 阶段兼容原则

`Normative + Evolving` 表示生态内部当前必须一致，但不等价于长期 semver 稳定承诺。breaking change 应修改 contract、给出版本/迁移、更新 consumer tests 与 release note。

当前重点已经从继续拆 shared core 转向：协议稳定、conformance tests、CI/release engineering、文档与实现同步。
