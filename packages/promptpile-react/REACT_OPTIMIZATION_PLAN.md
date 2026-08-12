# Promptpile React 编排优化与 Pre-Streaming Freeze 实施计划

> 状态：v1 orchestration 已实施 / Freeze 完成
> 日期：2026-08-12  
> 审计基线：`4d4f7f8477936c94d183e674b3c2f643f28f0f62`  
> 目标组件：`packages/promptpile-react`  
> 前置依赖：已收口的 `promptpile` single-completion runtime、`promptpile-protocol` public contracts  
> 后续工作：本计划 Freeze 完成后，重新审查根目录 `REACT_STREAMING_OUTPUT_PLAN.md`，再决定最小 Agent Event Protocol 是否值得实施。

---

## 0. 最终架构结论

`promptpile-react` v1 的目标不是扩展成通用 Agent 平台，而是成为一个**薄的、确定性的 ReAct orchestration state machine**。

仓库层次必须保持：

```text
promptpile-protocol
= 跨包纯数据 / parser / canonical contract

promptpile
= exactly one Chat Completions execution primitive
+ Conversation I/O boundary
+ durable artifact publication
+ OCC / hook / Receipt terminal witness

promptpile-react
= orchestration state machine
+ phase policy
+ prompt injection policy
+ promptpile public CLI invocation
```

核心 ownership 定理：

```text
React 决定：下一阶段是什么、是否继续、何时结束
Promptpile 决定：一次 completion 如何正确执行并形成 durable success/failure
Protocol 决定：跨包 public data 如何解析
```

`promptpile-react` 不得重新拥有：

- Chat Completions request construction；
- SSE / stream terminal 判定；
- Conversation scanner / allocator / OCC；
- atomic artifact publication；
- Completion Receipt builder / commit；
- LLM profile 内容解析；
- Promptpile 私有 `src/*` / `dist/*` 模块；
- Compression / Fork / Archive lifecycle；
- 通用 tool execution runtime；
- retry scheduler / workflow engine；
- 常驻 RPC server；
- Agent Event Protocol 的提前实现。

本轮不是功能升级，而是**删除双重语义、封闭错误状态、缩小 public surface、建立可执行 Freeze 证据**。

---

## 1. 为什么必须先优化，再实现 Streaming Output

根目录 `REACT_STREAMING_OUTPUT_PLAN.md` 计划新增：

```text
text
json
stream-json
session_id
sequence
phase lifecycle
terminal events
Agent Event Protocol v1
```

这些都属于长期 public contract。

如果当前内部 orchestration 仍存在：

```text
error 后仍跑 Final
Final 配置后失败仍可能成功退出
Infinity 但实际只执行一轮
running 状态可以随进程结束
-c 同时承担两个不同层次的 continue 语义
配置 coercion 与 Promptpile strict contract 不一致
```

那么先实现事件协议会造成：

```text
不稳定内部状态机
        ↓
被投影成 public event contract
        ↓
为了兼容 event contract 被迫保留旧状态
```

正确顺序固定为：

```text
Promptpile core Freeze
        ↓
React orchestration simplification
        ↓
React FSM / ownership Freeze
        ↓
重新审查 Streaming Output 草案
        ↓
只冻结真实消费者需要的最小 public projection
        ↓
实现 streaming
```

因此，本计划 Phase 0–6 完成前，**不得开始实现 `REACT_STREAMING_OUTPUT_PLAN.md` 的新 public output modes / event protocol**。

---

## 2. v1 成功定理

本轮最终必须能够证明：

```text
promptpile-react exits 0
⇒ orchestration reached one valid terminal decision
⇒ every required Promptpile child invocation succeeded
⇒ no orchestration phase remained required
⇒ if Final was configured, Final succeeded
⇒ no Promptpile runtime responsibility leaked into React
```

反向失败定理：

```text
any required Thought / Observe / Check / Final failure
⇒ React terminal state = error
⇒ process exits non-zero
⇒ no later optional-looking phase may convert failure back to success
```

React 不需要再次证明某个 Promptpile completion 的 SSE、Receipt 或 atomic-write 细节。

对子调用的信任边界是：

```text
Promptpile public CLI invocation
+ exit status
+ documented public output/artifact contract
```

不要读取 Promptpile Receipt 来“二次证明” Promptpile 已经由自身 runtime 证明过的成功。

---

## 3. 明确非目标

本轮明确不做：

- 新增 `text/json/stream-json` 输出模式；
- Agent Event Protocol；
- retry / backoff；
- tool execution engine；
- 自动 repair malformed tool calls；
- cancellation protocol；
- long-running server；
- session persistence；
- workflow DAG；
- multi-agent；
- automatic compression / fork；
- usage aggregation；
- durable React Receipt；
- 将 React event types 提升到 `promptpile-protocol`。

未来需求只有在出现真实独立 consumer 后再单独设计。

---

## 4. Blocker A：收敛 React FSM

### 4.1 当前问题

当前 `nextStep()` 的状态包括：

```text
running
final
max_step
error
aborted
```

但 `aborted` 没有真实 transition；同时 `nextStep()` catch 后只设置 `error`，入口仍无条件调用 `finalAnswer()`。

这导致：

```text
Thought / Observe / Check failure
→ stopReason = error
→ 仍然进入 Final
```

这不符合 terminal state 的含义。

### 4.2 v1 状态集合

v1 只保留实际可达状态：

```ts
type ReactRuntimeStopReason =
  | 'running'
  | 'final'
  | 'max_step'
  | 'error';
```

删除没有 runtime transition 的 `aborted`。

未来如果真正实现 cancellation，再连同：

```text
signal handling
child termination
cleanup
exit contract
```

一起设计 `cancelled/aborted`，不得现在占位。

### 4.3 状态机

冻结：

```text
                 ┌── phase failure ───────────────┐
                 │                                ▼
running ── Thought ── Observe ── Check ──────── error
                                 │
                                 ├── decision=false ──→ final
                                 │
                                 └── decision=true
                                         │
                                         ├── completedSteps < maxStep
                                         │       └──→ running
                                         │
                                         └── completedSteps == maxStep
                                                 └──→ max_step
```

只有：

```text
final
max_step
```

可以进入 Final phase。

```text
error
```

必须直接终止，不得再调用 Final。

### 4.4 `currentStep` 定义

`currentStep` 必须统一定义为：

> **已经成功完成的完整 ReAct iteration 数量**。

一个 iteration 是：

```text
Thought success
+ Observe success
+ Check success
```

因此：

```text
3 个 Promptpile child calls
≠ currentStep + 3

一个完整 iteration
= currentStep + 1
```

修正 interface comment / README / tests 中任何“Promptpile 调用次数”的表述。

### 4.5 Acceptance

- [x] `aborted` 从 v1 runtime state 删除；
- [x] `error` 后不执行 Final；
- [x] `currentStep` 只在 Thought/Observe/Check 全成功后 +1；
- [x] Check failure 不增加 step；
- [x] Check `false` → `final`；
- [x] Check `true` 且达到 max → `max_step`；
- [x] `running` 不能作为正常进程终态；
- [x] 状态转换有 dedicated pure/runtime tests。

---

## 5. Blocker B：删除 `Infinity + 只跑一轮` 双重语义

### 5.1 当前问题

当前未配置 `--max-step` 时：

```text
runtime.maxStep = Infinity
```

但 CLI 入口为了避免死循环只调用一次 `nextStep()`。

因此可能出现：

```text
Check says continue
→ stopReason 仍是 running
→ CLI 不再循环
→ 进程进入 Final / 结束
```

内部模型与真实 CLI 行为不一致。

### 5.2 v1 规则

v1 不提供隐式 unlimited agent loop。

默认：

```text
maxStep = 1
```

显式：

```text
--max-step N
N >= 1
```

统一入口：

```ts
while (runtime.stopReason === 'running') {
  await runtime.nextStep();
}
```

不再为 `Infinity` 写第二套 execution branch。

### 5.3 原则

```text
一个配置值
⇒ 一种 runtime 语义
```

不要用：

```text
Infinity 表示无上限
但 CLI 层又把它解释成只跑一轮
```

如果未来确实需要 unlimited agent loop，必须作为显式新 contract 单独设计，并考虑：

```text
cancellation
budget
wall-clock limit
operator control
streaming consumer
```

### 5.4 Acceptance

- [x] 默认 `maxStep === 1`；
- [x] runtime / CLI 无 Infinity special case；
- [x] `--max-step N` 精确执行至多 N 个完整 iteration；
- [x] Check `false` 可提前结束；
- [x] 达到 N 后状态稳定为 `max_step`；
- [x] README 不再描述“内部 Infinity 但入口只跑一轮”。

---

## 6. Blocker C：Final 必须是显式 required phase，而不是 soft cleanup

### 6.1 Final 的领域含义

Final 不是 cleanup。

如果 `.react.final.md` / `final_prompt` 非空，则用户明确要求生成一个最终回答，所以它属于 required orchestration phase。

冻结：

```text
final prompt empty
→ skip Final
→ final / max_step terminal remains success
```

```text
final prompt configured
→ Final invocation required
→ Final success = React success prerequisite
```

### 6.2 禁止 soft failure

删除 / 不再使用 Final 专用的：

```text
completePromptpileInvokeSoft()
```

Final 与 Thought/Observe/Check 统一使用 required child invocation semantics。

```text
Final child non-zero / spawn failure
→ terminal state error
→ process exit non-zero
```

### 6.3 Final 调用条件

冻结：

```text
stopReason == final
OR
stopReason == max_step
```

才允许调用 Final。

```text
stopReason == error
```

永远不调用 Final。

### 6.4 Acceptance

- [x] error path never invokes Final；
- [x] empty final prompt skips Final without failure；
- [x] configured Final failure forces exit 1；
- [x] configured Final success is required for exit 0；
- [x] Final failure cannot be swallowed；
- [x] no “successful React session with failed configured Final” state exists。

---

## 7. Simplification：`--input` 与 `--continue` 不再隐式组成无限交互循环

### 7.1 当前双重语义

当前 `-c/--continue` 同时承担：

1. Thought / Final 子进程是否传 `promptpile -c`；
2. `-i` 模式下是否 `while (true)` 重复读取终端输入。

这是两个不同层次的概念：

```text
Conversation continuation policy
≠ process-level interactive loop policy
```

### 7.2 v1 收敛建议

本轮将 `--input` 定义为**一次 user append + 一次 React session**。

```text
promptpile-react -i
→ read one user message
→ promptpile conversation append-user
→ run one React session
→ terminate
```

`--continue` 只保留 Conversation continuation 语义：

```text
Thought / Final child argv 可带 promptpile -c
```

不要再因为 `-i -c` 隐式进入无限 process loop。

未来如果真实需要长驻交互模式，再单独设计一个明确入口，例如 `--interactive`；本轮不新增该功能。

### 7.3 Acceptance

- [x] `-i` 一次进程只消费一次用户输入；
- [x] `-c` 不控制 process-level while loop；
- [x] append-user failure → no React session；
- [x] append-user success 后模型失败不回滚 user artifact；
- [x] 文档删除 `-i/-c` 双重含义说明。

---

## 8. 配置边界：保持 ownership 一致，而不是复制 Promptpile config engine

### 8.1 React 应该解析什么

React 只解析它为了 orchestration 必须知道的字段。

`[promptpile-react]`：

```text
Conversation layer / output selection
quiet
input / continue
max_step
prompt paths
phase profile selector
phase-specific pass-through override（仅现有兼容面）
tools_file / after_hook orchestration routing
```

React 不解析：

```text
[[llm_api]] profile contents
Promptpile request defaults
Promptpile OCC
Receipt
artifact publication policy internals
```

`[[llm_api]]` 仍由子进程 Promptpile 通过：

```text
--llm-config <same file>
--llm-api <profile>
```

解析。

### 8.2 `[promptpile]` 兼容子集

React 当前为了共享配置会读取 `[promptpile]` 的少量字段。

该兼容模式可以保留，但必须明确：

- React **只严格校验自己实际消费的字段**；
- React 不应因为 Promptpile 新增一个自己不关心的合法 `[promptpile]` key 而失败；
- 对 React 消费到的字段，如果显式存在且类型错误，必须 fail-fast。

即：

```text
unknown [promptpile] key to React
→ ignore / leave to Promptpile
```

但：

```text
[promptpile].quiet = "yes"
且 React 读取 quiet
→ fail
```

### 8.3 `[promptpile-react]` unknown key

`[promptpile-react]` 完全由 React 所有，因此：

```text
unknown key
→ fail-fast
```

避免 typo 静默降级。

### 8.4 TOML strict typing

删除宽松 coercion：

```text
number/bool → string
arbitrary string → bool
string → int
```

规则：

```text
string field  → TOML string
bool field    → TOML bool
integer field → TOML integer + domain validation
array field   → non-empty array of non-empty strings
extra_body    → TOML table/object
```

特别是：

```text
continue = "tru"
→ error

max_step = "3"
→ error

thought_llm_api_model = 123
→ error
```

CLI 参数本身仍是字符串 transport，由对应 CLI / Promptpile validator 决定 domain 语义。

### 8.5 LLM phase 配置收缩原则

本轮**不再新增任何新的 per-phase provider pass-through 字段**。

长期 canonical configuration 应优先：

```text
[[llm_api]] profiles
+
thought_llm_api / observe_llm_api / check_llm_api / final_llm_api
```

而不是继续扩张：

```text
thought_xxx
observe_xxx
check_xxx
final_xxx
```

现有 phase-specific model/key/base/temperature/extra-body 先作为 beta compatibility surface 保留；README 示例应优先使用 profile selector。稳定版前再根据真实使用情况决定是否删除这些重复字段。

### 8.6 Acceptance

- [x] `[promptpile-react]` unknown key fail；
- [x] React 消费的 TOML 字段 strict typed；
- [x] `[promptpile]` 未消费的新字段不使 React 失败；
- [x] React 不解析 `[[llm_api]]`；
- [x] invalid profile 仍由 Promptpile public CLI fail；
- [x] per-phase provider surface 不再扩张；
- [x] docs 以 profile selector 为 canonical configuration。

---

## 9. Public protocol 复用：ToolCall 只解析一次

### 9.1 当前重复

`parse-observe-calls.ts` 当前自行验证：

```text
id
type
function.name
function.arguments
```

而 `promptpile-protocol/tool` 已提供：

```ts
parseToolCallV1(value)
```

React 已经成为该 public ToolCall contract 的真实消费者。

### 9.2 目标结构

`promptpile-react` 增加对 `promptpile-protocol` 的**直接 exact dependency**，不要依赖 `promptpile` 的 transitive dependency。

```text
calls.jsonl line
→ JSON.parse
→ parseToolCallV1
→ React-specific tool name check
→ JSON.parse(function.arguments)
→ decision extraction
```

Protocol 只负责通用 ToolCall shape；React 只负责：

```text
react_check_decision
arguments.decision
```

### 9.3 不要过度抽象

`callsPathForMainOutput()` 这种只有 React 需要的局部路径 helper 不因“统一”而加入 protocol。

准入规则仍是：

```text
public protocol
+ pure
+ normative
+ real cross-package reuse
```

不是所有重复的 3 行代码都值得公共 API。

### 9.4 Acceptance

- [x] React 直接依赖 exact `promptpile-protocol`；
- [x] ToolCall shape 使用 `parseToolCallV1`；
- [x] malformed JSON / malformed ToolCall fail closed；
- [x] React-specific decision validation 留在 React；
- [x] 无 `promptpile/src` / `promptpile/dist` private import。

---

## 10. Promptpile CLI 是唯一 runtime integration boundary

继续冻结当前正确方向：

```text
promptpile-react
→ child_process.spawn
→ promptpile public bin
```

### 10.1 Binary resolution

保留：

```text
promptpile package bin metadata
→ current Node process.execPath + JS entry
```

以及：

```text
PROMPTPILE_BIN
```

作为显式 override。

禁止：

```text
hardcode promptpile/dist/index.js
import promptpile internal module
assume monorepo filesystem layout
```

### 10.2 Child invocation success

React 不理解 Promptpile SSE / Receipt 内部状态。

每个 required child phase只需要：

```text
spawn succeeded
AND child exit code == 0
AND phase-required public output is present/parseable
```

例如：

- Thought：exit 0 即 phase completion；
- Observe：exit 0 + required `-o` readable；
- Check：exit 0 + calls sidecar 可按 protocol + React decision contract 解析；
- Final：exit 0。

### 10.3 Tool execution ownership

README 必须删除任何：

> “工具执行由 promptpile 负责”

之类描述。

冻结：

```text
Promptpile
= may expose / persist model-emitted tool calls
≠ generic tool executor

Promptpile React
= orchestration
≠ generic tool executor
```

如果 Thought 的真实 workflow 通过 after-hook / host runtime 执行工具，则 owner 必须按那个独立边界描述，不得模糊归给 Promptpile core。

---

## 11. Phase policy 固定

本轮不要继续给各 phase 添加更多特殊 flag。

冻结现有最小职责：

### Thought

```text
Conversation view
+ core prompt injection
+ tools_file（若配置）
+ after-hook（若配置）
+ optional promptpile -c
```

### Observe

```text
Conversation view
+ observe prompt
+ --disable-tool
+ temporary -o text
+ no Conversation assistant mutation
```

### Check

```text
isolated empty Conversation directory
+ check prompt
+ observe text
+ only react_check_decision tool
+ temporary -o / calls sidecar
+ no main Conversation mutation
```

### Final

```text
only when prior terminal = final|max_step
+ final prompt
+ --disable-tool
+ optional promptpile -c
+ required if prompt configured
```

任何新增 phase 都必须重新做 domain design，不在 v1 随需求添加。

---

## 12. Error model

### 12.1 First orchestration failure

一次 session 只保留第一个 required orchestration failure 作为 primary failure。

后续 cleanup failure：

```text
temp unlink
rm temp dir
debug logging
```

不得覆盖 primary failure。

### 12.2 Phase failure

统一归为：

```text
Promptpile spawn error
Promptpile non-zero exit
Observe required output missing/unreadable
Check calls malformed / decision malformed
Final required child failure
```

→ `error`。

### 12.3 Cleanup

临时文件 cleanup 继续 best-effort。

```text
phase success
→ cleanup failure
```

不应把已完成 Promptpile domain action回滚成失败，除非该资源仍属于完成 contract 的 required public output。

当前 Observe/Check 临时文件本来就不是 public terminal witness，因此 cleanup failure 可忽略/diagnostic。

---

## 13. Package public surface 收口

### 13.1 CLI-only

当前真实 public surface 是：

```text
promptpile-react executable
```

不是受支持的 JS library。

因此 v1 采用 CLI-only：

- 删除误导性的 `main`；
- 不把顶层执行 `main()` 的文件同时声明成 library entry；
- 若未来需要 library API，另行设计 pure module exports 与 CLI entry 分离。

### 13.2 Version single source

禁止：

```text
package.json = 0.1.0-beta.x
CLI .version('1.0.0')
```

CLI version 必须从随包 metadata / build-generated constant 单源派生。

必须证明：

```text
promptpile-react --version
== package.json.version
```

在 workspace 和 packed install 中都成立。

### 13.3 Node support

与 monorepo / Promptpile runtime floor 对齐：

```json
"engines": {
  "node": ">=20"
}
```

CI：

```text
Node 20
Node 22
```

不要声明一套、依赖支持另一套、CI 再测第三套。

### 13.4 Runtime dependencies

`typescript`、`@types/node` 属于 build/dev dependency，不应留在 runtime dependencies。

目标：

```text
runtime dependencies
= packed CLI 真正执行需要的依赖
```

`promptpile` 与 `promptpile-protocol` 使用 exact beta version，保持 immutable artifact compatibility evidence。

---

## 14. Architecture guards

现有 architecture boundary test 继续保留并扩展。

至少 enforce：

```text
no promptpile/src/
no promptpile/dist/
no private sibling import
no hardcoded promptpile build path
React does not parse [[llm_api]] profiles
```

新增：

```text
React ToolCall parser imports promptpile-protocol/tool
package does not restore unsupported library main surface
no unused aborted runtime state
no Infinity default/special execution branch
Final has no soft-success invocation path
```

architecture guard 应覆盖未来 `src/**` 子目录递归扫描。

---

## 15. Tests：只证明领域不变量，不追求细枝末节

### 15.1 FSM tests

至少：

1. default maxStep = 1；
2. one successful iteration + check false → `final`；
3. one successful iteration + check true + maxStep=1 → `max_step`；
4. maxStep=N 精确最多完成 N iterations；
5. Thought failure → error / step unchanged / no Final；
6. Observe failure → error / step unchanged / no Final；
7. Check failure → error / step unchanged / no Final；
8. configured Final failure → error；
9. empty Final prompt → no child invocation / terminal success；
10. no successful process may end with stopReason `running`。

### 15.2 Input tests

11. `-i` consumes one user message only；
12. `-i -c` 不再创建无限 process loop；
13. append-user failure → no React phase starts；
14. user append success + later model failure → user artifact preserved。

### 15.3 Config tests

15. `[promptpile-react]` unknown key fail；
16. bool string fail；
17. string field number fail；
18. max_step string fail；
19. max_step <= 0 fail；
20. `[promptpile]` React-consumed field wrong type fail；
21. `[promptpile]` unrelated valid future key does not fail React；
22. React does not inspect `[[llm_api]]` profile contents；
23. missing selected profile propagates Promptpile child non-zero failure。

### 15.4 Protocol / phase tests

24. valid check ToolCall → decision true/false；
25. malformed JSON → error；
26. malformed ToolCall shape → error；
27. invalid decision arguments → error；
28. Observe required `-o` missing → error；
29. Check isolation does not leak main Conversation directories；
30. Final only runs from `final|max_step`。

### 15.5 Package tests

31. `--version` matches package metadata；
32. packed install does not require TypeScript runtime；
33. no supported `require('promptpile-react')` library illusion；
34. Promptpile binary resolution uses package bin metadata；
35. explicit `PROMPTPILE_BIN` still works。

重点是证明：

```text
FSM
ownership
failure
package boundary
```

不要因为 Freeze checklist 而给每个私有 helper 写脆弱的 implementation-detail test。

---

## 16. Dedicated CI

增加 / 收敛一个 React orchestration dedicated workflow，例如：

```text
Promptpile React v1
```

matrix：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

每格顺序：

```text
npm ci --ignore-scripts
→ build promptpile-protocol
→ build promptpile
→ test promptpile-react
→ architecture boundary
→ real Promptpile integration
→ packed install smoke
```

不得只在 workspace 源码环境里证明成功。

---

## 17. Packed artifact / release topology

由于 React v1 将直接依赖：

```text
promptpile-protocol@exact
promptpile@exact
```

independent package smoke 应打包同一 workspace revision 的三个 artifact：

```text
npm pack promptpile-protocol
npm pack promptpile
npm pack promptpile-react
```

然后在 fresh temp project 中安装：

```text
protocol tarball
promptpile tarball
react tarball
```

验证：

```text
promptpile-react --help
promptpile-react --version
binary resolution
minimal fake/stub Promptpile orchestration smoke
```

不要因为 registry 尚未发布 exact beta version 产生 `ETARGET`，再误判成 React package failure。

发布顺序固定：

```text
promptpile-protocol
→ promptpile
→ promptpile-react
```

---

## 18. README / example 同步

实施完成后同步：

```text
packages/promptpile-react/README.md
packages/promptpile-react/example.toml
packages/promptpile-react/example.sh
```

必须删除或更新：

- `Infinity` 默认语义；
- `-i/-c` 隐式无限交互语义；
- “Promptpile 负责执行工具”的错误 ownership；
- Final soft failure 描述；
- CLI `1.0.0` 假版本；
- 宽松 TOML coercion 的暗示。

canonical example 应优先展示：

```text
[[llm_api]] profiles
+ phase profile selectors
```

而不是大量 per-phase provider credentials/override 字段。

---

## 19. Streaming Plan 的重新准入条件

本计划 Freeze 后，不是立即照原 `REACT_STREAMING_OUTPUT_PLAN.md` 全量实现，而是先重新审查。

只有满足以下条件才进入 streaming design：

```text
React FSM Freeze
+ real machine consumer exists
+ terminal semantics stable
+ stdout ownership requirement明确
```

重新审查时按：

```text
stable internal state
→ minimal external projection
```

反推 event set。

### 19.1 必须重新质疑的内容

原草案中的以下设计都不是既定需求：

```text
text + json + stream-json 是否都需要？
phase.started / phase.completed 是否有真实 consumer？
是否需要暴露 Observe/Check lifecycle？
是否需要 session_id？
sequence 是否必须 public？
是否需要 include-internal-events？
```

没有真实消费价值的内容应删除，而不是因为草案里写过就实现。

### 19.2 Event ownership

即便未来实现 Agent Event Protocol v1，第一版仍由：

```text
promptpile-react
```

拥有。

不要因为名字叫 protocol 就提前搬到 `promptpile-protocol`。

只有出现第二个独立非-React consumer 且语义真正跨包规范化时，再重新评估 protocol admission。

---

## 20. 实施阶段

### Phase 0 — Freeze Plan

**实施结果：完成。** 本文已进入实现基线，Streaming implementation 保持暂停。

- 本文进入 main；
- 不改 runtime；
- Streaming implementation 暂停。

完成标准：核心状态机与 ownership 无开放设计问题。

### Phase 1 — FSM Simplification

**实施结果：完成。** 证据：`test/react-runtime-fsm.cjs` 与 architecture boundary。

1. 删除 `aborted`；
2. 默认 maxStep=1；
3. 删除 Infinity special branch；
4. 统一 session loop；
5. 修正 currentStep 定义与注释；
6. error 后不 Final。

完成标准：

```text
one runtime state machine
= one CLI execution model
```

### Phase 2 — Final / Input Semantics

**实施结果：完成。** 证据：FSM、runtime CLI boundary、append-user/input failure tests。

1. Final 改为 required phase；
2. 删除 Final soft failure；
3. empty final prompt 明确 skip；
4. `-i` 一次输入一次 session；
5. `-c` 不再控制 outer infinite loop。

完成标准：

```text
exit 0
⇒ every configured required phase succeeded
```

### Phase 3 — Config / Protocol Boundary

**实施结果：完成。** 证据：`test/react-config-strict.cjs`、`test/check-tool-protocol.cjs`、real Promptpile config integration。

1. strict React TOML；
2. `[promptpile-react]` unknown-key rejection；
3. `[promptpile]` narrow consumed-subset validation；
4. 继续 delegate `[[llm_api]]`；
5. ToolCall parser 切到 `promptpile-protocol/tool`；
6. direct exact protocol dependency。

完成标准：

```text
React owns orchestration config only
Promptpile owns completion config semantics
Protocol owns shared ToolCall shape
```

### Phase 4 — Package Surface

**实施结果：完成。** 证据：CLI package version test 与 packed artifact smoke。

1. CLI version single source；
2. engines >=20；
3. TypeScript/@types → devDependencies；
4. CLI-only surface；
5. package smoke。

### Phase 5 — Evidence

**实施结果：完成。** `.github/workflows/promptpile-react-v1.yml` 固定 Node 20/22 × Ubuntu/Windows；package tests、real Promptpile integration、packed smoke 与四格 CI 均已绿。

1. root React tests；
2. real Promptpile integration；
3. Node20/22 × Ubuntu/Windows；
4. packed artifact smoke；
5. docs audit。

### Phase 6 — Freeze

**实施结果：完成。** 专用 CI 已在同一 revision 上实现 Node 20/22 × Ubuntu/Windows 四格全绿，v1 orchestration 正式 Freeze。下一步仅重新审查 `REACT_STREAMING_OUTPUT_PLAN.md`，不继续修改本轮 orchestration contract。

所有 checklist 通过后：

```text
状态：v1 orchestration 已实施 / Freeze 完成
```

然后才能进入：

```text
REACT_STREAMING_OUTPUT_PLAN.md re-audit
```

---

## 21. Final Freeze Checklist

实施证据索引：

```text
FSM / Final               → test/react-runtime-fsm.cjs
Input append failure      → test/input-mode-append-failure.cjs
Config ownership          → test/react-config-strict.cjs + test/real-promptpile-config-errors.cjs
ToolCall protocol         → test/check-tool-protocol.cjs
CLI integration boundary  → test/react-runtime-cli-boundary.cjs + test/layered-runtime-cli-boundary.cjs
Architecture              → test/architecture-boundary.cjs
Version / CLI-only        → test/cli-package-version.cjs
Packed artifact topology  → scripts/packed-smoke.mjs
Platform matrix           → .github/workflows/promptpile-react-v1.yml
```

以下代码、测试、artifact 与平台证据均已满足。CI 证据由 `Promptpile React v1` workflow 的同一 revision 四格结果提供。

### Ownership

- [x] React 只拥有 orchestration state machine；
- [x] 不 import Promptpile private runtime；
- [x] 不解析 Promptpile `[[llm_api]]`；
- [x] 不实现 Chat Completions/SSE/Receipt/OCC；
- [x] 不拥有 generic tool execution；
- [x] 不实现 Streaming/Event Protocol。

### FSM

- [x] v1 state 只有 running/final/max_step/error；
- [x] default maxStep=1；
- [x] 无 Infinity special execution；
- [x] currentStep = completed iterations；
- [x] running 不能正常进程结束；
- [x] error 后不 Final。

### Final

- [x] empty prompt → skip；
- [x] configured Final → required；
- [x] Final failure → error / exit non-zero；
- [x] Final only from final|max_step。

### Input / Continue

- [x] `-i` 单次输入；
- [x] `-c` 只表达 Conversation continuation；
- [x] 无隐式 process-level infinite loop；
- [x] append success 后的 user artifact 不因后续 model failure rollback。

### Config

- [x] `[promptpile-react]` strict typed；
- [x] unknown React key fail；
- [x] consumed `[promptpile]` fields strict typed；
- [x] unrelated Promptpile fields 不被 React错误拒绝；
- [x] phase config 不继续膨胀；
- [x] profiles 是 canonical per-phase LLM configuration。

### Protocol / Integration

- [x] ToolCall shape 复用 `promptpile-protocol/tool`；
- [x] direct exact protocol dependency；
- [x] Promptpile public CLI 是唯一 runtime boundary；
- [x] public output/artifact parsing fail closed；
- [x] no sibling private imports。

### Package

- [x] version single source；
- [x] Node support 与 repo/CI/dependencies 一致；
- [x] runtime dependency 最小；
- [x] CLI-only public surface；
- [x] packed install smoke green。

### Evidence

- [x] Node20 Ubuntu green；
- [x] Node22 Ubuntu green；
- [x] Node20 Windows green；
- [x] Node22 Windows green；
- [x] real Promptpile integration green；
- [x] README/examples 与实现一致；
- [x] broader monorepo architecture guards green。

---

## 22. Freeze 判定

只有当以下两个定理都有代码结构与 CI 证据时，`promptpile-react` orchestration v1 才 Freeze。

### 22.1 Orchestration theorem

```text
React process success
⇒ stopReason ∈ {final, max_step}
⇒ every completed step contains successful Thought+Observe+Check
⇒ no required phase failed
⇒ if Final configured, Final succeeded
⇒ process exit 0
```

### 22.2 Boundary theorem

```text
React orchestration
⇒ invokes Promptpile only through public CLI
⇒ trusts Promptpile completion success through its public process contract
⇒ parses shared ToolCall data through promptpile-protocol
⇒ does not duplicate Promptpile runtime ownership
```

这两个定理成立后，React 的内部领域模型才足够稳定，可以安全地被 Streaming/Event Protocol 投影。

最终路线：

```text
Promptpile core Freeze
        ↓
React orchestration Freeze
        ↓
Streaming Plan re-audit
        ↓
minimal public event protocol
        ↓
implementation
        ↓
real consumer validation
```

本轮优化的目标是让 React **更少、更明确、更可证明**，而不是让它拥有更多功能。
