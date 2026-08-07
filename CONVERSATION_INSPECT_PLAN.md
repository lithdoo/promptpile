# Promptpile Conversation Inspect 初步设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 核心提案：增加只读 domain command，以机器可读形式展示 Conversation Protocol 视图

## 1. 动机

Promptpile、React、MCP、Compress 和第三方 orchestrator 都需要理解 Conversation artifacts。当前正式规范存在，但外部调用者若想检查目录，只能重复实现 filename parser、排序和 sidecar 归属，容易发生协议漂移。

## 2. CLI 草案

```bash
promptpile conversation inspect \
  -d ./messages \
  --format json
```

人类可读模式可以是默认值；机器调用必须显式选择 `json`，且 stdout 只包含一个 JSON document。

## 3. 输出草案

```json
{
  "schemaVersion": 1,
  "directory": "./messages",
  "maxIndex": 8,
  "artifacts": [
    {
      "index": 8,
      "role": "assistant",
      "message": "[8]assistant.md",
      "calls": "[8]assistant.calls.jsonl",
      "extra": null,
      "result": "[8]assistant.result.jsonl"
    }
  ],
  "diagnostics": []
}
```

第一版只报告 Conversation Protocol 结构。Tool calls/result 的 `pending | partial | complete | invalid` 继续由 `promptpile-mcp check` 负责，避免 Promptpile 重复实现执行器规则。

## 4. 行为

- 只读取目录直接子文件，不递归。
- 使用 Promptpile 自己的 scanner 和排序实现。
- 不加载 LLM config、tools 或 API key。
- 不调用模型、不执行 hook、不修改文件。
- 非协议文件可以忽略，也可以在显式 `--include-ignored` 下列出。
- 协议损坏应进入 diagnostics；是否导致非零退出由 `--strict` 控制。

## 5. 可选参数

```text
--format text|json
--strict
--include-ignored
--through-index <n>
```

Layered Conversation I/O 落地后，可以允许重复 `-d`，输出中每个 artifact 带 `directoryIndex`。第一版实现顺序应与 layered contract 协调。

## 6. 非目标

- 不读取或输出完整消息正文。
- 不恢复、不压缩、不修复 Conversation。
- 不自动执行 pending tools。
- 不为目录加锁。
- 不成为长期运行的查询服务。

## 7. 实施计划

- 抽取 scanner 的公共内部 read model，避免 CLI 另写 parser。
- 定义 inspect JSON Schema 和稳定字段。
- 注册 `conversation inspect` domain command。
- 增加 text/json formatter 和 strict exit semantics。
- 添加正常、损坏、未知文件、空目录及 layered fixture 测试。
- 更新 Conversation Protocol 和 CLI Contract。

## 8. 验收标准

- Inspect 的 artifact 排序与实际 completion message assembly 一致。
- JSON 模式不混入普通日志。
- 命令不读取 secret、不调用模型、不修改目录。
- 同一 fixture 在 Windows/POSIX 上得到相同协议视图。
- 其它包可以用该命令替代自建的“最新 artifact”猜测逻辑。

## 9. 待定项

- diagnostics 是否全部导致 `--strict` 失败，还是区分 warning/error。
- 是否输出绝对路径；初步建议输出输入目录和相对 artifact path。
- 是否在第一版同时提供 fingerprint。
- JSON document 是完整 artifact 列表还是支持分页；本地目录第一版可完整输出。
