# promptpile-react

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
- Thought、Observe 或 Check 失败立即进入 `error`，不会再执行 Final。
- Final prompt 非空时是 required phase；失败会令进程非零退出。空 Final prompt 会明确跳过。
- 进程成功退出时，终态只能是 `final` 或 `max_step`。

## CLI

```bash
promptpile-react --config ./example.toml
promptpile-react -d ./messages --max-step 3
promptpile-react -d ./base -d ./reference --output-dir ./session
```

常用参数：

| 参数 | 含义 |
| --- | --- |
| `--config <path>` | React 读取 `[promptpile-react]` 和少量 `[promptpile]` 兼容字段，并把同一文件作为 `--llm-config` 交给 Promptpile |
| `-d, --directory <path>` | Conversation 输入层；可重复，保持参数顺序 |
| `--output-dir <path>` | 唯一可写 Conversation 层 |
| `--max-step <N>` | 最大完整 ReAct iteration 数，默认 1 |
| `-i, --input` | 从终端读取一次 user message、append 一次、运行一次 session 后退出 |
| `-c, --continue` | Thought/Final 子调用传递 `promptpile -c`；不会启动进程级交互循环 |
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
- `dirs` 必须是非空 string 数组；
- `*_extra_body` 必须是 TOML table；
- `[promptpile-react]` 未知字段直接报错；
- `[promptpile]` 中 React 不消费的合法字段会被忽略并留给 Promptpile。

现有 phase-specific model/key/base/temperature/extra-body 字段仅作为 beta 兼容表面保留，不再扩展。新配置优先使用 profile selector。

## 阶段策略与边界

- Thought：读取真实 Conversation，可使用 tools/hook，可按 `-c` 续写。
- Observe：读取真实 Conversation，禁用工具，要求可读的 `-o` 文本输出。
- Check：使用隔离临时 Conversation，只注入 check prompt 与 Observe 报告；要求合法 calls sidecar。
- Final：只从 `final|max_step` 进入，禁用工具，非空 prompt 时必须成功。

Check 的通用 ToolCall 结构通过 `promptpile-protocol/tool` 的 `parseToolCallV1` 校验；React 只验证 `react_check_decision` 和 boolean `arguments.decision`。缺失或畸形的 required output 一律失败关闭。

Promptpile 公共 CLI 是唯一 runtime integration boundary。默认通过 `promptpile` 包的 `bin` metadata 定位入口；`PROMPTPILE_BIN` 可显式覆盖。React 不导入 `promptpile/src` 或 `promptpile/dist`，也不二次解释 Receipt、SSE 或 OCC。

## 构建与验证

要求 Node.js 20 或更高版本。

```bash
npm test -w promptpile-react
npm run package:smoke -w promptpile-react
```

`package:smoke` 会把同一 workspace revision 的 `promptpile-protocol`、`promptpile` 和 `promptpile-react` 打包到 fresh project，再验证 help、version、依赖拓扑、binary resolution 和最小编排。

专用 CI 在 Node 20/22 × Ubuntu/Windows 上执行构建、测试和 packed smoke。当前包仅支持 `promptpile-react` executable，不承诺 JavaScript library API。

调试时可设置 `PROMPTPILE_REACT_DEBUG=1`，阶段诊断写入 stderr，不改变 stdout ownership。
