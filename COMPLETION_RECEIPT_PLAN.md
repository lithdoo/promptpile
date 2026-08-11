# Promptpile Completion Receipt v1 设计

> 状态：实现完成，待专项 CI 验证
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

Receipt 固定包含 `schemaVersion: 1`、`status: "completed"`、`invocationId`、`artifacts`、`model`、`finishReason`、`usage` 与 `hook`。`artifacts` 的 `assistant`、`calls`、`extra`、`mainOutput`、`mainCalls`、`mainExtra` 使用规范化绝对路径或 `null`，因此单目录和 layered I/O 都可唯一解析。

`finishReason` 或 `usage` 未由兼容网关的流返回时写 `null`。`hook` 保存结构化状态、failure mode 及必要的 exit/signal/path 事实，不保存 raw stderr、spawn error message 或环境快照。

## 4. 写入时序与失败语义

1. 完成模型请求。
2. 写入 `-o` 和/或 `--continue` artifacts。
3. 执行 after-hook。
4. 收集已知 artifact path、usage、finish reason 和 hook 状态。
5. 将 receipt 写到同目录临时文件，fsync/close 后原子 rename，再登记到 artifact ledger。

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

## 7. 实施结果

### Phase 0：冻结 schema

- 已定义状态、artifact reference、usage 和 hook 字段。
- 已冻结成功、API 失败、输出失败、hook 失败时的 receipt 语义。
- artifact reference 已固定为绝对路径。

### Phase 1：Promptpile 写入

- 已增加 CLI/TOML 配置、规范 JSON 编码和原子写入。
- 已通过 completion artifact ledger 接入实际提交路径。

### Phase 2：生态使用

- v1 只由外层 root completion 产生 receipt；`promptpile-react` 不为内部 phase 自动合成 receipt。
- 已更新 CLI Contract、README 和 package 状态文档。
- 已提供第三方 orchestrator 可用的 Completion Receipt v1 JSON Schema，并随 npm package 的 `dist` 发布。

## 8. 验收标准

- Receipt 只在其引用的 artifacts 已经落盘后可见。
- `-q` 下可以完全不解析 stdout 地获得 completion 结果。
- crash 注入测试不会产生引用不存在 artifact 的有效 receipt。
- 单目录和 layered output directory 均可唯一解析 artifact 引用。
- Receipt 不包含 API key、完整 prompt、工具参数和 assistant 正文。

## 9. v1 决策

- after-hook 在 receipt 之前执行，使 receipt 成为最终完成标记。
- v1 不写失败 receipt；没有 completed receipt 时调用方结合退出码和已存在 artifacts 判断。
- `finishReason` 和 `usage` 不可用时均写 `null`。
- v1 只支持文件路径，不支持继承 fd。
- `invalid_explicit` 或 runtime hook failure 在 `warn` mode 下仍可写 completed receipt并记录 hook 状态；`error` mode 下不写 receipt。
