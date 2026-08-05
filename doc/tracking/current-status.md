# 当前状态

> 类型：Tracking  
> 非 normative  
> 最近复核：2026-08-05

## 已完成

- React CLI-first architecture migration 已进入 main。
- `conversation append-user` 已注册为正式 Commander command tree。
- React production code 不依赖 `promptpile/dist/*`。
- real Promptpile config boundary integration tests 与递归 architecture guard 已存在。
- VitePress + GitHub Pages 已从 main 自动构建发布。
- Context Lifecycle 已明确拆成 lifecycle mutation 与 archive retrieval 两类实现；新增 Archive Protocol v1 draft。
- `packages/promptpile-compress-grep-search/` 已建立空 scaffold，用于后续只读 grep consumer。

## 当前工程重点

1. 稳定 CLI / Conversation / Tool / Archive contracts；
2. 让 `promptpile-compress` 与 grep consumer 通过协议 fixture 而不是私有 import 互操作；
3. 为 compress 实现真正的 semantic summary，并移除当前 sliding-window summary 对具体 `lookup_archive` 工具名的硬编码假设；
4. grep consumer 有真实实现后，再评估是否需要独立 vector consumer；
5. CI/发布流程继续覆盖所有 active packages 与 supporting workspaces。
