# CLI Contract v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：orchestrator / shell automation 使用的 machine-facing CLI 边界  
> 被以下组件实现：`promptpile`；被 `promptpile-react` 使用  
> 最近复核：2026-08-10

## Root completion

`promptpile` root command 是单次 completion 路径。它解析 runtime config、profile、conversation、tools，并发起一次模型请求。

### Layered Conversation I/O

```text
-d, --directory <path>   有序 Conversation 输入层；可重复
--output-dir <path>      唯一可写 Conversation 目录
```

每次出现 `-d/--directory` 都增加一个完整路径元素；逗号不是分隔符。有效输入层按 CLI 中的出现顺序读取。指定 `--output-dir` 后，该目录自动成为最后一个输入层；调用方不需要、也不应为读取它而重复传入 `-d`。

`--output-dir` 与 `-o/--output` 是不同接口：前者只决定 Conversation Protocol mutation 的目录，后者仍是本次 completion 的普通主输出文件。`--output-dir` 即使未与 `--continue` 或 `--input` 一起使用，也会作为最后一个只读输入层参与本轮 completion。

Root completion 的 Conversation mutation 包括 `--input` 追加 user artifact，以及 `--continue` 追加 assistant artifact：

| 配置的 input 数量 | mutation | 显式 output directory | 结果 |
| ---: | --- | --- | --- |
| 0 或 1 | 否 | 否 | 读取单个兼容目录（未配置时为 `./messages`） |
| 0 或 1 | 是 | 否 | 单输入目录同时作为兼容写入目录 |
| 2 或更多 | 否 | 否 | 允许，按层只读组合 |
| 2 或更多 | 是 | 否 | 配置错误；在调用模型和读取 stdin 前失败 |
| 任意 | 任意 | 是 | output directory 为唯一 mutation 目标并作为最后输入层 |

`conversation append-user` 不是 layered completion：它继续要求且只接受一个 `-d`，不接受 `--output-dir`。

### TOML keys 与优先级

```toml
[promptpile]
dirs = ["./base", "./shared"]
output_dir = "./session"
continue = true
```

旧的单值 `dir` 继续有效。目录输入按以下整组优先级选择，不跨来源拼接：

```text
一个或多个 CLI --directory
> TOML dirs
> TOML dir
> ./messages（仅在没有 input 且没有 output directory 时）
```

CLI `--output-dir` 覆盖 TOML `output_dir`。没有配置 input、但配置了 output directory 时，不再合成 `./messages`，output 自身是唯一输入层。未配置 output directory 时，仅单个有效输入层可以作为 mutation 的兼容写入目录。TOML 同时声明 `dirs` 和 `dir` 是配置错误，避免被忽略的拼写或迁移残留。`dirs` 必须是非空字符串数组，空元素和非字符串元素均为配置错误。

### 路径基准

- CLI `--directory`、`--output-dir`、`--config`、`--llm-config`、`--tools-file`、`--after-hook-path`、`-o`、insert/append files 的相对路径相对 process cwd。
- TOML `dirs`、`dir`、`output_dir` 和 `output` 的相对路径继续相对 process cwd，以保持现有 `dir`/`output` 行为。
- TOML `tools_file` 与 `after_hook` 的相对路径相对 **conversation anchor**：有 output directory 时为 output directory，否则为最后一个有效输入层。单目录配置因此保持现有语义。
- 绝对路径不再与任何基准拼接。`tools_file` 的 `extends` 仍按 Tools TOML v1 解析。

### 目录验证与 identity

所有输入目录必须已存在且为目录。显式 output directory 不存在时，Promptpile 在调用模型前递归创建它（权限遵循进程 umask / 平台默认 ACL），然后验证它是可扫描、可写目录。创建或验证失败是配置错误，不发起模型请求。

用于去重的 canonical identity 是创建/存在后的目录 `realpath`。Windows (`win32`) 比较时使用不区分大小写的规范化绝对路径；POSIX 使用 `realpath` 返回的大小写敏感路径。输入别名（包括符号链接）按首次出现保留；若 output identity 已在输入中出现，则删除其所有旧位置并只在最后保留一次。不同 identity 的父子目录允许同时出现；扫描仍不递归，因此嵌套不产生隐式包含关系。junction 等若由平台 `realpath` 解析为同一路径，也视为同一目录。

目录顺序和 identity 规则属于 contract；实现不得只用用户提供的原始字符串、basename 或跨目录 idx 去重。

### After-hook migration

Layered mode 的 after-hook conversation anchor 与上面的 TOML 基准相同；hook 子进程 cwd 也设为该 anchor。默认 `.after-hook.*` 仅在调用方显式使用 `--allow-default-after-hook` 时从 anchor 发现。CLI/TOML hook 选择优先级保持不变。

hook 环境新增：

| 变量 | 值 |
| --- | --- |
| `PROMPTPILE_INPUT_DIRECTORIES_JSON` | 有效输入层 canonical absolute paths 的 JSON string array，已去重且含最后的 output layer |
| `PROMPTPILE_OUTPUT_DIRECTORY` | canonical output directory；无显式或兼容写入目录时为空字符串 |
| `PROMPTPILE_ASSISTANT_MD_FILE` | 本轮写入 output directory 的 assistant 正文绝对路径，否则为空 |
| `PROMPTPILE_ASSISTANT_CALL_FILE` | 本轮 Conversation calls 绝对路径，否则为空 |
| `PROMPTPILE_ASSISTANT_EXTRA_FILE` | 本轮 Conversation extra 绝对路径，否则为空 |

`PROMPTPILE_SCAN_DIRECTORY` 在单输入兼容模式继续等于该输入目录。在多个有效输入层时设为空字符串并视为 deprecated；hook 必须改用 `PROMPTPILE_INPUT_DIRECTORIES_JSON`。`PROMPTPILE_OUTPUT_FILE` 和 `PROMPTPILE_CALLS_FILE` 继续专指 `-o` 主输出及其 calls sidecar，不能解释为 Conversation output directory。新增变量从引入 layered I/O 的版本起为稳定接口；旧变量至少保留一个 minor release 的迁移期。

### 生态 handoff

Root completion 结束后，output directory 是下游 session 边界：

```bash
promptpile-mcp exec-calls --input "$PROMPTPILE_ASSISTANT_CALL_FILE" ...
promptpile-compress compress -d "$PROMPTPILE_OUTPUT_DIRECTORY"
promptpile-archive search -d "$PROMPTPILE_OUTPUT_DIRECTORY" "query"
```

这些下游 CLI 的 `-d/--dir` 仍表示一个明确的 physical directory，不继承 root completion 可重复 `-d` 的语义。精确 artifact path 优先于通过 cwd 或旧 `PROMPTPILE_SCAN_DIRECTORY` 猜测 output。

## Conversation domain command

```bash
promptpile conversation append-user -d <directory> [-q]
```

- stdin：完整 user message；空/纯空白输入失败；
- success：写入下一条 user artifact；
- `-q`：成功时不输出普通 stdout；
- 不读取 completion API key；
- 不加载 tools；
- 不调用模型；
- failure：非零退出并写 stderr。

## LLM profile selector

```text
--llm-config <path>
--llm-api <name>
--api-key-env <name>
```

`--llm-config` 只把 TOML 当作 `[[llm_api]]` profile database；`--llm-api` 选择命名 profile；`--api-key-env` 把环境变量名称交给 Promptpile 读取，orchestrator 不需要读取 secret。

## Override 原则

显式 CLI 字段覆盖 config/profile 中同一字段。temperature precedence：

```text
--temperature
> [promptpile].llm_api_temperature
> selected [[llm_api]].temperature
> default 0.8
```

`extra_body` 同样由显式 CLI override 优先。

## Process contract

- `0`：成功；
- 非 `0`：调用方必须视为失败；
- stdout：正常输出/流式正文；
- stderr：diagnostic、warning、error；
- `-q`：减少普通终端输出，不改变文件 side effects 的成功语义。

Machine consumer 不应依赖未文档化的自然语言日志文本。

## Binary resolution

`promptpile-react` 默认从依赖包 `promptpile/package.json` 的 `bin.promptpile` 解析 **Node-compatible entry script**，再用当前 `process.execPath` 启动；不假定固定 `dist/index.js`。原生 executable/wrapper 用 `PROMPTPILE_BIN` 覆盖。
