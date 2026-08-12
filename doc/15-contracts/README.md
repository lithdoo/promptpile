# 正式契约目录

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：Promptpile ecosystem 的跨进程、跨 package 互操作入口  
> 最近复核：2026-08-12

正式契约回答：**两个独立实现不共享私有代码时，如何仍然正确互操作。**

| 契约 | 状态 | 定义 |
| --- | --- | --- |
| [Conversation Protocol v1](./conversation-protocol-v1.md) | Normative / Evolving | filename grammar、扫描、排序、sidecar 与 Conversation artifact semantics |
| [Conversation Fork v1](./conversation-fork-v1.md) | Normative / Stable v1 | 单物理 Conversation selected-prefix snapshot、稳定观察与 terminal publication |
| [CLI Contract v1](./cli-contract-v1.md) | Normative / Evolving | machine-facing CLI、layered I/O、process contract、profile selection、mutation boundary |
| [Completion Receipt v1 JSON Schema](./completion-receipt-v1.schema.json) | Normative / Evolving | root completion 最终完成标记、artifact 引用、invocation 与 hook observation |
| [Tool Artifacts v1](./tool-artifacts-v1.md) | Normative / Evolving | calls/result JSONL、physical-directory ownership 与配对语义 |
| [Tools TOML v1](./tools-toml-v1.md) | Normative / Evolving | 工具声明与 extends 规则 |
| [Agent Event Protocol v1](./agent-event-protocol-v1.md) | Normative / Stable v1 | React `stream-json` JSONL vocabulary、ordering、terminal 与 privacy semantics |
| [Archive Protocol v1](./archive-protocol-v1.md) | Active Design / Experimental | archive discovery、manifest 最小字段、producer/consumer 边界 |

## Authority

`doc/15-contracts` 是 human normative source。可执行 projection 可以由不同 owning package 发布：

- Conversation/Fingerprint/Tool/Receipt 的纯 parser/types/schema projection 由 `promptpile-protocol` 发布；
- Agent Event Protocol v1 的 JSON Schema 由 `promptpile-react/schema/agent-event-v1.schema.json` 发布；
- runtime transaction、filesystem、HTTP、orchestration 等仍属于各 owning package。

Package README 可以提供示例，但不能重新定义这里的兼容语义。契约、schema/fixtures、producer/consumer 和 regression/CI evidence 发生冲突时，必须显式修正，而不是让多份文档分别成为真相源。
