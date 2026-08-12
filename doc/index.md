---
layout: home
hero:
  name: Promptpile
  text: File-native · CLI-first Agent Runtime
  tagline: 用文件保存状态，用 CLI 组合运行时边界，用版本化契约连接独立实现。
  actions:
    - theme: brand
      text: 第一次对话
      link: /25-guides/first-conversation
    - theme: alt
      text: 理解系统架构
      link: /10-architecture/system-overview
    - theme: alt
      text: 查看正式契约
      link: /15-contracts/README
features:
  - title: 文件就是状态
    details: Conversation、tool calls/results、fork snapshot 与 archive 都以可检查 artifact 为边界。
  - title: CLI 就是运行时边界
    details: promptpile 只执行一次 completion；React、tool executor 与 lifecycle package 在 core 之外组合。
  - title: 协议提供纯语义
    details: promptpile-protocol 投影稳定的 Conversation、Fingerprint、Tool 与 Receipt 语义，不吸收 filesystem、LLM 或 orchestration ownership。
---

## 从哪里开始

| 目标 | 入口 |
| --- | --- |
| 跑一次最小 completion | [第一次对话](./25-guides/first-conversation.md) |
| 配置多个模型/Profile | [LLM Profiles](./25-guides/llm-profiles.md) |
| 让模型产生工具调用 | [工具调用](./25-guides/tool-calling.md) |
| 跑 ReAct 编排 | [ReAct Agent](./25-guides/react-agent.md) |
| 消费 React JSONL stream | [Agent Event Protocol v1](./15-contracts/agent-event-protocol-v1.md) |
| 创建独立 Conversation prefix snapshot | [Conversation Fork v1](./15-contracts/conversation-fork-v1.md) |
| 接 MCP server | [MCP 工具](./25-guides/mcp-tools.md) |
| 理解长对话压缩与历史检索边界 | [上下文生命周期](./10-architecture/context-lifecycle-system.md) → [Archive Protocol v1](./15-contracts/archive-protocol-v1.md) |

## 文档权威顺序

```text
Overview → Architecture → Contracts → Packages → Guides / Development
```

跨进程、跨 package 的兼容语义以 **15 · 正式契约** 为准；package README 与指南不能重新定义协议。已完成的改造过程由 Git history 保存，不再留在当前文档面。
