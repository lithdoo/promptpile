# Promptpile React 结构化流式输出 Implementation Freeze 计划

> 状态：Implementation Freeze / 待实施  
> 日期：2026-08-12  
> 审计基线：`d6677207418b077d2a771acbbf41795d7736bd74`  
> 目标组件：`packages/promptpile-react`  
> 前置事实：React orchestration v1 已 Freeze；`promptpile` public CLI 与 output pile 是唯一 runtime integration boundary  
> 本文件用途：冻结 Streaming v1 的 ownership、public contract、transport、failure model、测试与 Freeze criteria；本文件完成不等于 Streaming 实现已经 Freeze

---

## 0. 最终架构结论

`promptpile-react` Streaming v1 不是新的 Agent runtime，也不是第二套状态机。

它的唯一职责是：

> **把已经 Freeze 的 React orchestration state machine 投影成一个非持久化、只读、实时、版本化的 public event stream。**

固定架构：

```text
promptpile-protocol
= 跨包纯数据 / parser / canonical contract

promptpile
= exactly one Chat Completions execution primitive
+ Conversation I/O
+ durable artifact publication
+ output pile transport

promptpile-react Frozen FSM
= orchestration domain truth
        │
        ▼
promptpile-react Agent Event Protocol v1
= observable projection / result delivery
        │
        ▼
stdout JSONL
```

核心定理：

```text
event does not create domain state
event only projects already-defined domain facts
```

因此：

```text
session.completed
不能把一次失败 session 变成成功

session.failed
不能创造一个 React runtime 原本不存在的 terminal reason
```

React Streaming v1 不得反向修改已经 Freeze 的 orchestration ownership。

---

## 1. Frozen React baseline

本计划只能投影以下已经 Freeze 的 runtime model：

```text
iteration = Thought → Observe → Check

runtime state = running | final | max_step | error
```

固定语义：

- `currentStep` 是已经成功完成的完整 iteration 数量；
- `Check=false`：当前 iteration 成功完成，然后进入 `final`；
- `Check=true` 且达到 `maxStep`：当前 iteration 成功完成，然后进入 `max_step`；
- `Thought` / `Observe` / `Check` 任一失败：立即进入 `error`，不得执行 Final；
- `final|max_step` 后，Final prompt 非空时 Final 是 required phase；
- required Final 失败：进程失败；
- Final prompt 为空：明确 skip，session 仍可以成功；
- 成功进程的 orchestration terminal state 只能是 `final|max_step`；
- `-i` 是一次 append + 一次 session + exit，不是进程内 multi-turn session。

Streaming v1 不得重新引入：

```text
cancelled
no_final_prompt
turn state
Final soft failure
process-level interactive loop
```

如果未来需要这些能力，必须先修改 React orchestration contract，再决定是否新增 event projection。

---

## 2. Ownership

### 2.1 React runtime owns

- phase order；
- `currentStep` / `maxStep`；
- Check continue decision；
- `final|max_step|error` terminal cause；
- Final configured / skipped / required；
- structured phase failure metadata；
- Agent Event Protocol v1；
- stdout/stderr ownership；
- event sequence；
- session id；
- parent event writer 与 Final output-pile decoder。

### 2.2 Promptpile owns

- Chat Completions request / SSE；
- completion success/failure；
- Conversation I/O / allocator / OCC；
- durable output publication；
- Receipt；
- output pile writer；
- Promptpile CLI exit code；
- Promptpile artifact semantics。

### 2.3 Protocol package owns

仅继续拥有已经 admission 的跨包 public contracts。

Agent Event Protocol v1 **不进入 `promptpile-protocol`**。当前只有 `promptpile-react` 拥有 session / step / phase / Final orchestration semantics，因此 event schema 由 `promptpile-react` package 自己 version。

只有出现真实第二个独立 producer/consumer，并且该 contract 确实成为跨包 normative protocol 后，才重新评估 protocol admission。

---

## 3. v1 scope

Streaming v1 只新增：

```text
--output-format terminal
--output-format stream-json
```

其中：

```text
terminal
= 现有人工可观察输出模式

stream-json
= Agent Event Protocol v1 JSONL machine contract
```

默认值固定为：

```text
terminal
```

v1 不切换默认值。

`-q/--quiet` 继续只是人工诊断 policy，不是 transport switch；它不得抑制 `stream-json` protocol events。

---

## 4. Explicit non-goals / Post-Freeze candidates

以下全部不进入 Streaming v1：

- `--output-format text`；
- `--output-format json`；
- `--include-internal-events`；
- process-level multi-turn input；
- `turn.started` / `turn.completed`；
- `session.cancelled`；
- `no_final_prompt` stop reason；
- `message_id`；
- generic `assistant.*` message lifecycle；
- Thought / Observe / Check 正文公开；
- hidden reasoning / `reasoning_content`；
- tool argument delta；
- tool lifecycle events；
- usage events；
- retry events；
- durable event log；
- replay / resume / exactly-once delivery；
- websocket / RPC server；
- public `AsyncIterable<ReactEventV1>` JavaScript API；
- output file result contract；
- named-pipe / temp-file transport fallback。

这些能力未来只能作为 additive proposal 单独进入设计，不得在 v1 实现过程中顺手加入。

---

## 5. Public CLI contract

新增：

```text
--output-format <terminal|stream-json>
```

固定规则：

```text
missing option → terminal
terminal       → current human-facing behavior
stream-json    → stdout is protocol-only JSONL
other value    → CLI validation failure
```

CLI option / config parsing失败发生在 protocol writer 建立之前时：

```text
stderr diagnostic
+ non-zero exit
+ zero protocol events
```

这不是 `session.failed`，因为 session protocol 尚未开始。

v1 不新增 TOML `output_format` 字段。output format 先保持 CLI invocation concern，避免配置文件把展示/transport policy 固化成 orchestration domain state。若未来存在真实持久化需求，再单独 admission。

---

## 6. stdout / stderr ownership

### 6.1 `terminal`

保持现有行为，不因为 Streaming 实现重写人工 CLI contract。

### 6.2 `stream-json`

父进程 stdout 必须满足：

```text
stdout = Agent Event Protocol v1 JSONL only
```

禁止进入 parent stdout：

- React debug log；
- Promptpile child 原始 stdout；
- Promptpile child stderr；
- Node stack trace；
- tool call raw JSON；
- Observe / Check 临时结果；
- Thought 正文；
- 未包装文本。

child stdout 在 machine mode 中必须被 drain/capture，但**永远不得 forward 到 parent stdout**。

child stderr：

- 可按现有 quiet/debug policy 写入 parent stderr；
- 可以继续保留 capped tail 供错误诊断；
- machine consumer 不得依赖 stderr 自然语言判断 domain result。

固定定理：

```text
quiet ≠ machine transport
quiet only changes human diagnostics
```

---

## 7. Protocol start boundary

Agent Event Protocol 正式开始的唯一 witness 是：

```text
session.started successfully written
```

在此之前失败：

```text
no protocol obligation
→ stderr
→ exit non-zero
```

在此之后，如果 output channel 仍可写：

```text
domain success
→ exactly one session.completed

domain failure
→ exactly one session.failed
```

terminal event 发布后不得再发布其它 protocol event。

---

## 8. Agent Event Protocol v1 envelope

所有 v1 events 固定包含：

```ts
interface ReactEventBaseV1 {
  schema_version: 1;
  type: string;
  session_id: string;
  sequence: number;
}
```

### 8.1 `session_id`

- 每次 `promptpile-react` process invocation 生成一个新的 opaque non-empty id；
- v1 不冻结具体 UUID/ULID 文本 grammar；
- consumer 只能比较 equality，不得解析结构；
- producer 必须保证同一 process invocation 内稳定不变，并以足以避免现实碰撞的随机来源生成。

### 8.2 `sequence`

- 第一条成功写出的 event 为 `0`；
- 后续成功写出的 event 每次 `+1`；
- 同一 session 中严格递增且连续；
- sequence 是唯一 normative event ordering；
- v1 不包含 mandatory timestamp / duration。

删除 timestamp 的原因是：wall-clock 不是 orchestration truth，且会增加 deterministic fixture、clock semantics 和 consumer interpretation burden。

### 8.3 Forward compatibility

- consumer MUST ignore unknown fields；
- producer MAY 在 v1 event object 中新增 optional fields，但不得改变已有字段语义；
- producer MAY 在未来 v1.x 增加新的 non-terminal event type；consumer SHOULD ignore unknown non-terminal types；
- v1 terminal event set 是 closed set：`session.completed | session.failed`；
- 新增或改变 terminal event type、破坏字段语义、改变 terminal semantics 必须提升 `schema_version`。

---

## 9. v1 exact event set

Streaming v1 只冻结 6 个 event types：

```text
session.started
phase.started
phase.completed
final.delta
session.completed
session.failed
```

不再同时维护 `turn.*`、`assistant.completed`、generic `error` 等重复状态表达。

---

## 10. `session.started`

形状：

```json
{
  "schema_version": 1,
  "type": "session.started",
  "session_id": "react_opaque",
  "sequence": 0,
  "max_steps": 3
}
```

固定字段：

- `max_steps`: 本次运行解析后的正整数 `maxStep`。

不包含：

- cwd；
- config absolute path；
- API/provider secrets；
- output format（事件本身已经证明是 stream-json）；
- timestamp。

---

## 11. Phase model

Public phase 只有：

```ts
type ReactPhaseV1 = 'thought' | 'observe' | 'check' | 'final';
```

Thought / Observe / Check 属于 iteration。

Final 不属于新的 iteration。

### 11.1 `step_index`

Thought / Observe / Check 使用：

```text
step_index = phase 开始时已经完成的 iteration 数量
```

第一轮为 `0`。

只有成功完成 Check 后，runtime 才把 `steps_completed` 增加 1。

### 11.2 Final

Final event 不携带 `step_index`，而携带：

```text
steps_completed
```

这样不会把 Final 伪装成下一轮 ReAct iteration。

---

## 12. `phase.started`

Thought / Observe / Check：

```json
{
  "schema_version": 1,
  "type": "phase.started",
  "session_id": "react_opaque",
  "sequence": 1,
  "phase": "thought",
  "step_index": 0
}
```

Final：

```json
{
  "schema_version": 1,
  "type": "phase.started",
  "session_id": "react_opaque",
  "sequence": 7,
  "phase": "final",
  "steps_completed": 1
}
```

`phase.started` 的语义是：React 已经完成该 phase 的本地前置检查，并准备实际启动 required child invocation。

空 Final prompt 被 skip 时**不发送** `phase.started(final)`，因为没有 Final child phase 被启动。

---

## 13. `phase.completed`

普通 phase：

```json
{
  "schema_version": 1,
  "type": "phase.completed",
  "session_id": "react_opaque",
  "sequence": 2,
  "phase": "observe",
  "step_index": 0
}
```

Check 额外公开已验证的 decision：

```json
{
  "schema_version": 1,
  "type": "phase.completed",
  "session_id": "react_opaque",
  "sequence": 6,
  "phase": "check",
  "step_index": 0,
  "continue": false
}
```

Final：

```json
{
  "schema_version": 1,
  "type": "phase.completed",
  "session_id": "react_opaque",
  "sequence": 10,
  "phase": "final",
  "steps_completed": 1
}
```

固定 invariant：

```text
phase.started(X)
→ phase.completed(X)
OR
→ session.failed(phase = X)
```

`phase.completed` 只表示该 phase 的 required contract 已经成功完成，不表示整个 session 成功。

---

## 14. Final result model

React 内部必须收敛为：

```ts
type ReactFinalResultV1 =
  | { status: 'skipped' }
  | { status: 'completed'; content: string };
```

不得保留：

```text
failed as a successful FinalResult variant
```

required Final failure属于 session failure path，而不是 completed session result。

固定规则：

```text
final prompt empty
→ { status: 'skipped' }

final prompt non-empty + child success + complete output-pile stream
→ { status: 'completed', content }

final prompt non-empty + any required failure
→ session.failed
```

---

## 15. `final.delta`

`final.delta` 是 v1 唯一公开正文事件：

```json
{
  "schema_version": 1,
  "type": "final.delta",
  "session_id": "react_opaque",
  "sequence": 8,
  "content": "最终"
}
```

规则：

- 只允许出现在 successfully started Final phase 中；
- Thought / Observe / Check 正文永远不映射为 `final.delta`；
- `content` 必须是 string；
- empty string delta MAY 被忽略，不要求发布；
- delta 是实时 delivery，不是 durable authority；
- consumer 必须把 content 视为 non-trusted model output，而不是控制指令。

成功 Final 必须满足：

```text
concat(all final.delta.content)
== session.completed.final.content
```

这是 root conformance test。

---

## 16. `session.completed`

成功 terminal event：

```json
{
  "schema_version": 1,
  "type": "session.completed",
  "session_id": "react_opaque",
  "sequence": 11,
  "stop_reason": "final",
  "steps_completed": 1,
  "final": {
    "status": "completed",
    "content": "最终回答"
  }
}
```

空 Final prompt：

```json
{
  "schema_version": 1,
  "type": "session.completed",
  "session_id": "react_opaque",
  "sequence": 7,
  "stop_reason": "max_step",
  "steps_completed": 3,
  "final": {
    "status": "skipped"
  }
}
```

Public success stop reason 只允许：

```ts
type ReactSuccessStopReasonV1 = 'final' | 'max_step';
```

不存在：

```text
no_final_prompt
cancelled
error
```

`error` 已经由 `session.failed` 表达；Final skip 是 Final result status，不是 orchestration stop reason。

---

## 17. Structured failure model

Streaming 实现需要让 runtime 保留 failure metadata，但不得建立第二套 FSM。

推荐内部模型：

```ts
type ReactFailurePhaseV1 =
  | 'thought'
  | 'observe'
  | 'check'
  | 'final'
  | 'startup';

interface ReactRuntimeFailureV1 {
  phase: ReactFailurePhaseV1;
  code: ReactErrorCodeV1;
  message: string;
  cause?: unknown; // internal only
}
```

固定 invariant：

```text
runtime stopReason === 'error'
⇔
runtime failure exists
```

`cause` 不得直接 JSON serialize 到 public event。

---

## 18. v1 error codes

冻结最小 package-local taxonomy：

```ts
type ReactErrorCodeV1 =
  | 'promptpile_spawn_failed'
  | 'promptpile_exit_nonzero'
  | 'phase_output_missing'
  | 'check_decision_invalid'
  | 'final_stream_invalid'
  | 'internal_error';
```

语义：

- `promptpile_spawn_failed`：required child 无法启动；
- `promptpile_exit_nonzero`：required child 已启动但没有成功退出；
- `phase_output_missing`：Observe/Check 等 required artifact/output 缺失或不可读；
- `check_decision_invalid`：Check required ToolCall 不存在或 boolean decision contract 非法；
- `final_stream_invalid`：Final output-pile JSONL malformed / incomplete / error event / protocol violation；
- `internal_error`：无法映射到前述 contract failure 的 React 内部故障。

错误码是机器 contract；`message` 是有限、人类可读诊断，不得包含 secret、Authorization、完整 request body 或 hidden reasoning。

未来新增 error code 可以 additive；改变既有 code 语义是 breaking change。

---

## 19. `session.failed`

只要 protocol 已经开始、domain failure 已确定、parent stdout 仍可写，就发送唯一 failure terminal：

```json
{
  "schema_version": 1,
  "type": "session.failed",
  "session_id": "react_opaque",
  "sequence": 6,
  "phase": "check",
  "steps_completed": 0,
  "error": {
    "code": "check_decision_invalid",
    "message": "react_check_decision output was invalid"
  }
}
```

固定规则：

```text
session.failed
⇒ session.completed never appeared
⇒ no Final starts after Thought/Observe/Check failure
⇒ process exit non-zero
```

v1 不发送额外 generic `error` event，因为当前 runtime 没有 public recoverable-error state。一个 fatal domain failure 只需要一个 terminal witness。

---

## 20. Terminal theorem 与 transport exception

### 20.1 Writable output channel

如果：

```text
session.started successfully written
AND
parent output channel remains writable
```

则必须：

```text
exactly one terminal event
= session.completed XOR session.failed

terminal event is the final event
```

### 20.2 Parent stdout failure

如果 parent stdout 在 session 中途发生 `EPIPE` / stream failure：

```text
terminal delivery is no longer guaranteed
```

实现必须：

```text
stop emitting events
→ stop accepting further Final deltas
→ destroy/stop Final transport reader
→ best-effort terminate active Promptpile child
→ wait/cleanup as practical
→ exit non-zero
```

不得：

- 假装已经发送 `session.failed`；
- 把 domain success 写到 stderr 当成 protocol success；
- exit 0。

因此精确 contract 是：

```text
output transport failure
⇒ no success claim
⇒ non-zero exit
```

而不是物理上无法保证的“任何情况下都恰好收到 terminal event”。

---

## 21. Promptpile child transport ownership

### 21.1 v1 only streams Final

Thought / Observe / Check 继续走 Frozen orchestration 已经存在的结果通道：

```text
Thought
→ child exit / Conversation effects

Observe
→ required temporary -o artifact

Check
→ required calls artifact + protocol parser
```

Streaming v1 **不为前三个 phase 打开 output pile**。

只有 Final 需要低延迟正文：

```text
Final
→ Promptpile output pile fd 3 JSONL
→ React decoder
→ final.delta
```

这避免把三个内部控制 phase 都暴露给新的 streaming transport failure surface。

### 21.2 Final child argv

machine mode 中 Final child 固定追加等价参数：

```text
--output-pile-fd 3
--output-pile-format json
```

是否同时向 child 传 `--quiet` 只能影响 child 自身诊断 verbosity；parent machine stdout purity 不得依赖它。

---

## 22. Final fd3 transport contract

Parent spawn Final 时使用额外 pipe：

```ts
stdio: [stdinMode, 'pipe', 'pipe', 'pipe']
```

`child.stdio[3]` 是 private transport，不是 public Agent Event Protocol。

当前 Promptpile output pile JSONL vocabulary：

```jsonl
{"type":"assistant_delta","content":"..."}
{"type":"assistant_done"}
{"type":"error","message":"..."}
```

映射固定为：

```text
assistant_delta
→ final.delta
→ append content to Final accumulator

assistant_done
→ mark transport stream complete

error
→ mark Final stream failure
→ still wait child close
→ session.failed if parent output remains writable
```

不得把 child JSONL 原样 byte-forward 到 parent stdout。

---

## 23. Final dual-witness success

`assistant_done` 只是 transport witness，不是 Promptpile domain success。

Final 成功必须同时满足：

```text
output-pile stream is valid
AND
exactly one assistant_done observed
AND
no output-pile error event observed
AND
Promptpile child exit code == 0
```

因此：

```text
assistant_done + child non-zero
→ Final failure

child exit 0 + missing assistant_done
→ final_stream_invalid

malformed stream + child exit 0
→ final_stream_invalid
```

只有双 witness 成立后：

```text
phase.completed(final)
→ session.completed
```

这保留 Promptpile 对 completion lifecycle 的 ownership，同时让 React 能证明机器输出正文完整。

---

## 24. JSONL decoder contract

Final private decoder 必须：

- 使用 streaming UTF-8 decoder，允许多字节字符跨 Node chunk；
- 跨 chunk 缓存 partial line；
- 支持多个 JSONL lines 位于同一 chunk；
- EOF 时允许最后一行无 trailing newline；
- 每个 transport line 设置 `1 MiB` UTF-8 byte hard limit；
- 超限立即标记 `final_stream_invalid`；
- object 之外 JSON value 非法；
- `assistant_delta.content` 必须为 string；
- `assistant_done` 必须恰好一次；
- duplicate done 非法；
- done 之后出现任何 delta / done / error 非法；
- unknown event type 非法；
- malformed JSON 非法；
- EOF 前没有 done 非法；
- `error` event 使 Final 必然失败，即使之后 child exit 0。

Decoder failure 后仍必须 drain/close child channels enough to avoid zombie process，并最终等待 child close；但不得再发布新的 `final.delta`。

---

## 25. Backpressure guarantee boundary

React event writer 必须串行写 parent stdout，不能 fire-and-forget `process.stdout.write()`。

最低实现要求：

```text
serialize one complete JSON object + "\n"
→ write
→ respect write callback / drain boundary
→ only then publish next event
```

Final fd3 reader在等待 parent event write 时必须停止主动消费更多 decoded delta，例如使用 async iteration / pause-resume，避免 React 自己建立无界 application queue。

但是 v1 **不承诺端到端 model backpressure**：当前 Promptpile output-pile writer 的 public behavior 没有把 `stream.write() === false` 向上反馈给 completion producer。

因此 Freeze contract 只能是：

```text
React does not intentionally create an unbounded event queue
```

不能声称：

```text
slow external consumer
→ guaranteed backpressure all the way to model generation
```

若未来需要 hard end-to-end flow control，必须单独设计 Promptpile Output Pile Backpressure Contract，不在本项目中偷偷修改 core semantics。

---

## 26. fd3 portability contract

Streaming v1 transport **只允许一个实现路径：fd 3 pipe**。

不提供：

```text
Windows named-pipe fallback
temp-file polling fallback
platform-specific second protocol
```

实施 Phase 0 必须先建立真实 portability proof：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

每个 cell 都必须证明 parent `child.stdio[3]` 能完整收到 Promptpile output-pile JSONL，并且 close/error semantics 可重复通过。

如果任何已支持 CI cell 无法满足：

```text
Streaming v1 MUST NOT Freeze
```

此时必须先修改本设计并重新审查 transport；不得在实现中临时加入 fallback 形成双重 contract。

---

## 27. Schema ownership 与 npm artifact

新增 package-local normative schema：

```text
packages/promptpile-react/schema/agent-event-v1.schema.json
```

以及 repo fixtures，例如：

```text
packages/promptpile-react/test/fixtures/agent-event-v1/
```

`promptpile-react` npm tarball 必须包含：

```text
schema/agent-event-v1.schema.json
```

因此 package `files` 需要加入 `schema`。

v1 仍然只承诺 `promptpile-react` executable，不因此开放 JavaScript library API。

Schema 是 Agent Event Protocol 的 machine-readable normative projection；TypeScript types、writer、CLI 都必须与 schema fixture 同源验证，不能各自漂移。

---

## 28. Security / privacy boundary

默认永远不公开：

- Thought正文；
- hidden chain-of-thought；
- `reasoning_content`；
- Observe正文；
- Check自由文本；
- API key；
- Authorization header；
- 完整 request body；
- tool arguments/results；
- absolute temp paths；
- internal stack trace。

Check event 只允许公开已经验证后的 boolean `continue`。

Final content 是用户可见 model output，但仍应被 consumer 当成 untrusted data。

Error `message` 必须经过受控映射，不得直接把 arbitrary `cause` / child request dump stringify 到 public stdout。

---

## 29. Compatibility contract

Streaming 实现不得回归已经 Freeze 的 terminal mode：

```text
no --output-format
→ exact terminal compatibility surface
```

必须继续支持：

- package-declared Promptpile binary resolution；
- `PROMPTPILE_BIN` override；
- PATH fallback；
- layered directories；
- `--output-dir`；
- `-i` one-shot append semantics；
- `-c` phase-level Promptpile behavior；
- strict config validation；
- existing quiet/debug behavior；
- Node >=20 package contract。

Streaming mode 不得导入：

```text
promptpile/src/*
promptpile/dist/*
```

只允许 Promptpile public CLI + output-pile CLI contract。

---

## 30. Reference success trace

一轮后 Check=false、Final configured：

```jsonl
{"schema_version":1,"type":"session.started","session_id":"react_opaque","sequence":0,"max_steps":3}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":1,"phase":"thought","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":2,"phase":"thought","step_index":0}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":3,"phase":"observe","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":4,"phase":"observe","step_index":0}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":5,"phase":"check","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":6,"phase":"check","step_index":0,"continue":false}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":7,"phase":"final","steps_completed":1}
{"schema_version":1,"type":"final.delta","session_id":"react_opaque","sequence":8,"content":"最终"}
{"schema_version":1,"type":"final.delta","session_id":"react_opaque","sequence":9,"content":"回答"}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":10,"phase":"final","steps_completed":1}
{"schema_version":1,"type":"session.completed","session_id":"react_opaque","sequence":11,"stop_reason":"final","steps_completed":1,"final":{"status":"completed","content":"最终回答"}}
```

注意：没有 `turn.*`、`assistant.completed`、generic `error`、timestamp 或 message id。

---

## 31. Reference skip trace

达到 max step，Final prompt 为空：

```jsonl
{"schema_version":1,"type":"session.started","session_id":"react_opaque","sequence":0,"max_steps":1}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":1,"phase":"thought","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":2,"phase":"thought","step_index":0}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":3,"phase":"observe","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":4,"phase":"observe","step_index":0}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":5,"phase":"check","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":6,"phase":"check","step_index":0,"continue":true}
{"schema_version":1,"type":"session.completed","session_id":"react_opaque","sequence":7,"stop_reason":"max_step","steps_completed":1,"final":{"status":"skipped"}}
```

Final skip 不创造新的 stop reason，也不伪造一个 Final phase。

---

## 32. Reference failure trace

Check decision invalid：

```jsonl
{"schema_version":1,"type":"session.started","session_id":"react_opaque","sequence":0,"max_steps":3}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":1,"phase":"thought","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":2,"phase":"thought","step_index":0}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":3,"phase":"observe","step_index":0}
{"schema_version":1,"type":"phase.completed","session_id":"react_opaque","sequence":4,"phase":"observe","step_index":0}
{"schema_version":1,"type":"phase.started","session_id":"react_opaque","sequence":5,"phase":"check","step_index":0}
{"schema_version":1,"type":"session.failed","session_id":"react_opaque","sequence":6,"phase":"check","steps_completed":0,"error":{"code":"check_decision_invalid","message":"react_check_decision output was invalid"}}
```

随后：

```text
no Final
no session.completed
exit non-zero
```

---

## 33. Implementation phases

### Phase 0 — Transport proof + schema freeze

只做：

- fd3 Node20/22 × Ubuntu/Windows real Promptpile portability test；
- freeze exact event vocabulary；
- add package-local JSON Schema；
- add valid/invalid fixtures；
- add architecture guard：streaming types/schema 不进入 `promptpile-protocol`；
- 不接入 production runtime。

Gate：4/4 transport cells + schema fixtures green。

### Phase 1 — Event writer

新增类似：

```text
src/react-event-protocol.ts
src/react-event-writer.ts
```

实现：

- session id；
- sequence ownership；
- complete JSONL line write；
- serialized writes；
- stdout backpressure boundary；
- terminal uniqueness；
- EPIPE/output failure state。

此阶段仍不启动 Promptpile streaming。

### Phase 2 — Runtime observation seam

在不改 Frozen transition graph 的前提下增加：

- structured failure metadata；
- phase start/complete observation seam；
- Final result `completed|skipped`；
- `runOneReactSession()` 可返回统一 internal result。

Gate：terminal mode所有旧测试继续通过。

### Phase 3 — Final-only output-pile transport

扩展 invoker：

- machine mode child stdout 不 forward；
- Final 额外 fd3；
- JSONL decoder；
- Final accumulator；
- `assistant_done + exit0` dual witness；
- malformed/incomplete stream fail-closed。

Thought/Observe/Check 不接 output pile。

### Phase 4 — `stream-json` CLI

接通：

```text
session.started
phase.started/completed
final.delta
session.completed/session.failed
```

实现：

- stdout purity；
- quiet independence；
- output failure non-zero exit；
- active Final child best-effort termination。

### Phase 5 — Root E2E / packed artifact

增加真实 `promptpile` child E2E：

- package bin resolution；
- npm pack fresh install；
- schema included in tarball；
- Node20/22 × Ubuntu/Windows；
- terminal compatibility；
- machine stdout purity。

### Phase 6 — Freeze

只有全部 acceptance criteria 与 dedicated CI 当前 HEAD green 后：

```text
status
Implementation Freeze / 待实施
→ Implemented / CI validation
→ Agent Event Protocol v1 Freeze
```

文档状态不得只因为代码“看起来完成”就标记 Freeze。

---

## 34. Required test matrix

至少包含：

1. normal Check=false + Final success；
2. normal max_step + Final success；
3. empty Final prompt → skipped success；
4. Thought spawn failure；
5. Thought non-zero；
6. Observe non-zero；
7. Observe required output missing；
8. Check non-zero；
9. Check calls missing；
10. Check decision malformed；
11. Final spawn failure；
12. Final partial deltas + child non-zero；
13. Final done + child non-zero；
14. Final child exit0 + missing done；
15. malformed fd3 JSON；
16. unknown fd3 event；
17. duplicate assistant_done；
18. delta after done；
19. output-pile error event；
20. one transport event split across chunks；
21. multiple transport events in one chunk；
22. UTF-8 multibyte split across chunks；
23. final line without newline；
24. transport line > 1 MiB；
25. child stdout noisy but parent machine stdout pure；
26. child stderr never enters parent stdout；
27. `-q` does not suppress protocol events；
28. sequence exactly `0..N`；
29. one terminal event only；
30. no event after terminal；
31. `session.failed` excludes `session.completed`；
32. Thought/Observe/Check failure never starts Final；
33. `concat(final.delta.content) == session.completed.final.content`；
34. Final skipped produces no Final phase/delta；
35. stdout EPIPE → non-zero, no success claim；
36. terminal mode behavior regression guard；
37. CLI parse failure before protocol start → no events；
38. schema validates every golden event；
39. schema rejects invalid terminal/result combinations；
40. packed npm artifact includes schema；
41. fresh install can run `promptpile-react --output-format stream-json` fixture；
42. Node20/22 × Ubuntu/Windows fd3 transport matrix。

---

## 35. Failure matrix

| Failure | Protocol started? | Final allowed? | Terminal when stdout writable | Exit |
| --- | --- | --- | --- | --- |
| invalid CLI option | no | no | none | non-zero |
| invalid config | no | no | none | non-zero |
| input append failure before session | no | no | none | non-zero |
| Thought failure | yes | no | `session.failed` | non-zero |
| Observe failure | yes | no | `session.failed` | non-zero |
| Check failure | yes | no | `session.failed` | non-zero |
| invalid Check decision | yes | no | `session.failed` | non-zero |
| Final skipped | yes | n/a | `session.completed` | 0 |
| Final child non-zero | yes | already started | `session.failed` | non-zero |
| Final stream malformed/incomplete | yes | already started | `session.failed` | non-zero |
| parent stdout EPIPE | maybe | stop work | terminal not guaranteed | non-zero |
| internal unexpected error after start | yes | no further required work | `session.failed` if writable | non-zero |

---

## 36. Acceptance checklist

实现可以进入 Freeze review 前，必须全部满足：

- [ ] React Frozen FSM 没有新增 state / transition；
- [ ] v1 public output mode 只有 `terminal|stream-json`；
- [ ] 默认仍为 `terminal`；
- [ ] Agent Event Protocol v1 只有 6 个 event types；
- [ ] public success reason 只有 `final|max_step`；
- [ ] Final result 只有 `completed|skipped`；
- [ ] no `turn` / `cancelled` / `no_final_prompt` / `message_id`；
- [ ] Thought/Observe/Check 正文不公开；
- [ ] required Final 使用 fd3 private output-pile transport；
- [ ] Thought/Observe/Check 不启用 output pile；
- [ ] Final success 需要 done + child exit0 双 witness；
- [ ] malformed/incomplete Final stream fail-closed；
- [ ] child stdout 永不污染 machine stdout；
- [ ] `-q` 不影响 machine events；
- [ ] sequence contiguous；
- [ ] terminal unique and last when channel writable；
- [ ] EPIPE 不假装 terminal success；
- [ ] schema package-local；
- [ ] npm tarball 包含 schema；
- [ ] no `promptpile/src/*` / `dist/*` import；
- [ ] existing terminal compatibility tests green；
- [ ] real child E2E green；
- [ ] packed fresh-install smoke green；
- [ ] Node20/22 × Ubuntu/Windows dedicated Streaming CI green。

---

## 37. Freeze criteria

### 37.1 Architecture Freeze

本文完成后冻结以下设计：

```text
Frozen React FSM
        ↓
minimal observable projection
        ↓
6-event Agent Event Protocol v1
        ↓
Final-only Promptpile fd3 transport
        ↓
one terminal witness
```

实施过程中如果需要增加第二种 transport、第二套 runtime state、第三种 output result contract，视为 architecture regression，必须先回到文档重新审查。

### 37.2 Implementation Freeze

只有当前 HEAD 同时满足：

```text
unit tests
+ schema fixtures
+ terminal compatibility
+ real Promptpile E2E
+ fd3 portability
+ packed npm smoke
+ Node20/22 × Ubuntu/Windows dedicated CI
```

才能把状态改为：

```text
Agent Event Protocol v1 Freeze
```

历史 green run 不替代当前 HEAD 的 executable witness。

---

## 38. Closure theorems

### Projection theorem

```text
React event stream
⇒ only projects Frozen React orchestration facts
⇒ never creates new orchestration states
```

### Success theorem

```text
stream-json exit 0
⇒ session.started was successfully emitted
⇒ React reached final|max_step
⇒ every required Thought/Observe/Check invocation succeeded
⇒ configured Final succeeded with valid output-pile done + child exit0
   OR Final was explicitly skipped
⇒ exactly one session.completed was successfully emitted
⇒ session.completed was the final event
```

### Failure theorem

```text
domain failure after protocol start
+ parent output channel remains writable
⇒ exactly one session.failed
⇒ no session.completed
⇒ no Final after Thought/Observe/Check failure
⇒ exit non-zero
```

### Final consistency theorem

```text
session.completed.final.status == completed
⇒ concat(final.delta.content)
   == session.completed.final.content
```

### Transport failure theorem

```text
parent output channel failure
⇒ terminal delivery may be incomplete
⇒ no success claim
⇒ exit non-zero
```

### Ownership theorem

```text
Promptpile success/failure
仍由 Promptpile public CLI lifecycle 决定

React Streaming
只消费 child public transport
并投影 orchestration result
不重新实现 completion/runtime ownership
```

满足以上定理并由当前 HEAD 的 executable evidence 证明后，Streaming v1 才算真正形成优雅闭环。