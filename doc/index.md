---
layout: home
hero:
  name: Promptpile
  text: File-native · CLI-first Agent Runtime
  tagline: 用文件保存对话状态，用 CLI 组合执行边界，用协议连接独立实现。
  actions:
    - theme: brand
      text: 第一次对话
      link: /25-guides/first-conversation
    - theme: alt
      text: 理解系统架构
      link: /10-architecture/system-overview
    - theme: alt
      text: 查看正式协议
      link: /15-contracts/README
features:
  - title: 文件就是状态
    details: 对话、tool calls、tool results 与 archive 都是可查看、可 diff、可脚本化的文件 artifact。
  - title: CLI 就是边界
    details: React 等上层编排只依赖公开 CLI 与文件协议，不穿透 promptpile/dist 私有实现。
  - title: 协议连接独立实现
    details: 压缩、恢复与历史搜索围绕 Archive Protocol 协作，grep/vector 等 consumer 可以独立演化。
---

## 从哪里开始

| 目标 | 入口 |
| --- | --- |
| 跑一次最小 completion | [第一次对话](./25-guides/first-conversation.md) |
| 配置多个模型/Profile | [LLM Profiles](./25-guides/llm-profiles.md) |
| 让模型调用工具 | [工具调用](./25-guides/tool-calling.md) |
| 跑 ReAct 编排 | [ReAct Agent](./25-guides/react-agent.md) |
| 接 MCP server | [MCP 工具](./25-guides/mcp-tools.md) |
| 理解长对话压缩与历史检索边界 | [上下文生命周期](./10-architecture/context-lifecycle-system.md) → [Archive Protocol v1](./15-contracts/archive-protocol-v1.md) |
| 写新的 orchestrator / executor / archive consumer | [正式契约](./15-contracts/README.md) |

## 文档权威顺序

```text
Overview → Architecture → Contracts → Packages → Guides / Development
```

跨进程、跨 package 的兼容语义以 **15 · 正式契约** 为准；package README 与指南不能重新定义协议。
