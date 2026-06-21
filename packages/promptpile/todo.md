# promptpile：工具调用（Tools / Function calling）设计与改造要点

本文档汇总目录级工具声明、调用落盘、以及与 `[idx]assistant.*` 配套消息的约定，供后续实现对照。

---

## 设计目标

在保持「目录中的消息文件 → Chat Completions」工作流的前提下，支持：

- 从 **显式路径** 读取 **工具定义**（`.toml`，可含 `extends`）。
- 模型返回 **工具调用** 时，在流式正文结束后输出/落盘调用记录。
- 将会话目录中 **与某条 assistant 配套的 call/result** 拼进 `messages`，用于回放或人工补全工具结果。

本工具 **不执行** 工具函数；**不生成** `.result.jsonl`，仅规定其格式并在拼消息时使用。

---

## 文件与命名约定

### 1. 工具 `.toml`（显式路径，可含 `extends`）

- **入口**：`--tools-file` / 配置中的 `tools_file`；不再依赖会话目录默认文件名。
- **内容**：根表 `extends` + `[[tools]]` 扁平条目；见 README。

### 2. 主输出与调用记录：`{basename}.calls.jsonl`

- **前提**：仅当用户使用 **`-o` / 配置中的 `output`** 指定主输出文件时，才写调用记录文件。
- **路径**：与主输出 **同目录、同 basename**：若主输出为 `out/answer.txt`，则调用记录为 `out/answer.calls.jsonl`（即去掉「主文件扩展名」后统一加 `.calls.jsonl`，或等价规则：**与主输出共享 basename，后缀固定为 `.calls.jsonl`**——实现时与 `path.basename` 语义一致并写入 README）。
- **未使用 `-o`**：只向 **stdout** 输出模型正文；**不写** `{basename}.calls.jsonl`。

### 3. 与 `[idx]assistant` 配套的三元组

对同一序号 `idx`，可与 `[idx]assistant.md` 关联的扩展文件：

| 文件 | 作用 |
|------|------|
| `[idx]assistant.md` | 现有规则：assistant 的文本 `content`。 |
| `[idx]assistant.calls.jsonl` | 记录该轮 assistant 的 **tool_calls**（格式需与 API 对齐或可解析为 `tool_calls`）。 |
| `[idx]assistant.result.jsonl` | 每行一条 **tool** 角色所需信息（至少含 `tool_call_id` 与 `content`；完整格式见下节）。 |

**缺失规则**：若某个文件不存在则 **忽略**该部分（不单独报错）。  
**对应规则**：以 `call` 中的 `tool_call_id`（或文档规定的键）为基准，与 `result` 行 **一一对应**。若在发送请求拼消息时，某 `tool_call_id` **在 result 中缺失**，则 **默认补一条** `role: "tool"` 消息，其 `content` 为约定的 **error** 占位（字符串或固定 JSON，在格式章节写死）。

**边界情况（需实现时二选一并写进 README）**：

- 存在 `[idx]assistant.calls.jsonl` 但 **不存在** `[idx]assistant.result.jsonl`：建议视为「全部 tool 结果缺失」→ 对每个 `tool_call_id` 均补 error（与上条一致）。

---

## `.result.jsonl` 格式（工具只规定格式，不负责生成）

建议每行解析为一条工具结果，字段至少包括：

- `tool_call_id`（必填，与 call 中一致）
- `content`（必填，字符串；为工具返回给模型的正文）

可选：`name`（若目标网关要求则必填）。

**本工具不参与** 该文件的创建或更新；由用户或其它程序生成。

---

## 请求与运行时行为

### 消息拼装顺序（建议）

对同一 `idx` 若存在 `[idx]assistant.md`：

1. 追加 assistant 文本消息（来自 `.md`）。
2. 若存在 `[idx]assistant.calls.jsonl`：解析并追加带 **`tool_calls`** 的 assistant 消息（是否与上一条合并由实现决定，但**同一 idx 内顺序必须固定且文档化**）。
3. 若存在 `[idx]assistant.result.jsonl`：按行追加 **`tool`** 消息；缺省 id 用 error 占位补齐。

其它 `[idx]user.md` / `[idx]system.md` 等仍按现有序号与角色规则插入；**与 OpenAI 要求一致**：`tool` 消息必须跟在带对应 `tool_calls` 的 assistant 之后。

### 当前轮 API 响应中的工具调用

- **流式**：模型正文仍流式输出；**工具调用**在 **stream 完全结束后** 再处理。
- **控制台**：stream 结束后，将本次响应中的工具调用 **按行** 输出（每行建议一条 JSON，便于脚本解析）。
- **落盘**：若已配置 `-o`，在 **同一时刻** 写入 `{basename}.calls.jsonl`（与控制台内容对应）。
- **`--quiet`**：**不打印**模型流式正文，也 **不打印** 工具调用的控制台行。  
  **建议**：若配置了 `-o`，**仍写入**主输出文件及 `{basename}.calls.jsonl`（quiet 仅抑制终端，避免与审计需求冲突）。

### 调用 API 前校验

- **输出路径不合法**（无法创建目录、只读介质、非法路径等）：**报错退出**，不发起请求。
- **工具 `.toml` 存在但解析/校验失败**：**报错退出**。
- （按需补充）主输出与 `.calls.jsonl` 路径冲突检测：若会导致覆盖非预期文件，可报错或覆盖并在 README 说明。

---

## 改造要点（实现 checklist）

1. **类型**：扩展 `Message` 或与 OpenAI 对齐的请求体类型，支持 `tool_calls`、`tool` 消息的 `tool_call_id` / `content`。
2. **`ai-client.ts`**：
   - 请求体增加 `tools`（从显式 `.toml` 读取，含 `extends` 展开）。
   - 非流式或流式路径均能解析 **`message.tool_calls`** / 流式 **`delta.tool_calls`** 的合并。
   - 流式结束后统一得到完整 `tool_calls` 再落盘/打印。
3. **`file-handler.ts`（或新模块）**：
   - 扩展目录扫描：除 `^\[(\d+)\](.+?)\.(md|json)$` 外，识别 `[idx]assistant.calls.jsonl`、`[idx]assistant.result.jsonl`。
   - 将「文件列表 → `messages[]`」的构建逻辑升级为支持上述三元组及插入顺序。
4. **`index.ts` / CLI**：
   - 解析 `-o` 时预校验路径；决定 `{basename}.calls.jsonl` 路径。
   - 无 `-o` 时不写 `.calls.jsonl`。
   - `quiet` 分支：不写 stdout 工具行；可选仍写文件。
5. **README**：补充文件约定、`.result.jsonl` 示例、error 占位格式、`basename.calls.jsonl` 规则、与多轮工具链的关系说明（本工具仍可为「单次 completion」，除非后续增加自动第二轮请求）。

---

## 明确暂不实现（当前阶段）

- 工具函数的 **自动执行**、沙箱、白名单（安全面）。
- **`--continue`** 与工具调用落盘的交互。
- 自动根据 call 发起第二轮请求并完成多轮对话闭环（若仅拼消息 + 单次请求，需在 README 说明）。

---

## 参考：现有代码入口

- 消息类型：`src/types.ts`
- 扫描与读取：`src/file-handler.ts`
- API 请求与流式：`src/ai-client.ts`
- 编排：`src/index.ts`、`src/cli.ts`、`src/config.ts`
