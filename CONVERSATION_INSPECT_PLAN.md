# Promptpile Conversation Inspect 设计与落地计划

> 状态：可实施设计（待开发；sidecar 兼容策略须按本文约束实施）
>
> 日期：2026-08-07
>
> 核心提案：增加只读 domain command，以稳定、机器可读的形式展示 Conversation Protocol 视图

## 1. 结论

`conversation inspect` 可以沿用 Promptpile 现有设计落地。只读扫描与 CLI 接入风险较低；统一 sidecar 校验会触及 completion 当前的宽松/严格行为，属于中等兼容风险，必须与基础 Inspect 分阶段实施。它应当是现有 Conversation 文件协议的只读观察入口，而不是新的消息解析器、执行器或修复工具。

最重要的实现原则是：

- Inspect 与 completion 共用同一套文件名识别、排序、分组和 sidecar 校验逻辑。
- 输出描述“磁盘上有什么”，不推断 MCP 的 tool 执行状态。
- 命令不加载 completion 配置、LLM profile、tools 或 API key。
- 命令不读取普通消息正文，不调用模型、不执行 hook、不修改目录。

建议拆成 3 个小 PR 逐步落地，先建立共享只读模型，再接 CLI，最后统一诊断与契约。

## 2. 动机

Promptpile、React、MCP、Compress 和第三方 orchestrator 都需要理解 Conversation artifacts。当前正式规范存在，但外部调用者若想检查目录，只能重复实现 filename parser、排序和 sidecar 归属，容易发生协议漂移。

Inspect 提供的价值是把 Promptpile 已经掌握的协议视图稳定地暴露出来：

- 人可以快速看清一轮对话有哪些文件。
- React 等调用者可以消费稳定 JSON，而不再自行猜测“最新文件”。
- 自动化流程可以在调用 completion 前做只读预检。
- 协议异常可以用统一诊断代码表达。

### 2.1 v1 非目标

Inspect v1 不负责：

- 判断 tool 是否实际执行、执行成功或仍在等待。
- 推断 conversation 的 `pending | partial | complete | invalid` 状态。
- 修复、移动、创建或重写任何 artifact。
- 输出普通消息正文，或把普通 `.json` message 解析成对象。
- 递归扫描 archive 或其它子目录。
- 合并 `--insert-files` / `--append-files`。
- 检查多目录 layered conversation。
- 同时承诺稳定的公共 TypeScript library API。

## 3. 与现有源码的关系

当前实现的职责分布如下：

| 位置 | 当前职责 | Inspect 落地时的处理 |
| --- | --- | --- |
| `packages/promptpile/src/file-handler.ts` | 文件名识别、目录扫描、排序、消息正文与 sidecar 解析、消息组装 | 抽出只读扫描/排序能力；保留消息组装职责 |
| `packages/promptpile/src/types.ts` | `FileInfo`、消息和现有诊断类型 | 增加 Inspect read model，或放入独立模块 |
| `packages/promptpile/src/conversation-command.ts` | 注册并执行 `conversation append-user` | 增加 `conversation inspect` |
| `packages/promptpile/src/cli.ts` | 根命令树和 command handlers | 增加 `inspectConversation` handler |
| `packages/promptpile/src/index.ts` | completion 入口和 command dispatch | 直接调用 Inspect handler，不进入 completion 配置解析 |

现有 `scanDirectory()` 已经具备以下正确行为，应直接复用：

- 只扫描目录直接子文件，不递归。
- 识别普通 `[idx]role.md/json` 消息。
- 识别 assistant 的 `calls.jsonl`、`extra.json` 和 `result.jsonl` sidecar。
- 先按 index，再按消息/assistant/sidecar 层级稳定排序。
- 支持同一 index 下存在多个普通消息及自定义 role。

当前 `compareScannedFiles()` 是 `file-handler.ts` 的私有实现。若 Inspect 复制一份 comparator 或 filename parser，协议很快会产生两套事实来源。因此应优先抽取内部共享 scanner，而不是单独为 CLI 重写。

需要在抽取时修正一个既有实现细节：当前 comparator 使用 `localeCompare()` 并比较绝对路径，不能严格保证 Windows/POSIX 和不同 locale 下得到相同顺序。共享 scanner 应改用明确的 UTF-16 code-unit 比较，并只比较 role 与协议相对路径；completion 和 Inspect 必须同时切换，以继续共享同一顺序。

## 4. CLI v1

```bash
promptpile conversation inspect \
  -d ./messages \
  --format json
```

v1 支持：

```text
-d, --directory <path>   必填；要检查的已有目录
--format text|json       默认 text
--strict                 warning 也导致非零退出
```

暂缓以下参数，避免第一版同时引入不稳定语义：

- `--include-ignored`
- `--through-index <n>`
- fingerprint
- 分页
- 重复 `-d` 和 `directoryIndex`

Layered Conversation I/O 落地并稳定后，再允许重复 `-d`。届时每一层应有明确的目录身份和覆盖顺序，不应在单目录 schema 尚未稳定时提前加入。

## 5. JSON read model

### 5.1 为什么不能使用单层 artifacts

初稿中的一个 artifact 对应一个 index，并假定每轮只有一个 role。这与当前协议不完全一致：同一 index 可以包含多个普通消息或自定义 role；assistant 正文又需要和 calls/extra/result sidecar 形成一组。

因此 v1 应按 turn 分组：

- `messages[]` 保存该 index 下所有普通消息。
- `assistant` 保存规范的 `[idx]assistant.md` 及其 sidecar。
- 没有 assistant 组合时，`assistant` 为 `null`。

### 5.2 建议的内部类型

```ts
interface ConversationArtifactRef {
  path: string;
  role: string;
  format: 'md' | 'json';
}

interface ConversationAssistantArtifacts {
  /** 仅表示规范的 `[idx]assistant.md`，不表示 `[idx]assistant.json`。 */
  message: string | null;
  calls: string | null;
  extra: string | null;
  result: string | null;
}

interface ConversationTurnView {
  index: number;
  messages: ConversationArtifactRef[];
  assistant: ConversationAssistantArtifacts | null;
}

interface ConversationDiagnostic {
  severity: 'warning' | 'error';
  code: string;
  index?: number;
  path?: string;
  message: string;
}

interface ConversationInspection {
  schemaVersion: 1;
  directory: string;
  artifactCount: number;
  maxIndex: number | null;
  turns: ConversationTurnView[];
  diagnostics: ConversationDiagnostic[];
}
```

这些类型是 Promptpile 内部 read model，不需要在 v1 同时承诺一个公共 TypeScript library API。稳定的是 CLI JSON contract。

分组语义必须固定如下：

- 只有 `[idx]assistant.md` 进入 `assistant.message`。
- `[idx]assistant.json` 是普通 message artifact，进入 `messages[]`，其 `role` 为 `assistant`、`format` 为 `json`。
- 任一 calls/extra/result sidecar 存在时，即使没有 assistant.md，`assistant` 仍为非 `null`。
- assistant.md 与三个 sidecar 都不存在时，`assistant` 为 `null`。
- `messages[]` 不读取正文，所有字段仅来自 scanner 的文件名识别结果。

`artifactCount` 等于 scanner 识别出的直接子文件数量，包括普通 message 和 calls/extra/result sidecar。未知文件、大小写不匹配文件、不支持的扩展名、子目录及子目录内文件均不计入。空目录时它为 `0`。

### 5.3 JSON 示例

```json
{
  "schemaVersion": 1,
  "directory": "./messages",
  "artifactCount": 4,
  "maxIndex": 2,
  "turns": [
    {
      "index": 0,
      "messages": [
        {
          "role": "system",
          "path": "[0]system.md",
          "format": "md"
        }
      ],
      "assistant": null
    },
    {
      "index": 2,
      "messages": [],
      "assistant": {
        "message": "[2]assistant.md",
        "calls": "[2]assistant.calls.jsonl",
        "extra": null,
        "result": "[2]assistant.result.jsonl"
      }
    }
  ],
  "diagnostics": []
}
```

空目录是合法 Conversation 视图：

```json
{
  "schemaVersion": 1,
  "directory": "./messages",
  "artifactCount": 0,
  "maxIndex": null,
  "turns": [],
  "diagnostics": []
}
```

`maxIndex` 不使用 `-1`，因为协议 index 本身是非负整数，`null` 能更准确表达“不存在”。

### 5.4 路径与稳定性

- artifact 的 `path` 一律相对于被检查目录，不输出绝对路径。
- JSON 中的路径分隔符应规范为 `/`，保证 Windows/POSIX 输出一致。
- `directory` 保留调用者提供的目录标识，不把内部解析出的绝对路径泄露到 stdout。
- `turns` 和 `messages` 使用与 completion 组装一致的稳定顺序。
- `--format json` 的 stdout 只包含一个完整 JSON document；日志与错误不得混入。
- scanner 不使用依赖 locale 的 `localeCompare()`；字符串使用 JavaScript UTF-16 code-unit 顺序比较：`a < b ? -1 : a > b ? 1 : 0`。
- formatter 接收完整的 `ConversationInspection`，不得重新访问文件系统。

## 6. Text 输出

Text formatter 面向人类阅读，信息来自同一个 `ConversationInspection`，不得重新扫描目录。

```text
Conversation: ./messages
Artifacts: 4
Max index: 2

[0]
  message system [0]system.md
[2]
  assistant [2]assistant.md
  calls     [2]assistant.calls.jsonl
  result    [2]assistant.result.jsonl

Diagnostics: none
```

Text 和 JSON formatter 应实现为纯函数，便于用同一 read model 做快照或精确断言。

JSON formatter 固定使用 `JSON.stringify(inspection, null, 2) + '\n'`。JSON 模式下 stdout 只写一次；协议 diagnostics 已包含在 document 中，不应再逐条复制到 stderr。只有无法建立可信 inspection 的运行时错误写入 stderr。

## 7. Diagnostics 与退出码

### 7.1 v1 诊断范围

Inspect 只报告 Promptpile 核心 Conversation Protocol 能确认的问题：

| code | severity | 含义 |
| --- | --- | --- |
| `ASSISTANT_CALLS_INVALID` | error | calls 文件不是支持的 JSON/JSONL tool call 结构 |
| `ASSISTANT_EXTRA_INVALID` | error | extra 文件不是合法对象或缺少有效 `reasoning_content` |
| `ASSISTANT_RESULT_INVALID` | error | result 行不是合法对象，或缺少必需字段 |
| `MISSING_TOOL_RESULT_FILE` | warning | calls 中有 tool call，但对应 result 文件不存在 |
| `MISSING_TOOL_RESULT_ID` | warning | result 文件存在，但缺少某个 `tool_call_id` |

未知文件和不支持的扩展名在 v1 继续忽略；是否通过 `--include-ignored` 暴露留给后续版本。

Inspect 不输出 `pending | partial | complete | invalid`。这些状态包含 MCP/执行器规则，继续由 `promptpile-mcp check` 负责，避免 Promptpile 核心层越权解释执行状态。

v1 对边界情况采用以下最小语义：

- 空 calls 文件合法，表示没有 tool calls。
- 空 result 文件合法，表示没有 tool results。
- calls 中任一非空行无法解析或无法规范化时，产生 `ASSISTANT_CALLS_INVALID`；validator 可以保留其它合法行，以继续生成缺失 result 诊断。
- 重复 `tool_call_id`、result 中存在 calls 未声明的额外 ID 暂不增加专用诊断，沿用 completion 当前的匹配行为。
- 普通消息读取失败不属于 Inspect，因为 Inspect 不读取普通消息正文；sidecar 读取失败属于无法完成校验的运行时 error，而不是 Conversation Protocol diagnostic。

### 7.2 统一 sidecar 校验

当前源码对 sidecar 错误的处理并不完全一致：

- 无效 `assistant.result.jsonl` 会抛错。
- 无效 `assistant.extra.json` 会抛错。
- `assistant.calls.jsonl` 中无法解析的行目前可能被跳过。
- 缘于 calls/result 对不齐的问题通过 `MessageDiagnostic` 表达。

如果 Inspect 单独增加一套严格 calls parser，就会出现“Inspect 判错，但 completion 仍接受”的分歧。落地时应抽取共享的 calls/result/extra validator，让 Inspect 和 completion 消费同一解析结果；不能只在 Inspect 内复制一份严格解析器。

共享 validator 必须是 non-throwing、无输出、无进程副作用的接口，例如：

```ts
interface ValidationResult<T> {
  value: T | null;
  diagnostics: ConversationDiagnostic[];
}
```

两个调用方采用不同的消费适配器：

- Inspect 收集全部 diagnostics，尽可能构建完整 `ConversationInspection`。
- completion 对 result/extra error 保持当前失败行为。
- completion 对 calls 非法行在 v1 保持兼容：使用 validator 返回的合法 calls，同时通过现有诊断输出边界发出 warning；将它升级为 completion error 必须作为单独的 breaking behavior change 评审。

因此，共享“判断与解析”不等于强迫两个调用方立即采用相同退出策略；稳定的是对输入合法性的判断只有一个事实来源。

### 7.3 退出语义

| 情况 | 默认模式 | `--strict` |
| --- | ---: | ---: |
| 无 diagnostics | 0 | 0 |
| 仅 warning | 0 | 1 |
| 至少一个 error | 1 | 1 |
| 目录不存在或目标不是目录 | 1 | 1 |

JSON 模式发现协议诊断时，仍应先向 stdout 写出完整、合法的 JSON document，再设置非零退出码。目录不存在或不是目录时无法形成可信 inspection，错误写 stderr，stdout 保持为空。

v1 只使用退出码 `0` 和 `1`。handler 不调用 `process.exit()`，只设置 `process.exitCode`；Commander 自身的参数错误继续沿用 Commander 的退出行为。

## 8. CLI 接线

在 `conversation-command.ts` 增加：

```ts
interface InspectConversationOptions {
  directory: string;
  format: 'text' | 'json';
  strict?: boolean;
}
```

接线顺序：

1. `registerConversationCommand()` 注册 `conversation inspect`。
2. `PromptpileCommandHandlers` 增加 `inspectConversation`。
3. `index.ts` 将 handler 直接接到 `runInspectConversationCommand(options, cwd)`。
4. handler 验证目录，建立 read model，格式化一次输出，并按 diagnostics 设置退出码。

这条执行路径不得调用 `resolveConfig()`，也不得触发 root completion handler。即使环境中没有 API key、LLM profile 或 tools 配置，Inspect 也必须正常工作。

## 9. 代码结构建议

建议新增：

```text
packages/promptpile/src/conversation-scanner.ts
packages/promptpile/src/conversation-sidecar-validator.ts
packages/promptpile/src/conversation-inspect.ts
packages/promptpile/test/conversation-inspect.cjs
packages/promptpile/test/conversation-inspect-cli.cjs
```

职责划分：

- `conversation-scanner.ts`：文件名识别、`scanDirectory()`、comparator、按 index 分组和共享 `FileInfo`。
- `conversation-sidecar-validator.ts`：calls/result/extra 的 non-throwing 解析与结构化校验；不输出日志、不决定退出码。
- `conversation-inspect.ts`：从 scanner 结果建立 read model、运行只读诊断、text/json formatter。
- `file-handler.ts`：继续负责读取正文、组装 completion messages 和写入 artifacts，但复用 scanner/validator，并通过 completion adapter 保持既有行为。
- `conversation-command.ts`：只负责 Commander 参数和 command runtime 边界。

若一次抽取 scanner 改动过大，可以先导出 comparator 作为过渡，但最终目标仍应是单一 scanner 模块，而不是两个调用方互相依赖 `file-handler.ts` 的内部细节。

## 10. 分阶段落地

### PR 1：纯 scanner 重构

- 抽取 filename recognition、scanner、排序和按 index 分组逻辑。
- 用确定性的 code-unit comparator 替代 `localeCompare()`，排序只依赖 role 与协议相对路径。
- 保证现有 completion scanner/message assembly 测试全部不变。
- 增加空目录、同 index 多消息、自定义 role 和跨路径形式排序单测。

这一阶段不改公开 CLI、不改变 sidecar 宽松/严格行为。验收标准是：现有 fixtures 在重构前后产生完全相同的 `FileInfo[]` 语义和 completion messages。

### PR 2：CLI 闭环

- 注册 `conversation inspect`。
- 定义 `ConversationInspection` 并实现由 `FileInfo[]` 构建 turn view 的纯函数。
- 增加 text/json formatter。
- 接入 `cli.ts` 和 `index.ts` handlers。
- 增加独立 CLI 测试并加入 `packages/promptpile/package.json` 的 test script。
- 验证无 API key、无 LLM config 时仍可运行。
- 验证 JSON stdout 纯净且目录未发生变化。
- 基础版本只展示 artifact 结构，不解析 sidecar 内容；`diagnostics` 暂为空数组。

这一阶段的验收标准是：正常目录和空目录均可稳定检查，命令不依赖 API key、completion config 或 tools，且不读取普通消息正文。

### PR 3：统一 Sidecar Diagnostics 与契约

- 抽取 non-throwing calls/result/extra validator 与两个消费适配器。
- 增加结构化 diagnostics 和 `--strict` 退出语义。
- calls 严格性按 7.2 的兼容策略接入 completion，不在本 PR 中静默引入 breaking behavior。
- 增加损坏 sidecar 与缺失 tool result fixtures。
- 更新 `doc/15-contracts/conversation-protocol-v1.md`。
- 更新 `doc/15-contracts/cli-contract-v1.md` 和 README 示例。

这一阶段完成后，v1 才具备稳定的结构、诊断和 CLI contract。

## 11. 测试矩阵

至少覆盖：

- 空目录：`maxIndex: null`、空 turns、退出 0。
- 目录不存在和目标是普通文件。
- system/user 等常见 role。
- 自定义 role。
- 同一 index 下多个普通消息。
- `[idx]assistant.json` 作为普通 message，而不是 `assistant.message`。
- assistant 正文与 calls/extra/result 同时存在。
- 只有 calls、extra 或 result，没有 assistant 正文。
- 嵌套目录中的协议文件被忽略。
- 大写扩展名和未知文件被忽略。
- calls、extra、result 各自损坏。
- calls 部分行合法、部分行损坏时，既报告 error，又能继续做可确认的 result 匹配诊断。
- 空 calls 和空 result 文件。
- 重复 `tool_call_id` 及 result 中的额外 ID 保持已声明的 v1 行为。
- calls 存在但 result 文件缺失。
- result 缺少指定 `tool_call_id`。
- JSON stdout 只能解析出一个 document。
- warning/error 在默认与 strict 模式下的退出码。
- Inspect 前后目录中的文件集合与文件内容不变。
- 未配置 API key 时命令成功。
- Windows/POSIX 下 artifact 相对路径和排序一致。
- `--format` 非法值由 Commander 拒绝。
- JSON error 模式下 stdout 仍可被 `JSON.parse()`，且 diagnostics 不重复写入 stderr。
- formatter 单测不创建或读取文件，证明其为纯函数。

## 12. 验收标准

- Inspect 的文件识别、turn 分组和排序与实际 completion message assembly 使用同一实现。
- 同一 index 下的多个消息不会丢失或被错误合并。
- JSON schema 能表达仅有 sidecar、没有 assistant 正文的轮次。
- JSON 模式不混入普通日志，错误使用 stderr。
- 命令不读取普通消息正文，不读取 secret、不调用模型、不执行 hook、不修改目录。
- Inspect 和 completion 对 sidecar 合法性的判断一致。
- completion 对 sidecar diagnostics 的消费策略符合 7.2，不因引入 Inspect 而意外改变既有退出行为。
- 其它包可以用该命令替代自建的“最新 artifact”猜测逻辑。

## 13. 主要风险与约束

最大的风险不是 CLI 本身，而是无意中实现第二套 Conversation Protocol。以下约束必须在 code review 中检查：

- 不复制 filename regex、排序 comparator 或 sidecar parser。
- 只建立结构视图，不读取或回显普通消息正文。
- 不把 tool 执行状态引入 Promptpile 核心层。
- validator 不抛出协议校验异常、不写 stdout/stderr、不设置进程退出状态。
- 先稳定单目录 schema，再设计 layered `directoryIndex`。
- 新增字段通过 `schemaVersion` 演进，不静默改变已有字段含义。

按以上边界实施，Conversation Inspect 与 Promptpile 原有“文件即协议、核心保持简单、执行能力外置”的设计理念一致。
