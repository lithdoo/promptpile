# Context lifecycle 发布质量门

> 类型：Development policy
> 适用范围：`promptpile-compress` 与 Archive Protocol consumers
> 最近复核：2026-08-06

## 支持矩阵

Context lifecycle filesystem gate 支持 Node 18 与 Node 22，并在
`ubuntu-latest`、`windows-latest` 上运行。矩阵覆盖 lock、same-host stale
lock recovery、唯一锁并发清理、atomic rename、POSIX directory fsync 分支、Windows
same-directory rename、故障注入恢复、producer/consumer integration。

## 必须通过的命令

```bash
npm ci --ignore-scripts --workspace=promptpile-compress --workspace=promptpile-compress-grep-search
npm run test -w promptpile-compress
npm run test -w promptpile-compress-grep-search
npm run docs:build
```

性能趋势可用以下命令复现，但耗时不是跨机器 pass/fail 条件：

```bash
npm run benchmark -w promptpile-compress
```

## 兼容策略

- Archive Protocol v1 consumer 只依赖 `version` 与
  `archivedTurnIndices` 最小字段，并忽略未知 producer metadata。
- `threshold` 是互斥的兼容入口；新集成使用 context budget。
- 自动化 completion 必须通过 `runCompressionBeforeCompletion` 排队；手动
  compress/restore 入口不构成 orchestrator 调度协议。
- dry-run / estimate plan 不调用 semantic summary provider；实际 compress phase
  每次最多调用一次。规划预算用 `upper-bound`、提交预算用 `actual` 标识 summary token 依据。
- operation report 只包含 idx、计数、阶段、预算、commit state 与稳定错误码，
  不记录 message、tool result 或 provider 原始错误正文。
- package 继续保持 `private` / `experimental`，直到 grep query surface、迁移策略
  与更多真实集成稳定。
