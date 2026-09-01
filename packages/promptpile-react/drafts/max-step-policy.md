# ReAct Max-Step Policy：终止语义最小改造方案

> 状态：**Implementation-ready / design frozen**（2026-09-01）  
> 范围：仅 `packages/promptpile-react`  
> 目标：在不改变现有 ReAct FSM、Check 协议、默认行为与 Final 语义的前提下，允许调用方选择“达到 `max_step` 后继续 Final”或“达到 `max_step` 后直接失败”。  
> 默认：`max_step_policy = "final"`，严格保持当前行为。  
> 核心原则：**`max_step` 仍然只是既有 runtime stop reason；policy 只决定该 stop reason 是否允许进入 Final / success。**

---

## 1. 问题

当前 ReAct FSM：

```text
Thoughtₙ
  ↓
Observeₙ
  ↓
Checkₙ
  ├─ false → final
  └─ true
       ├─ remaining step → Thoughtₙ₊₁
       └─ no remaining step → max_step
```

当前 runtime 在 `final` 与 `max_step` 两种 stop reason 下都会执行 Final：

```text
final
→ Final
→ success（若 Final 成功）

max_step
→ Final
→ success（若 Final 成功）
```

这适合“最多迭代 N 次，然后无论如何形成最终回答”的调用方式。

但另一类调用方需要更严格的闭环：

```text
Check=false
→ 当前工作已经通过
→ 才允许 Final

Check=true 且 max_step exhausted
→ 当前工作仍未通过
→ 不允许 Final
→ process failure
```

典型用途包括 evaluator / repair loop / convergence loop：Check 的 `true` 明确表示当前工作仍需继续，此时达到 iteration budget 应被视为“未收敛”，而不是“正常完成”。

本改造只解决这个终止策略差异。

---

## 2. 结论先行

新增一个 React-only 配置：

```text
max_step_policy = "final" | "error"
```

语义：

```text
final
→ 保持当前行为
→ max_step 后仍执行 Final
→ Final 成功则 session success

error
→ Check=true 且最后一个允许 iteration 已完成
→ stop reason 仍为 max_step
→ 不执行 Final
→ session failure / process non-zero
```

默认：

```text
max_step_policy = "final"
```

因此未配置该参数的所有现有调用方行为完全不变。

---

## 3. 配置契约

新增枚举配置：

| 表面 | 键 | 默认 | 合法值 |
| --- | --- | --- | --- |
| CLI | `--max-step-policy <policy>` | `final` | `final`, `error` |
| TOML | `[promptpile-react].max_step_policy` | `final` | `final`, `error` |
| Runtime config | `ResolvedReactConfig.maxStepPolicy` | `final` | `'final' \| 'error'` |

配置优先级：

```text
CLI --max-step-policy
> [promptpile-react].max_step_policy
> "final"
```

该键属于 React-only config，不加入 `[promptpile]` shared keys。

非法值 fail-closed：

```text
--max-step-policy retry
→ CLI error

[promptpile-react]
max_step_policy = "retry"
→ config error
```

不引入：

```text
boolean
integer
"auto"
"continue"
其他 alias
```

两个值足够表达 V1 所需语义。

---

## 4. Frozen 行为矩阵

| 最后状态 | `max_step_policy=final` | `max_step_policy=error` |
| --- | --- | --- |
| Check `false` | Final → success | Final → success |
| Thought / Observe / Check error | failure；无 Final | failure；无 Final |
| Check `true`，仍有 iteration | 下一轮 | 下一轮 |
| Check `true`，iteration budget exhausted | Final → success if Final succeeds | **无 Final → failure** |
| Final 自身失败 | failure | failure |

关键点：

```text
max_step_policy
只影响 stopReason === "max_step"
```

它不改变：

- `max_step` 如何计数；
- `currentStep` 语义；
- Thought / Observe / Check 顺序；
- Check ToolCall schema；
- Check boolean 含义；
- `observe_carryover`；
- Final prompt / handoff 格式；
- `--continue` persistence；
- session work 生命周期。

---

## 5. 最小实现边界

### 5.1 不修改 ReAct runtime FSM

继续保留既有 runtime 状态：

```text
running | final | max_step | error
```

`PromptpileReactRuntime.nextStep()` 继续按当前方式产生 `max_step`：

```text
last allowed Check returns true
→ currentStep reaches maxStep
→ stopReason = "max_step"
```

不增加：

```text
max_step_error
budget_exhausted
incomplete
```

等新的 runtime stop reason。

### 5.2 policy 在 session runner 层生效

当前 session runner 的逻辑概念上是：

```text
while running:
  nextStep()

finalAnswer()
```

改为：

```text
while running:
  nextStep()

if stopReason == "max_step" and maxStepPolicy == "error":
  skip Final
  fail session
else:
  Final
```

因此无需让 `react-runtime.ts` 承担新的业务分支；runtime 仍只报告事实：

```text
为什么 iteration loop 停止？
```

runner 根据 policy 决定：

```text
这个 stop reason 是否算成功、是否允许 Final？
```

这是本方案影响最小的关键。

---

## 6. Terminal 与 stream-json

### 6.1 terminal

`max_step_policy=error` 且达到 `max_step` 时：

```text
不调用 Final
process.exitCode = 1
stderr 输出简短诊断
```

推荐诊断：

```text
React reached max_step while Check still requested continuation.
```

不得把最后 Observe 或隐藏 phase 内容写到 stdout。

### 6.2 stream-json

必须维持“stdout 只包含 Agent Event Protocol”这一既有边界。

`max_step_policy=error` 且达到 `max_step` 时：

```text
不产生 phase.started(final)
不产生 final.delta
不产生 phase.completed(final)
不产生 session.completed

产生：
session.failed
  phase = "check"
  error.code = "max_step_exhausted"

process exit = non-zero
```

错误含义：

```text
最后一个成功 Check 仍要求 continue，
但 max_step budget 已耗尽。
```

为准确表达该已知失败原因，Agent Event Protocol v1 的 error code enum 只增加一个值：

```text
max_step_exhausted
```

不增加 event type，不增加字段，不改变现有 event shape。

这是本改造对公开事件协议唯一必要变化。

---

## 7. Backward compatibility

默认：

```text
max_step_policy = "final"
```

必须严格保持当前行为：

```text
max_step
→ Final
→ Final 成功则 process exit 0
→ stream-json 仍是 session.completed(stop_reason="max_step")
```

冻结要求：

1. 未配置 `max_step_policy` 的现有测试输出不变。
2. `--max-step` 默认值与计数语义不变。
3. `ReactRuntimeStopReason` 不变。
4. `ReactSuccessStopReasonV1 = 'final' | 'max_step'` 可保持不变，因为 `max_step` 在默认 `final` policy 下仍是合法 success stop reason。
5. Final observation handoff 不变。
6. `observe_carryover` 不变。
7. `--continue` 与 Conversation persistence 不变。
8. packed CLI / binary resolution 不变。

---

## 8. 预计代码影响

目标是只改配置解析与 session terminal handling，不触碰 phase 实现。

预计涉及：

```text
src/cli.ts
→ 增加 --max-step-policy

src/types.ts
→ ReactCliOverrides.maxStepPolicy
→ ResolvedReactConfig.maxStepPolicy
→ MaxStepPolicy type（如需要）

src/toml-config-react.ts
→ 允许 max_step_policy
→ ReactOnlyTomlLayer.maxStepPolicy

src/resolve-react-config.ts
→ CLI > TOML > final
→ 校验 final | error

src/index.ts
→ max_step + error 时跳过 Final
→ terminal non-zero
→ stream-json session.failed

src/react-event-protocol.ts
schema/agent-event-v1.schema.json
→ error code enum 增加 max_step_exhausted
```

原则上不需要修改：

```text
src/react-runtime.ts
src/react-processes.ts
src/check-decision-tool.ts
src/final-observation-handoff.ts
src/observe-files.ts
```

如果实现发现必须修改这些文件，应先确认是否真的需要，而不是把 policy 下沉进 phase / FSM。

---

## 9. 测试契约

### 配置

必须覆盖：

```text
默认 → final
CLI final
CLI error
TOML final
TOML error
CLI 覆盖 TOML
非法 CLI 值
非法 TOML 值
unknown key 检查仍生效
```

### `final` policy 回归

```text
Check=false
→ Final
→ success

Check=true until max_step
→ Final
→ success if Final succeeds
```

并证明现有未配置调用与改造前一致。

### `error` policy

```text
Check=false before max_step
→ Final
→ success

Check=true until max_step
→ no Final
→ exit non-zero
```

必须证明：

- Final subprocess 没有启动；
- `--continue` 时没有因 Final 产生新的 persisted assistant；
- latest Observe 仍按既有 session/debug policy 处理；
- `observe_carryover` 不受影响。

### stream-json

`error` policy exhaustion 必须严格产生：

```text
...
phase.completed(check, continue=true)
session.failed(
  phase="check",
  error.code="max_step_exhausted"
)
```

并且不存在：

```text
phase.started(final)
final.delta
phase.completed(final)
session.completed
```

Agent Event Protocol schema / fixture / validator 同步覆盖新增 error code。

### package smoke

现有 packed smoke 必须继续通过；至少增加 CLI help 能看到：

```text
--max-step-policy <policy>
```

---

## 10. README 更新范围

实现时只需在现有 README 的三个位置补充：

1. “执行模型”：说明 `max_step` 默认仍进入 Final，但 `max_step_policy=error` 可把 exhaustion 视为失败。
2. CLI 参数表：增加 `--max-step-policy <final|error>`。
3. 配置边界：增加 TOML key、合法值、默认值与 CLI precedence。

不需要重新组织 README 或修改 ReAct phase 文档结构。

---

## 11. 非目标

本改造不做：

- 修改 Check ToolCall schema；
- 给 Check 增加 feedback；
- 修改 `max_step` 计数；
- 自动增加 iteration budget；
- 根据 Observe 内容自动选择 policy；
- 新增 retry / fallback Final；
- 新增 runtime state；
- 修改 Observe carryover；
- 修改 Final handoff 内容；
- 改变默认行为；
- 引入 Dayloom 或其他业务语义。

`promptpile-react` 仍然只提供通用 orchestration policy。

---

## 12. Frozen V1

本改造冻结为：

```text
max_step_policy = "final" | "error"
default = "final"
```

其中：

```text
final
= max_step 是正常 terminal reason，继续 Final

error
= max_step 表示未在 budget 内通过 Check，跳过 Final 并失败
```

实现应优先在 session runner 层完成，不修改现有 ReAct FSM。

判断实现完成的标准：

```text
默认调用完全兼容
+
error policy 可确定性保证：
Check 仍要求 continue 时绝不会因为 iteration budget 用尽而进入成功 Final
```
