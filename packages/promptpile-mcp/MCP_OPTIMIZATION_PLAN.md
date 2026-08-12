# Promptpile MCP Tool Execution 优化与 Freeze 实施计划

> 状态：**Implementation Freeze / 待实施**  
> 日期：2026-08-12  
> 实施基线：`main@9ca55db512b3eefe5970792235903caf3a3119c2`  
> 目标 package：`packages/promptpile-mcp`  
> 上游已冻结边界：`promptpile-protocol`、`promptpile`、Conversation Fork v1、`promptpile-react` orchestration / Agent Event Protocol v1

本文档冻结 `promptpile-mcp` 下一阶段的实现范围、ownership、状态语义、失败模型、测试矩阵与最终 Freeze 标准。

它不是新的产品需求扩张，也不把 MCP 重写成 Promptpile runtime、Conversation subsystem 或 agent framework。目标是基于当前已经成立的 gateway + executor 架构，补齐真实工具副作用执行所缺失的 ownership / fail-closed / package / evidence 闭环。

按照当前仓库文档治理规则，本文件是**仍未完成工作的 active implementation plan**。当本文全部实施、当前 HEAD 的 CI 与 packed evidence 满足 Freeze gate 后：

1. 将仍然有效的稳定事实迁入 `doc/10-architecture/tool-execution-system.md`、`doc/20-packages/promptpile-mcp.md`，必要时同步 `doc/15-contracts/tool-artifacts-v1.md`；
2. 更新 package README 为最终用户入口；
3. 删除或降级现有 `packages/promptpile-mcp/DESIGN.md`，不得继续作为第二套 authority；
4. **删除本文件**，由 Git history 保存实施过程。

---

## 1. 最终架构结论

目标 ownership：

```text
promptpile-protocol
= cross-package pure ToolCall / ToolResult data contract

promptpile
= exactly one Chat Completions execution primitive
+ Conversation assembly
+ durable model artifact publication
+ OCC / hook / Receipt correctness

promptpile-mcp
= MCP session gateway
+ ToolCall execution adapter
+ tool execution policy
+ ToolResult publication

promptpile-react
= orchestration state machine

promptpile-fork
= Conversation snapshot transaction
```

最重要的边界定理：

```text
Protocol decides: shared public data shape
Promptpile decides: how one model completion executes correctly
MCP decides: how one selected tool-call batch executes correctly
React decides: which orchestration phase runs next
Fork decides: how a Conversation prefix snapshot commits
```

`promptpile-mcp` **不拥有**：

- Promptpile request construction；
- Chat Completions / SSE terminal semantics；
- Promptpile Conversation scanner / message assembly；
- Promptpile Conversation OCC claim；
- Promptpile Completion Receipt；
- Promptpile output-pile；
- React FSM / Agent Event Protocol；
- Fork snapshot transaction；
- compression / restore lifecycle；
- cross-layer Conversation selection；
- generic workflow retry engine；
- remote distributed exactly-once transaction。

---

## 2. 当前实现基线

当前 package 已经具备正确的主方向：

```text
launch
→ long-lived stdio MCP sessions
→ localhost HTTP gateway

export-tools
→ MCP tools/list
→ Promptpile .tools.toml

exec-calls
→ *.calls.jsonl
→ gateway / tools/call
→ *.result.jsonl

check
→ calls/result completeness observation
```

当前已经成立、必须保留的设计：

- Promptpile core 不引入 MCP SDK；
- Promptpile 不执行 generic tools；
- `promptpile-mcp` 通过公开 artifacts 与 Promptpile 组合；
- ToolCall 解析已经使用 `promptpile-protocol/tool` 的 `parseToolCallV1()`；
- result 检查已经使用 `parseToolResultLineV1()`；
- Conversation 集成推荐使用 `PROMPTPILE_ASSISTANT_CALL_FILE` + `exec-calls --input`；
- directory mode 只扫描一个明确 physical directory 第一层；
- 不跨 layered Conversation 搜索 result；
- result 正式文件使用同目录临时文件 + sync + rename 原子发布；
- gateway execution 已拥有 concurrency、call timeout、`continue | fail_fast`、显式 retry-safe tool 白名单；
- HTTP client disconnect 会向 gateway execution 传播 cancellation signal；
- gateway 只绑定 loopback，并可使用 bearer token；
- Node runtime contract 已为 `>=20`。

因此本轮优化不是架构迁移，而是 **Pre-Freeze hardening**。

---

## 3. 为什么当前还不能 Freeze

当前最大的 correctness gap 不是 ToolCall parser，而是真实副作用执行的 ownership。

现有简化流程：

```text
result absent?
    ↓
parse calls
    ↓
POST gateway
    ↓
real tools/call side effects
    ↓
atomic result rename
```

atomic rename 只能证明：

```text
不会发布半个 result
```

但不能证明：

```text
同一 result target 不会被两个 executor 同时执行
```

两个进程可以同时观察 `result absent`，随后都调用真实工具，再分别写同一个 result。

对于只读工具，这可能只是浪费；对于：

```text
send_email
create_issue
charge
write_file
deploy
delete
```

则可能形成不可逆副作用重复执行。

此外，HTTP timeout / disconnect 之后，即使 cancellation signal 已发送到 gateway / MCP SDK，也不能对任意 MCP server 的业务副作用做通用证明：

```text
client did not receive response
≠
remote side effect definitely did not happen
```

所以 v1 不能宣称 generic exactly-once。

正确目标是：

```text
exclusive cooperative execution ownership
+ no automatic replay after indeterminate execution
+ atomic complete result publication
```

---

# 4. v1 Freeze theorem

## 4.1 Ownership theorem

```text
for one calls/result operation identity
⇒ at most one cooperative promptpile-mcp execution owner is active
```

注意：这不等价于“每个 tool RPC 最多发送一次”。显式配置在 `retry_safe_tools` 中的工具允许在**同一个 owner** 内按 retry policy 重试。

因此：

```text
batch ownership uniqueness
≠ RPC exactly-once
```

## 4.2 Publication theorem

对于每一个由本次命令新执行并成功发布的 calls 文件：

```text
published complete result
⇒ execution ownership was acquired before any tools/call
⇒ input ToolCall batch was structurally valid
⇒ gateway returned one validated result for every selected call
⇒ result lines preserve original call order
⇒ final result file was atomically published
```

## 4.3 Indeterminate execution theorem

```text
request may have reached real tool execution
+
client cannot prove a complete gateway result
⇒ no result success witness
⇒ execution claim is retained
⇒ automatic re-execution is prohibited
```

典型场景：

- HTTP timeout；
- TCP reset / client disconnect；
- process cancellation while request is in flight；
- gateway 5xx after execution may have started；
- malformed / incomplete 2xx response；
- complete gateway response received but result publication fails。

## 4.4 Command success theorem

目标语义：

```text
promptpile-mcp exec-calls exits 0
⇒ every selected calls file is either:
   A. already paired with a complete valid result and was safely skipped
   OR
   B. newly executed under exclusive ownership and a complete result was atomically published
⇒ no selected partial/invalid result was silently treated as success
⇒ no indeterminate execution created by this command remains unreported as success
```

## 4.5 Cross-package theorem

```text
Promptpile emits public ToolCallV1
→ promptpile-mcp executes real tool
→ promptile-mcp emits public ToolResultLineV1-compatible rows
→ next Promptpile scan assembles tool messages
```

其中任何一层都不读取另一层 private runtime implementation。

---

# 5. Blocker A — Tool execution claim

## 5.1 Claim 是 MCP-owned runtime primitive

新增 package-private execution claim，例如：

```text
<result-path>.promptpile-mcp.exec.claim
```

示例：

```text
[7]assistant.result.jsonl.promptpile-mcp.exec.claim
```

claim：

- 使用 exclusive create（`wx` 或等价）；
- 与**最终 result target**绑定；
- 必须在任何 HTTP `/v1/calls/exec` 请求前取得；
- 不是 Tool Artifact Protocol 成员；
- 不进入 `promptpile-protocol`；
- 不由 Promptpile scanner 消费；
- 不属于 Conversation Fork selected prefix；
- 不复制到 Fork target；
- 不进入 Completion Receipt。

它只是 `promptpile-mcp` tool-execution lifecycle 的 runtime ownership marker。

## 5.2 Claim metadata

建议 v1 metadata：

```ts
interface McpExecutionClaimV1 {
  schema_version: 1;
  token: string;
  pid: number;
  host: string;
  created_at: string;
  calls_path: string;
  result_path: string;
}
```

可选诊断字段只能 additive；不得让其它 package 依赖 claim schema。

权限尽量使用 owner-only（例如 POSIX `0600`）。

## 5.3 Operation identity

v1 cooperative ownership identity 由 resolved result target 决定：

```text
same physical result target
→ same execution ownership domain
```

默认 Conversation integration：

```text
[idx]assistant.calls.jsonl
→ [idx]assistant.result.jsonl
→ one claim
```

显式 `--output` 改变 result target，因此属于用户显式选择的不同 publication target；不要假装 generic tool execution 能在不同用户指定 output target 间提供 exactly-once。

## 5.4 Acquisition ordering

正确顺序：

```text
resolve input/result path
↓
validate path shape
↓
observe existing result
↓
if complete and !overwrite: safe skip
↓
if partial/invalid and !overwrite: fail closed
↓
acquire execution claim
↓
re-observe result after claim
↓
read + parse calls
↓
validate duplicate IDs / supported type
↓
execute gateway request
```

claim 后必须 re-check result，关闭：

```text
pre-check absent
→ another process publishes
→ this process acquires stale opportunity
```

的 TOCTOU seam。

## 5.5 No automatic claim stealing

**v1 禁止：**

```text
claim age > N seconds
→ assume stale
→ automatically delete / steal
```

也禁止仅凭：

```text
pid does not exist
host matches
```

就自动重放。

原因：

```text
process dead
≠ external tool side effect did not happen
```

对任意 MCP tool 无法通用证明 side-effect rollback。

因此：

```text
claim exists + no complete result
→ execution state is indeterminate
→ automatic re-execution forbidden
```

operator 可以在检查真实外部副作用后显式删除 claim，再重新执行；v1 不提供隐式 stale recovery。

如果未来需要自动恢复，必须另行设计幂等 key / durable gateway execution ledger / tool-level idempotency contract，不能通过 TTL 偷锁模拟 exactly-once。

---

# 6. Blocker B — Claim retention / release rules

claim lifecycle 必须区分“可证明未执行”与“执行结果不确定”。

## 6.1 可以释放 claim

以下情况下可以释放：

1. claim 后重新观察到已有 complete result 且当前不是 overwrite；
2. calls 在任何 gateway request 前即解析/验证失败；
3. HTTP gateway 明确返回 contract-defined pre-execution 4xx（auth/body validation 等）；
4. complete gateway result 已通过严格验证，并且 result 已成功原子发布。

## 6.2 必须保留 claim

以下情况 retain claim：

- HTTP request timeout after request dispatch；
- connection reset / ambiguous network failure；
- SIGINT/SIGTERM while gateway request may be in flight；
- gateway 5xx where backend execution may already have started；
- 2xx body malformed；
- gateway results vector 不完整 / duplicate / unknown id；
- gateway response 已完整返回，但 result write / fsync / rename 失败；
- process crash naturally leaves claim behind。

对这些情况：

```text
result absent or not newly committed
+
claim remains
⇒ next cooperative exec refuses automatic replay
```

## 6.3 Publication succeeded but claim cleanup failed

若：

```text
complete result atomically published
→ claim cleanup fails
```

result 已经是 durable success witness。

目标行为：

- 不删除 / 回滚 result；
- 输出 warning；
- command 可以保持 success；
- 默认后续 `exec-calls` 先看到 complete result，因此安全 skip，不会因 leftover claim 自动重执行；
- `check` 应能显示 claim 仍存在，供 operator 清理。

不要因为 post-publication cleanup 失败，把已经完成的工具执行重新描述成“没有发生”。

---

# 7. Blocker C — Existing result semantics 必须 fail-closed

当前行为对已有 partial/invalid result 只是 warning + skip，某些路径最终仍可能 exit 0。

v1 必须改为：

```text
existing complete result
+ !overwrite
→ safe skip
→ success

existing partial result
+ !overwrite
→ error
→ non-zero
→ no tool execution

existing invalid result
+ !overwrite
→ error
→ non-zero
→ no tool execution
```

恢复方式仍保持显式：

```text
--overwrite-results
```

但必须明确：

> `--overwrite-results` 会重新执行真实 tools/call，可能重复不可逆副作用；该参数本身就是显式 re-execution policy。

如果对应 execution claim 存在，即使 `--overwrite-results` 也不得自动绕过 claim。

---

# 8. Blocker D — Gateway response completeness contract

当前 writer 能在 gateway 缺 result 时人为生成 `missing_gateway_result`，这会隐藏 gateway contract bug。

v1 改为明确的内部 HTTP contract：

```text
/v1/calls/exec 2xx
⇒ results.length == calls.length
⇒ every input call id appears exactly once
⇒ no unknown toolCallId
⇒ no duplicate toolCallId
```

gateway execution 层已有能力为：

- normal success；
- tool failure；
- timeout；
- cancelled；
- fail_fast 未调度；

都生成显式 `ExecCallResult`。

因此“missing result”不再是正常业务状态，而是 gateway/client contract violation。

client 必须在 publication 前严格校验。

违反时：

```text
no result publication
+ retain execution claim
+ non-zero
```

不要由 filesystem writer 静默补数据。

---

# 9. HTTP / execution parser hardening

新增严格 parser / validator，避免：

```ts
results as ExecCallResult[]
```

这样的 unchecked cast 成为 publication authority。

至少验证：

```text
toolCallId: non-empty string
ok: boolean
attempts: non-negative integer when present
durationMs: non-negative finite number when present
error: string when present
```

`content` 保持 MCP result projection 所需的 JSON-compatible / unknown payload，再由 result writer 规范化为 string。

同时 gateway route `/v1/calls/exec` 不再手写第二套 ToolCall structural parser：

```text
unknown JSON
→ parseToolCallV1
→ require type === "function"
→ MCP execution
```

这样：

```text
protocol owns generic public shape
MCP owns executable call type restriction
```

---

# 10. Protocol reuse / type ownership

## 10.1 ToolCall

不要继续维护独立的结构复制作为事实源。

目标：

```ts
import type { ToolCallV1 } from 'promptpile-protocol/tool';
```

MCP 可以定义自己的 executable refinement，例如：

```ts
type ExecutableMcpToolCall = ToolCallV1 & { type: 'function' };
```

或者通过 parser 返回 refinement。

## 10.2 ToolResult

公共基础字段：

```ts
ToolResultLineV1
```

继续归 `promptpile-protocol`。

MCP 扩展：

```ts
interface McpExecutionMetadataV1 {
  ok: boolean;
  attempts: number;
  duration_ms: number;
  error?: string;
}

type McpToolResultLineV1 = ToolResultLineV1 & {
  execution: McpExecutionMetadataV1;
};
```

`execution` 不进入 `promptpile-protocol`，除非未来满足正常 admission rule：

```text
normative public contract
+ conformance fixture
+ real second independent consumer
```

Promptpile 应继续只读取公共基础字段并忽略 executor extension。

---

# 11. Conversation integration boundary

MCP 不成为 Conversation scanner。

保留 generic executor：

```text
foo.calls.jsonl
→ foo.result.jsonl
```

因为 `promptpile-mcp` 的本质是 ToolCall artifact executor，不是 Conversation-only package。

但正式 Conversation integration 必须继续推荐：

```text
PROMPTPILE_ASSISTANT_CALL_FILE
→ promptpile-mcp exec-calls --input <exact file>
```

以及 `-o` sidecar：

```text
PROMPTPILE_CALLS_FILE
→ explicit sidecar execution
```

禁止新增：

- layered Conversation union scan；
- “找最大 idx”；
- 从 cwd 猜 writable Conversation；
- 跨 physical directory 配对 result；
- 调用 Promptpile private scanner；
- 依赖 `promptpile/dist/*`。

MCP result 的 atomic rename 与 Promptpile Conversation OCC 是两个不同 ownership：

```text
Promptpile OCC
= Promptpile-owned Conversation mutation serialization

MCP execution claim
= external tool execution / result publication ownership
```

不要共享一个 claim 文件，也不要让 MCP import Promptpile mutation implementation。

---

# 12. Strict config alignment

当前 MCP config 仍存在 permissive coercion / fallback，需要与已冻结 Promptpile/React config philosophy 对齐。

原则：

```text
field absent
→ documented default

field explicitly present but wrong
→ fail fast
```

不是：

```text
invalid
→ silently default
```

## 12.1 version

```text
missing
→ version 1

present
→ exact positive integer
→ must equal 1

version != 1
→ error
```

不再 warning 后继续用 v1 parser 猜测未来 schema。

## 12.2 table shape

这些字段若存在必须是 table/object：

```text
[gateway]
[defaults]
[behavior]
[execution]
[servers]
[servers.<id>]
[servers.<id>.env]
```

wrong shape → fail。

## 12.3 unknown keys

MCP 自己完整拥有 `mcp.toml`，因此 v1 建议：

- top-level unknown keys → fail；
- known tables 内 unknown keys → fail；
- `servers.<id>` unknown keys → fail。

未来 schema 扩展通过明确 version 升级，而不是 silently ignore typo。

## 12.4 booleans

```text
behavior.flat_names
```

必须是 TOML/JSON boolean；不能“只有 true 才算 true，其它都当 false”。

## 12.5 integers / durations

这些字段必须是 exact integer，不再对 float `Math.floor()`：

```text
port
init_timeout_ms
list_timeout_ms
concurrency
call_timeout_ms
retry_max_attempts
retry_base_delay_ms
```

并保持已有范围约束。

CLI 参数仍是 string transport，由 CLI parser 转成整数；不要把 CLI string transport 与 config file typing 混为一谈。

## 12.6 env

`env` 的目标类型本来就是 process environment string。

v1 可以正式允许：

```text
string | finite number | boolean
→ canonical String(...) conversion
```

因为这是明确的 subprocess env transport contract。

但：

```text
array / object / null / unsupported value
→ fail
```

不再 warning + skip，避免 typo/secret 配置静默消失。

## 12.7 retry_safe_tools

必须：

- array；
- 每项非空 string；
- trim 后不能空；
- 建议拒绝 duplicate。

文档必须强调：只有明确可安全重试的工具才可加入；副作用工具默认不应加入。

---

# 13. Tool retry semantics

保持当前设计：

```text
retry_max_attempts = 1
→ no retry
```

只有：

```text
call.function.name ∈ retry_safe_tools
```

才能因 transient failure / call timeout 做 retry。

Freeze invariant：

```text
non-whitelisted tool
⇒ one owner never performs automatic retry
```

`retry_safe_tools` 是 MCP execution policy，不是 Protocol 字段，不进入 ToolResult base contract。

---

# 14. Result publication preflight

任何真实 `tools/call` 之前必须完成 deterministic preflight：

```text
input exists
input is regular file
valid .calls.jsonl basename
result path resolves
result parent exists
result target policy resolved
claim path resolves
claim can be acquired
calls parse succeeds
duplicate call ids rejected
all calls are executable function type
```

目标是：

```text
known deterministic filesystem / parser failure
⇒ no real tool side effect
```

不要把“发现 output parent 不存在 / 没权限”推迟到工具已经执行之后。

claim create 本身应发生在 result target 所在目录，因此同时作为 mutation ownership 与基本 writability preflight。

---

# 15. `check` 语义

保留现有 public artifact completeness status：

```text
complete
pending
partial
invalid
```

不因为 execution claim 再创造第二套 artifact status。

但 `check` 应额外暴露 execution claim observation，例如：

```text
execution_claim: absent
```

或：

```text
execution_claim: present
claim: <path>
```

解释：

```text
pending + claim present
→ result 尚未形成，但存在 indeterminate / active execution ownership
→ 不安全自动重试

complete + claim present
→ result 已完整发布，claim cleanup 可能遗留
→ default exec 仍安全 skip
```

`check` 保持只读，不增加“顺手清 claim”的 mutation option。

operator 若要清理 `pending + claim present`，必须先自行确认外部 side effect 是否允许重放。

---

# 16. CLI exit semantics

保持简单：

```text
0   completed command / all selected work complete
1   operational / contract / claim conflict / indeterminate failure
2   check invalid artifact status（保持已有 check contract）
130 interrupted where existing CLI contract requires
```

不要为每种内部错误发明新的 public exit-code taxonomy。

关键规则：

```text
partial/invalid existing result
→ exec-calls non-zero
```

以及：

```text
claim conflict / indeterminate claim
→ non-zero
→ no tools/call
```

---

# 17. HTTP gateway boundary

保持：

```text
launch
= MCP session owner
+ localhost HTTP adapter
```

不要把 filesystem Conversation mutation移入 gateway。

client/gateway responsibilities：

```text
exec-calls CLI
owns:
- calls/result path
- execution claim
- artifact parsing
- final result publication

gateway
owns:
- MCP session routing
- concurrency
- call timeout
- retry-safe policy
- fail_fast scheduling
- cancellation propagation
```

这样 gateway 仍然可以被独立短生命周期 clients 使用，而 filesystem ownership 保留在 artifact executor CLI。

---

# 18. Cancellation boundary

当前链路：

```text
CLI AbortSignal
→ fetch abort
→ Koa client disconnected
→ gateway AbortController
→ executeCallsWithPolicy
→ StdioMcpSession.callTool(signal)
→ MCP SDK
```

这条链路应保留并加强 tests。

但 Freeze 文档必须明确：

```text
cancellation requested
≠ arbitrary MCP tool side effect proven rolled back
```

因此只要请求已经可能进入 tool execution 且没有收到完整可验证 response：

```text
retain claim
```

这是 fail-closed，而不是“取消失败”。

---

# 19. Security boundary

保持 loopback-by-default。

Freeze 前验证：

- 默认 bind 仅 loopback；
- bearer token comparison / missing token policy 明确；
- config 中 command/cwd/env 仍被视为本机代码执行权限；
- 不输出 token/env secret 到正常日志；
- execution claim metadata 不写 token / tool arguments / secret payload；
- HTTP error snippet 长度受限；
- body size limit 保持有界；
- tool arguments 由 MCP server schema / execution endpoint处理，不在日志无界展开。

不在本轮加入：

- TLS；
- remote public binding；
- multi-user auth；
- distributed execution lock。

---

# 20. Package surface 收口

当前 package surface 有几处与 Promptpile/React Freeze 后的 package philosophy 不一致。

## 20.1 Version single source

当前存在 package / CLI / MCP clientInfo 硬编码版本漂移风险。

目标：

```text
package.json version
= single source of truth
```

以下全部从 package metadata 派生：

- `promptpile-mcp --version`；
- MCP `clientInfo.version`；
- 任何 user-visible runtime version。

禁止源码继续硬编码：

```text
0.1.0
```

## 20.2 CLI-only surface

当前 `src/index.ts` 是直接执行 CLI 的 executable，不是 library entry。

若 repo audit 没有真实 library consumer，则 Freeze：

```text
promptpile-mcp
= CLI package
```

并移除误导性的：

```json
"main": "dist/src/index.js"
```

如果未来要提供 library API，必须单独设计 `exports` 与稳定类型 surface，而不是把 CLI entry 当 library contract。

## 20.3 Dependencies

runtime dependencies 只保留真正运行时需要的包。

移动到 devDependencies：

```text
typescript
@types/node
```

现有 `@types/koa*` / `ts-node` 继续保持 dev-only。

`promptpile-protocol` 保持 direct exact dependency。

## 20.4 Node runtime

保留：

```json
"engines": { "node": ">=20" }
```

并由 dedicated CI matrix 与 packed consumer 同时证明。

---

# 21. 不做的事情

本轮明确不实现：

- Promptpile 内嵌 MCP；
- 自动第二次 Chat Completion；
- MCP agent loop；
- React Event Protocol integration；
- Fork / compress lifecycle integration；
- Receipt builder；
- Conversation fingerprint / OCC implementation复制；
- remote MCP HTTP/SSE client transport；
- TLS gateway；
- distributed exactly-once；
- automatic stale claim stealing；
- arbitrary tool idempotency inference；
- recursive directory scan；
- cross-layer execution；
- plugin marketplace / tool registry；
- generic durable workflow engine。

任何这些需求都必须另起设计，不得在“优化 MCP”名义下顺手加入。

---

# 22. Implementation Phase 0 — Baseline lock

实施前重新抓取当前 `main`。

记录：

- implementation start SHA；
- current package version；
- current protocol version；
- current `DESIGN.md` / README / canonical docs 状态；
- current test list；
- current package consumer/import audit。

禁止基于本文写作时 SHA 假设 main 未变化。

先增加/调整 regression tests，再改 runtime。

---

# 23. Phase 1 — Protocol / HTTP contract hardening

实施：

1. MCP executable ToolCall 类型直接建立在 `ToolCallV1` 上；
2. gateway route 使用 `parseToolCallV1()` + `type === function`；
3. 添加 strict `ExecCallResult` response parser；
4. 强制完整 result vector；
5. duplicate/unknown/missing result 全部 fail closed；
6. writer 只接受 validated complete result vector；
7. 删除 writer 的 silent `missing_gateway_result` contract repair。

这一阶段不新增 filesystem claim，确保协议 hardening 可以独立 review。

---

# 24. Phase 2 — Execution claim transaction

新增内部模块，职责建议分离：

```text
execution-claim.ts
- claim path
- exclusive acquire
- metadata
- owner-safe release
- observation

result-publication.ts / existing atomic-file
- preflight
- complete result atomic write
```

重构 `exec-calls`：

```text
resolve
→ observe existing result
→ claim
→ re-observe
→ parse
→ execute
→ validate gateway response
→ publish result
→ release claim
```

并落实 retain rules。

不要把整个命令塞入一个巨大 `try/finally releaseClaim()`：

> 不是所有失败都应该 release claim。

claim release 必须由明确 terminal decision 控制。

---

# 25. Phase 3 — `exec-calls` / `check` semantics

实施：

- complete existing result：safe skip；
- partial/invalid existing result：non-zero；
- overwrite：显式 re-execution；
- claim conflict：non-zero / no HTTP request；
- `check` 增加 claim observation；
- post-publication claim cleanup failure：warning，不回滚 result；
- directory mode 对任一 selected partial/invalid/indeterminate item 不得整体返回“全成功”。

目录模式仍按文件串行处理即可；本轮不需要新增文件级并发。

---

# 26. Phase 4 — Strict config

按 §12 实施 strict parser。

必须有 negative tests 覆盖：

- unsupported version；
- top-level wrong shape；
- unknown top-level key；
- unknown table key；
- string boolean；
- fractional timeout；
- invalid concurrency；
- invalid retry-safe list；
- invalid env nested object；
- unsupported transport；
- invalid server id；
- empty command。

不要把 CLI transport string strictness与 TOML/JSON config typing 混在一个 permissive helper 中。

---

# 27. Phase 5 — Package modernization

实施：

- version single source；
- CLI `--version` derive package metadata；
- MCP clientInfo derive same version；
- CLI-only package surface（若 consumer audit确认）；
- remove misleading `main`；
- move TS / Node types to dev dependencies；
- retain Node >=20；
- inspect `files` publication allowlist；
- fresh packed install smoke。

不要意外把内部 gateway classes / execution policy types 暴露为稳定 JS library API。

---

# 28. Phase 6 — Documentation alignment

实现完成后，不继续让 `DESIGN.md` 与 canonical `doc/` 同时定义当前 architecture。

迁移：

## `doc/10-architecture/tool-execution-system.md`

写入：

- Promptpile / executor ownership；
- execution claim theorem；
- no automatic replay after indeterminate execution；
- retry-safe distinction；
- result publication lifecycle。

## `doc/20-packages/promptpile-mcp.md`

写入：

- launch/export-tools/exec-calls/check 当前行为；
- strict config；
- package surface；
- failure model；
- security boundary。

## `doc/15-contracts/tool-artifacts-v1.md`

只在公共 artifact semantics 真正发生变化时更新。

execution claim 本身不是 Tool Artifact Protocol，不要为了记录内部锁文件而扩张 protocol contract。

## package README

只保留用户安装 / 配置 / CLI examples / canonical doc links。

## DESIGN.md

稳定事实迁移完成后：

- 优先删除；
- 或缩成很短的 historical pointer；
- 不再出现“实现以本文为准”。

---

# 29. Unit test matrix

至少覆盖以下根节点。

## Protocol / parser

- valid ToolCallV1 function accepted；
- non-function call rejected by MCP executor；
- malformed call rejected；
- duplicate call id rejected；
- valid complete gateway response accepted；
- duplicate gateway result id rejected；
- unknown gateway result id rejected；
- missing gateway result rejected；
- malformed result fields rejected。

## Existing result

- complete + no overwrite → skip success；
- partial + no overwrite → fail；
- invalid + no overwrite → fail；
- overwrite complete → explicit re-execution；
- overwrite still respects existing claim。

## Claim

- first claimant succeeds；
- second claimant same result target fails before HTTP；
- claim acquisition is exclusive；
- claim metadata owner token verified on cleanup；
- wrong-owner cleanup rejected；
- parser failure before HTTP releases claim；
- pre-execution 4xx releases claim；
- timeout retains claim；
- connection reset retains claim；
- gateway 5xx retains claim；
- malformed 2xx retains claim；
- publication failure retains claim；
- successful publication releases claim；
- publication success + cleanup failure leaves complete result and warning；
- process-level leftover claim blocks automatic replay。

## Check

- pending + claim absent；
- pending + claim present；
- complete + claim absent；
- complete + leftover claim present；
- partial / invalid status preserved。

## Cancellation

- SIGINT/client abort propagates to gateway execution signal；
- interrupted ambiguous execution does not clear claim；
- no automatic retry after cancellation ambiguity。

## Config

覆盖 §26 全部 strict negative tests。

## Package

- CLI version == package version；
- MCP clientInfo version == package version；
- no misleading library surface；
- runtime dependencies do not include build-only types/compiler。

---

# 30. Concurrency / side-effect adversarial tests

必须有一个真正证明 Blocker 被关闭的测试：

```text
same calls file
same result target
executor A and B start concurrently
```

fixture backend 对每次真实执行增加 counter / durable marker。

期望：

```text
exactly one owner reaches POST/tools-call path
second process receives claim conflict
one complete result published
backend batch execution count == 1
```

如果测试仅 mock `fs.rename()`，不能算 execution-ownership witness。

另测：

```text
executor A reaches tool side effect
HTTP response intentionally lost
claim remains
executor B starts
→ B must not call tool
```

这条是整个优化最重要的 executable proof。

---

# 31. Real stdio MCP smoke

dedicated smoke 必须启动一个仓库内 deterministic stdio MCP fixture server，真实走：

```text
promptpile-mcp launch
→ MCP initialize
→ tools/list
→ export-tools
→ tools/call
→ result
```

不要只 stub `GatewayBackend`。

fixture tools 至少包含：

- pure echo/read-like tool；
- counter side-effect tool，用于 claim concurrency proof；
- controllable slow tool，用于 timeout/cancellation/indeterminate proof。

无外部网络依赖。

---

# 32. Promptpile ↔ MCP real composition E2E

必须新增一个完整组合 witness：

```text
real promptpile
→ local deterministic Chat Completions fixture emits tool call
→ real [idx]assistant.calls.jsonl
→ real promptpile-mcp exec-calls
→ local stdio MCP fixture tools/call
→ real [idx]assistant.result.jsonl
→ next real promptpile invocation
→ captured request contains correct tool message
```

约束：

- Promptpile 使用 public CLI；
- MCP 使用 public CLI；
- 不 import `promptpile/src/*`；
- 不 import `promptpile/dist/*`；
- 唯一 shared shape 通过 `promptpile-protocol` / public artifacts；
- local HTTP fixture 只替代外部模型 provider，不替代 Promptpile runtime；
- local MCP fixture 只替代外部 MCP server，不替代 MCP gateway/runtime。

这条测试证明：

```text
model execution ownership
+
tool execution ownership
+
shared protocol
```

真的可组合。

---

# 33. Packed artifact smoke

必须从真实 tarball topology 验证：

```text
npm pack promptpile-protocol
npm pack promptpile
npm pack promptpile-mcp
→ fresh temp consumer
→ install tarballs
→ promptpile-mcp --help
→ promptpile-mcp --version
→ launch local fixture
→ export-tools
→ exec-calls
→ check
```

不得依赖：

- monorepo node_modules hoisting；
- workspace symlink；
- source tree relative paths；
- `dist` private layout；
- repo cwd。

packed smoke 必须在 Windows 与 Ubuntu 至少各有一格执行。

---

# 34. Dedicated CI workflow

新增 dedicated workflow，例如：

```text
Promptpile MCP v1
```

matrix：

```text
Node 20 / Ubuntu
Node 22 / Ubuntu
Node 20 / Windows
Node 22 / Windows
```

推荐顺序：

```text
npm ci
→ build promptpile-protocol
→ test promptpile-protocol
→ build promptpile
→ build promptpile-mcp
→ promptpile-mcp unit/adversarial tests
→ real stdio MCP smoke
→ Promptpile↔MCP composition E2E
→ packed smoke
```

workflow paths 至少覆盖：

```text
packages/promptpile-mcp/**
packages/promptpile-protocol/**
packages/promptpile/**
doc/10-architecture/tool-execution-system.md
doc/15-contracts/tool-artifacts-v1.md
doc/20-packages/promptpile-mcp.md
.github/workflows/promptpile-mcp-v1.yml
package.json
package-lock.json
```

实现期间本 active plan 也应加入 trigger：

```text
packages/promptpile-mcp/MCP_OPTIMIZATION_PLAN.md
```

这样最终 Freeze docs commit 本身也能获得 current-HEAD evidence。

---

# 35. Architecture boundary tests

增加静态 guard，证明 MCP 没有越界：

禁止：

```text
promptpile/src/
promptpile/dist/
promptpile-react/src/
promptpile-fork/src/
```

要求：

- public ToolCall / ToolResult parser 只来自 `promptpile-protocol` public package path；
- MCP SDK 仅存在于 `promptpile-mcp`；
- no Receipt builder；
- no Promptpile stream parser；
- no Conversation scanner import；
- no Fork transaction import；
- no Agent Event Protocol import。

---

# 36. Freeze checklist

## Architecture

- [ ] MCP remains external tool executor / session gateway only
- [ ] Promptpile core remains free of MCP SDK / tool execution
- [ ] Protocol remains pure public data contract
- [ ] No React/Fork/Receipt ownership leaks into MCP

## Execution ownership

- [ ] Claim acquired before any real `tools/call`
- [ ] Same result target has at most one cooperative active owner
- [ ] Claim is rechecked against result after acquisition
- [ ] No automatic stale claim stealing
- [ ] Ambiguous execution retains claim
- [ ] Successful result publication is atomic
- [ ] Post-publication cleanup failure cannot erase success witness

## Result semantics

- [ ] Complete existing result safely skips
- [ ] Partial existing result fails closed
- [ ] Invalid existing result fails closed
- [ ] Overwrite is explicit re-execution
- [ ] Gateway 2xx must contain complete exact result vector
- [ ] Writer never fabricates missing gateway results

## Protocol

- [ ] MCP ToolCall parser reuses `parseToolCallV1`
- [ ] Result base conforms to `ToolResultLineV1`
- [ ] MCP execution metadata stays MCP-owned
- [ ] No protocol expansion without admission rule

## Config

- [ ] version exact and fail-fast
- [ ] wrong table shapes fail
- [ ] unknown keys fail
- [ ] booleans exact
- [ ] integers exact
- [ ] unsupported env values fail
- [ ] unsupported transports fail

## Package

- [ ] Package version is single source
- [ ] CLI version matches package version
- [ ] MCP clientInfo version matches package version
- [ ] CLI-only surface confirmed
- [ ] build-only dependencies moved to devDependencies
- [ ] Node >=20 preserved

## Evidence

- [ ] unit tests green
- [ ] execution contention proof green
- [ ] ambiguous network failure proof green
- [ ] real stdio MCP smoke green
- [ ] Promptpile↔MCP real composition E2E green
- [ ] packed fresh-install smoke green
- [ ] Node20 Ubuntu green
- [ ] Node22 Ubuntu green
- [ ] Node20 Windows green
- [ ] Node22 Windows green

## Documentation

- [ ] canonical `doc/` updated
- [ ] README updated
- [ ] DESIGN no longer second authority
- [ ] implementation commit(s) recorded
- [ ] CI run IDs recorded
- [ ] this implementation plan deleted after Freeze

---

# 37. Final Freeze declaration

只有当同一 current HEAD 满足上面的 implementation + evidence gate，才能宣布：

```text
Promptpile MCP Tool Execution v1 Freeze
```

Freeze 后正式文档应能够证明：

## Execution success theorem

```text
for every newly published result batch
⇒ one MCP execution owner was acquired before side effects
⇒ selected calls were valid
⇒ gateway returned a complete exact result vector
⇒ tool-level failures are represented explicitly as results
⇒ result publication completed atomically
```

## No-silent-replay theorem

```text
ambiguous execution failure
⇒ no complete success witness
⇒ claim remains
⇒ cooperative retry is blocked
```

## Existing-result theorem

```text
exec-calls exit 0 without overwrite
⇒ every selected pre-existing result that was skipped was complete
```

## Ownership theorem

```text
promptpile-protocol owns shared data
promptpile owns model completion
promptpile-mcp owns tool execution
promptpile-react owns orchestration
promptpile-fork owns snapshot transaction
```

## Package theorem

```text
declared Node support
= CI runtime support
= packed artifact behavior
```

---

# 38. Post-Freeze candidates

以下内容不阻塞 v1 Freeze，只能在真实需求出现后另起设计：

- durable gateway execution ledger；
- execution-id status query；
- operator-assisted claim recovery CLI；
- tool-provided idempotency keys；
- distributed/multi-host execution ownership；
- remote MCP HTTP/SSE client transport；
- TLS / remote gateway；
- library API；
- streaming tool progress events；
- React tool-execution orchestration integration；
- richer structured result content contract。

这些能力不得反向污染当前最小 v1 theorem。

---

# 39. 实施顺序摘要

```text
current main re-audit
        ↓
Protocol / HTTP response hardening
        ↓
execution claim + indeterminate semantics
        ↓
exec/check fail-closed behavior
        ↓
strict config
        ↓
package surface/version cleanup
        ↓
real stdio + Promptpile composition evidence
        ↓
Node20/22 × Ubuntu/Windows
        ↓
canonical docs migration
        ↓
current-HEAD CI green
        ↓
Promptpile MCP Tool Execution v1 Freeze
        ↓
delete DESIGN second authority / delete this plan
```

最终优化方向应始终保持：

```text
少一个隐式假设
多一个 executable invariant
少一层 duplicated ownership
多一个 current-HEAD witness
```

而不是增加更多 MCP 功能。