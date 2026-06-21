# promptpile

将目录中的 Markdown / JSON 片段按顺序组装成 **OpenAI Chat Completions** 所需的消息列表（可选 `tools`、历史 `tool_calls` / `tool`），调用大模型 API 并输出回复。适合用「一个文件一条消息」的方式维护多轮对话上下文，再由命令行一键发起单次补全请求。

---

## 目录

- [功能概览](#功能概览)
- [工作原理](#工作原理)
- [环境要求](#环境要求)
- [安装](#安装)
- [消息文件约定（重要）](#消息文件约定重要)
- [工具定义与历史工具调用（`.tools.toml` / `assistant.calls` / `assistant.result`）](#工具定义与历史工具调用toolstoml--assistantcalls--assistantresult)
- [配置说明](#配置说明)
- [命令行用法](#命令行用法)
- [输出格式](#输出格式)
- [完成后钩子（after-hook）](#完成后钩子after-hook)
- [与 OpenAI 兼容的网关](#与-openai-兼容的网关)
- [开发](#开发)
- [项目结构](#项目结构)
- [安全与隐私](#安全与隐私)
- [常见问题与排查](#常见问题与排查)
- [许可证](#许可证)

---

## 功能概览

- 只扫描指定消息目录的**根层文件**，读取符合命名规则的 `.md`、`.json`，以及可选的 `[idx]assistant.calls.jsonl` / `[idx]assistant.extra.json` / `[idx]assistant.result.jsonl`；子目录中的协议文件不会进入会话。
- **工具**：仅支持 **显式** 的 **`.toml`** 工具文件路径（`--tools-file` / 配置中的 `tools_file`），支持根表 **`extends`** 继承其它 toml；或使用 **`--disable-tool`** 不传 `tools`。不再支持 `.jsonl` 工具文件，也不在消息目录自动探测默认工具文件。
- 按文件名中的 **序号** 与 **固定规则** 排序，拼成 Chat Completions 所需的 `messages`（含可选的 `tool_calls` 与 `tool` 消息）。
- 通过 **`node-fetch`** 向兼容端点发起 `POST .../chat/completions` 请求（固定 **`stream: true`**）。
- 模型若返回 **工具调用**，可在启用 `-o` 时一并写入 **`{basename}.calls.jsonl`**；正文流式写入 stdout，流结束后逐行打印每条 tool_call（JSON 对象一行）；`--quiet` 时不打印终端输出，但若配置了 `-o` 仍写入文件。
- 可选在 **本轮成功结束**（含写 `-o`、`.calls.jsonl` 与可选 `--continue` 落盘）之后执行 **after-hook** 脚本（见 [完成后钩子](#完成后钩子after-hook)）。
- 支持通过 **环境变量** 与 **命令行参数** 配置目录、模型、API Key、Base URL 等。

**本工具不执行工具函数**；不生成 `[idx]assistant.result.jsonl`，仅规定格式并在拼消息时读取。单次运行仍为 **一次** Chat Completions 请求（不自动根据工具结果发起第二轮请求）。

---

## 工作原理

1. 解析 CLI 与 `--config` TOML，按优先级合并为最终配置（见 [配置说明](#配置说明)）。
2. 校验 **API Key** 是否存在；不存在则退出并提示错误。
3. 若配置了 `-o` / TOML `output`，在发起请求前 **创建输出目录并校验可写**；失败则退出且不调用 API。
4. 按 [工具文件解析规则](#工具定义与历史工具调用toolstoml--assistantcalls--assistantresult) 解析 `tools`（**仅**显式 `.toml`，可含 `extends`）；**在调用 API 之前**完成校验，非法则退出；`--disable-tool` 时请求体中 **省略** `tools` 字段。
5. 读取配置 `directory` 的**直接子文件**（不进入子目录），收集：
   - `^\[(\d+)\](.+?)\.(md|json)$`（扩展名不区分大小写）；
   - `^\[(\d+)\]assistant\.calls\.jsonl$`、`^\[(\d+)\]assistant\.extra\.json$`、`^\[(\d+)\]assistant\.result\.jsonl$`。
6. 按序号 **升序** 组装 `messages`：先将根层文件按 **序号分组**，再在组内按固定顺序拼消息（见下节「序号与同一序号内的顺序」与 [工具章节](#工具定义与历史工具调用toolstoml--assistantcalls--assistantresult)）。
7. 若指定 **`insert_files` / `append_files`**（CLI：`--insert-files`、`--append-files`；TOML / 环境变量见下表）：从各路径读取 **UTF-8** sidecar 文件（**相对路径相对当前工作目录**，与 `--tools-file` 一致）。多个路径用 **`|`** 分隔。每个文件的 **basename** 必须为 **`{name}.{role}.md`**（`name` 可含点，如 `react.core.system.md` → `role=system`）；`role` 仅允许 `system`、`user`、`assistant`。去除 BOM；`.md` 去 YAML front matter；trim 后 **仅空白** 则跳过该条。`insert_files` 按列表顺序 **插在** 扫描目录组装的 `messages` **之前**；`append_files` **追加在之后**。每条 sidecar 对应 **独立** 一条 API 消息（不与 `[idx]system.md` 合并）。文件不存在、不可读或命名非法则 **退出并报错**。sidecar 文件 **不会** 被 `scanDirectory` 当作 `[idx]role.md` 扫描。
8. 合并 **`temperature`**（与 `llm_api_model` 同链：`llm_api_temperature` / `PROMPTPILE_LLM_API_TEMPERATURE` / `--temperature` / `[[llm_api]].temperature`）；各层均未设置时 **默认 `0.8`**，并写入请求体。
9. 合并可选 **`extra_body`**（同链：`llm_api_extra_body` / `PROMPTPILE_LLM_API_EXTRA_BODY` / `--extra-body` / `[[llm_api]].extra_body`）；TOML 为内联表，env/CLI 为 JSON 对象字符串；各层均未设置时不写入；合并后浅展开进请求体（可覆盖 `temperature` 等字段）。
10. 使用 `fetch`（来自 `node-fetch` v2）请求 `{baseURL}/chat/completions`，固定 **`stream: true`**：正文来自流式 `delta.content`，流结束后合并 **`delta.tool_calls`**；非 quiet 时在 stdout 打印正文，并在有 tool calls 时每行输出一条 tool_call JSON。

普通消息的 **角色名** 会原样作为 `role` 传给 API。除 `tool` 外请使用网关接受的 role（常见为 `system`、`user`、`assistant`）。`tool` 消息来自 `[idx]assistant.result.jsonl` 的各行；若存在 **`[idx]assistant.calls.jsonl`** 但某 `tool_call_id` 在 result 中无对应行（或缺少 result 文件），程序会按 `missing_tool_results` 策略处理，并继续为缺失项 **合成** 一条 `tool` 消息，其 `content` 为固定中文错误句。默认策略为 `warn`：向 stderr 输出 warning 后继续。

---

## 环境要求

- **Node.js**：建议 **18+**（与当前 `@types/node` 及本地开发方式一致即可）。
- 依赖 **`node-fetch` v2**（CommonJS）；请求实现见 `src/ai-client.ts`。
- 可访问大模型 API 的网络环境（或自建兼容网关）。

---

## 安装

在包目录内：

```bash
cd packages/promptpile
npm install
```

全局安装本包（若仓库以 workspace 发布，请按你实际的 monorepo 方式安装）：

```bash
npm install -g .
```

本地开发推荐使用 `npm link`：

```bash
cd packages/promptpile
npm link
promptpile --help
```

安装后若 `promptpile` 命令不可用，可直接使用：

```bash
node dist/index.js --help
# 或
npm start -- --help
```

> **说明**：`package.json` 的 `bin` 指向 `dist/index.js`，并通过 `prepare` 自动构建可执行产物。若终端里仍找不到命令，请检查全局 npm bin 目录是否在 PATH 中。

---

## 消息文件约定（重要）

### 文件名格式

普通消息文件必须严格匹配（正则）：

```text
^\[(\d+)\](.+?)\.(md|json)$
```

即：

- 以 **`[` + 数字 + `]`** 开头，表示排序序号；
- 紧跟 **角色名**（将作为 API 的 `role`）；
- 扩展名为 **`.md`** 或 **`.json`**。

消息目录根层还可匹配 **助手工具专用** 文件名：

```text
^\[(\d+)\]assistant\.calls\.jsonl$
^\[(\d+)\]assistant\.extra\.json$
^\[(\d+)\]assistant\.result\.jsonl$
```

消息目录 **不再**自动加载工具文件；必须通过 **`--tools-file`** 或应用配置中的 `tools_file` 显式指定 **`.toml`** 路径，或使用 **`--disable-tool`**。工具文件 **不会** 被算进「消息文件」条数，也不参与序号排序。

### 示例（普通消息）

| 文件名 | 序号 | role | 说明 |
|--------|------|------|------|
| `[0]system.md` | 0 | `system` | 系统提示 |
| `[1]user.md` | 1 | `user` | 用户消息 |
| `[2]assistant.md` | 2 | `assistant` | 助手历史回复（可选） |
| `[3]user.md` | 3 | `user` | 下一轮用户输入 |
| `[4]user.json` | 4 | `user` | 整条消息为 JSON 文件原文（字符串），不解析字段 |

### 文件内容

- **Markdown（`.md`）**：若文件以 YAML front matter 开头（首行为 `---`，之后某一行单独为 `---` 闭合），则 **仅去掉该元数据块**，剩余正文作为 `content`；否则全文作为 `content`。正文**不会**再解析为 Markdown AST；模型看到的是纯文本。
- **JSON（`.json`）**：**完整文件内容**（UTF-8）作为 `content`，不按 JSON 结构抽取字段。
- 只扫描消息目录根层；子目录中的 `[idx]...` 文件会被忽略。若旧会话曾将消息放在子目录中，请先移动到配置的 `directory` 根层。

### 序号与同一序号内的顺序

- 排序键为文件名中的整数 **升序**。
- **同一序号**内顺序固定为：
  1. **`[idx]{role}.md` / `.json`**，但 **不含** `[idx]assistant.md` — 多条时先按 `role` 名字典序，再按路径；
  2. **`[idx]assistant.md`**（助手纯文本，若有）；
  3. **`[idx]assistant.calls.jsonl`**（该轮 `tool_calls`，若有）；
  4. **`[idx]assistant.extra.json`**（该轮 `reasoning_content`，若有；与 calls 合并进同一条 assistant 消息）；
  5. **`[idx]assistant.result.jsonl`**（`tool` 消息行，若有）。

这样可与 OpenAI 要求一致：**`tool` 消息紧跟在带对应 `tool_calls` 的 `assistant` 消息之后**。

若目录下没有任何匹配文件，程序会报错退出。

---

## 工具定义与历史工具调用（`.tools.toml` / `assistant.calls` / `assistant.result`）

### 破坏性变更（工具）

- **仅支持 `.toml`** 作为工具定义文件（不再支持 `.tools.jsonl` / `*.jsonl` 作为工具源）。
- **不再**在扫描目录根自动探测 `.tools.toml` / `.tools.jsonl`；必须通过 **`--tools-file`**或 TOML 中的 **`tools_file`** 等 **显式**给出路径，或使用 **`--disable-tool`**。
- 工具 TOML 根表支持 **`extends`**（字符串或字符串数组），路径相对 **当前该 toml 文件所在目录**；**环检测**；**最大递归深度 32**（根文件深度为 0）。

### 工具文件来源与优先级

| 来源 | 含义 | 相对路径解析基准 |
|------|------|------------------|
| CLI `--tools-file <path>` | 入口 `.toml`（可含 `extends`） | **`process.cwd()`** |
| TOML `tools_file` | 同上 | **扫描目录根**（`-d` 解析后的绝对路径） |

**优先级**：**`--tools-file`** > TOML `tools_file`。

未使用 **`--disable-tool`** 且 **未**提供上述任一显式路径时，程序在调用 API **之前**报错退出。

**`--disable-tool`**：不加载工具文件；请求体中 **不传** `tools`。与 **`--tools-file`** 同时出现时以 **`--disable-tool` 为准**（不解析工具路径）。历史消息中的 `tool_calls` / `tool` 仍按文件照常拼入 `messages`。

显式路径指向的文件 **必须存在** 且扩展名为 **`.toml`**。

### `extends` 与合并顺序

- **`extends`**：根表字段；值为单个字符串，或字符串数组；每个路径相对 **本文件所在目录** `path.dirname(当前 toml)` 解析为绝对路径后再加载。
- **深度优先**：每个 `extends` 目标会先完整解析其自身的 `extends` 链，再合并该文件中的 **`tools`**；同一文件内 **`extends` 列表从左到右** 合并子图，同一 `function.name` **后者覆盖前者**。
- **当前文件**：所有 `extends` 子图合并完成后，再合并根表的 **`tools`**；与下层同名时 **以当前文件为准**。
- **环**：若某绝对路径在递归栈中再次出现 → 报错退出。
- **深度**：进入下一层 `extends` 时深度 +1；**深度大于 32** 时报错退出。
- **`tools` 键**：可省略或为空数组；可仅通过 `extends` 聚合工具。

解析成功后，发给 API 的 `tools` **仅**来自上述 toml 合并结果（与 `function.name` 去重规则见 `extends` 一节）；未产生任何工具条目时，请求体中可不传 `tools`。

### 工具条目的扁平形状（`[[tools]]`）

每个工具条目按 **扁平形状** 书写，**不需要** `type = "function"`，**不需要** `tools.function` 嵌套表：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | 非空字符串 | 是 | 函数名（OpenAI `tools[].function.name`） |
| `description` | 字符串 | 否 | 函数说明（OpenAI `tools[].function.description`） |
| `parameters` | 对象 **或** JSON 字符串 | 否 | JSON Schema（OpenAI `tools[].function.parameters`）；若为字符串，promptpile 会自动 `JSON.parse` |

promptpile 内部会把每个条目自动包成 OpenAI 请求体所需的 `{ "type": "function", "function": { ... } }` 形状再传给 API。

**显式 `type` / `function` 顶层字段会被拒绝**（旧版的嵌套写法不再兼容）；如要扩展非 `function` 工具，需要后续版本另行支持。

### 工具 `.toml` 示例（含 `extends`）

```toml
extends = ["./common-tools.toml"]

[[tools]]
name = "get_weather"
description = "Get weather"
parameters = '{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}'
```

`./common-tools.toml` 相对于 **本文件所在目录** 解析。

### `[idx]assistant.extra.json`（历史：thinking 模型的 `reasoning_content`）

与 **`{basename}.extra.json`**（**`-o`** 主输出旁）规则不同：此处为 **`--continue`** 落盘的 **`^\[(\d+)\]assistant\.extra\.json$`** 文件。

用于回放 DeepSeek 等 **thinking 模式**下 assistant 必须回传的 **`reasoning_content`**。整文件为 **单个 JSON 对象**：

```json
{
  "reasoning_content": "模型内部推理全文……"
}
```

- 仅当 API 返回非空 `reasoning_content` 且启用 **`--continue`** 时自动写入；与 **`[N]assistant.md`**、**`[N]assistant.calls.jsonl`** 可 **共存于同一 `N`**。
- 下一轮 `buildMessages` 会将其合并进同序号的 **一条** `{ role: 'assistant', content?, tool_calls?, reasoning_content }` 再发给 API。
- 若历史 assistant 在 thinking 模型下缺少该文件，网关可能返回 **400**（例如 DeepSeek：`reasoning_content` must be passed back）。可 **手写** 此文件修复，或清空相关轮次后重跑。
- 扫描时 **优先于** 通用 `[idx]{role}.json` 规则匹配，避免被误当作 `role=assistant.extra` 的普通消息。

### `[idx]assistant.calls.jsonl`（历史：该轮助手的 `tool_calls`）

与 **`{basename}.calls.jsonl`**（**`-o`** 主输出旁）后缀相同但规则不同：此处为 **`--continue`** 落盘的 **`^\[(\d+)\]assistant\.calls\.jsonl$`** 文件。

用于回放或人工构造「模型曾发起的工具调用」。整文件解析为 **`tool_calls` 数组**（OpenAI 形态：`id`、`type`、`function.name`、`function.arguments`）。支持：

- 单个 JSON 对象，且含 **`tool_calls`** 数组；
- 根级 JSON **数组**（即为 `tool_calls`）；
- **JSONL**：每行一个完整 tool call 对象。

解析得到 **非空** `tool_calls` 时，才会追加一条 **`role: "assistant"`** 且 **`content` 为 `null`**、带 `tool_calls` 的消息。若文件为空、无法解析或解析后 **没有任何有效 tool call**（例如 `normalizeToolCalls` 过滤后为空），则 **不会** 追加该条 assistant 消息（可与同序号的 `[idx]assistant.md` 搭配：先文本助手消息，再带 `tool_calls` 的助手消息）。

### `[idx]assistant.result.jsonl`（历史：工具返回给模型的内容）

**本程序不创建或更新此文件**；由你或其它工具生成。每行一个 JSON 对象，字段至少包括：

- **`tool_call_id`**（字符串，与 `call` 中一致）
- **`content`**（字符串，传给模型的工具结果正文）

可选：**`name`**（若网关要求 `tool` 消息带名称可填写）。

示例一行：

```json
{"tool_call_id":"call_abc123","content":"{\"temperature\":22}","name":"get_weather"}
```

当同一序号存在 **`[idx]assistant.calls.jsonl`** 且解析出非空 `tool_calls` 时，按 call 中的 `tool_call_id` **顺序** 生成 `tool` 消息；若某 id 在 result 中 **缺失**，则该条 `content` 为 **固定中文句式**（与 `src/types.ts` 中 `formatMissingToolResultContent` 一致），模板为：

```text
错误：未在 [idx]assistant.result.jsonl 中找到 tool_call_id=<toolCallId>
```

示例（序号为 `2`、缺失的 id 为 `call_abc123`）：

```text
错误：未在 [2]assistant.result.jsonl 中找到 tool_call_id=call_abc123
```

缺失结果策略可通过 TOML `missing_tool_results` 或 CLI `--missing-tool-results` 设置：

| 策略 | 行为 |
|------|------|
| `warn` | 默认；输出 warning，插入上述合成 `tool` 消息并继续 |
| `error` | 抛错退出，不调用模型 |
| `ignore` | 不输出 warning，仍插入合成 `tool` 消息并继续 |

不能直接省略对应的 `tool` 消息，因为 Chat Completions 服务通常要求每个 `tool_call` 都有后续响应。

若 **仅有 `[idx]assistant.calls.jsonl` 而无 `assistant.result` 文件**，则对 **每个** `tool_call_id` 均使用上述合成 `content`。

若 **仅有 result 而无 call**（或 call 解析结果为空），则按 result 文件中的行顺序逐条追加 `tool` 消息（**不与** call 做 id 对齐）。

### 本次 API 响应中的工具调用与 `{basename}.calls.jsonl`

- 当模型在 **当前轮** 返回 `tool_calls` 时：
  - **`text` 模式**：正文仍流式输出；流 **结束后**，将每条工具调用以 **一行一个 JSON** 打印到 stdout（与写入 `.calls.jsonl` 的序列化一致）。
  - **`json` 模式**：在 stdout 打印 **单个** JSON 对象：`{"response":"...","tool_calls":[...]}`（无 `tool_calls` 时为 `null`）。
  - **`--quiet`**：不向 stdout 打印正文与上述工具行，但若配置了 **`-o`**，仍会写入 **主输出文件** 与 **`{basename}.calls.jsonl`**（若存在工具调用）。
- **`{basename}.calls.jsonl`**：仅当使用 **`-o` / TOML `output`** 指定主输出文件时写入。路径与主输出 **同目录**，文件名为 `path.parse(主输出路径).name + ".calls.jsonl"`。例如主输出为 `out/answer.txt`，则工具调用记录为 `out/answer.calls.jsonl`。若主输出为 `out/x.calls.jsonl`，则工具记录为 `out/x.calls.calls.jsonl`（由 `path.parse` 的 `name` 决定）。
- **`{basename}.extra.json`**：同上规则，当本轮返回非空 **`reasoning_content`** 时写入，内容为 `{"reasoning_content":"..."}` 单对象 JSON；仅作 **`-o` 旁车审计**，下轮历史仍以 **`messages/`** 内 **`[idx]assistant.extra.json`** 为准。

---

## 配置说明

普通配置按 **优先级从高到低** 合并：**命令行 > TOML > 内置默认值**。实现见 `src/resolve-config.ts`。

1. **命令行参数**
2. **`--config <path>` 指定的 TOML**（路径相对当前工作目录；读取 `[promptpile]` 与 `[[llm_api]]`）
3. **内置默认值**（如 `./messages`、`gpt-3.5-turbo`）

程序不读取 `.env`，也不把 `AI_MODEL`、`TOOLS_FILE`、`PROMPTPILE_*` 等普通环境变量作为配置层。环境变量仅用于以下明确的运行时接口：

- TOML `api_key_env` / `llm_api_key_env`：其值是另一个环境变量的名称，用于读取密钥。
- `PROMPTPILE_DEBUG`：启用 stderr 诊断日志。
- `PROMPTPILE_DUMP_LLM` / `PROMPTPILE_DUMP_LLM_TAG`：控制请求响应审计文件。
- after-hook 子进程收到的 `PROMPTPILE_*` 上下文变量属于输出接口，不参与 promptpile 自身配置合并。

### TOML（`--config`）

- **`[promptpile]`**：与 `example.toml` 一致，如 `dir`、`output`（路径字符串）、`output_pile_file`、`output_pile_fd`、`output_pile_format`、`quiet`、`after_hook`、`tool_choice`、`tools_file`、`disable_tool`、`continue`、`input`、`insert_files`、`append_files`、`missing_tool_results`、`llm_api`、`llm_api_key`、`llm_api_key_env`、`llm_api_model`、`llm_api_base_url`、`llm_api_temperature`、`llm_api_extra_body`。旧名 `output_pipe` / `output_pipe_format` 仍兼容，新名优先。
- **`[[llm_api]]`**：`name`、`model`、`base_url`、`api_key`、`api_key_env`、`temperature`、`extra_body`；由 `llm_api` 选择 profile 后再应用 `llm_api_*` 覆盖。
- **密钥**：若配置了 `api_key_env` / `llm_api_key_env`，在直写 `api_key` / `llm_api_key` 仍为空时从 `process.env[该变量名]` 读取。

### CLI 参数

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `--config <path>` | TOML 配置文件（相对 cwd） | 无 |
| `-d, --directory <path>` | 扫描目录 | 见上合并链 |
| `-m, --model <model>` | 模型 ID | 见上合并链 |
| `-k, --api-key <key>` | API Key | 无 |
| `-b, --api-base-url <url>` | Base URL | 见上合并链 |
| `--temperature <n>` | 采样温度（`0`–`2`）；覆盖 `llm_api_temperature` / profile | `0.8` |
| `--extra-body <json>` | 额外请求体字段（JSON 对象）；覆盖 `llm_api_extra_body` / profile | 无 |
| `-o, --output <path>` | 输出文件路径（保存模型回复） | 无 |
| `--output-pile-file <path>` | 将流式 assistant 正文旁路写入文件/命名管道路径；不受 `--quiet` 影响 | 无 |
| `--output-pile-fd <fd>` | 将流式 assistant 正文旁路写入继承 fd（整数，须 `>= 3`）；优先于 `--output-pile-file` | 无 |
| `--output-pile-format <text\|json>` | 旁路输出格式；`text` 写纯 chunk，`json` 写 JSONL 事件 | `text` |
| `--output-pipe <path>` / `--output-pipe-format <format>` | 旧名兼容；分别等价 `--output-pile-file` / `--output-pile-format` | 无 |
| `-q, --quiet` | 静默模式：不打印过程日志、流式正文、工具调用行；**仍会**写入 `-o` 主文件与 `.calls.jsonl` / `.extra.json`（若存在），也不会关闭 output pile | 关闭 |
| `-i, --input` | 在终端读取输入并保存为下一条 `user` 消息后再执行 | 关闭 |
| `-c, --continue` | 将本次 assistant 输出追加为下一条消息文件：有正文则写 `[N]assistant.md`；含 `tool_calls` 则写 `[N]assistant.calls.jsonl`；含 `reasoning_content` 则写 `[N]assistant.extra.json`；三者**可共存**于同一 `N`，下一轮拼请求时会合并为一条 assistant 消息；三者皆无时不写文件 | 关闭 |
| `--tools-file <path>` | 工具定义 **`.toml`**（可含 `extends`）；**相对路径相对当前工作目录**；未设置且 TOML 无 `tools_file` 且未 `--disable-tool` 时报错 | 无 |
| `--insert-files <paths>` | 在扫描消息 **之前** 插入 sidecar 消息；多路径用 `\|` 分隔；每文件须 `{name}.{role}.md`；**相对路径相对 cwd** | 无 |
| `--append-files <paths>` | 在扫描消息 **之后** 追加 sidecar 消息；规则同 `--insert-files` | 无 |
| `--after-hook-path <path>` | 完成后执行的脚本文件；**相对路径相对当前工作目录** | 无 |
| `--allow-default-after-hook` | 未显式配置 hook 时，允许在扫描目录根发现默认 `.after-hook.*`；**仅 CLI 可启用** | 关闭 |
| `--tool-choice <value>` | OpenAI `tool_choice`：当且仅当本次请求包含非空 `tools` 时写入请求体。`none`（禁止工具调用）\|`auto`\|`required`\|`function:<name>`（强制指定工具）。**优先级**：CLI 高于 TOML `tool_choice`；均未设置时按 `auto` | 无（由下层或未设置时的 `auto` 决定） |
| `--disable-tool` | 不加载、不发送 `tools`：忽略 `--tools-file` 与 TOML `tools_file`；与 `--tools-file` 同时出现时 **本开关优先** | 关闭 |
| `--missing-tool-results <policy>` | 缺失工具结果处理：`warn`、`error` 或 `ignore` | `warn` |

与「不传 `tools`」的区别：`tool_choice` 仅在请求体带 `tools` 时发送；`none` 表示仍下发工具定义但禁止模型发起 `tool_calls`。自建网关若不支持 `required` 或强制 `function` 对象，可能返回 400，需以网关文档为准。

查看帮助：

```bash
node dist/index.js --help
```

配置示例见 [example.toml](./example.toml)、[example.sh](./example.sh)。

---

## 命令行用法

### 最小示例

1. 准备目录（例如 `./messages`）与文件：

```text
messages/
  [0]system.md
  [1]user.md
```

2. 设置密钥并运行：

```bash
node dist/index.js -d ./messages -k "sk-..." --disable-tool
```

也可在 TOML 中配置 `api_key_env = "OPENAI_API_KEY"`，再由 shell 或密钥管理器提供该变量。

### 指定模型

```bash
node dist/index.js -d ./messages -m gpt-4o
```

### 继续会话（保存 assistant 回复）

```bash
node dist/index.js -d ./messages --continue
```

启用后会在 `directory` 根目录下追加 **`[N]assistant.md`**（本轮正文；若仅有工具调用而无正文，仍会写入该文件，可为空）。若本轮 API 返回 **`tool_calls`**，会追加 **同一 `N` 的 `[N]assistant.calls.jsonl`**（每行一个 JSON，与 `outputs` 下的 `.calls.jsonl` 每行格式一致），便于下一轮 **[助理发起工具调用](#工具定义与历史工具调用toolstoml--assistantcalls--assistantresult)**。若返回非空 **`reasoning_content`**（thinking 模型），会追加 **同一 `N` 的 `[N]assistant.extra.json`**（见上文 **[`[idx]assistant.extra.json`](#idxassistantextrajson历史thinking-模型的-reasoning_content)**）。主输出同目录下的 **`{basename}.calls.jsonl`** / **`{basename}.extra.json`** 仍仅在指定 **`-o` / TOML `output`** 时写入。

### 终端输入并执行

```bash
node dist/index.js -d ./messages --input
```

启用后会先在终端等待输入，将输入保存为 `directory` 根目录下的 `[nextIdx]user.md`，然后再调用模型执行。

### nextIdx 计算规则

- `nextIdx` 按当前目录已匹配到的消息文件中 **最大 idx + 1** 计算。
- 若目标文件名已存在（例如已有同序号同角色文件），会继续递增直到找到可用文件名。
- 不要求 idx 连续；例如现有 `[0]... [1]... [3]...`，下一条会从 `[4]...` 开始尝试。

### 单文件原子写入

完整文件输出先写入目标目录中的唯一临时文件，完成 `fsync` 后再通过同目录 `rename` 提交，包括 user/assistant 消息、calls/extra sidecar、`-o` 主输出及其 sidecar、LLM dump。异常时会清理临时文件，已有目标文件不会被半截内容覆盖。

原子性只保证单个文件不会以半截内容出现，不把同一 assistant 轮次的多个 sidecar 视为一个跨文件事务。若进程在两个文件提交之间崩溃，已 rename 的文件会保留，尚未提交的文件不存在；calls 缺少 result 时由 `missing_tool_results` 策略处理。promptpile 不协调同一消息目录的多个并发写入者；实时 `output pile` 是流式通道，也不适用原子文件提交。

### 使用自建兼容网关

```bash
node dist/index.js -b https://your-gateway.example/v1 -k your-key -m your-model-id
```

### 将回复保存到文件

```bash
node dist/index.js -d ./messages -o ./outputs/last-response.txt
```

若模型返回工具调用且指定了 `-o`，会额外生成 **`./outputs/last-response.calls.jsonl`**（与主文件同目录、`path.parse(主路径).name + ".calls.jsonl"`）。

### 静默模式（建议与输出文件配合）

```bash
node dist/index.js -d ./messages -o ./outputs/last-response.txt --quiet
```
### 带工具定义（显式 `.toml`）的最小目录示例

通过 **`--tools-file`**（相对 cwd）或 TOML **`tools_file`**（相对扫描目录）指向 **`.toml`**，消息目录内只需消息文件，例如：

```text
messages/
  [0]system.md
  [1]user.md
  my-tools.toml
```

`my-tools.toml` 示例：

```toml
[[tools]]
name = "get_weather"
description = "Get weather"
parameters = '{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}'
```

运行示例（模型是否发起 `tool_calls` 取决于网关与模型）：

```bash
node dist/index.js -d ./messages --tools-file ./my-tools.toml -m gpt-4o -o ./outputs/out.txt
```

---

## 输出格式

控制台输出固定为 **流式纯文本**：将模型 **正文** 逐块写入标准输出（`--quiet` 时关闭）。若存在 **工具调用**，在流结束后将每条调用以 **一行一个 JSON 对象** 写入 stdout（`--quiet` 时关闭）。若指定 **`-o`**，主回复写入该文件，工具调用写入 **`{basename}.calls.jsonl`**（与是否 quiet 无关）。需要结构化结果时请读 **`-o` 主文件**、**`.calls.jsonl`** 或 **`--continue` 落盘的 `[N]assistant.*`**，而非解析整段 stdout JSON（已不再支持 `-f json` / `PROMPTPILE_FORMAT`）。

### 流式旁路输出（output pile）

`output pile` 用于把模型正文 chunk 复制到 stdout 之外的独立通道，适合上层程序在 `--quiet` 模式下做实时 UI。

```bash
node dist/index.js -d ./messages --quiet \
  --output-pile-file ./outputs/stream.jsonl \
  --output-pile-format json
```

TOML 示例：

```toml
[promptpile]
output_pile_file = "./outputs/stream.jsonl"
output_pile_fd = 3
output_pile_format = "json"
```

当同时设置 `output_pile_fd` 与 `output_pile_file` 时，优先写 fd。fd 适合由父进程通过 `spawn(..., { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] })` 传入。

`text` 格式只写正文 chunk；`json` 格式写 JSONL 事件：

```jsonl
{"type":"assistant_delta","content":"..."}
{"type":"assistant_done"}
{"type":"error","message":"..."}
```

旧名 `--output-pipe` / `output_pipe` 仍可用作兼容别名，但新配置优先。

---

## 完成后钩子（after-hook）

在 **API 成功返回** 且已完成 **主输出及 `{basename}.calls.jsonl` / `{basename}.extra.json`（若配置了 `-o` 且存在）**、以及可选的 **`--continue` 追加 `[N]assistant.md` / `[N]assistant.calls.jsonl` / `[N]assistant.extra.json`** 之后，若解析到要运行的脚本文件，则 **`spawn` 子进程** 执行该文件（非交互、不经过 shell 拼接命令串）。**API 失败或中途 `exit(1)` 时不会执行钩子。**

### 配置来源与优先级

| 来源 | 含义 | 相对路径解析基准 |
|------|------|-------------------|
| CLI `--after-hook-path <path>` | 调用者显式指定，视为授权执行 | **`process.cwd()`**（当前工作目录） |
| TOML `after_hook` | 项目显式配置，视为授权执行 | **扫描目录根**（`dir` 解析后的绝对路径） |
| 均未配置 | 默认不查找、不执行 hook | — |
| CLI `--allow-default-after-hook` | 允许在扫描目录根查找默认文件名 | — |

优先级：**CLI 路径** > TOML `after_hook` > 由 `--allow-default-after-hook` 启用的**默认文件**。绝对路径在 CLI / TOML 中均不再拼相对基准。

`--allow-default-after-hook` 是 **CLI-only 授权**；TOML 中的 `allow_default_after_hook` 不会生效，避免项目配置自行开启隐式脚本发现。

显式脚本在执行前会通过 `realpath` 解析真实目标，并验证目标为普通文件。文件缺失、目录、断裂符号链接等情况会向 stderr 输出 `Warning: after-hook script is not executable as a regular file: ...`，不执行钩子，主流程仍成功结束。

### 默认文件名（仅在 CLI 授权时）

只有传入 **`--allow-default-after-hook`** 且未配置 CLI/TOML hook 路径时，才在扫描目录根查找第一个存在且解析后为普通文件的项：

- **Windows**（`win32`）：`.after-hook.ps1` → `.after-hook.bat` → `.after-hook.cmd`  
- **macOS / Linux**（非 `win32`）：仅 **`.after-hook.sh`**

Windows **默认链**不包含 `.sh`；若要在 Windows 上跑 shell 脚本，请用 CLI `--after-hook-path` 或 TOML `after_hook` **显式**指定路径（实现上会用 `sh` 启动 `.sh`，需本机存在 `sh`）。

### 子进程环境

子进程 **`cwd`** 为扫描目录绝对路径；继承当前环境变量，并追加（供脚本读取）：

| 变量 | 含义 |
|------|------|
| `PROMPTPILE_SCAN_DIRECTORY` | 扫描目录绝对路径 |
| `PROMPTPILE_OUTPUT_FILE` | 主输出文件绝对路径；未使用 `-o` 则为空字符串 |
| `PROMPTPILE_CALLS_FILE` | 若本轮写入了 `{basename}.calls.jsonl`（由 `-o` / TOML `output` 决定）则为该文件绝对路径，否则空字符串 |
| `PROMPTPILE_ASSISTANT_MD_FILE` | 若启用了 `--continue` 且本轮有正文（`response.length > 0`）写入了 `[N]assistant.md` 则为该文件绝对路径，否则空字符串 |
| `PROMPTPILE_ASSISTANT_CALL_FILE` | 若启用了 `--continue` 且本轮含 `tool_calls`、写入了 `[N]assistant.calls.jsonl` 则为该文件绝对路径，否则空字符串。与 `PROMPTPILE_ASSISTANT_MD_FILE` / `PROMPTPILE_ASSISTANT_EXTRA_FILE` **可同时非空**：下一轮拼请求时合并为单条 assistant 消息 |
| `PROMPTPILE_ASSISTANT_EXTRA_FILE` | 若启用了 `--continue` 且本轮含 `reasoning_content`、写入了 `[N]assistant.extra.json` 则为该文件绝对路径，否则空字符串 |
| `PROMPTPILE_MODEL` | 当前模型 ID |
| `PROMPTPILE_QUIET` | `0` 或 `1` |
| `PROMPTPILE_HAS_TOOL_CALLS` | `0` 或 `1` |
| `PROMPTPILE_HAS_REASONING` | 本轮 API 是否返回非空 `reasoning_content`：`0` 或 `1` |
| `PROMPTPILE_RESPONSE_LENGTH` | 本轮正文字符串长度（数字字符串） |

子进程 **stdout / stderr** 被管道收集：**非 0 退出码** 时向主进程 **stderr** 打印退出码与子进程 stderr；**成功（退出码 0）时不回显**子进程 stdout/stderr，以免干扰父进程终端输出。

### 启动方式（按扩展名）

| 扩展名 | 行为（概要） |
|--------|----------------|
| `.ps1`（Windows） | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File <脚本>` |
| `.bat` / `.cmd`（Windows） | `cmd.exe /d /s /c <脚本>` |
| `.sh` | `sh <脚本>` |
| 其他（仅非 Windows 常见） | 直接 `spawn(脚本路径, [])`（需文件具备可执行权限等） |

### 安全说明

CLI `--after-hook-path` 与 TOML `after_hook` 都属于显式配置，会直接授权执行对应脚本；请只使用已审查的配置。默认文件发现关闭，只有本次命令明确传入 `--allow-default-after-hook` 才启用。符号链接按 `realpath` 后的真实目标执行并校验为普通文件。不要将密钥等敏感信息写入钩子日志（本实现不会主动注入 API Key 到上述 `PROMPTPILE_*` 变量）。

---

## 与 OpenAI 兼容的网关

本工具使用 `node-fetch` 直接调用 HTTP 接口，通过 `-b` 与 `-k`（或 TOML profile）指向任意 **OpenAI Chat Completions 兼容** 的服务端（如部分云厂商、本地 `vLLM`/`llama.cpp` 的 OpenAI 兼容层等）。请注意：

- **路径**：默认 Base URL 为 `https://api.openai.com/v1`；若网关要求不含 `/v1` 或要求额外路径，需按对方文档填写 `-b` 或 TOML `base_url`。
- **模型名**：`-m` 必须与网关识别的模型 ID 一致。

---

## 开发

| 命令 | 说明 |
|------|------|
| `npm run build` | `tsc` 编译到 `dist/` |
| `npm run dev` | 使用 `ts-node` 直接运行 `src/index.ts` |
| `npm start` | 运行 `node dist/index.js`（需先 `build`） |

TypeScript 配置见本包目录 [tsconfig.json](./tsconfig.json)（`strict: true`，输出 CommonJS）。

---

## 项目结构

```text
packages/promptpile/
├── src/
│   ├── index.ts         # 入口：编排扫描、读文件、调 API、打印结果
│   ├── cli.ts             # Commander：CLI 定义与解析（`parseCli`）
│   ├── config.ts          # 遗留 `loadConfig` 兼容入口（不读取环境变量）
│   ├── resolve-config.ts  # 两层合并：CLI、TOML
│   ├── toml-config.ts     # 解析 `--config` TOML 的 `[promptpile]` / `[[llm_api]]`
│   ├── file-handler.ts  # 目录扫描、拼 ChatMessage[]
│   ├── tools-loader.ts  # 显式 `.toml` 工具、`extends` 解析与 `loadTools`
│   ├── after-hook.ts    # 解析并执行完成后钩子脚本
│   ├── ai-client.ts     # node-fetch 调用 chat/completions（含流式 tool_calls 合并）
│   └── types.ts         # Config、ChatMessage、FileInfo 等
├── dist/                # 编译产物（运行入口）
├── package.json
├── tsconfig.json
└── README.md
```

---

## 安全与隐私

- **API Key**：勿将真实密钥提交到仓库；优先使用系统/进程环境变量，或在 TOML 中使用 `api_key_env` 引用环境变量名。
- **日志**：默认不会在日志中打印完整 `messages` 负载；若自行修改代码或在外层包装脚本中记录请求体，请注意敏感数据与 CI 输出。
- **网络**：请求发往 `apiBaseUrl` 所指向的服务器，请确认合规与数据出境要求。
- **工具调用**：本工具 **不执行** 用户定义的工具函数；工具结果文件需自行保证来源可信。

---

## 常见问题与排查

| 现象 | 可能原因 | 处理建议 |
|------|----------|----------|
| `AI API key is required` | 未设置 `-k`，且 TOML 未提供 `api_key` 或有效的 `api_key_env` | 传入 `-k`，或配置 TOML `api_key_env` |
| `No files found matching` … | 目录下无匹配的消息文件 | 检查是否至少存在 `[数字]角色.md`、`.json` 或 `[idx]assistant.calls.jsonl` / `[idx]assistant.extra.json` / `[idx]assistant.result.jsonl` 等匹配项 |
| `Error loading tools` / `Circular tools extends` / `Tools extends depth exceeds` | 工具 `.toml` 非法、`extends` 成环、递归过深、显式路径不存在或扩展名非 `.toml` 等 | 按 stderr 提示修正；条目须为扁平 `[[tools]]`；`extends` 路径相对当前 toml 所在目录 |
| `Error: tools require an explicit .toml path` | 未传 `--disable-tool` 且未提供 `--tools-file` 或配置中的 `tools_file` | 指定 `.toml` 路径或添加 `--disable-tool` |
| `Warning: after-hook script is not executable as a regular file` | 显式 hook 缺失、不是普通文件或真实路径解析失败 | 修正路径或删除配置 |
| `after-hook exited with code` / `spawn error` | 脚本语法错误、无解释器、或 `.ps1` 被策略拦截 | 在本机直接运行同一脚本排查 |
| `Cannot create or write to output directory` | `-o` 父目录无法创建或不可写 | 检查路径权限与磁盘 |
| `Incomplete tool result` / `Warning: Incomplete tool result` | calls 缺少 result 文件或对应 `tool_call_id` | 补齐 result；或按场景使用 `--missing-tool-results error|warn|ignore` |
| `assistant.result.jsonl line …` / `Invalid JSON`（来自拼消息阶段） | `[idx]assistant.result.jsonl` 某行非合法 JSON 或缺少 `tool_call_id` / `content` | 按报错行号修正该文件 |
| HTTP 400 / invalid role | `role` 不是 API 支持的值 | 使用 `system` / `user` / `assistant` 等 |
| 连接失败 | 网络、代理、Base URL 错误 | 检查 `-b`、防火墙与网关文档 |
| 模型不存在 | `-m` 与服务商不匹配 | 换成该 Base URL 下列出的模型 ID |

---

## 许可证

以 `package.json` 中的 `license` 字段为准（当前为 `ISC`）。
