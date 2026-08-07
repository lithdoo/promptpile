# Promptpile Completion Receipt 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：以可选、原子写入的 receipt 文件描述一次 completion 已落盘的结果

## 1. 动机

上层编排器目前主要依靠退出码和 Conversation Directory 扫描判断一次 completion 产生了哪些 assistant、calls 和 extra artifacts。普通 stdout 是自然语言流，不能作为稳定机器协议；仅取目录中的“最新文件”也容易产生歧义。

Receipt 提供一次调用的结果索引，但不取代 Conversation Protocol，也不保存第二份正文。

## 2. CLI 草案

```bash
promptpile -d ./messages -c --receipt ./run/completion-receipt.json
```

TOML：

```toml
[promptpile]
receipt = "./run/completion-receipt.json"
```

显式 CLI 路径优先；相对路径建议相对 process cwd。

## 3. Receipt 草案

```json
{
  "schemaVersion": 1,
  "status": "completed",
  "artifacts": {
    "assistant": "[8]assistant.md",
    "calls": "[8]assistant.calls.jsonl",
    "extra": null,
    "mainOutput": null
  },
  "model": "example-model",
  "finishReason": "tool_calls",
  "usage": {
    "inputTokens": 1234,
    "outputTokens": 321,
    "totalTokens": 1555
  }
}
```

Artifact 引用必须指向已完成原子提交的文件。启用 layered Conversation I/O 后，引用还需要包含 output directory identity 或稳定的相对基准。

## 4. 写入时序与失败语义

1. 完成模型请求。
2. 写入 `-o` 和/或 `--continue` artifacts。
3. 执行 after-hook。
4. 收集已知 artifact path、usage、finish reason 和 hook 状态。
5. 将 receipt 写到同目录临时文件，fsync/close 后原子 rename。

Receipt 是最后写入的完成标记。进程失败且没有 receipt 时，调用方回退到退出码和 artifacts 检查；第一版不强制为所有失败写 receipt。

## 5. 不变量

- Conversation artifacts 是正文和工具调用的权威来源。
- Receipt 只引用 artifacts，不复制 assistant 正文、reasoning 或工具参数。
- Receipt 不证明工具调用已经成功；calls/result 完整性仍由 Tool Artifacts 和 `promptpile-mcp check` 定义。
- Receipt 不提供跨文件事务；crash 后可能存在 artifacts 而没有 receipt。
- `-q` 不影响 receipt 写入。
- Receipt 路径不可与本轮其它输出 artifact 冲突。

## 6. 非目标

- 不引入 NDJSON RPC 或实时 phase event stream。
- 不把 receipt 写入 Conversation 消息序列。
- 不定义业务 run、session、operation 或 World 状态。
- 不通过 receipt 承诺 exactly-once 工具执行。

## 7. 实施计划

### Phase 0：冻结 schema

- 定义状态、artifact reference、usage 和 hook 字段。
- 明确成功、API 失败、输出失败、hook 失败时是否写 receipt。
- 明确路径是绝对路径、receipt-relative 还是 output-directory-relative。

### Phase 1：Promptpile 写入

- 增加 CLI/TOML 配置。
- 实现规范编码和原子写入。
- 将现有输出路径和 `appendAssistantTurn` 返回值接入 receipt builder。

### Phase 2：生态使用

- `promptpile-react` 可选透传独立 phase receipt，或只让外层 completion 使用。
- 更新 CLI Contract 和 README。
- 为第三方 orchestrator 提供 JSON Schema。

## 8. 验收标准

- Receipt 只在其引用的 artifacts 已经落盘后可见。
- `-q` 下可以完全不解析 stdout 地获得 completion 结果。
- crash 注入测试不会产生引用不存在 artifact 的有效 receipt。
- 单目录和 layered output directory 均可唯一解析 artifact 引用。
- Receipt 不包含 API key、完整 prompt、工具参数和 assistant 正文。

## 9. 待定项

- after-hook 在 receipt 之前还是之后执行；初步建议之后写 receipt，从而记录 hook 状态。
- 是否为失败结果写 `<receipt>.failed.json`，还是保持“无 receipt 即未完成”。
- usage 不可用时使用 `null`、省略字段还是明确 `unknown`。
- 是否允许 receipt 输出到继承 fd；第一版建议只支持文件。
