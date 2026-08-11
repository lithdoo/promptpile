# Promptpile Invocation ID 实施设计计划

> 状态：实现完成，待专项 CI 验证
> 设计冻结日期：2026-08-11  
> 核心提案：为一次 root completion invocation 提供一个 **caller-supplied、CLI-only、可选、受限 ASCII、绝不进入模型上下文** 的 correlation identifier，并把它收敛为独立的 `ResolvedInvocationContextV1`；v1 只向 after-hook 与未来 Completion Receipt 传播，不把它扩张为 run/session/transaction/幂等协议

## 0. 结论

Invocation ID v1 只回答一个问题：

> 调用者是否为本次 Promptpile root completion 提供了一个安全、稳定、可原样传播的关联标识？

它不是 Conversation identity，不是模型 metadata，不是事务 ID，不是幂等键，也不是 Promptpile 自动生成的 run ID。

v1 固定为：

```text
root completion CLI
        ↓
--invocation-id <id>   optional / CLI-only
        ↓
parse + validate before runtime side effects
        ↓
ResolvedInvocationContextV1
        │
        ├─ id = string
        │      ├─ after-hook env: PROMPTPILE_INVOCATION_ID
        │      └─ future Completion Receipt: invocationId
        │
        └─ id = null
               ├─ hook env key absent
               └─ future Receipt: invocationId = null
```

核心不变量：

1. **Invocation ID 由 caller 提供，Promptpile v1 不自动生成。** 未提供时内部状态明确为 `null`。
2. **v1 只有 CLI 输入源。** 不从 TOML、`.env`、普通 `process.env`、`[[llm_api]]` profile 或 Conversation 文件读取。
3. **v1 只接受 1–128 个受限 ASCII 字符。** 合法字符固定为 `A-Z a-z 0-9 . _ - :`。
4. **校验通过后原样保存。** 不 trim、不 lowercase、不 uppercase、不 Unicode normalize、不补前缀、不改写。
5. **非法 Invocation ID 必须在任何 invocation-specific runtime side effect 之前失败。** 至少早于 `--input` Conversation mutation、sink preparation、model API request、after-hook 与 Receipt。
6. **Invocation ID 永不隐式进入模型输入。** Promptpile 不把它注入 messages、system/user/assistant content、tool arguments、provider request metadata 或 `extraBody`。
7. **Invocation ID 不进入 Conversation Protocol。** 不参与文件名、idx、Fingerprint、OCC claim、Archive/Fork/Compress protocol。
8. **Invocation ID 不决定权限、幂等、锁所有权或 exactly-once。** 两次 invocation 可以使用同一个 ID；Promptpile 不验证全局唯一性。
9. **v1 只向两个正式消费者传播：after-hook 与 future Completion Receipt。** 不进入 output pile JSON、LLM dump、stdout/stderr 自动前缀或独立 telemetry protocol。
10. **Invocation ID 与 output topology 正交。** 它不属于 `ResolvedOutputArtifactPolicyV1`；runtime 通过独立 `ResolvedInvocationContextV1` 消费。
11. **没有 ID 与空 ID 是不同概念。** 空字符串永远非法；未提供则是 `null`，hook env 中对应 key 完全 absent。
12. **v1 不定义 hook child invocation ID。** after-hook 属于同一次 Promptpile invocation，直接继承同一个 correlation ID。

职责边界固定为：

```text
CLI parser / invocation-id primitive
  负责：输入来源、校验、exact preservation

ResolvedInvocationContextV1
  负责：运行时唯一 invocation correlation fact

Completion runtime
  负责：把 context 传给允许的消费者

After-hook
  负责：只通过 PROMPTPILE_INVOCATION_ID 观察 caller ID

Completion Receipt
  负责：把 invocationId 编码进稳定机器结果

Conversation / OCC / Output Policy / Model client
  不拥有 Invocation ID 语义
```

---

## 1. 动机

外层 orchestrator 经常需要把：

```text
一个 Promptpile 子进程
↔ 一次 orchestrator run
↔ after-hook
↔ future Completion Receipt
```

稳定关联起来。

当前如果没有显式 correlation primitive，只能依赖：

- PID；
- 临时目录名；
- receipt 路径约定；
- Conversation 目录前后差集；
- stdout/stderr 文本；
- 在 Conversation message 中塞业务 runId。

这些方案都有明显问题：

```text
PID
→ 只在本机短时有效

临时路径
→ correlation 与 storage topology 耦合

目录差集
→ 并发下歧义

stdout/stderr
→ human channel，不是稳定机器协议

写入 Conversation message
→ 污染模型上下文与通用 Conversation Protocol
```

Invocation ID 的目标因此非常窄：

> 给 caller 一个不污染模型与 Conversation 的 per-invocation correlation slot。

---

## 2. v1 范围

v1 负责：

1. root completion CLI `--invocation-id <id>`；
2. 纯 parser / validator；
3. 受限 ASCII contract；
4. exact preservation；
5. `ResolvedInvocationContextV1`；
6. after-hook env `PROMPTPILE_INVOCATION_ID`；
7. future Completion Receipt 的 `invocationId: string | null` seam；
8. 非法输入的 pre-side-effect failure ordering；
9. “不得进入模型请求 / Conversation / tool args”的防回归测试；
10. Windows / Linux 一致行为；
11. CLI Contract / README / security documentation。

v1 不负责：

- 自动生成 UUID / ULID；
- TOML invocation id；
- process env invocation id 输入；
- session ID；
- operation ID；
- workflow ID；
- world ID；
- trace/span protocol；
- distributed tracing；
- telemetry backend；
- authorization identity；
- idempotency key；
- retry identity；
- OCC claim owner identity；
- exactly-once；
- output pile metadata；
- LLM dump metadata；
- hook child invocation ID；
- React Agent Event Protocol correlation；
- Completion Receipt JSON schema 本身。

---

## 3. Public CLI contract

### 3.1 root completion option

新增：

```bash
--invocation-id <id>
```

示例：

```bash
promptpile \
  -d ./messages \
  -c \
  --invocation-id run-01JXYZ
```

它属于 **root completion** 调用语义。

v1 不要求 Conversation 子命令共享该参数：

```text
promptpile conversation inspect
promptpile conversation fingerprint
promptpile conversation append-user
```

这些 domain commands 不产生 Completion Receipt，也不运行 completion after-hook，因此不需要为了“统一”而扩张 Invocation ID 的意义。

### 3.2 CLI-only

v1 明确不支持：

```toml
[promptpile]
invocation_id = "..."
```

也不读取：

```text
PROMPTPILE_INVOCATION_ID
```

作为输入配置。

原因：Invocation ID 是一次调用的动态 correlation value，不是静态 runtime configuration。

因此输入 precedence 不存在复杂层级：

```text
CLI --invocation-id
>
absent
```

### 3.3 不自动生成

未提供：

```bash
promptpile -d ./messages
```

固定语义：

```text
invocation.id = null
```

禁止 Promptpile 偷偷生成：

- UUID；
- ULID；
- timestamp-based ID；
- PID-based ID；
- random token。

自动生成会引入 retry / reuse / external discovery 等额外生命周期问题，属于 orchestrator policy，不属于 core completion。

---

## 4. Parser contract

建议独立 primitive：

```ts
export type InvocationId = string;

export const parseInvocationId = (
  value: unknown
): InvocationId | undefined => {
  // pure validation only
};
```

### 4.1 合法字符

v1 唯一合法语言：

```regex
^[A-Za-z0-9._:-]{1,128}$
```

允许：

```text
run-01JXYZ
job_42
agent.step:7
abc.def
A1_B2-C3:D4
```

拒绝：

```text
空字符串
空格 / tab / newline
/
\\
控制字符
Unicode 字符
引号
shell metacharacters
路径片段
```

### 4.2 长度

由于合法字符全部为单字节 ASCII：

```text
1 <= length <= 128 chars
```

同时也等价于：

```text
1 <= UTF-8 byte length <= 128
```

无需同时维护“字符长度”和“字节长度”两套规则。

### 4.3 不 normalize

重要：parser 不允许：

```ts
value.trim()
value.toLowerCase()
value.toUpperCase()
value.normalize(...)
```

来把非法输入“修复”为合法输入。

例如：

```text
" run-1 "
```

必须失败，而不是变成：

```text
"run-1"
```

理由是 correlation ID 应满足：

```text
caller bytes
=
runtime bytes
=
hook env bytes
=
receipt bytes
```

### 4.4 omitted 与 invalid

建议 contract：

```text
value === undefined
→ undefined

其它非 string
→ throw

string but regex mismatch
→ throw
```

CLI option 本身要求 `<id>`，因此：

```bash
--invocation-id
```

仍由 Commander 作为 missing argument 失败。

而：

```bash
--invocation-id ""
```

由 `parseInvocationId` 明确失败。

### 4.5 error class

v1 不需要新增 public exit code。

非法 Invocation ID 是 ordinary CLI/config failure：

```text
exit 1
```

可以使用普通 `Error` 或内部专用 parser error，但不得映射成 OCC exit `3`。

---

## 5. Pre-side-effect ordering

Invocation ID 是纯 CLI validation，应尽可能早完成。

目标 ordering：

```text
parse root CLI
→ validate invocation id
→ resolve config / paths
→ resolve hook / output policy
→ deterministic validation
→ mutation / sink preparation / model
```

最低 contract：非法 ID 必须发生在以下动作之前：

```text
root --input user append
output pile open
-o parent preparation
Conversation assistant mutation
model API request
after-hook
Completion Receipt
```

更优实现是把 parser 直接挂到 Commander option：

```ts
.option(
  '--invocation-id <id>',
  'Caller-supplied completion correlation id',
  parseInvocationId
)
```

这样非法值在 `resolveConfig()` 之前就已失败，不需要为了 Invocation ID 再设计 rollback。

### 5.1 与现有 `--output-dir` eager preparation

Invocation ID 本身不得引入任何 filesystem side effect。

如果当前 config resolution 对其它参数已有 eager directory preparation，那属于 Layered Conversation I/O / config lifecycle 的既有问题；Invocation ID 实现不应复制或扩大这一行为。

最好通过 CLI parser ordering 确保：

```text
invalid invocation id
→ 连 resolveConfig() 都不进入
```

从而不会因为一个已知非法 ID 产生任何后续路径副作用。

---

## 6. Resolved Invocation Context v1

不要让 root orchestration 到处直接读：

```ts
config.invocationId
```

建议把一次调用的 correlation fact 收敛成：

```ts
export interface ResolvedInvocationContextV1 {
  id: string | null;
}
```

创建方式：

```ts
export const resolveInvocationContext = (
  id: string | undefined
): ResolvedInvocationContextV1 => ({
  id: id ?? null
});
```

这个对象是 invocation metadata 的唯一 runtime source of truth。

### 6.1 为什么不放进 Output Policy

Invocation ID 与 output topology 是正交维度：

```text
ResolvedInvocationContextV1
→ 这是谁的一次调用

ResolvedOutputArtifactPolicyV1
→ 这次调用配置了哪些 output sinks
```

因此应该是：

```text
Resolved Config / CLI
     ├─→ ResolvedInvocationContextV1
     └─→ ResolvedOutputArtifactPolicyV1
```

而不是：

```ts
outputPolicy.invocationId
```

否则 future non-output consumers 会被迫依赖 output module。

### 6.2 optionality 内部显式化

public CLI parser 可以使用：

```ts
string | undefined
```

但 runtime context 固定：

```ts
string | null
```

理由：

- `undefined` 表示 parser / merge 层“未提供”；
- `null` 表示 resolved invocation fact“本次没有 caller ID”。

一旦进入 resolved runtime，不再保留“还没解析”的第三种状态。

---

## 7. Propagation matrix v1

传播范围必须固定，避免每个新功能顺手“带一下 ID”。

| Consumer / surface | v1 | 语义 |
| --- | --- | --- |
| `ResolvedInvocationContextV1` | ✅ | 唯一 runtime fact |
| after-hook env | ✅ | `PROMPTPILE_INVOCATION_ID` |
| future Completion Receipt | ✅ | `invocationId: string | null` |
| human stdout | ❌ | 不自动打印 / prefix |
| human stderr | ❌ | 不自动打印 / prefix |
| structured diagnostic protocol | ❌ | v1 不新增该协议 |
| output pile text | ❌ | 不改变 payload |
| output pile JSON | ❌ | 不增加 metadata event / field |
| LLM dump | ❌ | 不改变 dump schema |
| model messages | ❌ | 不注入 prompt |
| provider request body | ❌ | 不注入 metadata |
| tool definition | ❌ | 不修改 |
| tool call arguments | ❌ | 不修改 |
| Conversation artifact body | ❌ | 不修改 |
| Conversation filename / idx | ❌ | 不参与 |
| Conversation Fingerprint | ❌ | 不参与 |
| OCC precondition / claim | ❌ | 不参与 |
| Archive / Compress / Fork protocol | ❌ | 不参与 |
| filesystem target path | ❌ | 不参与派生 |

这张表是 normative。

未来某个协议需要 Invocation ID 时，必须由那个协议自己的版本化设计显式纳入，而不是默认“所有地方都应该带 ID”。

---

## 8. After-hook integration

After-hook 是 v1 第一个实际消费者。

### 8.1 环境变量

当：

```text
context.id = "run-01JXYZ"
```

hook env 增加：

```text
PROMPTPILE_INVOCATION_ID=run-01JXYZ
```

当：

```text
context.id = null
```

固定行为：

> `PROMPTPILE_INVOCATION_ID` key 不存在。

不是：

```text
PROMPTPILE_INVOCATION_ID=""
```

因为空 ID 永远非法，absent key 能保持状态语义唯一。

### 8.2 caller env 中已有同名 key

`buildPromptpileHookEnv()` 当前会先展开：

```ts
...process.env
```

因此实现必须显式覆盖 / 删除 caller process 中可能已有的：

```text
PROMPTPILE_INVOCATION_ID
```

规则固定：

```text
context.id != null
→ hook env key = context.id

context.id == null
→ hook env 中删除 PROMPTPILE_INVOCATION_ID
```

禁止无参数调用时意外把父进程已有的：

```text
PROMPTPILE_INVOCATION_ID=stale-parent-value
```

泄漏给 hook。

这是 v1 很重要的 determinism / security invariant。

### 8.3 不增加 hook child ID

v1 不定义：

```text
PROMPTPILE_HOOK_INVOCATION_ID
PROMPTPILE_HOOK_ID
```

hook 是 completion pipeline 的一个阶段，不是新的 Promptpile invocation。

如果 hook 自己再启动新的 Promptpile 进程，由它显式决定是否把当前 ID 作为新进程的 `--invocation-id` 传递；core 不做自动继承。

### 8.4 hook observation 不重复存 ID

`AfterHookObservationV1` / `AfterHookPolicyDecisionV1` 不需要新增 `invocationId` 字段。

它们描述 hook fact；correlation 由外围 `ResolvedInvocationContextV1` 提供。

避免：

```text
同一 ID
→ context 一份
→ hook decision 又复制一份
→ Receipt 再复制一份
```

造成内部事实漂移。

---

## 9. Future Completion Receipt seam

Invocation ID plan 只冻结 Receipt 接口，不定义 Receipt schema。

未来 Receipt 必须能直接消费：

```ts
ResolvedInvocationContextV1
```

public projection 固定为：

```ts
invocationId: string | null
```

有 ID：

```json
{
  "invocationId": "run-01JXYZ"
}
```

无 ID：

```json
{
  "invocationId": null
}
```

不建议 Receipt 省略字段，因为固定 nullable field 更方便 schema consumer。

### 9.1 Receipt 不生成 / 修改 ID

Receipt builder 禁止：

- 自动生成 ID；
- 从 receipt filename 推导 ID；
- 从 cwd / PID / timestamp 推导 ID；
- 对 ID 做 normalize；
- 从 hook env 反读 ID。

Receipt 只能消费 resolved context。

### 9.2 Receipt path 与 Invocation ID 独立

即使 caller 使用：

```text
--invocation-id run-01JXYZ
--receipt ./runs/run-01JXYZ/receipt.json
```

这只是 caller 自己建立的约定。

Promptpile 不允许：

```text
Invocation ID
→ 自动拼接 receipt path
```

这样可以避免路径穿越与 lifecycle 耦合。

---

## 10. Model isolation contract

Invocation ID 最重要的安全 / reproducibility contract 是：

> 在其它 completion inputs 相同的前提下，仅改变 `--invocation-id` 不得改变 Promptpile 构造的模型请求 body。

具体禁止进入：

```text
messages
system content
user content
assistant content
tools
tool_choice
tool arguments
temperature
extraBody
provider metadata
HTTP headers
```

### 10.1 caller 自己的 provider metadata 不受限制

如果 caller 另外通过已有：

```text
--extra-body
```

显式放入某个业务 ID，那是 caller 自己的模型配置。

Invocation ID feature 不负责删除 caller 显式提供的 provider metadata。

规范只保证：

> Promptpile 不会因为 `--invocation-id` 参数本身自动注入模型请求。

### 10.2 request-body regression test

必须有测试比较：

```text
run A: no invocation id
run B: --invocation-id run-123
```

在其它参数完全相同下，fake HTTP server 收到的 request body 必须 deep-equal。

这是比“代码里看起来没传”更强的 public contract proof。

---

## 11. Conversation / OCC isolation

Invocation ID 不属于 Conversation state。

不得进入：

```text
[idx]role.md/json
[idx]assistant.calls.jsonl
[idx]assistant.extra.json
[idx]assistant.result.jsonl
```

不得改变：

```text
Conversation scanner
canonical artifact ordering
Conversation Fingerprint v1
next index
OCC precondition
OCC claim file
conflict classification
```

因此：

```text
same physical Conversation
+ same content
+ different Invocation ID
```

必须产生完全相同的 Conversation Fingerprint。

### 11.1 不作为 OCC owner

`.promptpile.occ.claim` 不需要写入 Invocation ID。

Invocation ID：

```text
correlation hint
```

OCC claim：

```text
exclusive mutation primitive
```

二者安全等级和语义不同。

即使两个进程使用同一个 Invocation ID，OCC 仍必须完全按既有 claim / recheck 规则工作。

---

## 12. Output Artifact Policy isolation

Invocation ID 不进入：

```ts
ResolvedOutputArtifactPolicyV1
```

也不参与：

- output file collision；
- output pile target；
- Conversation namespace validation；
- hook script collision；
- future receipt target collision。

原因：ID 不是文件 target。

尤其禁止这种“方便功能”：

```text
--invocation-id run-1
→ 默认 output = run-1.md
```

或：

```text
→ 默认 receipt = run-1.receipt.json
```

所有路径必须继续由各自显式 output configuration 决定。

---

## 13. Output pile v1 明确不携带 Invocation ID

当前 output pile JSON 表示 model streaming transport，不表示整个 completion 已提交。

Invocation ID v1 不修改其事件：

```text
assistant_delta
assistant_done
error
```

不增加：

```json
{"type":"invocation", "id":"..."}
```

也不在每个 delta 上重复：

```json
{"invocationId":"..."}
```

理由：

1. output pile 是 live transport，不是 completion metadata authority；
2. `assistant_done != completion committed`；
3. Receipt 才是 future final machine outcome；
4. 给 pile 加 ID 会提前耦合未来 React/Event Protocol。

如上层需要 correlation，应该在创建 pipe/fd 时自己持有 invocation context。

---

## 14. LLM dump v1 明确不携带 Invocation ID

虽然 Invocation ID 对 debugging 有潜在价值，但 v1 不修改 LLM dump schema。

理由：

- LLM dump 是另一个 observability surface；
- dump 可能包含高度敏感 provider data；
- 为 ID 修改 dump 会扩大本次 feature scope；
- future dump schema versioning 应独立决定 correlation metadata。

因此：

```text
Invocation ID implementation
≠ LLM dump schema migration
```

---

## 15. Human diagnostics contract

v1 不自动给 stdout/stderr 加：

```text
[run-01JXYZ]
```

前缀。

原因：

- 会改变大量现有 human output；
- 很容易被上层脚本误当稳定协议；
- structured Receipt 才是长期机器接口。

如果某条 Invocation ID 自身的 validation error 需要提到输入值，由于合法 ID 只包含安全 ASCII、非法值可能包含控制字符，因此：

> validation error 不应原样回显任意 raw invalid value。

建议错误文本只描述 contract，例如：

```text
invalid invocation id: expected 1-128 characters matching [A-Za-z0-9._:-]
```

而不是：

```text
invalid invocation id: <raw attacker-controlled string>
```

这样天然避免 newline / terminal escape injection。

---

## 16. Security boundary

Invocation ID 是不可信 caller input。

即使采用受限 ASCII，也必须明确禁止把它当作：

### 16.1 path component authority

禁止 core 自动：

```ts
path.join(base, invocationId)
```

生成 output / receipt / dump / Conversation 路径。

caller 可以自己在 shell/orchestrator 中使用经过自身策略处理的 ID 构造路径；这不属于 Promptpile contract。

### 16.2 authorization identity

Invocation ID 不证明：

- 谁发起调用；
- 调用者权限；
- tenant；
- user；
- service identity。

### 16.3 idempotency / exactly-once

相同 ID：

```text
不表示同一个 invocation 已执行
不阻止重复模型请求
不阻止重复 Conversation mutation
不缓存结果
不自动 resume
```

### 16.4 secret

Invocation ID 不应承载 secret。

虽然 v1 字符集降低了注入风险，但 hook 与 Receipt 都可能持久化或传播它，因此文档应建议 caller 只放 opaque correlation token，不放：

- API key；
- access token；
- email；
-敏感业务 payload。

---

## 17. Internal API shape

建议新增独立文件：

```text
packages/promptpile/src/invocation-context.ts
```

参考结构：

```ts
export type InvocationId = string;

export interface ResolvedInvocationContextV1 {
  id: InvocationId | null;
}

export const parseInvocationId = (
  value: unknown
): InvocationId | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new Error(
      'invalid invocation id: expected 1-128 characters matching [A-Za-z0-9._:-]'
    );
  }
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(value)) {
    throw new Error(
      'invalid invocation id: expected 1-128 characters matching [A-Za-z0-9._:-]'
    );
  }
  return value;
};

export const resolveInvocationContext = (
  id: InvocationId | undefined
): ResolvedInvocationContextV1 => Object.freeze({
  id: id ?? null
});
```

具体错误类/函数名可以按代码风格微调，但以下语义不能改：

```text
CLI-only
restricted ASCII
no trim
no auto-generation
resolved null
```

---

## 18. Config integration

Invocation ID 是 CLI-only invocation metadata。

有两种可接受实现：

### 方案 A：不放入长期 `Config`

`parseCli()` 返回独立字段：

```ts
interface CliParseResult {
  ...
  invocationId?: InvocationId;
}
```

root completion 构造：

```ts
ResolvedInvocationContextV1
```

优点：不会让 general runtime config 承担 per-invocation identity。

### 方案 B：临时放入 `Config` 作为解析中转

如果现有 `resolveConfig()` wiring 更容易，可以增加：

```ts
invocationId?: InvocationId;
```

但进入 completion orchestration 后必须立刻收敛成：

```ts
ResolvedInvocationContextV1
```

后续消费者不要继续直接读 `config.invocationId`。

### 18.1 推荐

优先 **方案 A**。

理由：Invocation ID：

```text
不是 TOML-mergeable config
不是 model config
不是 output config
```

让它留在 CLI invocation metadata 层更干净。

如果 Commander / `runCli` 当前结构导致方案 A 需要大范围重构，则 v1 可以接受 B，但文档必须把它标成 wiring compromise，不改变 domain boundary。

---

## 19. Root runtime integration

建议 root completion 入口明确接收：

```ts
runCompletion(
  cwd: string,
  invocationContext: ResolvedInvocationContextV1
)
```

或者在 completion handler 创建 context 后传入内部 orchestration object。

重要的是：

```text
context 创建一次
→ downstream 只读
```

不要在：

- hook env builder；
- future Receipt builder；
- diagnostics；

各自再次解析 CLI。

### 19.1 immutable

`ResolvedInvocationContextV1` 应视为 immutable。

可以：

```ts
Object.freeze(...)
```

或通过 readonly type 保证。

不允许 hook stage 修改 ID，也不允许 future Receipt writer反向补 ID。

---

## 20. After-hook env builder API

`buildPromptpileHookEnv()` 建议新增：

```ts
invocation: ResolvedInvocationContextV1;
```

而不是：

```ts
invocationId?: string;
```

这样 hook builder 消费的是 resolved fact，不是重新拥有 optionality semantics。

伪代码：

```ts
const env: NodeJS.ProcessEnv = {
  ...process.env,
  ...existingPromptpileVars
};

delete env.PROMPTPILE_INVOCATION_ID;

if (invocation.id !== null) {
  env.PROMPTPILE_INVOCATION_ID = invocation.id;
}

return env;
```

必须先 delete 再条件赋值，以消除 stale parent env。

---

## 21. Completion Receipt integration seam

Future Receipt builder 推荐接受完整 final outcome，而不是单独传 invocation ID。

例如未来：

```ts
interface SuccessfulCompletionOutcomeV1 {
  invocation: ResolvedInvocationContextV1;
  // artifact ledger snapshot
  // hook decision
  // requested model
}
```

Receipt projection：

```ts
{
  invocationId: outcome.invocation.id
}
```

Invocation ID plan 不定义：

- Receipt target；
- Receipt write ordering；
- Receipt success-only/failure semantics；
- Receipt artifact refs；
- Receipt JSON schema 其它字段。

这里只冻结一个接口事实：

> Receipt 不解析 CLI、不读取 env、不读取 hook env、不从 path 推导 invocation ID。

---

## 22. Failure semantics

### 22.1 invalid input

```text
invalid Invocation ID
→ ordinary pre-runtime failure
→ exit 1
→ no model request
→ no root --input mutation
→ no completion artifacts
→ no hook
→ no Receipt
```

### 22.2 valid ID + later failure

Invocation ID 不改变既有 failure semantics。

例如：

```text
valid ID
→ OCC conflict
→ exit 3
```

仍然是 OCC conflict。

```text
valid ID
→ after-hook error policy failure
→ exit 1
```

仍然是 after-hook ordinary failure。

ID 不重新分类错误。

### 22.3 duplicate ID

两次独立 invocation：

```text
--invocation-id same-id
```

都合法。

Promptpile 不维护 registry，也不检查历史 Receipt。

如果 orchestrator 需要 uniqueness / dedupe，它必须自己保证。

---

## 23. Compatibility

未提供 `--invocation-id` 时：

```text
model request body
Conversation artifacts
Fingerprint
OCC
stdout
stderr
output pile
-o
hook behavior
exit semantics
```

都应与功能落地前保持兼容。

唯一 after-hook env 差异需要特别定义：

如果父进程环境里意外已有：

```text
PROMPTPILE_INVOCATION_ID=stale
```

v1 落地后，未提供 CLI ID 的 Promptpile hook **不再继承这个变量**。

这是有意的安全/确定性修正，不视为兼容性回归。

---

## 24. Tests

v1 至少需要以下测试。

### 24.1 pure parser

合法：

```text
a
A1
run-01JXYZ
foo.bar_baz:42
128-char allowed value
```

非法：

```text
""
" a"
"a "
"a b"
"a/b"
"a\\b"
"a\nb"
"中文"
129 chars
number / object / null
```

验证：

- 不 trim；
- exact preservation；
- 错误文本不回显 raw malicious input。

### 24.2 resolved context

```text
undefined → { id: null }
valid id  → { id: same exact string }
```

### 24.3 CLI pre-side-effect

非法 ID +：

```text
--input
-o ./new-parent/out.md
--output-pile-file ./new-parent/pile.jsonl
```

必须在模型请求与这些 invocation-specific side effects 前失败。

如 parser 直接在 Commander 阶段失败，测试应证明 fake API server request count 仍为 0。

### 24.4 model isolation

两次请求：

```text
without ID
with ID
```

fake provider 捕获的 JSON request body deep-equal。

还应验证 request headers 没有自动增加 Invocation ID。

### 24.5 Conversation isolation

相同输入下有/无 ID：

- assistant artifact 内容相同；
- filename/idx 不因 ID 改变；
- fingerprint 不因 ID 单独变化。

不必为模型随机性做真实网络测试，可使用 deterministic fake provider。

### 24.6 hook env

有 ID：

```text
PROMPTPILE_INVOCATION_ID == exact caller ID
```

无 ID：

```text
key absent
```

父进程预先设置 stale：

```text
PROMPTPILE_INVOCATION_ID=stale
```

但 CLI 未给 ID：hook 仍必须看不到该 key。

CLI 给 ID 时必须覆盖 stale parent value。

### 24.7 output pile isolation

有/无 ID 的 output pile text / JSON payload 格式不发生变化。

### 24.8 LLM dump isolation

如果 test suite 已稳定覆盖 dump schema，应增加断言 Invocation ID 不自动进入 dump；如果当前 dump tests 不适合扩展，至少通过代码边界保证 invocation context 不传入 dump API。

### 24.9 exit semantics

Invocation ID 不改变：

```text
ordinary failure = 1
OCC conflict = 3
successful completion = 0
```

---

## 25. Dedicated CI

建议增加或纳入现有 completion-contract workflow 的矩阵：

```text
Node 18 / Linux
Node 22 / Linux
Node 18 / Windows
Node 22 / Windows
```

至少运行：

```text
invocation-id unit tests
invocation-id CLI integration
request-body isolation
hook env integration
root completion regression
After-hook Failure Policy regression
Output Artifact Policy regression
OCC regression
```

Invocation ID 自身没有平台特有路径语义，但 hook env 和 CLI quoting 在 Windows/Linux 都必须验证。

在 workspace dedicated CI 运行前，root `package-lock.json` 必须与所有 workspace package 同步；不能因为安装阶段失败就把矩阵标记为验证完成。

---

## 26. Implementation plan

### Phase 1 — primitive

新增：

```text
src/invocation-context.ts
```

实现：

- `InvocationId`；
- `parseInvocationId()`；
- `ResolvedInvocationContextV1`；
- `resolveInvocationContext()`。

纯 unit tests。

### Phase 2 — CLI wiring

新增 root completion option：

```text
--invocation-id <id>
```

确保 parser 在 runtime side effects 前执行。

不要增加 TOML/env/profile config。

### Phase 3 — runtime context

root completion 创建一次：

```text
ResolvedInvocationContextV1
```

并作为 immutable fact 传给允许的消费者。

### Phase 4 — after-hook propagation

`buildPromptpileHookEnv()` 消费 resolved invocation context：

- ID present → exact env value；
- ID absent → delete stale inherited key。

不得修改 hook observation/policy schema。

### Phase 5 — isolation regression

证明 Invocation ID 不进入：

- model body/headers；
- Conversation artifacts；
- output pile；
- OCC；
- filename/path derivation。

### Phase 6 — Receipt seam

只建立 internal context seam / test fixture。

如果 Completion Receipt 尚未实现，不要为了 Invocation ID 预先增加假的 Receipt writer。

### Phase 7 — docs + dedicated CI

更新：

- CLI Contract；
- README；
- security documentation；
- tracking status。

远端矩阵全绿后才把本计划状态改成 `v1 已实施`。

---

## 27. Suggested file changes

预期最小实现面：

```text
packages/promptpile/src/invocation-context.ts        new
packages/promptpile/src/cli.ts                       CLI option / parser wiring
packages/promptpile/src/index.ts                     resolve/pass context
packages/promptpile/src/after-hook.ts                hook env propagation
packages/promptpile/test/invocation-id.cjs            unit
packages/promptpile/test/invocation-id-cli.cjs        integration
packages/promptpile/test/after-hook-security.cjs      env inheritance regression
CLI_CONTRACT.md / README.md / security docs           public contract
.github/workflows/...                                 dedicated/regression matrix
```

尽量不要修改：

```text
conversation scanner
fingerprint encoder
OCC claim protocol
output pile event schema
model request schema
LLM dump schema
```

如果实现需要大范围修改这些模块，说明 Invocation ID 的边界正在泄漏，应停止并重新检查设计。

---

## 28. Acceptance checklist

实施完成必须同时满足：

- [x] public surface 只有 root completion `--invocation-id <id>`；
- [x] v1 不支持 TOML invocation id；
- [x] v1 不从 process env 读取 invocation id；
- [x] Promptpile 不自动生成 invocation id；
- [x] omitted invocation id resolve 为 `null`；
- [x] 合法语言严格为 `^[A-Za-z0-9._:-]{1,128}$`；
- [x] parser 不 trim / normalize / case-fold；
- [x] parser validation error 不回显任意 raw invalid input；
- [x] invalid ID 在 root `--input` mutation 前失败；
- [x] invalid ID 在 sink preparation 前失败；
- [x] invalid ID 在 model request 前失败；
- [x] `ResolvedInvocationContextV1` 是唯一 runtime correlation fact；
- [x] Invocation ID 不进入 `ResolvedOutputArtifactPolicyV1`；
- [x] Invocation ID 不参与 file target derivation；
- [x] Invocation ID 不进入 model messages；
- [x] Invocation ID 不进入 provider request body/headers；
- [x] Invocation ID 不进入 tool args / tool definitions；
- [x] Invocation ID 不进入 Conversation artifacts / filenames / idx；
- [x] Invocation ID 不影响 Conversation Fingerprint；
- [x] Invocation ID 不参与 OCC claim/precondition；
- [x] Invocation ID 不进入 output pile text/JSON；
- [x] Invocation ID 不进入 LLM dump v1；
- [x] Invocation ID 不自动加到 stdout/stderr diagnostics；
- [x] after-hook 有 ID 时收到 exact `PROMPTPILE_INVOCATION_ID`；
- [x] after-hook 无 ID 时该 env key absent；
- [x] stale parent `PROMPTPILE_INVOCATION_ID` 不泄漏到无-ID hook；
- [x] CLI ID 覆盖 stale parent env；
- [x] 不新增 hook child invocation id；
- [x] future Receipt seam 固定为 `invocationId: string | null`；
- [x] Receipt 不从 env/path/hook 反推 invocation id；
- [x] duplicate ID 不被 Promptpile 当错误；
- [x] Invocation ID 不承担 authorization / idempotency / exactly-once；
- [x] 不提供 ID 时除 stale hook env 安全修正外行为兼容；
- [ ] Node 18/22 × Windows/Linux dedicated/regression CI 全绿；
- [x] CLI Contract、README、安全文档更新。

---

## 29. Freeze 后允许的兼容演进

以下未来扩展必须独立设计，不属于 v1 隐含承诺：

### 29.1 Receipt

Completion Receipt v1 可以正式公开：

```json
"invocationId": "..."
```

或：

```json
"invocationId": null
```

但不得改变 Invocation ID parser contract。

### 29.2 structured diagnostics

未来如果出现版本化 structured diagnostic protocol，可以显式决定是否携带 Invocation ID。

不能因为 v1 有 correlation context 就默认 human stderr 格式属于机器协议。

### 29.3 output pile / Agent Event Protocol

如果 future Agent Event Protocol 需要 correlation，应在那个协议的 schema/version 中设计。

不要 retroactively 认为 output pile v1 已经承诺 Invocation ID metadata。

### 29.4 auto-generated IDs

如果未来确实需要 Promptpile 自生成 ID，必须回答：

- 生成时机；
- caller 如何在运行前知道；
- retry 是否复用；
- 与 Receipt path / React run 的关系；
- entropy / format / compatibility。

因此必须作为独立版本演进，而不是悄悄在 `id = null` 时生成。

---

## 30. 最终架构位置

Invocation ID v1 完成后，底层 completion architecture 应保持：

```text
Caller
  │
  ├─ completion configuration
  │        ↓
  │   Output Artifact Policy
  │
  └─ --invocation-id
           ↓
     ResolvedInvocationContextV1
           │
           ├──────────────→ after-hook env
           │
           └──────────────→ future Successful Completion Outcome
                                      ↓
                              Completion Receipt
```

而 Conversation 主链保持完全独立：

```text
Conversation
→ Fingerprint
→ OCC
→ mutation
```

模型主链也保持独立：

```text
messages/tools/config
→ model request
→ output lifecycle
```

Invocation ID 只在最终 orchestration 层把允许的 observation 关联起来。

这正是 v1 的边界：

> **它是 correlation primitive，不是业务协议。**

---

## 31. 实施前最终结论

本计划冻结以下唯一实现方向：

```text
caller-supplied
CLI-only
optional
restricted ASCII
exact preservation
no auto-generation
pre-side-effect validation
independent resolved context
hook env propagation
future Receipt propagation
no model / Conversation / output-pile leakage
```

实施阶段不再讨论：

- 是否支持 Unicode；
- 是否自动生成；
- 是否从 TOML/env 读取；
- 是否进入 output pile；
- 是否进入 LLM dump；
- 是否需要 hook child ID；
- 是否作为 OCC owner；
- 是否自动构造 Receipt 路径。

这些答案在 v1 全部固定为：**否**。

下一层 `COMPLETION_RECEIPT_PLAN.md` 只需要消费：

```text
ResolvedInvocationContextV1
```

而不再重新设计 invocation identity。
