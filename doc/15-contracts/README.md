# 正式契约目录

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：Promptpile ecosystem 的跨进程、跨 package 互操作入口  
> 最近复核：2026-08-05

正式契约回答：**两个独立实现不共享私有代码时，如何仍然正确互操作。**

| 契约 | 定义 |
| --- | --- |
| [Conversation Protocol v1](./conversation-protocol-v1.md) | conversation 文件命名、扫描范围、排序与 sidecar 组合 |
| [CLI Contract v1](./cli-contract-v1.md) | machine-facing CLI、exit/stdin/stdout/stderr 与 profile selection |
| [Tool Artifacts v1](./tool-artifacts-v1.md) | calls/result JSONL 与配对语义 |
| [Tools TOML v1](./tools-toml-v1.md) | 工具声明与 extends 规则 |

Package README 可以提供示例，但不能重新定义这里的字段和兼容语义。发生冲突时，应修正文档与实现，使 contract 与代码重新一致。
