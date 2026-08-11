# 当前状态

> 类型：Tracking  
> 非 normative  
> 最近复核：2026-08-11

## 已完成

- Root completion Invocation ID 与 Completion Receipt v1 已实施并 Freeze：public schema 与 producer 均拒绝 fatal hook state，stale target reuse 具备受控 API failure 回归和 caller guidance；本地专项、全仓测试及 closure 提交 `eae4000` 的 Node 18/22 × Windows/Linux dedicated matrix 均已通过。
- After-hook Failure Policy v1 已实现并冻结：`warn|error` 配置、事实化 resolution、结构化 executor、64 KiB stderr tail、pre-model strict validation 与 post-artifact runtime decision 已通过 Node 18/22 × Windows/Linux 专项矩阵。
- Conversation Optimistic Concurrency v1 已覆盖 `conversation append-user`、root `--input`、root `--continue` 与组合 derived baseline；使用 output-directory-scoped exclusive claim、commit-time recheck、稳定 exit code 3，并进入 Node 18/22 × Windows/Linux 并发矩阵。
- React CLI-first architecture migration 已进入 main。
- `conversation append-user` 已注册为正式 Commander command tree。
- `conversation inspect` 已提供只读 text/JSON artifact discovery，且不进入 completion/config 路径。
- React production code 不依赖 `promptpile/dist/*`。
- real Promptpile config boundary integration tests 与递归 architecture guard 已存在。
- VitePress + GitHub Pages 已从 main 自动构建发布。
- Context Lifecycle 已明确拆成 lifecycle mutation 与 archive retrieval 两类实现；新增 Archive Protocol v1 draft。
- `packages/promptpile-compress-grep-search/` 已成为 active workspace，实现只读 archive discovery 与 read-turn。
- `promptpile-compress` 已实现显式注入的 semantic summary provider、可追溯 schema、预算/超时校验与固定质量 fixture。
- `promptpile-compress` 已统一 context budget，引入 heuristic/tiktoken adapters、误差 corpus 和可复现 scanner benchmark。
- `promptpile-compress` 已提供串行 orchestrator lifecycle boundary、脱敏 operation report，并进入 Node 18/22 × Windows/Linux filesystem matrix。
- producer/consumer 已通过公开 package 边界做 byte-for-byte read-only integration test。

## 当前工程重点

1. 稳定 CLI / Conversation / Tool / Archive contracts；
2. 为 grep consumer 实现 query/snippet surface，并优先复用通用 search mechanism；
3. 用真实上层应用验证 `runCompressionBeforeCompletion` 调度边界；
4. grep consumer 有真实使用数据后，再评估是否需要独立 vector consumer；
5. CI/发布流程继续覆盖所有 active packages 与 supporting workspaces。
