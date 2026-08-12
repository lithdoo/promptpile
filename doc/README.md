# Promptpile 文档

Promptpile 文档只描述**当前实现与当前契约**，按依赖方向组织：

```text
产品目标与范围 → 系统架构 → 正式契约 → Package ownership → 使用指南 / 开发维护
```

实施过程、迁移 checklist 和已完成的 freeze plan 由 Git history 保存，不作为第二套文档真相源。

## 推荐阅读顺序

1. [产品定位](./00-overview/product-vision.md)
2. [生态总览](./00-overview/ecosystem-overview.md)
3. [成熟度与范围](./00-overview/maturity-and-scope.md)
4. [系统架构总览](./10-architecture/system-overview.md)
5. [边界模型](./10-architecture/boundary-model.md)
6. [正式契约目录](./15-contracts/README.md)
7. [Conversation Protocol v1](./15-contracts/conversation-protocol-v1.md)
8. [Conversation Fork v1](./15-contracts/conversation-fork-v1.md)
9. [CLI Contract v1](./15-contracts/cli-contract-v1.md)
10. [Agent Event Protocol v1](./15-contracts/agent-event-protocol-v1.md)
11. [Package 目录](./20-packages/README.md)
12. [测试策略](./30-development/testing-strategy.md)

## 读者路径

| 我想做什么 | 阅读 |
| --- | --- |
| 第一次使用 | [第一次对话](./25-guides/first-conversation.md) |
| 理解一次 completion | [执行系统](./10-architecture/execution-system.md) → [promptpile](./20-packages/promptpile.md) |
| 理解协议纯投影 | [正式契约](./15-contracts/README.md) → [promptpile-protocol](./20-packages/promptpile-protocol.md) |
| 创建 Conversation snapshot | [Conversation Fork v1](./15-contracts/conversation-fork-v1.md) → [promptpile-fork](./20-packages/promptpile-fork.md) |
| 写新的 orchestrator | [编排系统](./10-architecture/orchestration-system.md) → [CLI Contract v1](./15-contracts/cli-contract-v1.md) |
| 消费 React machine stream | [Agent Event Protocol v1](./15-contracts/agent-event-protocol-v1.md) → [promptpile-react](./20-packages/promptpile-react.md) |
| 写新的 tool executor | [工具执行系统](./10-architecture/tool-execution-system.md) → [Tool Artifacts v1](./15-contracts/tool-artifacts-v1.md) |
| 修改 Compress | [上下文生命周期](./10-architecture/context-lifecycle-system.md) → [Archive Protocol v1](./15-contracts/archive-protocol-v1.md) |
| 修改 MCP | [promptpile-mcp](./20-packages/promptpile-mcp.md) |
| 判断成熟度 | [成熟度与范围](./00-overview/maturity-and-scope.md) |
| 看设计理由 | [ADR 0001](./decisions/0001-file-native-conversation.md) |

维护规则见 [CONVENTIONS.md](./CONVENTIONS.md)。
