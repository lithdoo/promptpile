# promptpile-react

## Structured streaming output

The default output remains the existing human-facing terminal mode. For a
machine-readable, real-time projection of the ReAct session, use:

```bash
promptpile-react -d ./messages --output-format stream-json
```

`stream-json` reserves stdout for Agent Event Protocol v1 JSONL. Human
diagnostics and child stderr remain on stderr; `--quiet` never suppresses
protocol events. The package-local normative schema is published at
`schema/agent-event-v1.schema.json`.

The v1 stream exposes orchestration facts and Final answer deltas only. It does
not expose Thought, Observe, Check text, tool arguments, or hidden reasoning.

`promptpile-react` 是建立在 `promptpile` 公共 CLI 之上的轻量 ReAct 编排器。它只负责阶段顺序、继续/停止决策和提示词注入；Chat Completions、Conversation I/O、OCC、Receipt 与 artifact publication 均由 `promptpile` 负责。

## 执行模型

一次完整 iteration 固定为：

```text
Thought → Observe → Check
```

运行时状态只有：

```text
running | final | max_step | error
```

- `currentStep` 是成功完成的完整 iteration 数量。
- 默认 `maxStep=1`；`--max-step N` 要求 `N >= 1`。
- Check 返回 `false` 时提前进入 `final`；返回 `true` 且达到上限时进入 `max_step`。
- `max_step_policy=final`（默认）在 `max_step` 后继续执行 Final；`max_step_policy=error` 将其视为未收敛，跳过 Final 并令 session 失败。
- Thought、Observe 或 Check 失败立即进入 `error`，不会再执行 Final。
- Final prompt 非空时是 required phase；失败会令进程非零退出。空 Final prompt 会明确跳过。
- 进程成功退出时，终态只能是 `final` 或 `max_step`。

## CLI

```bash
promptpile-react --config ./example.toml
promptpile-react -d ./messages --max-step 3
promptpile-react -d ./base -d ./reference --output-dir ./session
promptpile-react -d ./messages --work-root ./react-work
promptpile-react -d ./messages --max-step 3 --observe-carryover 1
```

常用参数：

| 参数 | 含义 |
| --- | --- |
| `--config <path>` | React 读取 `[promptpile-react]` 和少量 `[promptpile]` 兼容字段，并把同一文件作为 `--llm-config` 交给 Promptpile |
| `-d, --directory <path>` | Conversation 输入层；可重复，保持参数顺序 |
| `--output-dir <path>` | 唯一可写 Conversation 层 |
| `--work-root <path>` | 每次 session 独占 work Conversation 的父目录；默认系统临时目录 |
| `--max-step <N>` | 最大完整 ReAct iteration 数，默认 1 |
| `--max-step-policy <final\|error>` | 达到 `max_step` 后执行 Final 或直接失败，默认 `final` |
| `--observe-carryover <N>` | active work Conversation 中保留的最近 Observe 数；非负整数，默认 0 |
| `-i, --input` | 从终端读取一次 user message、append 一次、运行一次 session 后退出 |
| `-c, --continue` | 仅控制 Final 是否写入用户 Conversation；Thought 始终只续写 session work |
| `--tools-file <path>` | Thought 阶段工具定义 |
| `--after-hook-path <path>` | Thought 成功后的 Promptpile hook |
| `-q, --quiet` | 减少 Promptpile 子进程输出 |

`-i` append 成功后，后续模型失败不会回滚已经发布的 user artifact。多输入层与 `-i` 或 `-c` 联用时，必须显式提供 `--output-dir`。

## 配置边界

推荐用 `[[llm_api]]` 定义 provider/profile，再用阶段 selector 选择：

```toml
[[llm_api]]
name = "default"
model = "your-model"
api_key_env = "OPENAI_API_KEY"
base_url = "https://api.openai.com/v1"

[promptpile-react]
dir = "./messages"
max_step = 3
max_step_policy = "final"
observe_carryover = 1
thought_llm_api = "default"
observe_llm_api = "default"
check_llm_api = "default"
final_llm_api = "default"
```

React 不解析 `[[llm_api]]` 内容；profile 存在性和 provider 配置由 Promptpile 公共 CLI 校验。

配置采用严格 TOML 类型：

- string 字段必须是非空 TOML string；
- bool 字段必须是 TOML bool；
- `max_step` 必须是正整数；
- `max_step_policy` 只允许 `final` 或 `error`；CLI 优先于 TOML，默认值为 `final`；
- `observe_carryover` 必须是非负整数；CLI 优先于 TOML，默认值为 `0`；
- `work_root` 必须是非空 string；CLI/TOML 相对路径均相对 invocation cwd；
- `dirs` 必须是非空 string 数组；
- `*_extra_body` 必须是 TOML table；
- `[promptpile-react]` 未知字段直接报错；
- `[promptpile]` 中 React 不消费的合法字段会被忽略并留给 Promptpile。

现有 phase-specific model/key/base/temperature/extra-body 字段仅作为 beta 兼容表面保留，不再扩展。新配置优先使用 profile selector。

## 阶段策略与边界

- Thought：读取权威 Conversation 与既有 session work，可使用 tools/hook，始终只续写 session work。
- Observe：读取权威 Conversation 与 work，禁用工具，要求非空的 `-o` 文本输出；最后一次成功 Observe 成为 Final handoff。
- Check：使用隔离临时 Conversation，只注入 check prompt 与 Observe 报告；要求合法 calls sidecar。
- Final：只从 `final|max_step` 进入，不读取 work，只读取权威 Conversation 和 `.user.md` Observe handoff；`-c` 时以唯一 Completion Receipt 证明持久化成功。

当 `max_step_policy=error` 且最后一次 Check 仍返回 `true` 时，Final 不会启动。terminal 模式在 stderr 输出诊断并非零退出；`stream-json` 模式以 `session.failed(phase="check", error.code="max_step_exhausted")` 收口，不产生 Final 事件或 `session.completed`。

Check 的通用 ToolCall 结构通过 `promptpile-protocol/tool` 的 `parseToolCallV1` 校验；React 只验证 `react_check_decision` 和 boolean `arguments.decision`。缺失或畸形的 required output 一律失败关闭。

### Observe carryover

`observe_carryover=0` 严格保持旧行为：Observe 只生成临时 `-o`，不续写 work、不创建 `.observe_files` 或 Receipt。

当值为 `N>0` 时，Promptpile 在同一次 Observe invocation 中同时生成临时 `-o` 和标准 `[n]assistant.md`，Completion Receipt 将两者绑定到同一个 invocation。React 只登记该 Observe 的 message index，并把超过最近 N 个的 Observe artifact family 移入 work 下的 `.observe_files/`。Promptpile 只扫描 work 根目录，因此保留项自然进入后续 Thought/Observe 上下文，归档项自然不可见。

`.observe_files/index.json` 是 append-only 的内部身份账本；root 与 `.observe_files` 中的物理位置分别表示 active 与 archived。任一 Receipt、登记、归档或不变量校验失败都会在 Check 前终止 session。Check 协议、Final handoff、公开事件协议、成功清理和失败调试保留策略均不改变。

Promptpile 公共 CLI 是唯一 runtime integration boundary。默认通过 `promptpile` 包的 `bin` metadata 定位入口；`PROMPTPILE_BIN` 可显式覆盖。React 不导入 `promptpile/src` 或 `promptpile/dist`，也不二次解释 Receipt、SSE 或 OCC。

## 构建与验证

要求 Node.js 20 或更高版本。

```bash
npm test -w promptpile-react
npm run package:smoke -w promptpile-react
```

`package:smoke` 会把同一 workspace revision 的 `promptpile-protocol`、`promptpile` 和 `promptpile-react` 打包到 fresh project，再验证 help、version、依赖拓扑、binary resolution 和最小编排。

专用 CI 在 Node 20/22 × Ubuntu/Windows 上执行构建、测试和 packed smoke。当前包仅支持 `promptpile-react` executable，不承诺 JavaScript library API。

调试时可设置 `PROMPTPILE_REACT_DEBUG=1`，失败 session 的 work directory 会保留并把路径写入 stderr；成功 session 仍清理。该模式不改变 stdout ownership。
