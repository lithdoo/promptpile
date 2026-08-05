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
compress         ◄── conversation files ─► filesystem
```

## 禁止的边界

上层 package 不应运行时或类型依赖 `promptpile/dist/*`。`dist/*` 是构建产物，不是生态 API。React 已有 architecture guard 递归扫描生产 TypeScript 源码以防止回归。

## CLI-first 的含义

CLI-first 不是把每个内部函数做成 subprocess RPC，而是暴露完整 domain operation：

- `conversation append-user` 封装 scan + next-index + write；
- `--llm-config` + `--llm-api` 让 Promptpile 自己拥有 profile 解析；
- `--api-key-env` 让 secret 由 Promptpile 子进程读取。

只有出现 CLI/files 无法合理表达、且多个 package 必须在同进程共享稳定领域能力时，才重新评估 public library API。
