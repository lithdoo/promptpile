# ADR 0002 · 上层编排采用 CLI-first 边界

> 状态：Accepted  
> 最近复核：2026-08-05

## Context

`promptpile-react` 曾同时 spawn Promptpile CLI 并 import `promptpile/dist/*` 私有模块，形成两套架构边界。

## Options

1. 抽 `promptpile-core` 供双方共享；
2. 把内部函数逐个做 CLI RPC；
3. 重新按 domain operation 设计 public CLI，让 React 不再需要内部接口。

## Decision

选择 3。新增 `conversation append-user`，并让 Promptpile 通过 `--llm-config` / `--llm-api` 自己解析 profile；React 只保留 orchestration ownership。

## Consequences

边界更清晰、secret handling 更好、package release 耦合更低；代价是 CLI/artifacts 从实现细节升级为需要治理的公共协议。
