# 当前状态

> 类型：Tracking  
> 非 normative  
> 最近复核：2026-08-05

## 已完成

- React CLI-first architecture migration 已进入 main。
- `conversation append-user` 已注册为正式 Commander command tree。
- React production code 不依赖 `promptpile/dist/*`。
- real Promptpile config boundary integration tests 与递归 architecture guard 已存在。
- `promptile` release 已推进到 `0.1.0-beta.1`。

## 当前工程重点

1. 把 CLI / conversation / tool artifacts 稳定为可维护 contract；
2. Pages + VitePress 文档成为当前设计的主要入口；
3. CI/发布流程覆盖 active packages 与 supporting workspaces；
4. 后续再评估 Compress contract 与 Plan runtime，而不是继续无目标拆 core。
