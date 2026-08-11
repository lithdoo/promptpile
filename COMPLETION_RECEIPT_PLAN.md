# Promptpile Completion Receipt v1 实施闭环设计

> 状态：实现与 CR-1 / CR-2 closure 完成，Freeze 待 dedicated matrix 复验
> 初始设计日期：2026-08-07  
> 闭环设计更新：2026-08-11  
> 核心提案：Completion Receipt v1 是一次 **successful root completion 的最终 durable witness**。它以可选、原子发布的 JSON 文件描述本 invocation 已成功提交的 completion artifacts、调用关联信息、provider 可观察 metadata 与 after-hook 最终非致命状态；它不是通用运行日志、失败报告、事务日志或 Conversation 的第二份正文。

---

## 0. 最终结论

Completion Receipt v1 只回答一个问题：

> **本次 root completion 是否已经越过所有 required completion stages，并最终原子发布了一个机器可消费的 completed witness；如果是，这次调用实际提交了哪些 durable completion artifacts，以及有哪些非致命完成事实？**

最终主链固定为：

```text
ResolvedInvocationContextV1
        +
Model Result Metadata
        +
CompletionArtifactLedger
        +
Final After-hook Policy Decision
        ↓
SuccessfulCompletionOutcomeV1
        ↓
pure Receipt projection
        ↓
atomic Receipt publication
        ↓
final process success
```

核心不变量：

1. **Receipt v1 是 success-only protocol。** `schemaVersion = 1` 时唯一合法顶层状态是 `status = "completed"`；v1 不发布 `failed` Receipt。
2. **本 invocation 新发布的有效 completed Receipt 是最终完成 witness。** 它只在所有前置 required completion stages 已完成、after-hook 没有 fatal policy impact、Receipt 自身成功原子发布后存在。
3. **Receipt 不提供跨文件事务。** 在 Receipt 发布前发生失败时，已经提交的 output pile / main / Conversation artifacts 可以保留；因此 `no new Receipt` 不等于 `nothing was written`。
4. **Receipt 只引用实际 committed artifacts。** artifact presence 只能来自 `CompletionArtifactLedger`，不能重新扫描文件系统、根据模型结果猜测或重新推导路径。
5. **Receipt 是最后一个 fallible required completion stage。** Receipt 之后不得再增加会重新定义 completion success 的 required stage；未来新增 required stage 必须放在 Receipt 之前，或升级 Receipt contract。
6. **Invocation ID 只由 `ResolvedInvocationContextV1` 提供。** Receipt 不生成、不解析、不从 env/path/PID/cwd 推导 invocation identity。
7. **Provider metadata 是 observation，不是 artifact truth。** `model`、`finishReason`、`usage` 描述 Promptpile 实际已知的请求/流观察事实，不参与 artifact presence 推导。
8. **After-hook public projection 只保存结构化必要事实。** 不复制 raw stdout、raw stderr、stderr tail、spawn error message 或 hook environment。
9. **Receipt path 是 caller-managed output slot。** Promptpile 不根据 Invocation ID 自动生成 Receipt path，也不保证复用同一路径时旧 Receipt 能代表当前 invocation。
10. **Receipt 是 local operational metadata，不是 portable archive manifest。** v1 artifact/hook path 使用本机 absolute path；跨机器可移植性属于 Archive/Fork/Bundle 等独立能力。

职责边界固定为：

```text
Output Artifact Policy
  负责：Receipt target resolution、collision/namespace protection、parent preparation

Completion runtime
  负责：完成 required stages、形成最终成功事实、决定是否允许进入 Receipt stage

CompletionArtifactLedger
  负责：记录本 invocation 实际成功提交的 durable completion artifacts

ResolvedInvocationContextV1
  负责：唯一 invocation correlation fact

After-hook Policy
  负责：observation → none | warning | error

Completion Receipt builder
  负责：把已完成事实投影为 public v1 JSON；不做 orchestration 决策

Atomic file primitive
  负责：same-directory temp + fsync/close + rename 的原子 publication
```

---

## 1. 动机

上层 orchestrator 不能可靠依赖：

- stdout 自然语言流；
- “目录中最新文件”；
- PID；
- 目录前后差集；
- hook stderr；
- 通过扫描 Conversation 猜测当前 completion 产物。

这些方式要么不是稳定机器协议，要么在 layered I/O、并发、partial failure 下存在歧义。

Receipt 提供一个明确的 invocation result index：

```text
completion process
        ↓
实际 artifacts 已提交
        ↓
hook 已观察并完成 policy decision
        ↓
Receipt 原子发布
        ↓
orchestrator 读取稳定 JSON
```

它不保存第二份正文，不替代 Conversation Protocol，也不证明 tool execution 完整性。

---

## 2. v1 范围

v1 负责：

1. root completion `--receipt <path>`；
2. TOML `[promptpile].receipt`；
3. CLI > TOML > absent precedence；
4. Receipt target 进入 Output Artifact Policy；
5. target collision / Conversation namespace / hook path protection；
6. parent preparation；
7. success-only completed Receipt；
8. `invocationId: string | null`；
9. committed artifact absolute path references；
10. resolved requested model；
11. nullable finish reason / usage observation；
12. sanitized after-hook status projection；
13. atomic publication；
14. Receipt write failure = ordinary failure；
15. public JSON Schema；
16. npm package 中发布 schema copy；
17. Node 18/22 × Linux/Windows dedicated contract tests。

v1 不负责：

- failure Receipt；
- realtime event stream；
- NDJSON RPC；
- transaction rollback；
- exactly-once；
- idempotency；
- tool execution success证明；
- hook stdout protocol；
- prompt/body/reasoning/tool args复制；
- portable relative manifest；
- run/session/workflow/world state；
- telemetry backend；
- distributed tracing；
- Receipt fd target；
- 自动生成 Receipt path；
- 自动删除旧 Receipt；
- 将 Receipt 写进 Conversation message sequence。

---

## 3. 术语

### 3.1 completed Receipt

一个通过 Completion Receipt v1 JSON Schema 校验，且由当前 invocation 在 Receipt stage 成功原子发布的 Receipt 文件。

### 3.2 new Receipt

“当前 invocation 新发布”的 Receipt。Receipt path 上预先存在的历史文件不自动属于当前 invocation。

### 3.3 successful completion candidate

所有 Receipt 之前的 required completion stages 已成功，且 after-hook policy impact 不是 `error`；此时 runtime 才有资格进入 Receipt stage。

### 3.4 durable completion artifact

由 Promptpile completion runtime 成功提交并登记进入 `CompletionArtifactLedger` 的 main / Conversation artifact。

### 3.5 provider metadata observation

Promptpile 从当前 model request / compatible streaming response 中实际观察到的 metadata，例如 requested model、finish reason、usage。缺失或非法 observation 使用 `null`，不反向推导其它事实。

---

## 4. Public CLI / TOML contract

### 4.1 CLI

```bash
promptpile \
  -d ./messages \
  --continue \
  --receipt ./run/completion-receipt.json
```

`--receipt` 只属于 root completion。

Conversation domain commands 不接受：

```text
promptpile conversation inspect
promptpile conversation fingerprint
promptpile conversation append-user
```

上的 root Receipt option。

### 4.2 TOML

```toml
[promptpile]
receipt = "./run/completion-receipt.json"
```

### 4.3 precedence

固定：

```text
CLI --receipt
>
TOML [promptpile].receipt
>
absent
```

### 4.4 relative path base

v1 固定：CLI 与 TOML Receipt relative path 都相对 **process cwd**。

不要改成 Conversation anchor-relative。After-hook TOML path 与 Receipt path 可以拥有不同 path-base semantics；这是各自协议的一部分，不应为了表面统一而改写。

### 4.5 configured requiredness

```text
Receipt 未配置
→ Receipt stage 不参与 completion success

Receipt 已配置
→ Receipt publication 是 required stage
```

配置了 Receipt 但最终无法成功发布时，进程不得以 success 结束。

---

## 5. Receipt target resolution 与 Output Artifact Policy

Receipt target 必须成为 `ResolvedOutputArtifactPolicyV1` 的正式成员：

```ts
receipt?: ResolvedFileTarget;
```

并参加与其它 potential file targets 相同的 pre-model / pre-sink validation。

### 5.1 collision set

至少包含：

```text
main body
main calls
main extra
file output pile
completion receipt
resolved runnable after-hook
Conversation protected namespace/control paths
```

Receipt 不允许与任意 potential main sidecar target 冲突，即使本轮模型最终没有产生 calls/extra。

例如：

```text
-o ./result.md
--receipt ./result.calls.jsonl
```

必须在模型调用前失败。

### 5.2 Conversation namespace protection

Receipt 永远不是 Conversation Protocol artifact。

因此，无论本轮是否启用 `--continue` / `--input`，Receipt target 只要位于任一 effective Conversation input/output layer 中，就不得使用：

- scanner 可识别的 Conversation artifact filename；
- `.promptpile.occ.claim` 等保留控制路径。

例如：

```text
--receipt ./messages/[4]assistant.md
```

即使是 read-only completion，也必须 pre-model failure。

### 5.3 hook collision

若 after-hook resolution 得到 runnable canonical hook path，则 Receipt target 不得覆盖该 hook 文件。

### 5.4 lexical + prepared identity

Output Policy 应先按 lexical absolute target 验证，再在 parent preparation 后使用 canonical parent identity 重复验证，以处理 symlinked parent 与 Windows case-insensitive identity。

Receipt 不自行实现另一套 collision logic。

---

## 6. 最终内部完成边界：SuccessfulCompletionOutcomeV1

为了防止 Receipt builder 直接耦合 root orchestration，v1 的维护方向应收敛为一个内部 successful outcome：

```ts
interface SuccessfulCompletionOutcomeV1 {
  invocation: ResolvedInvocationContextV1;

  model: {
    requested: string;
    finishReason: string | null;
    usage: CompletionUsage | null;
  };

  artifacts: CompletionArtifactSnapshotV1;

  hook: CompletedAfterHookDecisionV1;
}
```

其中：

```ts
type CompletedAfterHookDecisionV1 =
  AfterHookPolicyDecisionV1 & {
    impact: 'none' | 'warning';
  };
```

这不是 public Receipt schema，而是内部 ownership boundary。

目标是：

```text
root runtime
→ 决定是否已经 successful
→ 形成 SuccessfulCompletionOutcomeV1

receipt module
→ 只把 successful outcome 投影成 JSON
```

Receipt builder 不应：

- scan filesystem；
- 重新 evaluate OCC；
- 重新 evaluate after-hook policy；
- 推导 artifact filename；
- 读取 CLI argv；
- 读取 process env；
- 调用模型；
- 决定 process exit code。

当前实现已经接近这一边界；Freeze closure 时允许继续收敛，但不得借此扩展 public protocol。

---

## 7. Public Receipt v1 schema

当前 public shape：

```ts
interface CompletionReceiptV1 {
  schemaVersion: 1;
  status: 'completed';
  invocationId: string | null;
  artifacts: {
    assistant: string | null;
    calls: string | null;
    extra: string | null;
    mainOutput: string | null;
    mainCalls: string | null;
    mainExtra: string | null;
  };
  model: string;
  finishReason: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
  hook: CompletionReceiptHookV1;
}
```

Normative machine contract：

```text
doc/15-contracts/completion-receipt-v1.schema.json
```

npm package 的 `dist/completion-receipt-v1.schema.json` 是该 normative schema 的发布副本，构建/测试必须验证二者一致。

### 7.1 top-level status

v1 唯一允许：

```json
{
  "schemaVersion": 1,
  "status": "completed"
}
```

禁止在 schemaVersion 1 中添加：

```text
failed
partial
cancelled
conflicted
```

如果未来需要通用 failure report，应设计新协议或新 schema version。

---

## 8. Invocation ID semantics

Receipt 必须消费已经 resolved 的：

```ts
ResolvedInvocationContextV1
```

规则：

```text
caller 提供合法 ID
→ invocationId = exact caller ID

caller 未提供
→ invocationId = null
```

Receipt 禁止：

- 自动生成 UUID/ULID；
- 从 Receipt filename 推导；
- 从 cwd/PID/timestamp 推导；
- 读取 `PROMPTPILE_INVOCATION_ID`；
- 从 after-hook observation 反推；
- 重新 parse argv。

Invocation ID 是 correlation primitive，不是 Receipt path owner、事务 ID 或幂等键。

---

## 9. Artifact slot semantics

Artifact fields 只能由当前 invocation 的 `CompletionArtifactLedger` 投影。

固定映射：

```text
artifacts.assistant
← conversation / body

artifacts.calls
← conversation / calls

artifacts.extra
← conversation / extra

artifacts.mainOutput
← main / body

artifacts.mainCalls
← main / calls

artifacts.mainExtra
← main / extra
```

### 9.1 null 的精确含义

```json
"calls": null
```

表示：

> 当前 invocation 没有成功 commit 对应 durable completion artifact。

它不是 Receipt reader 对当前 filesystem 状态做实时 `exists()` 后得到的结论。

### 9.2 path 语义

非 null artifact field 固定为：

> runtime 实际登记的 normalized absolute artifact path。

文档不要使用“portable relative path”或未经实现保证的“full canonical realpath”术语。

### 9.3 不进入 artifacts 的对象

以下内容明确不属于 v1 durable completion artifact slots：

```text
stdout
stderr
output pile file/fd
--input 追加的 user artifact
assistant.result.jsonl / tool execution results
hook-created files
Receipt 自身
临时文件
```

原因：

- output pile 是 live transport，不是 durable body authority；
- `--input` 是 pre-model Conversation mutation，不是 model completion result；
- tool execution results 属于后续 Tool Artifact lifecycle；
- hook-created files 没有进入 Promptpile Artifact Ledger；
- Receipt 不自引用。

---

## 10. Model metadata semantics

### 10.1 `model`

v1 `model` 表示：

> Promptpile 为本 invocation 解析得到并发送请求时使用的 **requested model identifier**。

它不承诺等于 provider 内部真实路由到的 backend model。

v1 保留字段名 `model`，但 normative 文档必须按上述语义解释。

### 10.2 `finishReason`

Promptpile 从 compatible streaming response 中观察最后一个可用非-null string `finish_reason`。

```text
观察到合法字符串
→ 原样写入

未观察到
→ null
```

`null` 的含义是：

> 当前 stream 没有向 Promptpile 提供可用 finish reason observation。

不是“模型明确返回无 finish reason”。

不得把 v1 finish reason 限制为固定 enum；兼容 gateway 可以提供额外字符串。

### 10.3 `usage`

只有当 stream 提供完整且合法的：

```text
prompt_tokens
completion_tokens
total_tokens
```

并且三者都是 safe integer、`>= 0` 时，才投影为：

```json
{
  "inputTokens": 5,
  "outputTokens": 2,
  "totalTokens": 7
}
```

否则：

```json
"usage": null
```

`null` 表示 provider stream 没有提供完整可用 usage observation，不表示 zero usage。

v1 不强制：

```text
totalTokens == inputTokens + outputTokens
```

这是 provider-reported metadata，不应由 Receipt producer重新发明计算规则。

### 10.4 metadata 与 artifact 独立

禁止建立：

```text
finishReason == tool_calls ⇒ calls != null
calls != null ⇒ finishReason == tool_calls
usage != null ⇒ artifact presence 某种状态
```

Artifact truth 和 provider metadata observation 是正交维度。

---

## 11. After-hook Receipt projection

Receipt 必须记录 after-hook 的结构化完成事实，但不能把 executor 的内部对象直接 `JSON.stringify` 成 public protocol。

v1 public statuses：

```text
skipped
invalid_explicit
succeeded
spawn_failed
exited_nonzero
signaled
```

允许的必要附加事实包括：

- `failureMode`；
- skip reason；
- attempted/path；
- exitCode；
- signal；
- optional spawn error code。

明确禁止进入 Receipt：

```text
hook stdout
stderrTail
stderrTruncated
raw stderr
spawn error message
full Error object
hookEnv
process.env
```

### 11.1 completed Receipt 的 hook state invariant

运行时已经规定：

```text
failed hook observation + failureMode=error
→ impact=error
→ ordinary failure
→ no completed Receipt
```

因此 public schema 也必须表达同样的 state machine。

合法 completed Receipt：

```text
skipped + warn/error
succeeded + warn/error
failed observation + warn
```

不可能/必须拒绝：

```text
invalid_explicit + error
spawn_failed + error
exited_nonzero + error
signaled + error
```

出现在 `status: "completed"` Receipt 中。

**CR-1 closure（2026-08-11 已完成）：** JSON Schema 已拒绝上述不可能组合；producer builder 同时拒绝 fatal after-hook decision，并由独立 schema regression test 覆盖合法与非法状态矩阵。

### 11.2 `reason` 稳定性

`invalid_explicit.reason` 当前可能含 filesystem diagnostic text。

v1 消费者不得把 `reason` 当稳定 machine enum 解析；稳定机器分支应基于 `status` / `failureMode` / exit/signal 等结构化字段。

未来若需要稳定 reason taxonomy，应引入明确 reason code，而不是要求 consumer 解析 OS/Node error message。

---

## 12. Stage ordering

Receipt 的固定完成顺序：

```text
deterministic validation
→ sink preparation
→ model stream
→ output pile finalize
→ main artifact group
→ terminal tool-call postlude
→ Conversation commit / OCC decision
→ after-hook execution or skip observation
→ after-hook policy decision
→ successful completion outcome
→ atomic Receipt publication
→ final process success
```

### 12.1 Receipt 必须在 after-hook 之后

原因：completed Receipt 必须能准确表达 hook 最终 observation，且 `failureMode=error` 的 hook failure 不允许发布 completed Receipt。

### 12.2 Receipt 必须是最后 required stage

Receipt 之后不得新增会导致当前 completion 变成失败的 required operation，例如：

```text
required second hook
required upload
required metadata sidecar
required remote callback
required post-receipt mutation
```

否则：

```text
completed Receipt exists
```

将不再表示 completion 已越过所有 required stages。

允许存在的 Receipt 后操作只能是不会改变 completion outcome 的 best-effort / process teardown 行为。

---

## 13. Success-only existence semantics

v1 最关键的存在性规则：

```text
本 invocation 新发布 completed Receipt
⇒
本 invocation 达到 successful terminal state
```

但：

```text
没有新 Receipt
⇏
本 invocation 没有产生任何 artifact
```

因为下列场景都可能保留前置 artifacts：

- main group 部分写入后失败；
- Conversation OCC conflict 前 main 已提交；
- Conversation partial I/O failure；
- hook `error` failure；
- Receipt 自身 write failure。

因此 orchestrator 在失败路径需要结合：

```text
process exit code
+
known output locations / Conversation protocol
```

进行诊断；Receipt v1 本身不承担失败报告职责。

---

## 14. Failure matrix

| Stage / outcome | 已提交 artifacts | 新 completed Receipt | Exit |
| --- | --- | --- | --- |
| deterministic CLI/config/target validation fail | 无本轮 completion artifacts | 否 | 1 |
| OCC preflight conflict | 无 completion artifacts | 否 | 3 |
| API/model failure | live transport 可能已 partial | 否 | 1 |
| configured output pile failure | pile 可能 partial | 否 | 1 |
| main body 成功、main sidecar failure | 成功 prefix 保留 | 否 | 1 |
| Conversation OCC conflict | pile/main 可保留 | 否 | 3 |
| Conversation ordinary/partial I/O failure | 已成功 prefix 保留 | 否 | 1 |
| hook skipped | 前置 artifacts 保留 | 是 | 0 |
| hook succeeded | 前置 artifacts 保留 | 是 | 0 |
| hook failed + `warn` | 前置 artifacts 保留 | 是，记录 failed hook observation | 0 |
| hook failed + `error` | 前置 artifacts 保留 | 否 | 1 |
| Receipt write failure | 所有前置 artifacts 保留 | 否 | 1 |
| all required stages success | artifacts 保留 | 是 | 0 |

Receipt 不改变既有 OCC exit code：

```text
ordinary failure = 1
Conversation conflict = 3
success = 0
```

---

## 15. Receipt write failure

配置 Receipt 后，Receipt publication 是 required stage。

如果此前：

```text
model success
main success
Conversation success
hook impact none/warning
```

但 Receipt write 失败：

```text
Receipt failure
→ ordinary primary failure
→ exit 1
→ no new valid Receipt
→ prior artifacts preserved
→ hook 不重跑
→ model 不重跑
```

不得把 Receipt write failure 降级成 warning + exit 0。

`CompletionArtifactLedger` 只有在 Receipt atomic publication 成功后，才能登记：

```text
namespace = receipt
kind = receipt
```

失败的 Receipt 不得进入 ledger。

---

## 16. Atomic publication contract

Receipt 使用现有 atomic file primitive：

```text
same-directory temp
→ exclusive temp create
→ write UTF-8 JSON
→ fsync temp file
→ close
→ atomic rename to target
→ best-effort parent directory fsync
→ ledger record
```

### 16.1 保证范围

v1 保证的是：

> **atomic visibility**：正常 reader 不应看到半写 JSON。

不要过度承诺：

> 所有 filesystem / OS / power-loss 情况下绝对 durable。

parent directory fsync 的效果受平台与 filesystem 能力限制。

### 16.2 failure before rename

```text
write/fsync/close/rename 前失败
→ 不发布新的 valid Receipt
→ temp cleanup best effort
```

消费者不得扫描实现内部 temp filename 来判断 invocation 状态。

---

## 17. Stale Receipt / target reuse

Receipt path 是 caller-managed output slot，可能预先存在旧文件。

例如：

```text
run A
--receipt ./receipt.json
→ success，receipt.json 属于 A

run B
--receipt ./receipt.json
→ model failure before Receipt stage
```

当前正确语义是：

```text
run B exit 1
旧 receipt.json 可以仍然存在
```

因此以下推理是错误的：

```text
exists(receiptPath)
⇒ 当前 invocation success
```

正确 contract：

> **只有当前 invocation 新发布的 Receipt 才是当前 completion witness。预先存在、被复用的 Receipt path 不能单凭文件存在性证明当前 invocation 成功。**

### 17.1 caller guidance

严肃 orchestrator SHOULD 为每次 invocation 使用唯一 Receipt path，例如：

```text
./runs/<caller-controlled-id>/completion-receipt.json
```

Promptpile 不根据 Invocation ID 自动生成该路径。

若 caller 复用路径，至少必须结合：

```text
process exit == 0
+
receipt.invocationId == expected invocation id（若提供）
```

而不能只检查文件存在。

### 17.2 不自动删除旧 Receipt

v1 不在 invocation 开始时主动 unlink 旧 Receipt。

理由：失败 invocation 不应无条件销毁此前成功 invocation 的 durable metadata；freshness/correlation 属于 caller output-slot policy。

**CR-2 closure（2026-08-11 已完成）：** 回归测试已证明“预存 Receipt + 新 invocation 在 publication 前失败”时旧文件原字节保留、历史 Invocation ID 不变；CLI contract 与 package README 已给出 caller freshness/correlation guidance。

---

## 18. Security / privacy boundary

Receipt 明确禁止复制：

```text
assistant body
reasoning content
tool arguments
prompt/messages
API key
Authorization header
process.env
hook stdout
hook stderr / stderr tail
spawn error message
LLM request body
LLM response full body
```

但 Receipt **确实可以包含本地敏感元数据**：

```text
absolute artifact paths
hook path
invalid explicit attempted path
filesystem diagnostic reason text
model identifier
caller Invocation ID
```

因此：

> Receipt 是 local operational metadata，不应默认视为可公开发布、已脱敏的 artifact。

如果上层要上传/公开 Receipt，应自行评估路径和 correlation metadata 暴露风险。

---

## 19. JSON encoding

当前 producer 固定：

```ts
JSON.stringify(receipt, null, 2) + '\n'
```

因此实现约定：

```text
UTF-8
no BOM
2-space pretty JSON
trailing LF
```

但 whitespace / key order **不是 consumer semantics**。

机器消费者必须 JSON parse + schema validate，不应依赖 byte-for-byte 文本格式。

---

## 20. JSON Schema 与 versioning

Normative source：

```text
doc/15-contracts/completion-receipt-v1.schema.json
```

package distribution copy：

```text
packages/promptpile/dist/completion-receipt-v1.schema.json
```

CI 必须验证发布副本与 normative source deep-equal。

### 20.1 closed object

v1 schema 使用：

```text
additionalProperties = false
```

因此 public field 增删不是“随便加 metadata”，而是 protocol contract 变化。

### 20.2 schemaVersion

v1 顶层固定：

```json
"schemaVersion": 1
```

需要改变下列核心语义时应优先设计 v2：

- failure Receipt；
- portable relative refs；
- 新 completion terminal states；
- 破坏现有 hook state machine；
- 将 Receipt 改为 transaction manifest。

### 20.3 v1 schema closure

Freeze 前 schema 必须至少表达：

```text
completed + failed hook observation
⇒ failureMode == warn
```

避免 public schema 接受 runtime 永远不会生产的状态。

---

## 21. Receipt 与 Conversation / Tool Artifact Protocol 的关系

### 21.1 Conversation

Conversation artifacts 仍是正文、tool calls、reasoning sidecar 的权威来源。

Receipt 只是路径索引，不复制正文。

### 21.2 Tool execution

Receipt 中：

```text
artifacts.calls != null
```

只说明 model completion 成功提交了 tool-call artifact。

它不证明：

```text
tool 已执行
assistant.result.jsonl 完整
业务操作成功
exactly-once
```

这些仍由 Tool Artifacts / MCP check 等独立能力定义。

### 21.3 Output pile

Output pile 是 streaming transport，不进入 Receipt artifacts。

即使 configured pile 是 required sink，它也不是 durable body authority。

### 21.4 `--input`

root `--input` user append 是 pre-model Conversation mutation，不属于当前 model completion result，因此不进入 Receipt artifacts。

---

## 22. Receipt 与 Invocation ID 的闭环

最终 correlation 链固定：

```text
caller --invocation-id
        ↓
ResolvedInvocationContextV1
        ├─→ after-hook env
        └─→ SuccessfulCompletionOutcomeV1
                    ↓
             Completion Receipt
```

Receipt 不拥有 Invocation ID parser，不拥有 auto-generation，也不决定 ID uniqueness。

因此：

```text
Invocation ID
= correlation fact

Receipt
= successful completion fact
```

两者正交但可组合。

---

## 23. Ecosystem boundary

v1 Receipt 只由 `promptpile` root completion 产生。

`promptpile-react`、Compress、Fork、MCP 等包不应为了“统一”自行伪造 Promptpile Completion Receipt v1。

未来如果这些包需要自己的 run result，应拥有各自协议，或显式消费 root Promptpile Receipt。

Receipt v1 不自动进入：

```text
React Agent Event Protocol
Archive Protocol
Fork Protocol
output pile protocol
LLM dump protocol
```

Protocol Package extraction 只能共享已冻结的纯 schema/types，不应反向改变 Receipt runtime semantics。

---

## 24. Implementation phases / closure plan

当前实现主体已经完成。Freeze closure 只允许做必要收口，不进行 scope expansion。

### Phase 0 — 已完成：target/config wiring

- CLI/TOML Receipt config；
- CLI precedence；
- cwd-relative path；
- root-only CLI boundary；
- Output Artifact Policy target；
- collision / Conversation namespace / hook protection。

### Phase 1 — 已完成：model metadata

- streaming finish reason observation；
- normalized usage observation；
- nullable semantics。

### Phase 2 — 已完成：Receipt builder / writer

- Invocation Context consumption；
- Artifact Ledger projection；
- sanitized hook projection；
- deterministic JSON；
- atomic publication；
- ledger record after successful publication。

### Phase 3 — 已完成：public schema / package distribution

- normative JSON Schema；
- package `dist` schema copy；
- schema copy equality regression。

### Phase 4 — 已完成：Freeze blocker CR-1

收紧 hook schema：

```text
failed hook observation + completed Receipt
→ only failureMode=warn
```

并增加 producer/schema tests。

### Phase 5 — 已完成：Freeze blocker CR-2

补 stale Receipt target reuse contract test：

```text
pre-existing receipt
+ new invocation failure before receipt publication
→ old receipt remains historical
→ no claim that current invocation published it
```

同时将 caller freshness guidance 写入 CLI/public contract docs。

### Phase 6 — optional internal cleanup, non-blocking

可把 root runtime 最终事实收敛为：

```text
SuccessfulCompletionOutcomeV1
```

使 Receipt builder 只接受 successful outcome。

这是 ownership purity 优化；只要现有行为测试保持不变，不要求作为 v1 Freeze blocker。

---

## 25. Unit tests

### 25.1 Receipt builder

覆盖：

- invocation ID exact / null；
- ledger slot → public artifact mapping；
- absent slot → null；
- model/finishReason/usage projection；
- hook variants；
- no raw stderr / spawn message / env。

### 25.2 Model metadata normalization

覆盖：

- complete valid usage；
- missing usage；
- partial usage；
- negative / unsafe integer usage；
- finish reason present / absent；
- provider-specific arbitrary finish reason string。

### 25.3 Schema

必须验证：

- current producer examples pass；
- additional property rejected；
- invalid Invocation ID rejected；
- invalid usage rejected；
- exited_nonzero exit code cannot be zero；
- **completed + failed hook + failureMode=error rejected**。

---

## 26. Root integration tests

必须覆盖：

1. Receipt 未配置 → completion 行为不变；
2. quiet + Receipt → 不解析 stdout 也可获得结果；
3. main + Conversation artifacts 已存在后 Receipt 可见；
4. hook 执行时 Receipt 尚不可见；
5. hook success → completed Receipt；
6. hook skipped → completed Receipt；
7. hook failure + warn → exit 0 + completed Receipt + failed hook observation；
8. hook failure + error → exit 1 + no new Receipt + prior artifacts preserved；
9. API failure → no new Receipt；
10. output pile failure → no new Receipt；
11. main failure → no new Receipt；
12. OCC conflict → exit 3 + no new Receipt；
13. Conversation failure → no new Receipt；
14. Receipt write failure → exit 1 + prior artifacts preserved；
15. Receipt collision with main/pile → pre-model failure；
16. Receipt collision with Conversation protocol namespace → pre-model failure；
17. Receipt collision with runnable hook → pre-model failure；
18. layered Conversation artifact refs 唯一；
19. invocation ID exact / null；
20. stale reused Receipt path regression。

---

## 27. Dedicated CI

Dedicated workflow：

```text
.github/workflows/invocation-id-receipt.yml
```

矩阵：

```text
Node 18 / Ubuntu
Node 22 / Ubuntu
Node 18 / Windows
Node 22 / Windows
```

至少运行：

```text
invocation context tests
Receipt JSON Schema contract tests
Receipt integration tests
After-hook security regression
Output Artifact Policy regression
resolve-config regression
root OCC regression
```

当前 2026-08-11 专项矩阵已经四组全绿。

CR-1 / CR-2 closure 已通过本地 workflow 等价测试与 `npm test -w promptpile`；Freeze 前仍必须再次跑同一远端矩阵，不能以本地结果替代。

---

## 28. Acceptance checklist

### Public contract

- [x] root completion 支持 `--receipt <path>`；
- [x] TOML `[promptpile].receipt` 支持；
- [x] CLI > TOML > absent；
- [x] relative Receipt path 相对 process cwd；
- [x] Conversation subcommands 不接受 root Receipt option；
- [x] v1 `schemaVersion = 1`；
- [x] v1 `status = completed`；
- [x] v1 不发布 failure Receipt；
- [x] `additionalProperties = false`；

### Output policy / filesystem

- [x] Receipt target 进入 `ResolvedOutputArtifactPolicyV1`；
- [x] 与 main potential targets collision 预检；
- [x] 与 file output pile collision 预检；
- [x] 与 runnable hook collision 预检；
- [x] 所有 effective Conversation layers 的 protocol namespace 受保护；
- [x] `.promptpile.occ.claim` 等控制路径受保护；
- [x] parent preparation 后重复 canonical identity validation；
- [x] Receipt publication 使用 same-dir atomic writer；
- [x] publication 成功后才登记 Receipt ledger entry；

### Artifact semantics

- [x] artifact presence 只来自 `CompletionArtifactLedger`；
- [x] Conversation body/calls/extra 映射固定；
- [x] main body/calls/extra 映射固定；
- [x] absent committed artifact → null；
- [x] output pile 不进入 artifact slots；
- [x] `--input` user artifact 不进入 Receipt；
- [x] tool result artifacts 不进入 Receipt；
- [x] Receipt 不复制 assistant/reasoning/tool args；

### Invocation / model metadata

- [x] Receipt 消费 `ResolvedInvocationContextV1`；
- [x] no ID → `invocationId = null`；
- [x] Receipt 不生成/推导 Invocation ID；
- [x] `model` 为 resolved requested model identifier；
- [x] finish reason unavailable → null；
- [x] usage unavailable/invalid/incomplete → null；
- [x] model metadata 不反向决定 artifact presence；

### Hook semantics

- [x] Receipt 在 hook 之后；
- [x] hook warning failure 可以生成 completed Receipt；
- [x] hook error failure 不生成 completed Receipt；
- [x] raw hook stderr 不进入 Receipt；
- [x] spawn error message/env 不进入 Receipt；
- [x] **CR-1：JSON Schema 禁止 completed Receipt 中 failed hook + `failureMode=error` 不可能状态；**

### Completion / failure semantics

- [x] Receipt configured 时是 required stage；
- [x] Receipt write failure → exit 1；
- [x] Receipt write failure 不回滚 prior artifacts；
- [x] OCC conflict 保持 exit 3；
- [x] Receipt 是 completion 主链最后 fallible required stage；
- [x] no new Receipt 不表示没有 prior artifacts；
- [x] 不在 invocation 开始时自动删除旧 Receipt；
- [x] **CR-2：stale reused Receipt path 语义具备回归测试与 caller-facing contract guidance；**

### Security / ecosystem

- [x] Receipt 不包含 API key / Authorization / process env；
- [x] Receipt 不包含 prompt/messages/request body；
- [x] 文档明确 absolute paths / hook path 属于本地敏感 metadata；
- [x] Receipt 不是 portable archive manifest；
- [x] Promptpile React 等其它包不伪造 root Completion Receipt v1；

### Schema / CI

- [x] normative JSON Schema 存在；
- [x] npm package 发布 schema copy；
- [x] package schema 与 normative schema equality test；
- [x] Node 18/22 × Ubuntu/Windows 首轮 dedicated CI 全绿；
- [ ] CR-1 / CR-2 closure 后 dedicated CI 再次全绿；

只有 CR-1、CR-2 完成并经同一 dedicated matrix 全绿后，本计划状态才改为：

```text
v1 已实施 / Freeze 完成
```

---

## 29. Freeze 后允许的兼容演进

### 29.1 failure reporting

如果 future orchestrator 需要机器化 failure outcome，优先设计：

```text
Invocation Failure Report
```

或 Completion Receipt v2，而不是把 v1 `status: completed` 扩成多态失败对象。

### 29.2 portable refs

relative / content-addressed artifact refs 属于新版本或 Archive/Bundle protocol，不 retroactively 改写 v1 absolute path semantics。

### 29.3 new metadata

新增 public field 前必须判断：

- 是否已有稳定 authority；
- 是否属于 completion result 而非 telemetry；
- 是否泄漏 prompt/secret；
- 是否需要 schemaVersion bump。

不要把 Receipt 变成“什么都塞”的 observability envelope。

### 29.4 After-hook taxonomy

future timeout / richer reason code 可以在 after-hook policy 先稳定，再设计 Receipt schema 演进；Receipt 不提前发明 executor 状态。

---

## 30. 非目标

v1 明确不演进为：

- transaction commit log；
- filesystem rollback coordinator；
- Conversation manifest；
- Tool Execution Receipt；
- audit trail；
- security attestation；
- trace/span envelope；
- billing ledger；
- portable project bundle；
- retry/idempotency state；
- exactly-once proof；
- generic plugin result schema。

这些能力即使未来需要，也必须拥有自己的权威数据源和 lifecycle。

---

## 31. 最终架构位置

Completion foundation 最终应保持：

```text
Conversation state
    ↓
Fingerprint / OCC
    ↓
model request + stream
    ↓
Output Artifact Policy
    ↓
Artifact Ledger
    ↓
Conversation commit
    ↓
After-hook Observation
    ↓
After-hook Policy Decision
    ↓
SuccessfulCompletionOutcomeV1
    ↓
Completion Receipt
    ↓
process success
```

并与 correlation 链连接：

```text
Caller
  ↓
--invocation-id
  ↓
ResolvedInvocationContextV1
  ├─→ after-hook env
  └─→ Completion Receipt.invocationId
```

这两个链条共同形成最终机器可观测边界：

```text
Invocation ID
= “是哪一次调用”

Completion Receipt
= “这次调用最终成功落下了什么”
```

而不会扩张为：

```text
Invocation ID = transaction/session/workflow
Receipt = failure log/正文副本/tool proof/telemetry dump
```

---

## 32. Freeze closure 结论

当前实现已经完成 v1 contract、CR-1 schema closure 与 CR-2 stale-target closure。closure 改动已通过本地 dedicated-workflow 等价测试及 `npm test -w promptpile`；首轮 Node 18/22 × Ubuntu/Windows dedicated workflow 也已全绿。

两项硬 closure 已完成：

```text
CR-1
public JSON Schema 已拒绝：
completed + failed hook observation + failureMode=error

CR-2
stale/reused Receipt target 的历史文件语义已有回归测试，
caller-facing contract 已明确：文件存在本身不证明当前 invocation 成功
```

最终 Freeze 只剩一个发布门禁：closure 分支上的 dedicated Node 18/22 × Ubuntu/Windows matrix 必须四组全绿；在该证据产生前，不把计划状态提前写成“Freeze 完成”。

完成后最终状态应为：

```text
Completion Receipt v1
= successful root completion 的最终 atomic durable witness
= Artifact Ledger 的稳定机器索引
= Invocation ID 的最终 correlation consumer
= After-hook non-fatal observation 的最终结构化记录
```

到这里，Receipt 才真正封底：

> **它只声明已经发生且由现有底层 primitive 权威证明的事实，并且它自身的成功发布就是 completion 主链的最后一个 required fact。**
