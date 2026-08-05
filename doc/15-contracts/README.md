# 正式契约目录

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：Promptpile ecosystem 的跨进程、跨 package 互操作入口  
> 最近复核：2026-08-05

正式契约回答：**两个独立实现不共享私有代码时，如何仍然正确互操作。**

| 契约 | 状态 | 定义 |
| --- | --- | --- |
| [Conversation Protocol v1](./conversation-protocol-v1.md) | Normative / Evolving | conversation 文件命名、扫描范围、排序与 sidecar 组合 |
| [Archive Protocol v1](./archive-protocol-v1.md) | Active Design / Experimental | archive discovery、manifest 最小字段、producer/consumer 边界 |
| [CLI Contract v1](./cli-contract-v1.md) | Normative / Evolving | machine-facing CLI、exit/stdin/stdout/stderr 与 profile selection |
| [Tool Artifacts v1](./tool-artifacts-v1.md) | Normative / Evolving | calls/result JSONL 与配对语义 |
| [Tools TOML v1](./tools-toml-v1.md) | Normative / Evolving | 工具声明与 extends 规则 |

Package README 可以提供示例，但不能重新定义这里的字段和兼容语义。Archive Protocol 在 grep consumer 和 cross-package conformance fixtures 完成前仍属于 experimental draft；发生冲突时，应修正文档与实现，使 contract 与代码重新一致。
