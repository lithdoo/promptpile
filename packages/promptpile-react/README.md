# promptpile-react

在 **`promptpile` 命令行**之上编排 AI agent（React 式的状态 / 回合模型）。**调用模型时**通过子进程执行 **`promptpile` CLI**（不把 CLI 当 npm 库 `import`）；**默认**使用依赖包 **`promptpile`** 内已构建的 **`dist/index.js`**（以当前 Node **`process.execPath`** 启动），无需全局安装。**`-i` 写入终端用户消息**时，本包依赖 workspace 内的 **`promptpile` npm 包**，引用其 **`file-handler`**（与 `promptpile -i` 写 `[idx]user.md` 的规则一致）。

**当前版本**：解析 CLI、用 `PromptpileReactRuntime` 以 **`child_process.spawn`** 异步调用 **`promptpile`**（不再使用 `spawnSync`）。子进程 **stdout/stderr** 在运行期间 **实时转发** 到当前进程终端（`promptpile` 在 **text** 模式下流式写出的正文会逐块出现；粒度取决于管道与上游 chunk）。若传入 **`-q`**：子进程 argv 仍带 **`promptpile -q`**，且本进程 **不向终端转发** 子进程的 stdout/stderr（与少刷屏一致）。从 `-d` 目录读取 `.react.*.md` 提示词。主循环 **`nextStep()`**（`async`）每轮依次 **`await reactThoughtProcess()`** → **`await reactObserveProcess()`**（纯文本）→ **`await reactCheckProcess(observeText)`**（仅 observe 正文 + 决策 tool）。二者子进程 argv **不含** 主流程的 `-o`；**`-c`（continueMode）** 有两层含义：见下文「`-i` / `-c`」与 **`react*` 子进程 argv**。

### 运行时与 `PROMPTPILE_BIN`

- **默认**（未设置 **`PROMPTPILE_BIN`**）：解析依赖 **`promptpile`** 的 **`dist/index.js`**，用 **`process.execPath`** 执行；需已在 **`packages/promptpile`** 执行 **`npm install` / `npm run build`** 使 **`dist/`** 存在。
- **回退**：若无法解析到内置脚本（例如单独安装本包且未带 `promptpile` 依赖），则仍尝试命令名 **`promptpile`**（需在 `PATH` 中）。
- **覆盖**：设置环境变量 **`PROMPTPILE_BIN`** 为可执行文件路径或命令名时，**完全**使用该值启动子进程（与旧行为、CI 或自定义包装脚本兼容）。
- **`currentStep`**：已成功完成的 **ReAct 轮数**（每轮 `nextStep` 在 thought、observe、check **均成功**后 +1；从 0 递增）。
- **`--max-step N`**：最多 **N** 轮上述成功；用尽后 `stopReason` 为 `max_step`。
- **未传 `--max-step`**：内部为无上限（`Infinity`），为避免死循环，**入口只执行一轮** `nextStep` 后结束（仍可通过多次手动运行进程实现多轮）。
- **`finalAnswer()`**：委托 **`reactFinalAnswerProcess()`**（见下文）；若 `.react.final.md` 非空则发起一次带 final 注入的 `promptpile`。
- **`stopReason`**：`error` 表示 thought/observe/check 子进程失败或 check 读 **`.calls.jsonl` 解析失败**（`nextStep` **catch** `PromptpileReactInvocationError` 等异常后写入，**不向进程外再抛**）；`final` 表示 check 正常返回 **`false`**（判定不继续）；`max_step` 表示达到步数上限。

## 配置（`resolveReactConfig`）

入口在 [`resolve-react-config.ts`](src/resolve-react-config.ts) 合并配置；子进程 argv 由 [`build-phase-argv.ts`](src/build-phase-argv.ts) 按阶段生成，**不传** `--config` 给 `promptpile`。

**合并优先级：**

```text
React CLI
  > [promptpile-react] TOML（--config 指定文件）
  > [promptpile] TOML 同名共享键（仅 dir / quiet / tools_file / continue / input / after_hook / llm_api / llm_api_temperature / llm_api_extra_body 作默认 profile）
  > 内置默认
```

- **仅 react 消费**：`max_step`、`thought_prompt` / `observe_prompt` / `check_prompt` / `final_prompt`、分阶段 `*_llm_api` / `*_llm_api_temperature` / `*_llm_api_extra_body`（含 `check_*`）等；合并后经 `buildPhaseArgv` 向子进程传 `-m/-k/-b/--temperature` 及可选 `--extra-body`（JSON 字符串）。
- **不读取、不转发**：`[promptpile]` 的 `output`、`tool_choice`、`disable_tool`、`insert_files`、`append_files`（ReAct 各阶段在代码里固定行为：Observe 全量目录 + `--append-files` + `-o` 纯文本；Check 空目录 + `--insert-files`（check + observe 正文）+ `react_check_decision`；Final `--disable-tool`；Thought/Final 用 `--insert-files`）。
- 普通配置不从 `.env` 或 `process.env` 读取；密钥仍可由 TOML `api_key_env` 引用指定环境变量。示例见 [`example.toml`](example.toml)、[`example.sh`](example.sh)。

## 编排调试（`PROMPTPILE_REACT_DEBUG`）

设置 **`PROMPTPILE_REACT_DEBUG`** 为 **`1` / `true` / `yes` / `on`** 时同时启用：

1. **stderr 阶段日志** — **`[promptpile-react]`** 前缀行（阶段边界、读盘摘要等）。**与 `promptpile` 的 `PROMPTPILE_DEBUG` 无关**；与 **`-q`** 无关（调试行仍写 stderr）。典型行：**`session start maxStep=…`** / **`phase=thought`** / **`phase=observe llm_reply:`** / **`phase=check continue=true|false`** / **`phase=final`** / **`session end stopReason=…`**。

2. **LLM 请求/响应 JSON 落盘** — 每个 **Thought / Observe / Check / Final** 子进程在 **`promptpile` 的 cwd**（`ResolvedReactConfig.cwd`，即 `--config` 所在目录）写入：
   - **`{timestamp}-{rand}.req.json`** — URL、脱敏 headers、请求 body
   - **`{timestamp}-{rand}.res.json`** — 归一化 `content` / `tool_calls` 或错误信息  
   JSON 内 **`tag`** 为 `thought` / `observe` / `check` / `final`。**勿提交**这些文件。

裸跑 **`promptpile`**（非 react）时可用 **`PROMPTPILE_DUMP_LLM=1`** 单独落盘（见 `packages/promptpile` README）。

## React 提示词

在 **扫描目录**（`-d` / `dir` 解析后的绝对路径）下读取提示词，优先级：

1. TOML：`thought_prompt`、`observe_prompt`、`check_prompt`、`final_prompt`（相对扫描目录）
2. 回退：`.react.core.md`、`.react.observe.md`、`.react.check.md`、`.react.final.md`
3. `core` / `observe` / `check` 仍缺省则用内置中文默认；`final` 空白则跳过 Final 子进程

也可仅在目录内放置下列文件（无 TOML 路径时）：

| 文件名 | 说明 |
|--------|------|
| `.react.core.md` | 执行核心（core）提示词 |
| `.react.final.md` | 收尾 / 面向用户交付（final）提示词，**可省略或留空** |
| `.react.observe.md` | 观察 / 审视（observe）提示词（纯文本，不调工具） |
| `.react.check.md` | 校验（check）提示词（仅见 observe 报告，须调 `react_check_decision`） |

规则：

- **`core`**：文件不存在或内容仅空白时，使用**内置中文默认**。
- **`observe`**：同上，缺失或空白时使用**内置中文默认**。
- **`final`**：文件不存在或仅空白时视为**空字符串**（无内置默认）。

未传 `-d` 时不会读取上述文件；`core` / `observe` 仍使用内置默认，`final` 为空。

## 主循环 `nextStep`

每轮顺序：

1. 若 `stopReason !== 'running'` 或已达 **`maxStep`** → 置 `max_step` 或直接 return。
2. **`try`**：`await reactThoughtProcess()` → **`await reactObserveProcess()`** → **`await reactCheckProcess(observeText)`**。
3. 三者均**未抛异常**时：`currentStep += 1`；若 `reactCheckProcess()` 返回 **`false`** → **`stopReason = 'final'`**；若返回 **`true`** 且已达有限 **`maxStep`** → **`stopReason = 'max_step'`**。observe 正文**不落盘** messages 目录，仅内存传入 check。
4. **`catch`**（含 **`PromptpileReactInvocationError`**）→ **`stopReason = 'error'`**（异常**不**冒泡到 CLI `index.ts`）。

入口 **`runOneReactSession`** 在 **`nextStep` 循环结束后 `await finalAnswer()`**。

## ReAct 思考阶段（`PromptpileReactRuntime.reactThoughtProcess`）

**`reactThoughtProcess()`**：单独一次 `promptpile`，注入 **`prompts.core`**。**`nextStep` 每轮会调用**；也可在外层单独调用。实现类为 **`CoreReactProcess`**（见源码 [`react-processes.ts`](src/react-processes.ts)）。

| 行为 | 说明 |
|------|------|
| **core 注入** | 将 `prompts.core` 写入 **临时 `{name}.system.md`**（`os.tmpdir()`），向本次 argv 追加 **`--insert-files` 绝对路径**；调用结束删除临时文件。不在 `-d` 消息目录内新增 `[idx]*.md` 承载 core。 |
| **`-c` / `--continue`** | `continueMode` 为真时，`buildPhaseArgv('thought', …)` 末尾含 `-c`。 |
| **工具与落盘** | `[idx]assistant.calls.jsonl` / `[idx]assistant.result.jsonl` 及工具执行由 **`promptpile`** 负责；本方法 **不写**、不解析上述文件。 |
| **错误** | 子进程启动失败或非零退出 → **`throw PromptpileReactInvocationError`**（`phase: 'thought'`）。**不修改** `currentStep` / `stopReason`（由 `nextStep` 的 `try/catch` 或外层处理）。 |

## ReAct 观察阶段（`PromptpileReactRuntime.reactObserveProcess`）

**`reactObserveProcess(): string`**：单独一次 `promptpile`，扫描当前消息目录并输出**纯文本观察报告**（不写回目录）。实现类为 **`ObserveReactProcess`**（[`react-processes.ts`](src/react-processes.ts)）。

| 行为 | 说明 |
|------|------|
| **argv** | `buildPhaseArgv('observe', …)`（含 **`--disable-tool`**）+ **`-o`**（tmpdir）；**无** `--tools-file` / `--tool-choice` / `--after-hook-path`。 |
| **observe 注入** | 若 `prompts.observe` 非空，临时 `{name}.system.md` + **`--append-files`**（在扫描对话之后）。 |
| **返回值** | 读取 **`-o` 主文件** 全文（trim）；缺失或读失败 → **`throw PromptpileReactInvocationError`**（`phase: 'observe'`）。 |
| **`-c`** | Observe **不传** `-c`。 |

## ReAct 校验阶段（`PromptpileReactRuntime.reactCheckProcess`）

**`reactCheckProcess(observeText): boolean`**：根据**仅** observe 正文决定是否继续外层循环。实现类为 **`CheckReactProcess`**。

| 行为 | 说明 |
|------|------|
| **argv** | `buildPhaseArgv('check', …, { directoryOverride: 空临时目录 })` + **`--insert-files`**（`check.system.md` + `observe-report.user.md`）+ 临时 **`--tools-file`**（`react_check_decision`）+ **`-o`**。依赖 `promptpile`：扫描目录为空时若提供 insert-files 仍可调用（见 `packages/promptpile`）。 |
| **判定** | 读 `{basename}.calls.jsonl` 中 **`react_check_decision`** 的 `decision === true` → 继续；否则停止。解析失败 → **`throw PromptpileReactInvocationError`**（`phase: 'check'`）。 |
| **LLM** | 独立配置 `check_llm_api_*`；未设置时回退共享的 TOML LLM profile。 |

## ReAct 收尾（`reactFinalAnswerProcess` / `finalAnswer`）

**`reactFinalAnswerProcess()`**：`prompts.final` 非空时发起一次带 final 注入的 `promptpile`（失败时**不抛**、沿用 soft invoke 的静默返回语义）。**`finalAnswer()`** 当前委托此方法。实现类为 **`FinalReactProcess`**（[`react-processes.ts`](src/react-processes.ts)）。

| 行为 | 说明 |
|------|------|
| **argv** | `buildPhaseArgv('final', …)` 已含 **`--disable-tool`**；再追加 final 的 **`--insert-files`** 临时 `{name}.system.md`。 |
| **after-hook** | 本轮 argv **不带** `--after-hook-path`（与转发中显式传入的 hook 解绑），避免 Final 成功后再跑 after-hook。 |
| **`-c`** | `continueMode` 为真时在本轮 argv 末尾追加 `-c`（与 Thought 一致；Observe 不传 `-c`）。 |

`promptpile` 在 **`--disable-tool`** 下会忽略 `--tools-file`，且不会扫描默认 `.tools.*`，无需本包 unset 子进程环境。

## `-i` / `-c`（终端输入）

| 标志 | 行为 |
|------|------|
| **`-i`** | 在本进程按 `promptpile` 同款提示从终端读入多行（Ctrl+Z / Ctrl+D 结束），调用 **`file-handler`** 写入下一条 **user** 消息（需已解析出扫描目录，通常来自 `-d` 或 `--config`）。**不会**向子进程传入 `-i`。 |
| **仅 `-i`** | 读入 **一次** → 跑完整 ReAct（`nextStep` 循环 + `finalAnswer()`）→ 退出。 |
| **`-i` + `-c`** | **外层循环**：每轮读入 → append → 新建 **`PromptpileReactRuntime`** → ReAct + `finalAnswer()` → 再次读入…直至某轮 **空输入**（报错退出，与 `promptpile -i` 一致）或 **`Ctrl+C`**。内层 **Thought / Final** 子进程在 `continueMode` 时追加 `-c`；**Observe 不续写** `messages/`。 |

首次安装前请在 **`packages/promptpile`** 执行 **`npm run build`**，以便 **`promptpile/dist/file-handler`** 存在。

## 安装与构建

```bash
cd ../..
npm install
npm run build -w promptpile
npm run build -w promptpile-react
```

安装后入口命令为 **`promptpile-react`**（见 `package.json` 的 `bin`）。

## CLI 选项

| 选项 | 说明 |
|------|------|
| `--config <path>` | 读取 `[[llm_api]]`、`[promptpile-react]`；共享键可回退 `[promptpile]`（见上文合并顺序） |
| `-d, --directory <path>` | 消息扫描目录（覆盖 TOML） |
| `-m, --model` / `-k, --api-key` / `-b, --api-base-url` | 覆盖**所有阶段** LLM（当次 CLI 最高优先级） |
| `--temperature <n>` | 覆盖**所有阶段**采样温度（`0`–`2`）；子进程传 `--temperature`；未设时默认 **0.8** |
| `--extra-body <json>` | 覆盖**所有阶段**额外请求体字段；子进程传 `--extra-body`（JSON 字符串）；未设则不传 |
| `-q, --quiet` | 子进程带 `-q`；本进程不转发子进程 stdout/stderr |
| `--tools-file <path>` | Thought 阶段 tools（CLI 路径相对 **cwd**，覆盖 TOML） |
| `--after-hook-path <path>` | **仅 Thought** 阶段；CLI 相对 cwd |
| `-i, --input` | 本进程写 user 消息，不传 `promptpile -i` |
| `-c, --continue` | **Thought / Final** 子进程 argv 含 `-c`（Observe 不含）；与 `-i` 同时可外层循环读终端 |
| `--max-step <n>` | 仅本包；未设则入口只跑 **1** 轮 `nextStep` |

**本包不声明、子进程不由用户 `[promptpile]` 配置的项**：`-o`（主 CLI）、`--tool-choice`、`--insert-files` / `--append-files`（由本包按阶段写入临时 sidecar）。Final 阶段由代码固定 `--disable-tool`；Observe 使用临时 `-o`。

## 开发

```bash
npm run test
npm run dev -- --config=example.toml -q
```

## 许可证

ISC
