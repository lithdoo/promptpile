# CLI Contract v1

> 层级：15 · Contracts  
> 状态：Normative  
> 稳定程度：Evolving  
> 主要定义：orchestrator / shell automation 使用的 machine-facing CLI 边界  
> 被以下组件实现：`promptpile`；被 `promptpile-react` 使用  
> 最近复核：2026-08-11

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

### Conversation optimistic concurrency

Root mutation 可选声明 writable output physical directory 的 expected condition：

```text
--expect-output-fingerprint <promptpile-conversation-v1:sha256:64-lowercase-hex>
--expected-output-next-index <0..9007199254740991>
```

条件只允许与 `--input` 或 `--continue` 一起使用；否则是配置错误且不调用模型。两者同时给出时必须全部匹配。Fingerprint 是强内容条件，next-index 是只检测 allocator 结果的弱条件。Layered mode 不检查只读 base/shared layer。

实现可以在模型调用前 preflight 以尽早失败，但只有获取 `.promptpile.occ.claim` 后的 fresh recheck 才是权威 commit 判断。模型请求期间不持 claim。仅 `--continue` 时 caller condition 在模型返回后重新验证；`--input --continue` 时 user commit 后在同一 claim 内派生内部 baseline，assistant commit 验证该 baseline。

退出码固定为：`0` success、`1` ordinary/config/runtime failure、`3` Conversation conflict。post-model conflict 不写本轮 assistant Conversation artifacts，也不执行 after-hook；此前已经流向 stdout/output pile 或写入 `-o` 的独立结果不回滚。组合模式已经提交的 user artifact同样不回滚。

### Output Artifact Policy v1

Root completion 的唯一执行顺序为：

```text
resolve/preflight → prepare configured sinks → model stream → finalize output pile
→ commit -o body/calls/extra → terminal tool-call postlude
→ commit Conversation assistant artifacts → after-hook → final status
```

output pile destination 是单一 logical slot：CLI file/fd target group 整体优先于 TOML target group；同一来源同时给出 file 与 fd 时保持 v1 `fd wins`。caller-managed 相对路径只相对 invocation cwd resolve 一次，下游 writer 不得重新读取 `process.cwd()` 解释路径。

`-o` 的 body、calls 与 extra potential targets 必须在调用模型前全部进入 collision set。它们不得与 pile file、writable Conversation directory 中可识别的 protocol filename、`.promptpile.occ.claim` 或本轮 resolved after-hook script 冲突。静态冲突是 exit `1`，不调用模型，也不打开或 truncate output sink。

Policy resolution 与 lexical collision validation 不产生 filesystem side effect。只有 OCC early preflight、消息扫描、tools、tool choice、insert/append sidecar 等确定性验证全部成功后，才进入 sink preparation：创建 output parents、按 canonical parent identity 复检 collision，并打开/等待 pile readiness。上述验证失败不得因 `-o` 或 pile file 配置而留下新建的 output parent directory。

output pile 是 required live transport，但不是 durable body authority，也不进入 artifact ledger。JSON pile 的 `assistant_done` 只表示 model stream done。pile open/write/done/close failure 是 ordinary failure，并阻止 main、Conversation 和 hook stages。

durable commit 顺序固定为 main body → calls → extra，再进入 Conversation。每个文件独立 atomic；group 和跨 channel 都不 transactional。ledger 只在单个 durable write 成功后记录事实。后续失败不 rollback 已写 artifact。after-hook 的精确 artifact path 只能来自 ledger，不能根据模型结果、配置或目录扫描推导。cleanup/finalizer 的 secondary failure 不得覆盖更早的 primary failure。

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

## Conversation domain commands

### Append user

```bash
promptpile conversation append-user -d <directory> [-q]
  [--expect-fingerprint <token>]
  [--expected-next-index <idx>]
```

- stdin：完整 user message；空/纯空白输入失败；
- success：写入下一条 user artifact；
- `-q`：成功时不输出普通 stdout；
- 不读取 completion API key；
- 不加载 tools；
- 不调用模型；
- failure：非零退出并写 stderr。
- expected condition mismatch、claim busy、state unstable 或 target collision：退出码 `3`，stdout 为空且不写 user artifact；
- claim cleanup 等普通文件系统失败：退出码 `1`；
- 无 expected condition 时保留原有兼容 mutation 路径。

### Inspect

```bash
promptpile conversation inspect -d <directory> [--format text|json]
```

- `-d/--directory`：必填，只接受一次；相对路径相对 process cwd；目标必须是已存在的目录；
- `--format`：`text`（默认）或 `json`，其他值由 CLI parser 拒绝；
- 只列出当前 Conversation scanner 识别的直接子文件，顺序与 scanner 完全一致；
- 不读取 artifact 正文，不解析 JSON/JSONL，不递归、不展示未知文件；
- 不解析 completion config，不要求 API key，不加载 tools，不调用模型或 after-hook；
- success：退出码 `0`，stdout 只包含所选 formatter 的一个完整结果，stderr 为空；
- failure：退出码 `1`，错误写入 stderr，stdout 为空。

JSON 输出固定为 `JSON.stringify(inspection, null, 2) + '\n'`，schema 为：

```ts
interface ConversationInspection {
  schemaVersion: 1;
  directory: string;          // 调用者提供的原始目录字符串，仅用于显示/关联本次调用
  artifactCount: number;      // 始终等于 artifacts.length
  maxIndex: number | null;    // 空目录为 null
  artifacts: Array<{
    index: number;
    kind: 'message' | 'assistant_call' | 'assistant_extra' | 'assistant_result';
    role: string;
    extension: 'md' | 'json' | 'jsonl';
    path: string;             // 相对目录的 `/` 分隔协议路径
  }>;
}
```

`[1]user.md` 与 `[01]user.md` 是两个独立 artifact，二者的 `index` 都是 `1`。Inspect
不实现独立 filename parser、comparator 或去重逻辑。空目录是成功结果；text 模式输出
`Artifacts: 0` 和 `Max index: null`。

`directory` 不是 canonical physical-directory identity。同一物理目录通过相对路径、绝对路径、
不同相对拼写或符号链接调用时，可能产生不同的 `directory` 字符串。需要目录 identity 的调用方
必须独立使用 Layered Conversation I/O 定义的 realpath canonicalization。Conversation Fingerprint
不得直接 hash 整个 Inspect JSON；fingerprint 应基于独立 canonicalization 后的 artifact refs/content，
与 Inspect 的显示字段保持解耦。

### Fingerprint

```bash
promptpile conversation fingerprint -d <directory> [--format text|json]
```

- 一次只接受一个已存在的 physical Conversation Directory；
- discovery、artifact interpretation 和顺序完全复用 Conversation scanner；
- 对每个 recognized artifact 的原始 bytes 做 streaming SHA-256，不解析或规范化正文；
- 连续执行两次完整的 `scan -> hash -> rescan` observation，只有两次 observation 完全相同才成功；
- unknown 文件、nested 文件和 metadata 不参与；绝对路径、display path、cwd、mtime、权限位不进入 canonical encoding；
- 不解析 completion config，不要求 API key，不加载 tools，不调用模型或 after-hook；
- failure：非零退出、diagnostic 写入 stderr、stdout 为空，不输出部分 fingerprint。

text stdout 固定为一个 token 和换行：

```text
promptpile-conversation-v1:sha256:<64-lowercase-hex>
```

JSON 使用 `JSON.stringify(result, null, 2) + '\n'`：

```ts
interface ConversationFingerprintResult {
  schemaVersion: 1;
  fingerprintVersion: 1;
  algorithm: 'sha256';
  artifactCount: number;
  maxIndex: number | null;
  fingerprint: string;
}
```

Fingerprint 是强内容 identity 和 stable observation，不是访问控制、文件系统锁、CAS、事务或
线性化 snapshot。mutation/OCC consumer 必须在自己的临界区内消费该 primitive，不能把一次
较早计算的 token 当作写入时状态未变化的证明。

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
