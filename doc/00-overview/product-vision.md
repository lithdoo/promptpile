# 产品定位

> 层级：00 · Overview  
> 状态：Active Design  
> 稳定程度：Evolving  
> 主要定义：Promptpile 的产品目标、原则和非目标  
> 最近复核：2026-08-05

Promptpile 是一个 **file-native、CLI-first 的轻量 Agent Runtime 生态**。它把一次模型调用缩小为一个可组合 primitive：从目录装配消息、调用一次 Chat Completions、把输出与工具调用写成可观察 artifacts。

```text
state         = files
execution     = CLI
tool boundary = artifacts
orchestration = separate process/package
```

## 目标

- 对话状态可以直接查看、diff、备份、脚本化和恢复。
- 单次模型执行保持小而明确，不在 core 内隐式运行 agent loop。
- 上层 orchestration 通过公开 CLI 组合，不依赖 `promptpile/dist/*` 私有实现。
- tool generation 与 tool execution 分离，让 MCP、shell automation 或其他 executor 独立演化。
- 崩溃后尽量保留已提交 artifact，而不是把关键状态只放内存。

## 非目标

Promptpile core 当前不负责自动无限 agent loop、内置执行模型生成的工具调用、多写入者 conversation transaction，也不以“共享代码”为理由把生态收进一个 `promptpile-core` library。

## 设计原则

1. **显式优于隐式**：工具文件、profile、sidecar、continue 行为通过显式参数/配置表达。
2. **协议优于私有复用**：跨 package 优先使用 CLI 与 artifacts。
3. **失败可观察**：exit code、stderr、diagnostic/artifact 允许调用者判断失败边界。
4. **单次执行可组合**：复杂流程由 React、MCP、Plan 等上层组合。
