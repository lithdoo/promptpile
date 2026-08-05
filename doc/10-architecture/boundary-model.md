# 边界模型

> 层级：10 · Architecture  
> 状态：Active Design  
> 稳定程度：Stable  
> 主要定义：跨 package 的允许依赖方向  
> 依赖：[系统架构总览](./system-overview.md)  
> 最近复核：2026-08-05

## 允许的边界

```text
promptpile-react ── CLI/stdin/files ──► promptpile
promptpile-plan  ── CLI/stdin/files ──► promptpile
promptpile-mcp   ◄──── calls/results ──► conversation artifacts

Conversation Protocol ──► promptpile-compress ──► Archive Protocol
Archive Protocol ──read-only──► promptpile-compress-grep-search
Archive Protocol ──read-only──► future vector/search consumers
```

`promptpile-compress` 可以读写 conversation/archive 状态，因为它是 lifecycle mutation 实现。Search consumer 只能通过公开协议读取 archive，不应 import `promptpile-compress/src`、`dist/*` 或依赖其内部 TypeScript 类型。

## 禁止的边界

上层 package 不应运行时或类型依赖 `promptpile/dist/*`。同样，Archive Protocol consumer 不应把 `promptpile-compress` 私有实现当作协议。`dist/*`、scanner helpers、内部 manifest types 都不是跨 package API。

## CLI-first / protocol-first 的含义

CLI-first 不是把每个内部函数做成 subprocess RPC，而是暴露完整 domain operation：

- `conversation append-user` 封装 scan + next-index + write；
- `--llm-config` + `--llm-api` 让 Promptpile 自己拥有 profile 解析；
- `--api-key-env` 让 secret 由 Promptpile 子进程读取。

Protocol-first 则要求独立 producer/consumer 通过 versioned artifact contract 互操作。只有 CLI/files 无法合理表达、且多个 package 必须在同进程共享稳定领域能力时，才重新评估 public library API。
