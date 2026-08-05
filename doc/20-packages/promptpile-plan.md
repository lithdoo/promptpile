# promptpile-plan

> 类型：package  
> 状态：scaffold  
> 主要职责：未来 Plan → Exec orchestration  
> 最近复核：2026-08-05

当前 `promptpile-plan` 只有 CLI/package scaffold，README 明确说明尚未接线 Promptpile 子进程与完整 runtime。

设计方向是与 React 同级：通过 Promptpile 公共 CLI 做 plan-and-execute 编排，而不是 npm import Promptpile 私有实现。

在 runtime 与 tests 完成前，文档和根 README 都应把它标记为 **Scaffold**，不能与 React/MCP 的成熟度等同。

[查看 package README](https://github.com/lithdoo/promptpile/blob/main/packages/promptpile-plan/README.md)
