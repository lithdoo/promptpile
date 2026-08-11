# Promptpile React 结构化流式输出设计计划

> 状态：讨论草案  
> 日期：2026-08-07  
> 目标组件：`promptpile-react`；依赖 `promptpile` 的 public CLI 与 output pile  
> 核心提案：由 React 编排层定义版本化 Agent Event Protocol，并通过 `text`、`json`、`stream-json` 三种机器输出模式提供稳定结果

## 1. 摘要

`promptpile` 已经能够将模型正文以增量形式写到 stdout，也能通过
`--output-pile-file` 或 `--output-pile-fd` 输出 `text`/JSONL 旁路流。
`promptpile-react` 当前没有自己的结果协议：Thought、Observe、Check、Final
各阶段启动的 `promptpile` 子进程会把 stdout/stderr 直接转发到 React 进程。

直接转发适合观察开发过程，但不适合作为 Agent API：

- 调用方无法可靠区分阶段、轮次和最终回答；
- 多个模型调用的正文可能连续混在 stdout；
- tool call JSON、普通文本和诊断信息缺少统一 envelope；
- quiet 模式会同时失去用户可见进度，但不会产生替代的结构化结果；
- Final 失败目前是 soft failure，调用方可能无法判断是否获得了完整最终回答；
- 没有稳定的 session/turn/phase/error/completed 生命周期事件。

本提案让 `promptpile-react` 成为对外协议的所有者：底层 `promptpile`
output pile 只作为子进程传输通道，React 将其映射为版本化 JSONL 事件，
不把子进程的原始输出形状直接暴露给上层调用方。

```text
promptpile child output pile (fd 3, JSONL)
                  │
                  ▼
       promptpile-react event mapper
                  │
                  ▼
   Agent Event Protocol v1 (stdout JSONL)
```

## 2. 目标

1. 为脚本、IDE、UI 和上层 Agent 提供稳定、可版本化的 React 输出协议。
2. 明确区分 session、turn、step、phase、最终消息和错误。
3. Final 正文可以低延迟增量传输。
4. 机器模式下 stdout 只包含约定格式，不混入日志或子进程原始输出。
5. stderr 继续承载 warning、diagnostic 和人工调试信息。
6. 保持 `promptpile-react` 只依赖 `promptpile` 的公共 CLI、继承 fd 和版本化 artifacts。
7. 默认不公开 Thought 或隐藏推理正文。
8. 每次运行恰好产生一个 terminal event，并让 terminal event 与进程退出码一致。
9. 保留当前面向终端的多阶段实时观察能力，避免无迁移路径的行为破坏。
10. 为将来的 tool lifecycle、usage、重试和双向输入保留兼容扩展点。

## 3. 非目标

- 不把 React 改造成常驻 RPC server。
- 第一版不实现 `--input-format stream-json` 或单进程多轮双向会话。
- 不把 Conversation Protocol 或磁盘 artifacts 替换成事件流。
- 不让 output pile 成为完成事实或可恢复状态的权威来源。
- 不在第一版流式输出 tool arguments；当前底层 output pile 只提供 assistant text delta。
- 不把内部 Thought 文本作为稳定公共 API。
- 不承诺 exactly-once 事件投递、断线续传或跨进程 replay。
- 不让 React 依赖 `promptpile/dist/*`、内部 TypeScript 类型或固定构建路径。
- 不把业务系统的 project/run/operation 字段加入通用 Promptpile 协议。

## 4. 当前行为与问题

当前 `invokePromptpileAsync()` 使用：

```ts
stdio: [stdinMode, 'pipe', 'pipe']
```

非 quiet 时，子进程 stdout/stderr 分别实时写入父进程 stdout/stderr；结束后
stdout 不保留，stderr 仅保存截断 tail。四个阶段的行为是：

| 阶段 | 当前结果来源 | 当前终端行为 |
| --- | --- | --- |
| Thought | 子进程退出状态；可由 `-c` 写 Conversation artifacts | stdout 实时转发 |
| Observe | 临时 `-o` 文件 | stdout 仍实时转发，文件结束后读取 |
| Check | 临时 `-o` 和 `.calls.jsonl` | stdout 仍实时转发，calls 决定是否继续 |
| Final | 子进程退出状态 | stdout 实时转发；调用 API 返回 `void` |

因此当前 stdout 更接近调试控制台，而不是一个“React 返回消息”。尤其是
Observe 与 Check 的模型输出属于内部控制流，不应被机器消费者误认为最终回答。

## 5. CLI 设计

### 5.1 输出格式

新增：

```text
--output-format <format>
```

支持：

| 格式 | stdout 语义 | 主要用途 |
| --- | --- | --- |
| `terminal` | 保持现有多阶段实时输出 | 人工运行、兼容旧行为 |
| `text` | 只输出最终回答正文 | shell pipe、简单自动化 |
| `json` | 结束时输出单个 JSON result envelope | CI、脚本 |
| `stream-json` | 每行一个 Agent Event Protocol v1 事件 | IDE、UI、上层 Agent |

兼容策略：

- 未显式设置时，Beta 阶段先使用 `terminal`，保持当前行为；
- 新的脚本和集成应显式选择 `text`、`json` 或 `stream-json`；
- 稳定版前可以评估将默认值切换为 `text`，但必须单独记录破坏性变更；
- `-q/--quiet` 不改变机器输出结果，只控制人工诊断；在机器模式中不能让
  `-q` 吞掉 protocol event。

示例：

```bash
# 最终纯文本
promptpile-react --config ./agent.toml --output-format text

# 单个 JSON 结果
promptpile-react --config ./agent.toml --output-format json | jq

# 实时 JSONL 事件
promptpile-react --config ./agent.toml --output-format stream-json | jq -c
```

### 5.2 可选内部事件

第一版可以预留但不必实现：

```text
--include-internal-events
```

默认行为只暴露 phase lifecycle、Final assistant delta 和 terminal result。
启用内部事件后也不应直接输出隐藏 chain-of-thought；可以暴露阶段状态、耗时、
artifact 引用和受控摘要。

## 6. stdout、stderr 与退出码不变量

### 6.1 stdout 纯净性

| 模式 | stdout 允许内容 |
| --- | --- |
| `terminal` | 兼容现有人工输出 |
| `text` | UTF-8 最终回答正文 |
| `json` | 一个合法 JSON 文档 |
| `stream-json` | 零到多个完整 JSONL 事件，每行一个 JSON object |

在 `json`/`stream-json` 模式下，以下内容禁止写入 stdout：

- Commander help 以外的普通日志；
- React debug 日志；
- 子进程 stderr；
- 子进程原始 stdout；
- 未包装的 tool call JSON；
- Node stack trace。

### 6.2 stderr

stderr 用于：

- 配置错误与诊断；
- 子进程 stderr；
- debug 日志；
- 人类可读 warning；
- 无法建立结构化 writer 时的启动失败。

机器调用方不应依赖 stderr 自然语言文本做状态判断。

### 6.3 退出码

| 结果 | 退出码 |
| --- | --- |
| `session.completed` | `0` |
| `session.failed` | 非 `0` |
| 被 SIGINT/SIGTERM 取消 | 非 `0`，并尽力发送 `session.failed`/`session.cancelled` |

如果 stdout 自身写入失败，例如消费者提前关闭 pipe，进程应停止继续生成事件并以
非零状态退出，不能报告成功。

## 7. Agent Event Protocol v1

### 7.1 公共 envelope

所有 JSONL 事件包含：

```ts
interface ReactEventBaseV1 {
  schema_version: 1;
  type: string;
  session_id: string;
  sequence: number;
  timestamp: string; // RFC 3339 UTC
}
```

约束：

- `session_id` 每次 React 进程运行唯一；
- `sequence` 从 `0` 开始严格递增；
- 单个事件必须完整写成一行；
- consumer 必须忽略未知字段和未知非 terminal event type；
- schema 的破坏性变化使用新的 `schema_version`；
- event type 的新增不要求提升 schema version。

### 7.2 Phase 与 stop reason

```ts
type ReactPhase = 'thought' | 'observe' | 'check' | 'final';

type ReactStopReason =
  | 'final'
  | 'max_step'
  | 'error'
  | 'cancelled'
  | 'no_final_prompt';
```

`step` 表示已开始的 ReAct 迭代序号，从 `0` 开始。Final 不属于新的 ReAct
迭代，但携带最终的 `steps_completed`。

### 7.3 v1 事件集合

| Event type | 何时产生 | 关键字段 |
| --- | --- | --- |
| `session.started` | 配置解析成功、运行开始 | `max_steps`、`output_format` |
| `turn.started` | 单次用户任务开始 | `turn` |
| `phase.started` | 某阶段启动前 | `phase`、`step` |
| `phase.completed` | 某阶段成功完成 | `phase`、`step`、`duration_ms`、可选 `continue` |
| `assistant.delta` | Final 获得正文增量 | `message_id`、`phase: final`、`content` |
| `assistant.completed` | Final 正文结束 | `message_id`、`content` |
| `turn.completed` | 外层循环结束 | `stop_reason`、`steps_completed` |
| `session.completed` | 所有要求的阶段和结果交付成功 | `result`、`stop_reason` |
| `error` | 可恢复或将终止的错误被发现 | `phase`、`code`、`message`、`fatal` |
| `session.failed` | 运行失败的唯一 terminal event | `phase`、`error` |

第一版只有两个 terminal event：

```text
session.completed
session.failed
```

每次已发出 `session.started` 的运行必须恰好发送其中一个。发送 terminal event
后禁止再发送其它事件。

### 7.4 成功流示例

```jsonl
{"schema_version":1,"type":"session.started","session_id":"react_01","sequence":0,"timestamp":"2026-08-07T08:00:00.000Z","max_steps":3,"output_format":"stream-json"}
{"schema_version":1,"type":"turn.started","session_id":"react_01","sequence":1,"timestamp":"2026-08-07T08:00:00.001Z","turn":0}
{"schema_version":1,"type":"phase.started","session_id":"react_01","sequence":2,"timestamp":"2026-08-07T08:00:00.002Z","phase":"thought","step":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_01","sequence":3,"timestamp":"2026-08-07T08:00:01.000Z","phase":"thought","step":0,"duration_ms":998}
{"schema_version":1,"type":"phase.started","session_id":"react_01","sequence":4,"timestamp":"2026-08-07T08:00:01.001Z","phase":"observe","step":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_01","sequence":5,"timestamp":"2026-08-07T08:00:02.000Z","phase":"observe","step":0,"duration_ms":999}
{"schema_version":1,"type":"phase.started","session_id":"react_01","sequence":6,"timestamp":"2026-08-07T08:00:02.001Z","phase":"check","step":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_01","sequence":7,"timestamp":"2026-08-07T08:00:02.500Z","phase":"check","step":0,"duration_ms":499,"continue":false}
{"schema_version":1,"type":"turn.completed","session_id":"react_01","sequence":8,"timestamp":"2026-08-07T08:00:02.501Z","turn":0,"stop_reason":"final","steps_completed":1}
{"schema_version":1,"type":"phase.started","session_id":"react_01","sequence":9,"timestamp":"2026-08-07T08:00:02.502Z","phase":"final","steps_completed":1}
{"schema_version":1,"type":"assistant.delta","session_id":"react_01","sequence":10,"timestamp":"2026-08-07T08:00:03.000Z","phase":"final","message_id":"msg_01","content":"最终"}
{"schema_version":1,"type":"assistant.delta","session_id":"react_01","sequence":11,"timestamp":"2026-08-07T08:00:03.050Z","phase":"final","message_id":"msg_01","content":"回答"}
{"schema_version":1,"type":"assistant.completed","session_id":"react_01","sequence":12,"timestamp":"2026-08-07T08:00:03.051Z","phase":"final","message_id":"msg_01","content":"最终回答"}
{"schema_version":1,"type":"phase.completed","session_id":"react_01","sequence":13,"timestamp":"2026-08-07T08:00:03.052Z","phase":"final","duration_ms":550}
{"schema_version":1,"type":"session.completed","session_id":"react_01","sequence":14,"timestamp":"2026-08-07T08:00:03.053Z","stop_reason":"final","steps_completed":1,"result":"最终回答"}
```

`assistant.completed.content` 与 `session.completed.result` 有意重复：前者完成一条
message，后者是整个进程的 terminal summary，使只关心终态的 consumer 无需重放
所有 delta。大正文是否允许 terminal event 只提供 message id，可在协议冻结阶段基于
最大消息体与 consumer 使用方式决定；v1 初步建议保留完整 result。

### 7.5 失败流示例

```jsonl
{"schema_version":1,"type":"error","session_id":"react_01","sequence":6,"timestamp":"2026-08-07T08:00:02.100Z","phase":"check","code":"CHILD_EXIT_NONZERO","message":"promptpile exited with status 1","fatal":true}
{"schema_version":1,"type":"session.failed","session_id":"react_01","sequence":7,"timestamp":"2026-08-07T08:00:02.101Z","phase":"check","error":{"code":"CHILD_EXIT_NONZERO","message":"promptpile exited with status 1"}}
```

错误码是机器判断依据，`message` 只面向人类。初始错误码建议包括：

```text
CONFIG_INVALID
CHILD_SPAWN_FAILED
CHILD_EXIT_NONZERO
CHILD_STREAM_INVALID
PHASE_OUTPUT_MISSING
CHECK_DECISION_INVALID
FINAL_OUTPUT_MISSING
OUTPUT_STREAM_FAILED
CANCELLED
INTERNAL_ERROR
```

## 8. `json` 最终结果格式

`--output-format json` 不输出中间事件，只在成功时写一个结果对象：

```json
{
  "schema_version": 1,
  "session_id": "react_01",
  "status": "completed",
  "stop_reason": "final",
  "steps_completed": 1,
  "result": "最终回答"
}
```

失败时输出：

```json
{
  "schema_version": 1,
  "session_id": "react_01",
  "status": "failed",
  "phase": "check",
  "error": {
    "code": "CHECK_DECISION_INVALID",
    "message": "react_check_decision was not present"
  }
}
```

无论是否成功都必须输出合法 JSON；失败同时使用非零退出码。若错误发生在 CLI
无法建立 result writer 之前，例如 option 自身无法解析，则允许只写 stderr 并非零退出。

## 9. Final 结果语义

Final 是 Agent 面向用户的规范结果来源。为此需要调整当前 API：

```ts
interface ReactFinalResult {
  status: 'completed' | 'skipped' | 'failed';
  content: string | null;
  messageId?: string;
  error?: ReactProtocolError;
}

interface ReactSessionResult {
  stopReason: ReactStopReason;
  stepsCompleted: number;
  final: ReactFinalResult;
}
```

建议修改：

- `FinalReactProcess.run()` 从 `Promise<void>` 改为返回 `ReactFinalResult`；
- `PromptpileReactRuntime.finalAnswer()` 返回结果，不再是 `void`；
- Final 子进程失败不再静默视为正常完成；
- `runOneReactSession()` 统一决定 terminal event 与 process exit code；
- text/json/stream-json 模式必须收集完整 Final 正文；
- `terminal` 模式可继续实时显示，但也应在内部得到同一个 result。

当前 Final prompt 允许为空。第一版建议明确：

- `terminal` 兼容模式继续允许跳过；
- `text` 模式输出空字符串并以 `no_final_prompt` 结束；
- `json`/`stream-json` 返回 `result: null` 和 `stop_reason: no_final_prompt`；
- 是否将“没有 Final prompt”视为非零退出，在 Phase 0 冻结；初步建议保持成功，
  因为它是当前合法配置，而不是运行时故障；
- 不允许用最后一次 Thought 文本隐式冒充 Final，这会混淆内部动作与用户答案。

## 10. 子进程传输设计

### 10.1 独立继承 fd

机器模式不解析子进程普通 stdout。父进程为每次 `promptpile` 调用增加第四个
stdio entry：

```ts
const child = spawn(command, argv, {
  stdio: [stdinMode, 'pipe', 'pipe', 'pipe']
});
```

并向子进程追加：

```text
--quiet
--output-pile-fd 3
--output-pile-format json
```

父进程从 `child.stdio[3]` 增量读取 JSONL：

```jsonl
{"type":"assistant_delta","content":"..."}
{"type":"assistant_done"}
```

映射规则：

| Promptpile output-pile event | React 行为 |
| --- | --- |
| `assistant_delta` / Thought | 默认消费但不向外暴露正文 |
| `assistant_delta` / Observe | 收集供内部使用，不向外暴露正文 |
| `assistant_delta` / Check | 默认不暴露正文；decision 仍以 calls artifact 为准 |
| `assistant_delta` / Final | 输出 `assistant.delta` 并累积最终正文 |
| `assistant_done` | 完成当前 phase 的 stream half |
| `error` | 转换为 phase error；仍等待子进程 close 获取退出码 |

Observe/Check 当前仍依赖临时 `-o` 和 calls sidecar，这是确定性控制 artifacts；
第一版无需用流事件替换它们。output pile 负责低延迟正文传输，不负责证明阶段完整。

### 10.2 不直接透传底层事件

底层事件没有 React 所需的：

- session id；
- sequence；
- phase；
- step；
- turn lifecycle；
- stop reason；
- React error taxonomy。

因此 React 必须解析并重新编码，不能简单地把 fd 3 字节复制到父 stdout。

### 10.3 Invoker API 草案

```ts
interface PromptpileInvokeOptions {
  cwd?: string;
  quiet: boolean;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
  outputPile?: {
    fd: 3;
    format: 'json';
    onEvent(event: PromptpileOutputPileEvent): void | Promise<void>;
  };
}

interface PromptpileInvokeResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: NodeJS.ErrnoException;
  stderr: string;
  outputPileDone: boolean;
}
```

`stdout` 不应继续以“streaming path 永远为空”的含糊字段存在；可以明确拆成
terminal forwarding callback 与 machine output-pile callback。

### 10.4 JSONL decoder

decoder 必须：

- 跨 chunk 缓冲不完整行；
- 按 UTF-8 解码，不把多字节字符截断；
- 设置单行大小上限；
- EOF 时处理最后一行；
- 拒绝非法 JSON 和未知 schema 形状；
- 未收到 `assistant_done` 时把 phase 标记为 incomplete；
- 不允许解析错误只写 warning 后继续报告 session success。

## 11. Event writer 与 backpressure

新增独立模块，例如：

```text
packages/promptpile-react/src/react-event-writer.ts
packages/promptpile-react/src/react-event-protocol.ts
packages/promptpile-react/src/promptpile-output-pile-decoder.ts
```

Event writer 应串行化所有写入：

```ts
interface ReactEventWriter {
  emit(event: ReactEventInput): Promise<void>;
  complete(result: ReactSessionResult): Promise<void>;
  fail(error: ReactProtocolError): Promise<void>;
}
```

不能无条件调用 `process.stdout.write()` 并忽略返回值。writer 必须在返回 `false`
时等待 `drain`，从而将 consumer backpressure 传递到 phase reader。若 stdout 发生
`EPIPE`，应取消当前子进程树并以非零状态结束。

同一个 writer 负责分配 sequence 和 timestamp，避免各 phase 并发或未来新增事件时
产生重复 sequence。

## 12. Runtime 生命周期调整

当前 runtime 把 phase exception catch 后只设置 `stopReason = 'error'`，错误细节丢失。
建议保留结构化 failure：

```ts
interface ReactRuntimeFailure {
  phase: ReactPhase | 'startup';
  code: ReactErrorCode;
  message: string;
  cause?: unknown; // internal only; never blindly JSON.stringify to stdout
}

interface ReactRuntimeState {
  currentStep: number;
  stopReason: ReactRuntimeStopReason;
  failure?: ReactRuntimeFailure;
}
```

`nextStep()` 可以继续不向 CLI 抛出预期 phase error，但必须保存 failure；或者改为
返回 discriminated union。CLI 层不得仅依据 `stopReason === 'error'` 构造一个丢失
phase/code 的通用错误。

推荐顺序：

```text
parse CLI/config
→ create event writer/session id
→ session.started
→ turn.started
→ phase events for each nextStep
→ turn.completed
→ Final phase
→ assistant.completed
→ session.completed OR session.failed
→ flush writer
→ set exit code
```

## 13. 工具调用事件

常见 Agent CLI 会公开 tool lifecycle，但当前 Promptpile output pile v1 只包含正文
delta/done/error，tool calls 在模型流结束后聚合并写 calls artifact。因此本提案分阶段处理：

### v1

- 不伪造流式 tool argument event；
- Thought 的 `phase.completed` 可以携带非敏感的 `has_tool_calls`；
- 如果 Completion Receipt 或 artifact reference 已实现，可以携带 calls artifact 引用；
- 工具成功与否继续由 Tool Artifacts 和执行器契约定义。

### v1.x / v2

在底层 Promptpile output pile 扩展并冻结新事件后，React 可以映射：

```text
tool.started
tool.input.delta
tool.completed
tool.failed
```

tool result 可能包含 secret、大文件和任意非可信内容，默认事件应只包含 tool name、
call id、状态和受限摘要；完整内容仍由 artifacts 管理。

## 14. 安全与隐私

- 默认不输出 Thought/hidden reasoning 正文。
- `reasoning_content` 不进入 Agent Event Protocol v1。
- error message 不包含 API key、Authorization header 或完整 request body。
- 临时路径和绝对目录默认不进入公共事件；需要 artifact ref 时优先相对路径。
- Observe 内容只在进程内传给 Check，不默认发给外部 consumer。
- tool arguments/results 不因启用 stream-json 自动公开。
- debug 模式仍只能写 stderr 或受控 dump 文件，不能污染 stdout protocol。
- consumer 必须把 assistant、tool 和 error 内容视为非可信数据，而不是控制指令。

## 15. 与现有设计的关系

### 15.1 Promptpile Output Artifact Policy

本协议只属于 `promptpile-react` 的 Agent-facing 输出。它不要求核心 `promptpile`
把所有输出强制合并成一个事件流，也不改变以下分类：

- Conversation artifacts 是会话历史权威来源；
- `-o` 是调用者管理的普通结果 artifact；
- output pile 是允许截断的实时旁路；
- receipt 是完成 artifact 的索引；
- React event stream 是一次编排运行的实时观察与结果交付通道。

### 15.2 Completion Receipt

Receipt 与 event stream 互补：

- event stream 面向实时观察，可能因消费者断开而截断；
- receipt 在完成后原子写入，引用已落盘 artifacts；
- React terminal event 可以包含 receipt path/reference，但不能取代 receipt 的完成标记语义。

### 15.3 Layered Conversation I/O

分层输入不会改变 event envelope。事件中的 artifact ref 若引用 output layer，必须使用
Layered Conversation I/O 冻结后的唯一目录身份，不能只提供 basename。

### 15.4 CLI Contract

需要扩展 CLI Contract：

- 定义 React 的四种 output format；
- 定义 stdout/stderr 纯净性；
- 定义 JSONL terminal event 与 exit code 的一致性；
- 明确未知字段和 event type 的前向兼容规则。

## 16. 实施计划

### Phase 0：冻结协议

- 确认 `terminal` 兼容模式与未来默认值。
- 确认 no-final-prompt 的退出码语义。
- 冻结 v1 event names、必填字段、error code 和 JSON Schema。
- 确认 terminal result 是否复制完整 Final content。
- 确认 timestamp 是否必须，还是允许测试/嵌入场景关闭。

### Phase 1：内部结果模型

- 让 Final 返回 `ReactFinalResult`。
- 让 runtime 保留结构化 failure。
- 让 `runOneReactSession()` 返回 `ReactSessionResult`。
- 修正 Final soft failure 与 session success 的歧义。
- 保持 terminal 模式输出行为不变。

### Phase 2：`text` 与 `json`

- 增加 CLI/config output format。
- text 模式只写 Final content。
- json 模式写单个 result/failure envelope。
- 所有子进程在机器模式中使用 quiet，禁止原始 stdout 污染。
- 增加 stdout purity 与 exit code 测试。

### Phase 3：output-pile fd 传输

- 扩展 invoker stdio，增加 fd 3 pipe。
- 实现 JSONL 增量 decoder。
- 每个 phase 添加 output-pile CLI 参数。
- 保留 Observe/Check 的现有临时 artifacts。
- 验证 fd 优先级、关闭顺序和子进程异常路径。

### Phase 4：Agent Event Protocol v1

- 实现 session/turn/phase/assistant/error/terminal events。
- 实现 sequence、session id 和 RFC 3339 timestamp。
- 实现 stdout backpressure 与 EPIPE 取消。
- 增加 JSON Schema 和协议 fixtures。
- 更新 README、package docs、CLI Contract 和示例。

### Phase 5：生态集成

- 增加一个 `examples/promptpile-react-stream-json/` consumer。
- 验证 Node、Python 和 shell `jq` 消费。
- 评估与 Completion Receipt 的 artifact ref 集成。
- 底层 output pile 扩展稳定后再增加 tool lifecycle 和 usage。

## 17. 测试计划

### 17.1 协议测试

- 每行都是独立合法 JSON。
- `schema_version`、`session_id`、`sequence` 始终存在。
- sequence 从 0 严格递增，无重复和跳号。
- 未知可选字段不影响 consumer fixture。
- 每个 started phase 恰好对应 completed 或 fatal error。
- 每个已开始 session 恰好一个 terminal event。
- terminal event 后无其它事件。

### 17.2 输出隔离测试

- json/stream-json stdout 不出现子进程普通日志。
- stderr warning 不进入 stdout。
- quiet 不抑制 JSON/JSONL result。
- Observe/Check 正文默认不以 `assistant.delta` 暴露。
- Thought/reasoning 默认不暴露。

### 17.3 流边界测试

- 一个 JSONL event 被拆成多个 Node chunks。
- 多个 event 位于同一个 chunk。
- UTF-8 多字节字符跨 chunk。
- EOF 前最后一行没有换行。
- 非法 JSON、超长行和缺失 done。
- stdout backpressure 与 drain。
- consumer 提前关闭导致 EPIPE。

### 17.4 Runtime 测试

- Thought/Observe/Check/Final 分别非零退出。
- Check calls 缺失或 decision 非法。
- Final prompt 为空。
- Final 子进程失败。
- max-step、final、error、cancelled stop reason。
- SIGINT/SIGTERM 清理当前子进程树和临时文件。

### 17.5 兼容测试

- 未指定 output format 时 terminal 行为与现有版本一致。
- `PROMPTPILE_BIN`、package bin 和 PATH fallback 继续工作。
- `-i`、`-c`、quiet、debug 与各 output format 组合明确。
- Windows inherited fd 支持若不可移植，应在 Phase 0 验证并设计 named pipe/file fallback。

## 18. 验收标准

- `--output-format text` 的 stdout 只有最终回答。
- `--output-format json` 在运行失败时仍输出合法 failure JSON，并使用非零退出码。
- `--output-format stream-json` 可以在 Final 完成前收到正文 delta。
- stream-json 的调用方能只根据事件区分 session、phase、最终回答和失败。
- 非 quiet 与 debug 不会污染机器模式 stdout。
- Thought、Observe 和 Check 正文默认不会被当作用户最终消息输出。
- Final 失败不会产生 `session.completed`。
- 每个开始的 session 恰好有一个 terminal event。
- 慢 consumer 不会无界累积内存；断开的 consumer 会终止运行。
- 实现不导入 `promptpile/dist/*`，只使用公共 CLI/output-pile 契约。
- terminal 兼容模式的现有测试继续通过。

## 19. 待定项

- `terminal` 是否作为长期公开格式，还是仅作为 Beta 迁移别名。
- 无 Final prompt 是否算成功；初步建议成功但 `result: null`。
- `assistant.completed` 与 `session.completed` 是否都携带完整正文。
- 是否允许 `--output <path>` 保存最终 Agent result，以及它与核心 `-o` 的命名区分。
- usage 由各 phase 分别报告还是只给 session 聚合值。
- tool lifecycle 由 Promptpile output pile 扩展提供，还是从 receipt/artifacts 映射。
- Windows 上额外 fd 的兼容边界及 fallback。
- 取消时是否定义独立 `session.cancelled` terminal event，还是使用
  `session.failed` + `code=CANCELLED`；v1 初步建议后者以减少 terminal 类型。
- 是否为嵌入式调用公开 TypeScript `AsyncIterable<ReactEventV1>` API；建议在 CLI
  协议稳定后再提供，并让 CLI 与 API 共用同一个 event source。

## 20. 参考模式

本设计借鉴但不复制以下 Agent CLI 的边界：

- Codex 非交互模式：默认把进度写 stderr、最终回答写 stdout；`--json` 将 stdout
  变为包含 thread/turn/item/error 的 JSONL 事件流；
- Claude Code print mode：区分 `text`、`json`、`stream-json`，并以 terminal result
  message 提供最终结果和 session metadata。

Promptpile React 的差异是保留 file-native Conversation artifacts，并把核心
`promptpile` 作为独立 CLI 子进程。因此公共协议必须在 React 层重新建立 session、
step 和 phase 语义，不能直接等同于单次 LLM completion stream。
