# 工具调用

> 类型：Guide  
> 目标：理解 Promptpile 的“生成调用”和“执行调用”为什么是两个步骤

## 1. 提供工具定义

Promptpile 只加载显式 `.tools.toml`：

```bash
promptpile -d messages --tools-file .tools.toml ...
```

工具格式与 `extends` 见 [Tools TOML v1](../15-contracts/tools-toml-v1.md)。

## 2. 模型生成 calls

如果模型返回 tool calls，Promptpile 可把它们写入 `.calls.jsonl`。此时 **工具还没有执行**。

## 3. 执行工具

可以由 `promptpile-mcp exec-calls`、after-hook、shell automation 或其他 executor 读取 calls 并写 `.result.jsonl`。

## 4. 再次 completion

下一次 Promptpile 扫描 conversation 时会读取 calls/result，并把 result 组装成 `tool` messages。

```text
completion #1 → calls → executor → result → completion #2
```

这种显式两阶段设计使 retry、权限、失败恢复和 executor 选择都不会被隐藏在 core agent loop 中。
