# Promptpile After-hook Failure Policy 实施设计计划

> 状态：已实施，待远端 dedicated CI 矩阵验证
> 设计冻结日期：2026-08-11  
> 核心提案：把 after-hook 从“执行后打印几条日志”的宽容副作用，收敛为一个版本化但内部使用的 **resolution → execution observation → failure-policy decision** 状态机；默认继续保持 `warn` 兼容语义，同时提供 `error` 严格模式，并让 Output Artifact Policy、未来 Completion Receipt 与上层 orchestrator 对 hook 结果只有一套解释

> v1 closure：显式 fresh output directory 的创建属于 config resolution preparation，可早于 strict invalid-hook decision；该场景允许留下空目录，但不允许产生 Conversation artifacts、completion sinks 或模型请求。把 `AfterHookPolicyDecisionV1` 保存为 Completion Receipt 的正式 stage output 留待 Receipt 实施，不在 v1 重复计算 policy。

## 0. 结论

After-hook Failure Policy v1 只回答一个问题：

> 当 completion 的 required output stages 已经完成、after-hook 被解析或执行后，hook 的事实结果应如何影响本次 invocation 的最终成功/失败语义？

它不重新定义 hook 的用途，也不把 hook 变成事务、tool executor 或新的业务协议。

v1 固定为：

```text
resolved completion config
        ↓
resolve hook target fact
        ↓
resolve failure mode: warn | error
        ↓
ResolvedAfterHookPolicyV1
        │
        ├─ invalid explicit + error
        │      → pre-model ordinary failure
        │
        ├─ invalid explicit + warn
        │      → warning observation, continue without hook
        │
        └─ runnable / skipped
               ↓
Output Artifact Policy required stages
               ↓
artifact ledger complete for this invocation
               ↓
run hook if runnable
               ↓
AfterHookExecutionResult
               ↓
apply failure policy
        ├─ none
        ├─ warning
        └─ error
               ↓
future Receipt consumes observation + decision
               ↓
final process status
```

核心不变量：

1. **Hook resolution、hook execution 和 failure policy 是三件不同的事。** Resolver 只描述事实，不在状态名中偷塞 `warn` / `error` 行为。
2. **v1 只有 `warn` 和 `error` 两种 failure mode。** 默认 `warn`，保持现有成功兼容语义；不增加 `ignore`。
3. **`error` 模式不等于“必须存在 hook”。** 没有配置 hook，或显式允许 default discovery 但没有找到 default hook，仍然只是 `skip`。
4. **显式 hook 路径无效属于可在模型前确定的 hook failure observation。** `warn` 继续调用；`error` 必须在模型请求和 sink preparation 之前失败。
5. **Runtime hook failure 发生在所有 required durable output stages 之后。** 已提交的 `-o` / Conversation artifacts 不回滚。
6. **`warn` 模式 hook failure 不改变成功 candidate。** 但结构化 observation 必须保留，未来 Receipt 不得把它伪装成 hook success。
7. **`error` 模式 hook failure 产生 ordinary failure，使用 exit code `1`。** 不为 hook 再发明专用退出码。
8. **Conversation OCC conflict 仍是 exit code `3`，且发生 conflict 时 hook 不执行。** After-hook Policy 不重分类 OCC。
9. **`runAfterHook()` 不负责 policy、不负责 process exit、不负责 Receipt。** 它只返回一个结构化执行事实。
10. **第一个 primary failure 继续由 Output Artifact Policy 的 first-primary-failure rule 决定。** Hook failure 不得被后续 Receipt/finalizer failure 覆盖。
11. **Hook stdout 不是业务协议。** v1 不缓存、不转发、不进入 Receipt。
12. **Hook stderr 只用于 bounded diagnostics。** v1 最多保留最后 `64 KiB` 原始字节对应的 UTF-8 diagnostic tail，并持续 drain，避免 child 因 pipe backpressure 阻塞。
13. **Receipt 只消费结构化 hook observation/decision，不消费 hook stdout/stderr 或完整 hook env。**
14. **v1 不实现 timeout / process-tree termination。** Signal termination 可以被分类，但主动 timeout 必须等跨平台进程树策略单独设计。

职责边界固定为：

```text
After-hook resolution
  负责：哪个 hook（如果有）会被运行

After-hook executor
  负责：启动 child 并观察它如何结束

After-hook Failure Policy
  负责：该 observation 对 invocation 是 none / warning / error

Output Artifact Policy
  负责：hook 在什么阶段运行、hook 之前哪些 artifacts 已成功落盘

Completion Receipt
  负责：把 hook observation / decision 编码成稳定机器文档
```

---

## 1. 动机与当前缺口

当前实现已经具备正确的阶段顺序：

```text
model
→ output pile finalize
→ -o artifacts
→ Conversation --continue artifacts
→ after-hook
```

并且 after-hook env 已经从实际 artifact ledger 构造，而不是自行猜测输出路径。

当前真正未闭环的是：

```ts
runAfterHook(...): Promise<void>
```

现有实现中：

- spawn error 只打印 stderr；
- non-zero exit 只打印 stderr；
- child 被 signal 终止没有正式分类；
- 调用者拿不到结构化结果；
- completion 无法区分“hook 成功”和“hook 失败但被宽容忽略”；
- future Receipt 无法可靠记录 hook outcome；
- executor 同时负责执行、日志和隐式 failure policy；
- stdout/stderr 都被无上限累积到内存，其中 stdout 最终完全不消费。

因此需要把现在的：

```text
spawn child
→ print some diagnostics
→ always resolve void
```

改成：

```text
spawn child
→ return execution fact
→ pure policy evaluation
→ top-level decides invocation impact
```

---

## 2. v1 范围

v1 负责：

1. `--after-hook-failure warn|error`；
2. TOML `after_hook_failure = "warn" | "error"`；
3. CLI-over-TOML failure mode precedence；
4. 把 hook resolution 从 policy 命名中解耦；
5. 把 hook execution 结果结构化；
6. 区分：
   - skipped；
   - invalid explicit target；
   - success；
   - spawn failure；
   - non-zero exit；
   - signal termination；
7. 将 observation 映射为：
   - `none`；
   - `warning`；
   - `error`；
8. 定义严格模式下 pre-model / post-artifact failure 时序；
9. bounded stderr diagnostics；
10. 与 Output Artifact Policy / artifact ledger / future Receipt 的接口；
11. Windows / Linux 跨平台测试矩阵。

v1 不负责：

- hook timeout；
- kill process tree；
- 自动 retry；
- hook stdout 协议；
- hook 生成 artifact 的自动发现；
- tool execution semantic validation；
- Receipt JSON schema；
- Invocation ID；
- React Agent Event Protocol；
- 分布式任务生命周期。

---

## 3. 术语

### 3.1 Hook resolution

只回答：

> 本次 invocation 有什么 hook target 可运行？

它不回答 hook 失败是否 fatal。

### 3.2 Hook execution observation

child 实际执行后观察到的终止事实，例如：

```text
succeeded
spawn_failed
exited_nonzero
signaled
```

### 3.3 Failure mode

调用者配置的策略：

```text
warn
error
```

### 3.4 Policy decision

将 hook observation 与 failure mode 组合后的 invocation impact：

```text
none
warning
error
```

### 3.5 Hook failure

v1 以下 observation 视为 hook failure：

```text
invalid_explicit
spawn_failed
exited_nonzero
signaled
```

以下不是 failure：

```text
skipped
succeeded
```

---

## 4. Public configuration v1

### 4.1 CLI

新增：

```bash
--after-hook-failure <mode>
```

合法值仅：

```text
warn
error
```

示例：

```bash
promptpile \
  -d ./messages \
  -c \
  --after-hook-path ./exec-calls.ps1 \
  --after-hook-failure error
```

### 4.2 TOML

```toml
[promptpile]
after_hook = "./exec-calls.ps1"
after_hook_failure = "error"
```

### 4.3 precedence

固定为：

```text
CLI --after-hook-failure
>
TOML after_hook_failure
>
default warn
```

Failure mode 与 hook path 的来源独立解析。

例如：

```text
CLI after-hook path
+
TOML after_hook_failure = "error"
```

最终是：

```text
CLI path + error mode
```

### 4.4 parser contract

建议纯 parser：

```ts
type AfterHookFailureMode = 'warn' | 'error';

parseAfterHookFailureMode(value: unknown): AfterHookFailureMode | undefined;
```

规则：

- 未提供 / 空字符串 → `undefined`；
- trim 后只接受精确 lowercase `warn` / `error`；
- 其它输入在模型调用前配置失败；
- v1 不接受 `ignore`、`strict`、`fatal` 等别名；
- 不从普通 process env 读取 failure mode；
- `[[llm_api]]` profile 不拥有 after-hook policy。

---

## 5. Hook resolution 必须保持事实化

当前 resolver 有：

```ts
{ status: 'warn_invalid_explicit', ... }
```

这个状态名把当前默认行为 `warn` 混进了 resolution fact。

v1 应改成：

```ts
type ResolveAfterHookResult =
  | {
      status: 'run';
      path: string;
    }
  | {
      status: 'skip';
      reason: 'not_configured' | 'default_not_found';
    }
  | {
      status: 'invalid_explicit';
      attempted: string;
      reason: string;
    };
```

重要：

```text
invalid_explicit
```

只意味着：

> 调用者显式声明了 hook target，但 resolver 无法把它解析成可运行 regular file。

是否继续，由 failure mode 决定。

### 5.1 路径 precedence 保持不变

```text
CLI --after-hook-path
>
TOML after_hook
>
default discovery（仅显式 CLI opt-in）
```

CLI 显式 path 无效时：

```text
不得 fallback 到 TOML hook
不得 fallback 到 default hook
```

因为显式高优先级配置已经表达了调用者意图。

### 5.2 相对路径语义保持不变

```text
CLI --after-hook-path → relative to invocation cwd
TOML after_hook      → relative to Conversation anchor
```

resolver 成功后继续返回 canonical `realpath`。

### 5.3 default discovery security boundary 保持不变

```text
--allow-default-after-hook
```

仍然是 CLI-only opt-in。

TOML 不得通过：

```toml
allow_default_after_hook = true
```

静默启用本地脚本发现。

`after_hook_failure = "error"` 也不得隐式启用 default hook discovery。

### 5.4 default hook 不存在不是 failure

如果调用者只给：

```text
--allow-default-after-hook
--after-hook-failure error
```

但 Conversation anchor 没有 default hook：

```text
resolution = skip(default_not_found)
impact = none
```

`error` 的含义是：

> hook target 已明确失败或实际执行失败时，失败是 fatal。

不是：

> 必须找到一个 hook。

---

## 6. Resolved After-hook Policy v1

建议内部结构：

```ts
interface ResolvedAfterHookPolicyV1 {
  failureMode: 'warn' | 'error';
  resolution: ResolveAfterHookResult;
}
```

Output Artifact Policy 中的：

```ts
hook: ResolveAfterHookResult
```

应演进为：

```ts
hook: ResolvedAfterHookPolicyV1
```

这样 runtime output orchestration 继续只消费唯一 resolved topology，而不会重新回到：

```text
config.afterHookFailure
+
outputPolicy.hook
```

两个事实源。

Output Artifact Policy 仍然负责：

- hook path 与 output file sink 的 collision validation；
- hook stage ordering；
- hook 只消费实际 artifact ledger。

After-hook Failure Policy 不重新实现这些能力。

---

## 7. Pre-model policy：显式 invalid hook

`invalid_explicit` 是唯一能够在模型调用前确定的 hook failure。

### 7.1 warn

```text
resolution = invalid_explicit
mode       = warn
```

固定行为：

1. 产生结构化 hook observation；
2. 输出一条 stderr warning；
3. 不运行 hook；
4. 继续 completion；
5. 如果后续其它 required stages 全部成功，最终仍可 exit `0`；
6. future Receipt 必须能够知道 hook 是 `invalid_explicit`，不能记录成 success。

这是现有宽容行为的语义兼容。

### 7.2 error

```text
resolution = invalid_explicit
mode       = error
```

固定行为：

```text
resolve config / policy
→ detect invalid explicit hook
→ ordinary failure
→ exit 1
```

并且必须发生在：

```text
sink preparation
model API request
main output
Conversation assistant mutation
```

之前。

如果本次调用包含 `--input`，需要注意：

- `--input` user append 属于模型请求前的 Conversation mutation；
- Output Artifact Policy 已明确它不是 completion output sink；
- 为避免“严格 hook 配置明知无效却先 append user”的不必要 side effect，v1 推荐将 explicit hook strict validation 放在 root `--input` mutation 之前；
- 如果现有 orchestration 因配置解析顺序需要调整，应以“所有可确定的 fatal config validation 尽量先于 mutation”为实现目标。

这一点必须有专门测试，不能只验证普通 `--continue`。

---

## 8. Hook execution result contract

`runAfterHook()` 不再返回 `void`，而返回执行事实。

建议：

```ts
interface AfterHookStderrDiagnostic {
  stderrTail: string;
  stderrTruncated: boolean;
}

type AfterHookExecutionResult =
  | {
      status: 'succeeded';
      path: string;
      exitCode: 0;
    }
  | {
      status: 'spawn_failed';
      path: string;
      errorCode?: string;
      message: string;
    }
  | ({
      status: 'exited_nonzero';
      path: string;
      exitCode: number;
    } & AfterHookStderrDiagnostic)
  | ({
      status: 'signaled';
      path: string;
      signal: string;
    } & AfterHookStderrDiagnostic);
```

### 8.1 succeeded

只有 child 正常 close 且：

```text
exit code === 0
```

才是 success。

### 8.2 spawn_failed

包括：

- interpreter / executable 不存在；
- OS 拒绝启动；
- Node `spawn()` 同步抛错；
- child `'error'` event 表示无法启动。

它不是 throw-through ordinary exception；它是一个预期可分类的 execution result。

### 8.3 exited_nonzero

child 正常结束但：

```text
exit code != 0
```

必须记录 exact numeric exit code。

### 8.4 signaled

child close 时：

```text
signal != null
```

记录 Node 提供的 signal string。

v1 只观察这个事实，不承诺由 Promptpile 自己发送该 signal。

---

## 9. Executor 必须恰好产生一个 terminal result

Node child lifecycle 中可能出现：

```text
error
close
```

多个 event。

Executor 必须有 settle-once 规则：

```text
first terminal observation wins
subsequent terminal events ignored for result classification
```

不能：

- spawn error 先返回 `spawn_failed`；
- close 又覆盖成 `exited_nonzero`；
- 或 Promise 多次 resolve 后日志重复打印两遍。

建议将 executor 的 child event mapping 独立成可注入/可测试 primitive，而不是只依赖真实 shell scripts 制造 race。

---

## 10. Executor 不负责日志和 failure mode

目标 API：

```ts
runAfterHook(...): Promise<AfterHookExecutionResult>
```

它必须：

- 不读取 `failureMode`；
- 不调用 `process.exit` / `process.exitCode`；
- 不直接把 nonzero/spawn failure 当作 warn 或 error；
- 不写 Completion Receipt；
- 不重新扫描 artifacts；
- 不执行 tool completeness check。

预期 child outcome 返回结构化 result。

只有真正的内部不可恢复错误才允许 reject/throw。

---

## 11. stdout / stderr 资源与安全 contract

### 11.1 stdout

当前实现会把 hook stdout 全量积累到字符串，但从不使用。

v1 固定为：

```text
hook stdout = non-protocol / discarded
```

实现应使用等价于：

```text
stdio stdout = ignore
```

或持续 drain 且不缓存。

不得：

- 转发到 Promptpile stdout；
- 放入 artifact ledger；
- 放入 hook execution result；
- 放入 future Receipt。

这样大型 hook stdout 不会成为 Promptpile 内存增长点。

### 11.2 stderr

stderr 仍用于 failure diagnostics，但必须有硬上限。

v1 冻结：

```text
MAX_AFTER_HOOK_STDERR_TAIL_BYTES = 64 * 1024
```

实现必须：

1. 始终 drain child stderr；
2. 只保留最后 64 KiB raw bytes；
3. 超过上限设置 `stderrTruncated = true`；
4. 结束后再以 UTF-8 decode（非法字节 replacement 可接受）；
5. 不因保留上限而停止 drain，否则 child 可能卡在 pipe backpressure。

### 11.3 success stderr

保持现有兼容习惯：

```text
hook exit 0
→ stderr 不自动回显
```

stderr tail 可以在 executor 内部丢弃；success result 不需要携带它。

### 11.4 failure stderr diagnostic

`warn` / `error` 模式下 runtime hook failure 可以输出 bounded stderr tail。

必须明确：

> Promptpile 不会自动打印 hook env / API key，但 hook stderr 本身是 hook 主动产生的不可信输出，可能包含 hook 自己打印的敏感信息。v1 不承诺对任意 hook stderr 做可靠 secret redaction。

因此：

- Receipt 禁止保存 raw stderr；
- structured machine API 不应依赖 stderr 文本；
- 人工日志只接受 bounded diagnostic risk。

---

## 12. Unified hook observation

为 future Receipt 和 orchestration 提供统一事实层，建议内部定义：

```ts
type AfterHookObservationV1 =
  | {
      status: 'skipped';
      reason: 'not_configured' | 'default_not_found';
    }
  | {
      status: 'invalid_explicit';
      attempted: string;
      reason: string;
    }
  | AfterHookExecutionResult;
```

注意：

```text
observation != decision
```

同一个：

```text
exited_nonzero(exitCode=7)
```

在两种 mode 下事实完全相同，只是 impact 不同。

---

## 13. Pure policy decision

建议纯函数：

```ts
type AfterHookCompletionImpact = 'none' | 'warning' | 'error';

interface AfterHookPolicyDecisionV1 {
  failureMode: AfterHookFailureMode;
  observation: AfterHookObservationV1;
  impact: AfterHookCompletionImpact;
}

evaluateAfterHookPolicy(
  failureMode: AfterHookFailureMode,
  observation: AfterHookObservationV1
): AfterHookPolicyDecisionV1;
```

固定映射：

| observation | `warn` | `error` |
| --- | --- | --- |
| `skipped` | `none` | `none` |
| `succeeded` | `none` | `none` |
| `invalid_explicit` | `warning` | `error` |
| `spawn_failed` | `warning` | `error` |
| `exited_nonzero` | `warning` | `error` |
| `signaled` | `warning` | `error` |

这个 mapping 必须是纯逻辑，不读取 filesystem、env 或 process exit state。

---

## 14. Runtime hook stage ordering

Output Artifact Policy 已冻结：

```text
model
→ output pile finalize
→ main -o artifacts
→ Conversation --continue artifacts
→ after-hook
→ future Receipt
```

After-hook Failure Policy 不改变这个顺序。

只有在前置 required stages 没有：

- model/output failure；
- Conversation ordinary failure；
- OCC conflict；

时，runtime hook 才会真正执行。

因此：

```text
post-model OCC conflict
→ main/pile 可能保留
→ Conversation assistant 不 commit
→ hook 不运行
→ exit 3
```

`--after-hook-failure error` 不能把这个 `3` 改成 `1`。

---

## 15. Runtime failure semantics

### 15.1 warn

例如：

```text
main output committed
Conversation committed
hook exit 7
mode = warn
```

结果：

```text
artifacts 保留
hook observation = exited_nonzero(7)
hook impact = warning
stderr 输出 warning + bounded stderr tail
final success candidate 不变
当前无其它失败时 exit 0
```

### 15.2 error

同一个 child fact：

```text
hook exit 7
mode = error
```

结果：

```text
artifacts 保留
hook observation = exited_nonzero(7)
hook impact = error
ordinary failure candidate
exit 1
```

禁止：

- 删除已写 artifacts；
- 重跑模型；
- 自动 retry hook；
- 自动补写 tool result；
- 把 error 模式包装成 OCC conflict。

---

## 16. Hook failure error object

当前没有 Receipt 时，top-level 需要把 `impact = error` 映射到 ordinary exit `1`。

建议内部使用结构化 error：

```ts
class AfterHookFailureError extends Error {
  readonly code = 'after_hook_failed';
  readonly observation: AfterHookObservationV1;
}
```

用途：

- 让 top-level 可识别；
- 保留 observation；
- 保持 exit class = ordinary failure；
- future Receipt 可以消费 observation，而不需要解析 stderr message。

不要求：

- 把该 `code` 直接变成新的 public exit code；
- 把整个 Error JSON.stringify 进 Receipt。

如果为 Receipt 引入统一 invocation outcome state，则也可以不 throw，而是记录 primary failure candidate；但无论实现形式如何，**结构化 observation 必须先存在，stderr 自然语言不得成为机器事实来源。**

---

## 17. First-primary-failure integration

### 17.1 invalid explicit + error

发生在 pre-model：

```text
hook invalid
→ first primary ordinary failure
```

没有后续 model / output / hook runtime stage。

### 17.2 runtime hook + error

由于 Output Policy 只在前置 required stages 成功后执行 hook：

```text
runtime hook failure
→ 此时是第一个 primary failure
```

### 17.3 warn 不成为 primary

```text
hook failure + warn
```

只是 observation + warning。

如果未来随后 Receipt atomic write 失败：

```text
Receipt failure
→ 成为 first primary ordinary failure
```

### 17.4 error + future Receipt failure

如果未来 Completion Receipt 选择在 hook error 后仍尝试写 failure receipt：

```text
hook error 先发生
receipt write failure 后发生
```

必须保持：

```text
primary = hook failure
receipt failure = secondary diagnostic/finalizer failure
```

不得让 Receipt write error 覆盖 hook failure 的主要分类。

---

## 18. Completion Receipt seam

After-hook Failure Policy 必须为 Receipt 提供：

```text
failure mode
hook observation
policy impact
```

但不定义 Receipt schema。

Receipt 后续可以决定如何公开，例如：

```text
hook.status
hook.exitCode
hook.signal
hook.policy
```

但本计划只冻结以下禁止项：

Receipt 不得包含：

- raw hook stdout；
- raw hook stderr；
- hook environment；
- API key；
-完整 process.env；
- stdout/stderr capture buffer；
-通过解析 human diagnostic 反推 hook outcome。

对于 `warn` failure：

```text
process exit 0
```

与：

```text
hook observation = failed
```

可以同时成立。

Receipt 必须保留这种信息，而不是因为 exit `0` 就写成 hook success。

对于 `error` failure 是否写 failure receipt，由 Completion Receipt contract 决定，不由 After-hook Policy 强制。

---

## 19. Artifact ledger / hook env contract

Hook env 继续由：

```text
resolved Output Policy
+
actual CompletionArtifactLedger
+
model metadata
```

构造。

以下变量必须继续只引用真实已提交 artifacts：

```text
PROMPTPILE_OUTPUT_FILE
PROMPTPILE_CALLS_FILE
PROMPTPILE_ASSISTANT_MD_FILE
PROMPTPILE_ASSISTANT_CALL_FILE
PROMPTPILE_ASSISTANT_EXTRA_FILE
```

After-hook Failure Policy 不允许：

```text
hook failure
→ 重新 scan directory
→ 猜最新 assistant artifact
```

也不允许 hook result 改写 ledger。

如果 hook 自己创建新文件：

```text
这些文件不是 Promptpile completion artifact ledger 的自动成员
```

未来如需 hook-produced artifact protocol，应单独设计。

---

## 20. Diagnostics contract

stderr 仍是 human diagnostic channel，不是稳定机器协议。

建议前缀保持清晰，例如：

```text
Warning: after-hook ...
Error: after-hook ...
```

但 v1 不冻结完整自然语言字符串。

必须包含足够人工信息：

### invalid explicit

- attempted path；
- resolver reason；
- failure mode 造成的 warning/error 结果。

### spawn failed

- resolved hook path；
- OS / spawn error code（若有）；
-简短 error message。

### exited nonzero

- resolved hook path；
- exact exit code；
- bounded stderr tail（若非空）。

### signaled

- resolved hook path；
- signal；
- bounded stderr tail（若非空）。

`quiet` 只关闭正常 stdout，不得吞掉这些 warning/error diagnostics。

---

## 21. Signal 与 cancellation 边界

v1 支持分类：

```text
child terminated by signal
→ status = signaled
```

但不定义：

- Promptpile 收到 SIGINT 后怎样递归杀 hook process tree；
- Windows Job Object；
- `taskkill /T`；
- Unix process group；
- signal forwarding；
- cancellation receipt。

这些属于独立 process lifecycle 设计。

不能因为 v1 没有 process-tree 管理，就把 `signaled` 错误归为 `exited_nonzero`。

---

## 22. Timeout 明确延期

v1 **不增加**：

```bash
--after-hook-timeout-ms
```

原因不是 timeout 不重要，而是正确 timeout 语义必须至少回答：

```text
只 kill shell 还是整个 process tree？
Windows 怎么做？
Unix process group 怎么做？
grace period 是否存在？
SIGTERM → SIGKILL escalation？
cleanup failure 怎么分类？
```

在这些问题没有被冻结前，加入一个只杀父进程的 timeout 会制造更难诊断的 orphan child。

未来若加入 timeout，应新增明确 observation：

```text
timed_out
```

不能偷偷映射成 `signaled`。

---

## 23. 不增加 `ignore`

v1 只保留：

```text
warn
error
```

原因：

- `warn` 已经保持现有宽容成功语义；
- `ignore` 唯一差异只是“连 stderr 都不要”，价值不足以扩大 public policy surface；
- `quiet` 本身也不应吞掉 warning/error diagnostics。

如果未来真实使用场景证明需要完全静默 hook failure，再单独增加，不提前保留无消费价值的枚举。

---

## 24. Exit code contract

v1 不增加 after-hook 专用退出码。

固定：

```text
hook failure + warn  → 不单独改变 exit code
hook failure + error → ordinary failure exit 1
OCC conflict         → exit 3
```

这样现有 orchestrator 仍可保持：

```text
0 = success
1 = ordinary failure
3 = Conversation conflict
```

更细粒度机器判断由 future Receipt / structured result 提供，而不是继续挤压进程退出码空间。

---

## 25. Implementation architecture

建议形成以下模块边界：

```text
after-hook-policy.ts
  parseAfterHookFailureMode
  evaluateAfterHookPolicy
  AfterHookFailureError / types


after-hook.ts
  resolveAfterHookScript
  buildPromptpileHookEnv
  runAfterHook → structured execution result


output-artifact-policy.ts
  hook: ResolvedAfterHookPolicyV1


index.ts
  orchestration only
```

禁止形成：

```text
runAfterHook()
  ├─ read config failure mode
  ├─ print warning
  ├─ set process.exitCode
  └─ maybe write receipt
```

那会重新把 execution、policy 和 orchestration 混回一个函数。

---

## 26. 实施阶段

### Phase 0：Config / contract primitive

1. 增加 `AfterHookFailureMode`；
2. 增加纯 parser；
3. CLI `--after-hook-failure`；
4. TOML `after_hook_failure`；
5. CLI > TOML > `warn`；
6. 更新 `Config` / `loadConfig` compatibility；
7. 更新 CLI Contract。

### Phase 1：事实化 resolver

1. `warn_invalid_explicit` → `invalid_explicit`；
2. `skip` 增加 reason；
3. 保持 CLI/TOML/default path precedence；
4. 保持 canonical realpath；
5. 保持 default hook CLI-only opt-in；
6. 增加 invalid CLI path 不 fallback 的测试。

### Phase 2：Resolved Hook Policy

1. 定义 `ResolvedAfterHookPolicyV1`；
2. 将 failure mode 与 resolution 放入 Output Policy；
3. downstream output/hook orchestration 不再直接读取 config failure mode；
4. collision validation 继续只保护真正 `run` 的 resolved hook path。

### Phase 3：Structured executor

1. `runAfterHook(): Promise<AfterHookExecutionResult>`；
2. classify success/spawn/nonzero/signal；
3. exactly-one terminal settle；
4. stdout discard；
5. stderr 64 KiB byte tail；
6. executor 不做 logging/policy/process exit。

### Phase 4：Policy evaluator

1. `evaluateAfterHookPolicy()` 纯函数；
2. warn/error mapping；
3. invalid explicit pre-model handling；
4. `AfterHookFailureError` 或等价 structured primary failure；
5. diagnostics formatter 与 execution 分离。

### Phase 5：Root orchestration

1. strict invalid explicit 在 sink preparation / model 前失败；
2. runtime hook 在 artifact ledger 完成后执行；
3. warn 保持 success candidate；
4. error → ordinary failure 1；
5. conflict/upstream failure 时不运行 hook；
6. `--input` strict-invalid ordering 明确测试。

### Phase 6：Tests / docs / CI

1. parser/config tests；
2. executor fault injection；
3. root fake API integration；
4. Windows/Linux dedicated workflow；
5. README；
6. CLI Contract；
7. security docs；
8. 更新本文状态为已实施。

Receipt 不作为本计划实施完成的依赖。

---

## 27. 测试矩阵

### 27.1 failure mode parser

覆盖：

```text
undefined → undefined
""        → undefined
"warn"    → warn
"error"   → error
" WARN "  → invalid
"ignore"  → invalid
```

如果希望 trim 后接受 whitespace：

```text
" warn " → warn
```

可以接受，但大小写仍保持 exact lowercase；实现与文档必须一致。推荐 trim whitespace 后接受。

### 27.2 config precedence

必须验证：

```text
no config → warn
TOML error → error
CLI warn + TOML error → warn
CLI error + TOML warn → error
```

并验证：

```text
after_hook_failure
```

不来自 process env / LLM profile。

### 27.3 no hook configured

```text
mode warn  → skip, exit 0
mode error → skip, exit 0
```

### 27.4 default discovery missing

```text
--allow-default-after-hook
--after-hook-failure error
```

无 default file：

```text
skip(default_not_found)
exit 0
```

### 27.5 explicit invalid + warn

fake API integration：

- invalid explicit hook；
- API request count = 1；
- normal artifacts 按配置产生；
- no hook process；
- warning on stderr；
- exit 0（若其它阶段成功）。

### 27.6 explicit invalid + error

验证：

- API request count = 0；
- output pile 不 open/truncate；
- main output parent 不因 sink preparation 创建；
- no assistant Conversation artifact；
- exit 1。

带 `--input` 再测一次：

- strict invalid hook 应在 user append 前失败；
- no new user artifact。

### 27.7 path precedence

```text
valid TOML hook
+
invalid CLI hook
```

必须使用 invalid CLI observation，不 fallback。

### 27.8 success

真实短脚本：

```text
exit 0
```

在 warn/error 下均：

```text
observation=succeeded
impact=none
exit 0
```

### 27.9 nonzero

真实脚本 exit `7`：

warn：

- artifacts 保留；
- hook observation exact exit `7`；
- exit 0；
- warning diagnostic。

error：

- artifacts 保留；
- hook observation exact exit `7`；
- exit 1。

### 27.10 spawn failure

优先用 injectable executor seam，避免依赖平台上不存在某个特定 shell。

验证：

```text
spawn error event
→ exactly one spawn_failed result
```

并验证 `error` 与后续 `close` 不会产生第二个 classification。

### 27.11 signal termination

用 deterministic fake child event seam 覆盖：

```text
close(null, "SIGTERM")
→ signaled(SIGTERM)
```

Unix 可以补真实 signal integration；Windows 不要求用不稳定真实 signal 模拟证明核心 classifier。

### 27.12 stdout memory behavior

hook 输出大量 stdout：

- Promptpile 不缓存；
- 不转发到 Promptpile stdout；
- child 不因 stdout pipe backpressure 卡死；
- execution result 不包含 stdout。

### 27.13 stderr bound

hook 写 > 64 KiB stderr 后 exit nonzero：

验证：

- child 能正常结束；
- retained bytes <= 64 KiB；
- `stderrTruncated = true`；
- tail 对应最后部分；
- Receipt seam 不暴露 raw tail。

### 27.14 quiet

```text
-q + hook failure warn/error
```

warning/error stderr 仍然可见；quiet 不改变 policy。

### 27.15 artifact retention

同时启用：

```text
-o
--continue
hook nonzero
```

warn/error 均验证：

- main artifacts 保留；
- Conversation artifacts 保留；
- ledger 保留；
- 不回滚。

### 27.16 upstream failure / conflict

至少：

- main output write failure；
- Conversation OCC conflict；

验证 hook marker 不产生。

`--after-hook-failure error` 不得覆盖原有 error/conflict classification。

### 27.17 hook env remains ledger-backed

继续覆盖：

- main body/calls；
- Conversation body/calls/extra；
- absent sidecar = empty env path；
- layered mode；
- no path inference。

### 27.18 diagnostics do not serialize env

构造包含 sentinel secret 的 env：

```text
PROMPTPILE_TEST_SECRET=do-not-print
```

让 spawn/nonzero failure 发生。

Promptpile 自己生成的结构化 error/diagnostic 不得自动 dump：

- process.env；
- hookEnv；
- API key config。

如果 hook 主动把 secret 写到 stderr，属于 hook-emitted untrusted output，不纳入“自动泄露”保证。

---

## 28. CI

After-hook 行为高度依赖：

- shell selection；
- Windows `cmd` / PowerShell；
- Unix executable；
- child lifecycle；
- path resolution；
- stdio stream behavior。

因此 dedicated workflow 至少执行：

```text
Node 18 / Ubuntu
Node 22 / Ubuntu
Node 18 / Windows
Node 22 / Windows
```

建议新增：

```text
.github/workflows/after-hook-failure-policy.yml
```

核心矩阵应执行：

1. config/parser tests；
2. after-hook resolver/security tests；
3. executor structured result tests；
4. root integration warn/error tests；
5. Output Artifact Policy regression tests；
6. OCC conflict hook-skip regression。

---

## 29. 验收标准

实施完成必须同时满足：

- [x] failure mode 只有 `warn|error`；
- [x] 默认 mode 为 `warn`；
- [x] CLI > TOML > default precedence 冻结；
- [x] invalid failure mode 在模型调用前失败；
- [x] resolver status 不再包含 `warn_` / `error_` policy 语义；
- [x] CLI explicit hook > TOML hook > opt-in default discovery；
- [x] invalid CLI hook 不 fallback；
- [x] default discovery 仍只能由 CLI 显式 opt-in；
- [x] `error` mode 不把 missing default hook 当 failure；
- [x] `ResolvedAfterHookPolicyV1` 进入唯一 Output Policy topology；
- [x] `runAfterHook` 返回结构化 execution result；
- [x] success / spawn_failed / exited_nonzero / signaled 均有确定分类；
- [x] child lifecycle 恰好产生一个 terminal result；
- [x] executor 不读取 failure mode；
- [x] executor 不直接设置 process exit；
- [x] hook stdout 不缓存、不进入 stdout/ledger/receipt；
- [x] hook stderr 持续 drain 且只保留最后 64 KiB；
- [x] invalid explicit + warn 继续 completion；
- [x] invalid explicit + error 在 model/sink preparation 前失败；
- [x] `--input` strict invalid hook 不先 append user；
- [x] runtime hook failure 发生在 durable output stages 后；
- [x] warn runtime failure 保留 artifacts 且不单独改变 success exit；
- [x] error runtime failure 保留 artifacts 且 exit 1；
- [x] hook failure 不回滚 main/Conversation artifacts；
- [x] upstream ordinary failure/OCC conflict 时 hook 不执行；
- [x] OCC conflict 仍保持 exit 3；
- [x] quiet 不吞 hook warning/error diagnostics；
- [x] artifact env 继续只来自 actual ledger；
- [x] structured result/Receipt seam 不携带 raw hook stdout/stderr/env；
- [x] first-primary-failure 与 future Receipt failure 顺序已冻结；
- [x] v1 不实现 timeout / process-tree kill；
- [x] v1 不增加 `ignore`；
- [x] v1 不增加 hook 专用 exit code；
- [ ] Node 18/22 × Windows/Linux dedicated CI 全绿；
- [x] CLI Contract、README、安全文档更新。

---

## 30. 非目标

v1 明确不做：

- 不把 hook 变成 Promptpile 内建 tool executor；
- 不自动运行 `promptpile-mcp check`；
- 不根据 hook exit code 猜 tool result completeness；
- 不自动 retry hook；
- 不回滚已提交 artifacts；
- 不自动删除 hook 自己产生的文件；
- 不解释 hook stdout；
- 不允许 hook stdout 污染 Promptpile machine stdout；
- 不把 stderr 原文写进 Receipt；
- 不定义 Receipt schema；
- 不定义 Invocation ID；
- 不实现 timeout；
- 不实现跨平台 process tree cancellation；
- 不增加 distributed lease / task manager；
- 不给 hook failure 增加专用 exit code；
- 不增加 `ignore` failure mode；
- 不在本计划中改变 default hook discovery 的安全 opt-in。

---

## 31. Future Work

### 31.1 Completion Receipt

Receipt 直接消费：

```text
AfterHookObservationV1
+
AfterHookPolicyDecisionV1
```

而不是解析 stderr。

Receipt schema 应独立决定：

- 是否公开 resolved hook path；
- warn failure 下 top-level status 如何编码；
- error failure 是否仍写 failure receipt；
- signal/exit code 字段形式。

### 31.2 Invocation ID

未来 Invocation ID 可以进入：

```text
PROMPTPILE_INVOCATION_ID
```

和 Receipt correlation。

After-hook Failure Policy 不提前定义该字段。

### 31.3 Timeout / process tree lifecycle

单独设计：

```text
timeout
→ graceful termination
→ process-tree escalation
→ timed_out observation
```

必须跨 Windows/Linux 正确实现后再加入 public CLI。

### 31.4 Structured diagnostics

如果未来提供机器 diagnostics channel，可以把：

```text
after_hook_failed
kind
exitCode
signal
```

结构化输出。

不要让调用方解析当前 human stderr。

### 31.5 Hook-produced artifacts

如果未来确有需求让 hook 声明新 artifacts，应定义显式 manifest/protocol。

不要通过：

```text
hook 执行后扫目录 diff
```

自动猜测。

---

## 32. 冻结决策汇总

After-hook Failure Policy v1 在实施前冻结以下决定：

1. **v1 只支持 `warn` / `error`。**
2. **默认 `warn`，保持现有宽容成功语义。**
3. **不增加 `ignore`。**
4. **Failure mode CLI > TOML > default。**
5. **Failure mode 不来自 env / LLM profile。**
6. **Resolver 只返回事实，不再使用 `warn_invalid_explicit` 这类 policy-laden status。**
7. **CLI explicit hook > TOML hook > CLI-opt-in default discovery。**
8. **显式高优先级 path invalid 时不 fallback。**
9. **Default hook 未找到只是 skip，即使 failure mode = error。**
10. **Invalid explicit + warn = warning observation + continue。**
11. **Invalid explicit + error = pre-model ordinary failure。**
12. **严格 invalid hook 应在 `--input` user mutation 前被发现。**
13. **Runtime hook 只在 required durable output stages 成功后运行。**
14. **`runAfterHook` 返回 structured execution fact，不做 policy。**
15. **Execution result 固定区分 success / spawn failure / nonzero / signal。**
16. **Child lifecycle 只允许一个 terminal classification。**
17. **Hook stdout 完全不是协议，不缓存、不转发。**
18. **Hook stderr 只保留最后 64 KiB byte tail，同时必须持续 drain。**
19. **Warn runtime failure 保留 artifacts，最终可 exit 0。**
20. **Error runtime failure 保留 artifacts，ordinary exit 1。**
21. **不增加 hook 专用 exit code。**
22. **OCC conflict 仍为 exit 3，且不会运行 hook。**
23. **Hook failure 不修改 artifact ledger。**
24. **Hook env 仍只消费 ledger 中真实 committed artifacts。**
25. **Receipt 消费 hook observation/decision，不消费 stderr/stdout/env。**
26. **first-primary-failure 继续适用于 hook → Receipt 顺序。**
27. **v1 不实现 timeout/process-tree kill。**
28. **Output Policy 继续拥有阶段顺序；本计划只拥有 hook outcome → completion impact。**

完成以上实现后，底层 completion 链可稳定表示为：

```text
Conversation state
        ↓
Fingerprint / OCC
        ↓
model
        ↓
Output Artifact Policy
        ↓
actual Artifact Ledger
        ↓
Resolved After-hook Policy
        ↓
Hook Observation
        ↓
Hook Policy Decision
        ↓
future Completion Receipt
        ↓
final invocation status
```

这使 `warn` 的人工兼容场景与 `error` 的严格 orchestrator 场景共享同一套执行事实，不再依赖“看 stderr 猜 hook 到底有没有成功”。
