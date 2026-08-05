# ADR 0001 · Conversation state 使用文件系统

> 状态：Accepted  
> 最近复核：2026-08-05

## Context

Agent/context 状态如果只存在内存或数据库抽象中，不便于直接检查、diff、shell 组合和 crash recovery。

## Decision

Promptpile 把 conversation 的主要持久状态表示为有序 Markdown/JSON 与 sidecar artifacts，并让一次 completion 从目录重新组装消息。

## Consequences

优点：透明、可版本控制、易脚本化、进程之间天然解耦。代价：需要严格文件协议、排序规则和并发边界；多写入者事务不是默认能力。
