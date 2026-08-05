# Promptpile 文档

Promptpile 文档按依赖方向组织：

```text
产品目标与范围 → 系统架构 → 正式契约 → Package ownership → 使用指南 / 开发维护
```

## 推荐阅读顺序

1. [产品定位](./00-overview/product-vision.md)
2. [生态总览](./00-overview/ecosystem-overview.md)
3. [系统架构总览](./10-architecture/system-overview.md)
4. [边界模型](./10-architecture/boundary-model.md)
5. [正式契约目录](./15-contracts/README.md)
6. [Conversation Protocol v1](./15-contracts/conversation-protocol-v1.md)
7. [CLI Contract v1](./15-contracts/cli-contract-v1.md)
8. [Package 目录](./20-packages/README.md)
9. [测试策略](./30-development/testing-strategy.md)

## 读者路径

| 我想做什么 | 阅读 |
| --- | --- |
| 第一次使用 | [第一次对话](./25-guides/first-conversation.md) |
| 理解 files + CLI | [系统总览](./10-architecture/system-overview.md) → [边界模型](./10-architecture/boundary-model.md) |
| 写新的 orchestrator | [编排系统](./10-architecture/orchestration-system.md) → [CLI Contract v1](./15-contracts/cli-contract-v1.md) |
| 写新的 tool executor | [工具执行系统](./10-architecture/tool-execution-system.md) → [Tool Artifacts v1](./15-contracts/tool-artifacts-v1.md) |
| 修改 React | [promptpile-react](./20-packages/promptpile-react.md) |
| 修改 MCP | [promptpile-mcp](./20-packages/promptpile-mcp.md) |
| 判断成熟度 | [成熟度与范围](./00-overview/maturity-and-scope.md) |
| 看设计决策 | [ADR](./decisions/0001-file-native-conversation.md) |
| 看当前推进 | [当前状态](./tracking/current-status.md) |

维护规则见 [CONVENTIONS.md](./CONVENTIONS.md)。
