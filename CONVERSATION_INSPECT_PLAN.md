# Promptpile Conversation Inspect MVP 设计

> 状态：已实施
>
> 日期：2026-08-07
>
> 核心提案：增加一个只读 CLI，把现有 scanner 的结果无损输出为 text 或 JSON

## 1. 结论

`conversation inspect` 的第一版只回答一个问题：

> Conversation 目录中有哪些被 Promptpile 识别的 artifacts？

它直接复用现有 `scanDirectory()`，将 `FileInfo[]` 映射成稳定、机器可读的相对路径列表。它不读取消息正文，不解析 sidecar 内容，也不改变 completion 的扫描、排序或错误处理行为。

职责边界固定为：

```text
inspect   磁盘上有什么
validate  文件内容是否合法（未来独立能力）
check     tool 执行是否完整（继续由 promptpile-mcp 负责）
```

这样可以满足 React、MCP、Compress 和第三方 orchestrator 的核心需求，同时把实现控制在一个小 PR 内。

## 2. 为什么采用扁平 artifacts

现有 scanner 的基本输出是 `FileInfo[]`。MVP 直接映射这组数据，不提前发明 turn、assistant slot 或 tool 状态模型。

扁平结构具有以下优点：

- 与现有源码一一对应，几乎没有新的协议逻辑。
- 同一 index 下可以自然表达多条消息和自定义 role。
- `[1]...` 与 `[01]...` 即使归入同一数值 index，也会保留为两个不同 path。
- assistant.md、calls、extra、result 各自都是独立 artifact，不会因单值字段丢失。
- React 只需按 `index` 或 `kind` 分组，不再解析文件名。
- 后续可以在不改变 v1 artifact 含义的情况下增加独立 validate 能力。

## 3. MVP 范围

MVP 负责：

- 检查一个已存在的 Conversation 目录。
- 调用 Promptpile 当前的 `scanDirectory()`。
- 输出 scanner 已识别的直接子文件。
- 提供人类可读 text 和机器可读 JSON。
- 在无 API key、无 LLM config、无 tools 配置时运行。

MVP 不负责：

- 读取或输出普通消息正文。
- 解析 calls、extra 或 result 内容。
- 判断 JSON/JSONL 是否有效。
- 判断 tool 是否 pending、partial、complete 或 invalid。
- 报告未知文件或被 scanner 忽略的文件。
- 修复、移动、创建或重写 artifacts。
- 合并 `--insert-files` / `--append-files`。
- 检查 layered conversation 或递归扫描子目录。
- 修正现有 comparator 或改变 completion 排序。
- 提供公共 TypeScript library API。

## 4. CLI

```bash
promptpile conversation inspect \
  -d ./messages \
  --format json
```

MVP 参数：

```text
-d, --directory <path>   必填；已有 Conversation 目录
--format text|json       默认 text
```

MVP 不提供：

```text
--strict
--include-ignored
--through-index
重复 -d（显式拒绝）
```

非法 format 由 Commander 拒绝。目录不存在或目标不是目录时，错误写入 stderr，退出码为 `1`，stdout 保持为空。

## 5. JSON contract

### 5.1 类型

```ts
type ConversationArtifactKind =
  | 'message'
  | 'assistant_call'
  | 'assistant_extra'
  | 'assistant_result';

interface ConversationArtifact {
  index: number;
  kind: ConversationArtifactKind;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  path: string;
}

interface ConversationInspection {
  schemaVersion: 1;
  directory: string;
  artifactCount: number;
  maxIndex: number | null;
  artifacts: ConversationArtifact[];
}
```

字段直接映射现有 `FileInfo`：

| JSON 字段 | 来源 |
| --- | --- |
| `index` | `FileInfo.idx` |
| `kind` | `FileInfo.fileKind` |
| `role` | `FileInfo.role` |
| `extension` | `FileInfo.extension` |
| `path` | `FileInfo.path` 转换为相对目录的协议路径 |

sidecar 的 `role` 沿用 scanner 当前行为，值为 `assistant`。调用者必须使用 `kind` 区分普通 assistant message 和专用 sidecar。

### 5.2 示例

```json
{
  "schemaVersion": 1,
  "directory": "./messages",
  "artifactCount": 4,
  "maxIndex": 2,
  "artifacts": [
    {
      "index": 0,
      "kind": "message",
      "role": "system",
      "extension": "md",
      "path": "[0]system.md"
    },
    {
      "index": 2,
      "kind": "message",
      "role": "assistant",
      "extension": "md",
      "path": "[2]assistant.md"
    },
    {
      "index": 2,
      "kind": "assistant_call",
      "role": "assistant",
      "extension": "jsonl",
      "path": "[2]assistant.calls.jsonl"
    },
    {
      "index": 2,
      "kind": "assistant_result",
      "role": "assistant",
      "extension": "jsonl",
      "path": "[2]assistant.result.jsonl"
    }
  ]
}
```

空目录是合法结果：

```json
{
  "schemaVersion": 1,
  "directory": "./messages",
  "artifactCount": 0,
  "maxIndex": null,
  "artifacts": []
}
```

### 5.3 稳定语义

- `artifacts` 的顺序与当前 `scanDirectory()` 返回顺序完全一致。
- Inspect 不实现第二套 filename parser 或 comparator。
- `artifactCount` 必须严格等于 `artifacts.length`。
- `maxIndex` 是 artifacts 中最大的 `index`；空数组时为 `null`。
- `path` 相对于被检查目录，并统一使用 `/` 分隔符。
- `directory` 保留调用者提供的目录标识，不输出内部解析后的绝对路径。
- `[1]user.md` 与 `[01]user.md` 会作为两个 artifacts 输出，二者的 `index` 都是 `1`。
- 未被现有 scanner 识别的文件不计入 `artifactCount`。

JSON formatter 固定使用：

```ts
JSON.stringify(inspection, null, 2) + '\n'
```

JSON 模式的 stdout 只写一次，并且只包含这一个 JSON document。

## 6. Text 输出

Text formatter 使用同一个 `ConversationInspection`，不得重新扫描目录。
空目录的 text 输出固定使用 `Max index: null`，与 JSON contract 对齐。

```text
Conversation: ./messages
Artifacts: 4
Max index: 2

[0] message          system     md     [0]system.md
[2] message          assistant  md     [2]assistant.md
[2] assistant_call   assistant  jsonl  [2]assistant.calls.jsonl
[2] assistant_result assistant  jsonl  [2]assistant.result.jsonl
```

具体列宽不是稳定 contract；字段值和 artifact 顺序是稳定语义。

## 7. 实现方案

### 7.1 新增只读映射模块

新增：

```text
packages/promptpile/src/conversation-inspect.ts
```

模块只负责：

1. 接收已解析的绝对目录和调用者提供的显示目录。
2. 调用现有 `scanDirectory()`。
3. 将 `FileInfo[]` 映射为 `ConversationInspection`。
4. 提供纯 text/json formatter。

它不读取 artifact 内容，也不依赖 config、LLM client、tools 或 hook。

### 7.2 CLI 接线

修改：

```text
packages/promptpile/src/conversation-command.ts
packages/promptpile/src/cli.ts
packages/promptpile/src/index.ts
```

接线方式：

1. 在 `conversation-command.ts` 注册 `conversation inspect`。
2. 在 `PromptpileCommandHandlers` 增加 `inspectConversation`。
3. `index.ts` 直接调用 `runInspectConversationCommand(options, cwd)`。
4. 该路径不得调用 `resolveConfig()`，也不得进入 root completion handler。

现有 `scanDirectory()` 已经导出，MVP 直接复用它；不为实现 Inspect 预先拆分 `file-handler.ts`。

### 7.3 一个 PR 完成

建议在一个小 PR 中完成：

- 新增 read model 和 formatters。
- 注册 CLI 与 handler。
- 增加单元测试和 CLI 测试。
- 将测试脚本加入 `packages/promptpile/package.json`。
- 更新 CLI Contract 和 README 示例。

## 8. 测试矩阵

至少覆盖：

- 空目录。
- 目录不存在和目标是普通文件。
- system/user/assistant 普通消息。
- 自定义 role。
- 同一 index 下多个消息。
- `[1]` 与 `[01]` 同时存在，两个 path 都被保留。
- assistant call/extra/result sidecar。
- 只有 sidecar、没有 assistant.md。
- 嵌套目录中的协议文件被忽略。
- 大写扩展名、未知文件和不支持的扩展名被忽略。
- `artifactCount === artifacts.length`。
- `maxIndex` 和空目录的 `null` 语义。
- artifact path 使用相对路径和 `/` 分隔符。
- JSON stdout 可以直接 `JSON.parse()`，且只包含一个 document。
- text/json formatter 不访问文件系统。
- 无 API key、无 LLM config、无 tools 时命令成功。
- Inspect 前后目录中的文件集合与文件内容不变。
- 命令不读取普通消息或 sidecar 内容；不可读 artifact 内容不影响结构检查。

## 9. 验收标准

- CLI 能稳定列出当前 scanner 识别的全部 artifacts。
- 每个 `FileInfo` 恰好映射为一个 JSON artifact，不丢失、不合并。
- 输出顺序与 completion 使用的 scanner 顺序一致。
- JSON stdout 纯净，错误只写 stderr。
- 命令不要求 API key，不加载 completion config 或 tools。
- 命令不读取 artifact 内容、不调用模型、不执行 hook、不修改目录。
- React 等调用者可以只依据 `index`、`kind` 和 `path` 使用结果，无需解析文件名。

## 10. 后续扩展

MVP 稳定后，再按独立需求评估：

- `conversation validate`：校验 calls/result/extra 内容并输出 diagnostics。
- `--include-ignored`：显式展示未识别文件。
- Layered Conversation：为 artifacts 增加目录层身份。
- 确定性 comparator 迁移：作为独立协议变更评审。

这些扩展不应阻塞基础 Inspect，也不应被静默加入 v1。
