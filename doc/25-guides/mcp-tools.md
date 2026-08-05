# MCP 工具

> 类型：Guide  
> 目标：用 `promptpile-mcp` 把 MCP servers 接入 Promptpile tool artifact 流程

## 1. 启动 gateway

准备 `mcp.toml` 后：

```bash
promptpile-mcp launch --config mcp.toml
```

Gateway 持有长期 stdio MCP sessions，默认只绑定 loopback。

## 2. 导出工具

```bash
promptpile-mcp export-tools \
  --base-url http://127.0.0.1:8765 \
  -o .tools.toml
```

## 3. 让 Promptpile 生成 calls

```bash
promptpile -d messages --tools-file .tools.toml ...
```

## 4. 执行 calls

```bash
promptpile-mcp exec-calls \
  --base-url http://127.0.0.1:8765 \
  --dir messages
```

## 5. 检查完整性

```bash
promptpile-mcp check --input messages/'[2]assistant.calls.jsonl'
```

状态为 complete/pending/partial/invalid。正式配对语义见 [Tool Artifacts v1](../15-contracts/tool-artifacts-v1.md)。
