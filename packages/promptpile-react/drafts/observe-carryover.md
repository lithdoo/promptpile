# ReAct Observe Carryover：文件原生闭环改造方案

> 状态：**Implementation-ready / design frozen**（2026-08-31）  
> 范围：仅 `packages/promptpile-react`  
> 目标：在不改变 Promptpile 文件优先设计、不扩大 Check 职责、不引入新的业务协议的前提下，让 Observe 可以成为后续 ReAct iteration 的显式上下文，并通过文件位置实现可验证的滑动窗口。  
> 默认：`observe_carryover = 0`，严格保持当前行为。  
> 核心原则：**身份由 append-only index 记录；可见性由文件位置决定；Promptpile 负责消息文件，React 只负责标识 Observe 身份与 retention。**

---

## 1. 结论先行

现有 ReAct FSM 不变：

```text
Thoughtₙ
  ↓
Observeₙ
  ↓
Checkₙ
  ├─ false → Final
  └─ true  → Thoughtₙ₊₁
```

四个 phase 的职责继续冻结为：

```text
Thought  = 执行 / 推进工作
Observe  = 对当前累计工作形成评价
Check    = current Observe → continue / stop
Final    = 对外形成最终回复
```

本改造只增加一个 React-only retention policy：

```text
observe_carryover = N
```

当 `N = 0`：

```text
完全保持现有行为
```

当 `N > 0`：

```text
Observe completion
→ Promptpile 正常持久化为 work/[n]assistant.md
→ Completion Receipt 证明该 persisted assistant 与本轮 -o 来自同一次 invocation
→ React 把 n 追加登记为 Observe index
→ 最近 N 个 Observe turn 留在 work 根目录
→ 更旧 Observe artifact family move 到 work/.observe_files/
→ 下一轮 Thought / Observe 通过正常扫描 work root 自然看到保留的 Observe
```

文件状态模型：

```text
work 根目录
= active React Conversation

work/.observe_files/
= archived Observe artifact family

work/.observe_files/index.json
= 本 session 所有 Observe message index 的 append-only identity ledger
```

Promptpile 只扫描 Conversation directory 根层，不递归扫描 `.observe_files/`，因此不需要额外 handoff、过滤器或上下文拼装。

---

## 2. 为什么采用 file-native retention

不采用：

```text
Observe text
→ Runtime successfulObserves[]
→ 动态生成 thought-observations.user.md
→ --append-files
→ next Thought
```

原因：

1. 同一 Observe 会同时存在为 Runtime 内存状态和 handoff 文本，形成第二套状态表示。
2. Runtime 需要主动拼上下文，而不是由 Conversation directory 自然决定上下文。
3. 需要额外定义 handoff 格式、顺序、覆盖与生命周期。
4. 与 Promptpile 的核心模型“文件即消息、目录即 Conversation”不一致。

file-native 方案只依赖现有 Promptpile primitives：

```text
标准 Conversation message file
标准 Completion Receipt
标准根目录扫描
标准同文件系统 rename
```

因此 `observe_carryover` 的语义不是“向 Thought 注入 N 个 Observe”，而是：

> **active React work Conversation 中最多保留最近 N 个 Observe turn。**

---

## 3. 配置契约

新增 React-only 非负整数：

| 表面 | 键 | 默认 | 含义 |
| --- | --- | ---: | --- |
| CLI | `--observe-carryover <n>` | `0` | active work Conversation 中最多保留的最近 Observe turn 数量 |
| TOML | `[promptpile-react].observe_carryover` | `0` | 同上 |
| Runtime | `ResolvedReactConfig.observeCarryover` | `0` | 已解析值 |

约束：

```text
integer
>= 0
```

不引入：

```text
-1
"all"
true / false
```

若希望 session 内所有 Observe 都保持 active：

```text
observe_carryover >= max_step
```

配置优先级：

```text
CLI --observe-carryover
> [promptpile-react].observe_carryover
> 0
```

该键只属于 `[promptpile-react]`，不得加入 `[promptpile]` shared keys。

### 3.1 `observe_carryover = 0`

必须是严格 backward-compatible 模式：

```text
Observe
→ 继续只使用临时 -o
→ 不传 -c
→ 不写 session work Conversation
→ 不创建 .observe_files/
→ 不创建 index.json
→ 不创建 Observe Receipt
```

冻结要求：

1. Thought argv 与当前一致。
2. Observe argv 与当前一致。
3. Check argv / tool schema 与当前一致。
4. Final latest-Observe handoff 与当前一致。
5. Agent Event Protocol 不变。
6. session cleanup / debug-preserve 不变。

### 3.2 `observe_carryover = N > 0`

Observe 同一 Promptpile invocation 同时产生：

```text
-o <temporary-output>
→ Runtime 取得 current Observe text

-c --output-dir <session-work>
→ Promptpile 持久化标准 assistant turn

--receipt <receipt-path>
→ 原子证明本轮 committed artifacts
```

最近 N 个 Observe 会被所有读取 work Conversation 的 phase 自然看到；当前包括：

```text
Thought
Observe
```

Check 仍不读取 work。

---

## 4. 文件系统状态模型

假设：

```toml
[promptpile-react]
max_step = 4
observe_carryover = 2
```

稳定状态可能是：

```text
work/
├── .promptpile-react-session.json
│
├── [0]assistant.md          # Thought₀
├── [2]assistant.md          # Thought₁
├── [4]assistant.md          # Thought₂
├── [5]assistant.md          # Observe₂, active
├── [6]assistant.md          # Thought₃
├── [7]assistant.md          # Observe₃, active
│
└── .observe_files/
    ├── index.json
    ├── [1]assistant.md      # Observe₀, archived
    └── [3]assistant.md      # Observe₁, archived
```

`index.json`：

```json
{
  "version": 1,
  "indices": [1, 3, 5, 7]
}
```

定义：

```text
registered Observe
= index.json 中存在 n

active Observe
= registered n 且 work/[n]assistant.md 存在

archived Observe
= registered n 且 work/.observe_files/[n]assistant.md 存在
```

稳定成功态要求每个 registered Observe index：

```text
exactly one of:
  active primary body exists
  archived primary body exists
```

因此：

> **manifest 只记录身份；物理位置只记录 active/archive 状态。**

不得把 `active` / `archived` 再写进 manifest。

---

## 5. Observe identity ledger

固定路径：

```text
<session.workDirectoryAbs>/.observe_files/index.json
```

V1 schema：

```ts
interface ObserveFileIndexV1 {
  version: 1;
  indices: number[];
}
```

冻结约束：

1. `version === 1`。
2. `indices` 只包含非负整数。
3. 严格升序。
4. 不允许重复。
5. **append-only：成功登记后 index 永不删除。**
6. archive / unarchive 不修改 identity ledger。
7. 不记录 session id；父目录已有 `.promptpile-react-session.json`。
8. 不记录路径；路径由 index + Promptpile artifact naming 推导。
9. 不记录 iteration；message index 已足以标识 persisted Observe turn。
10. 不是 public protocol，仅属于 session-owned internal state。

因此状态变化固定为：

```text
identity history
= append-only

visibility
= move-only
```

例如：

```text
register Observe 5:
[1,3] → [1,3,5]

archive Observe 1:
index 仍是 [1,3,5]
只发生 root/[1]... → .observe_files/[1]...
```

### 5.1 Atomic write

`index.json` 必须原子替换：

```text
write temp in .observe_files/
→ close / fsync as existing helper permits
→ rename temp → index.json
```

至少保证下一阶段永远不会读取半写 JSON。

`.observe_files/` 在 `carryover=0` 时不得创建；`N>0` 时 lazy 创建于首个成功 Observe register 阶段。

---

## 6. Observe artifact family

Observe 身份以 Promptpile message index 为单位，不只以 `[n]assistant.md` 单文件为单位。

一个 Observe turn 的允许 artifact family：

```text
[n]assistant.md
[n]assistant.calls.jsonl
[n]assistant.extra.json
[n]assistant.result.jsonl
```

当前 Observe 使用 `--disable-tool`，正常不会产生 calls/result，但 archive 逻辑仍按整个同-index family 处理。

归档：

```text
work/[n]assistant.*
→ work/.observe_files/[n]assistant.*
```

只允许移动明确属于该 index 的标准 Promptpile artifact family；不得使用模糊前缀匹配或通配删除其它文件。

Primary body：

```text
[n]assistant.md
```

是 active/archive 状态判定锚点。

---

## 7. Observe persistence 必须由 Promptpile 完成

React 不得：

```text
自行计算 next index
自行 fs.writeFile([n]assistant.md)
通过 Observe 前后 readdir diff 猜新文件
```

Promptpile 继续拥有 Conversation mutation/index allocation。

启用 carryover 时 Observe invocation 使用：

```text
-c
--output-dir <session-work>
-o <temporary-output>
--invocation-id <observe-invocation-id>
--receipt <observe-receipt-path>
```

Promptpile Completion Receipt 是唯一 commit proof。

---

## 8. Observe invocation correlation

每轮 Observe invocation id 冻结为：

```text
${session.sessionId}-observe-${stepIndex}
```

要求：

1. 同一 session + step 唯一。
2. 不与 Thought / Final invocation id 冲突。
3. Receipt validation 必须 exact match。

Receipt path 必须每轮唯一，禁止复用一个可能残留旧 Receipt 的固定路径。

建议：

```text
os.tmpdir()/promptpile-react-observe-receipt-<sessionId>-<stepIndex>-<random>.json
```

读取验证后在 `finally` 删除。

`.observe_files/` 不保存 Receipt；其长期 session-internal 内容只允许：

```text
index.json
archived Observe artifact family
```

---

## 9. Receipt 双绑定：证明 text 与 persisted message 来自同一次 completion

Observe success 不能只验证 `receipt.artifacts.assistant`。

必须同时验证：

```text
schemaVersion == 1
status == completed
invocationId == expected observe invocation id

artifacts.assistant != null
artifacts.assistant exists
assistant parent == session.workDirectoryAbs
assistant basename 严格匹配 [n]assistant.md

artifacts.mainOutput != null
artifacts.mainOutput == 当前 invocation 的 exact resolved -o path
mainOutput exists
```

然后：

```text
current Observe text
= 从 exact -o path 读取

persisted Observe identity
= 从 exact assistant path 解析 n
```

这形成必须冻结的证明链：

```text
same invocation id
      │
      ├── receipt.mainOutput ──► Check 使用的 Observe text
      │
      └── receipt.assistant  ──► work 中 persisted Observe message
```

因此 Runtime 不会把一个 completion 的 `-o` 和另一个 completion 的 assistant artifact 错配。

### 9.1 Receipt validator

建议把当前 `final-receipt.ts` 中通用逻辑抽成：

```text
src/completion-receipt.ts
```

概念接口：

```ts
validateCompletionReceiptV1({
  receiptPath,
  expectedInvocationId
}): ValidatedCompletionReceiptV1
```

返回：

```ts
{
  assistant: string | null;
  calls: string | null;
  extra: string | null;
  mainOutput: string | null;
  mainCalls: string | null;
  mainExtra: string | null;
}
```

Final wrapper 再校验 assistant parent == userWritable；Observe wrapper 校验 assistant parent == session work、mainOutput == expected `-o`。

不要复制两套 Receipt parser。

---

## 10. Observe phase routing

### 10.1 `carryover = 0`

保持当前：

```text
read:
  authoritativeReadLayers
  session work

write:
  temporary -o only

continueMode:
  false
```

### 10.2 `carryover > 0`

切换为 writable work routing：

```text
input directories:
  authoritativeReadLayers

output directory:
  session.workDirectoryAbs

continueMode:
  true
```

Promptpile 会把 output directory 作为最后 input layer，所以逻辑读取仍是：

```text
authoritative Conversation
→ existing session work Conversation
```

Observe prompt 继续用现有 `--append-files <observe.system.md>` 注入，不进入 Conversation。

概念 argv：

```text
promptpile
  -d <authoritative layer> ...
  --output-dir <session-work>
  -c
  --disable-tool
  --append-files <observe-prompt.system.md>
  -o <observe-output.md>
  --invocation-id <sessionId-observe-stepIndex>
  --receipt <unique-observe-receipt.json>
```

---

## 11. Frozen Observe commit sequence

当 `observe_carryover > 0` 时，一轮 successful Observe 的提交顺序固定为：

```text
1. Thought completed
   ↓
2. Observe Promptpile invocation
   - temporary -o
   - persisted assistant into work
   - atomic Completion Receipt
   ↓
3. Validate -o exists and trim() is non-empty
   ↓
4. Validate Completion Receipt
   ↓
5. Assert receipt.mainOutput == exact -o path
   ↓
6. Assert receipt.assistant == valid direct child of session work
   ↓
7. Parse Observe message index n from assistant basename
   ↓
8. Append-register n in .observe_files/index.json
   ↓
9. Prune active Observe to carryover limit
   ↓
10. Verify stable retention invariants
   ↓
11. Set latestSuccessfulObserve from current -o text
   ↓
12. phase.completed(observe)
   ↓
13. Check(current Observe text)
   ↓
14. continue / stop
```

这里 `phase.completed(observe)` 的含义冻结为：

```text
model completion succeeded
AND -o text valid
AND persisted assistant Receipt valid
AND mainOutput/assistant belong to this exact invocation
AND Observe identity registered
AND retention/pruning succeeded
AND stable invariants hold
```

其中任一步失败：

```text
stopReason = error
Check 不运行
Final 不运行
```

---

## 12. Retention invariants

每个 successful Observe phase commit 之后必须满足：

### 12.1 Active count

```text
active Observe count <= observe_carryover
```

### 12.2 Registered location exclusivity

对每个 registered index：

```text
exactly one primary body exists:
  root/[n]assistant.md
  OR
  .observe_files/[n]assistant.md
```

### 12.3 Latest Observe must remain active

若本轮新 Observe index 为 `newestObserveIndex`：

```text
work/[newestObserveIndex]assistant.md MUST exist
```

本轮新 Observe **绝不能在同一次 prune 中被 archive**。

因此当 `N > 0`：

```text
newest Observe is always active
```

### 12.4 Active maximum index monotonicity

由于：

```text
newest Observe 始终保留在 root
```

且它是刚由 Promptpile 分配的当前最新 message index，所以 Observe pruning 不得导致：

```text
max(active work Conversation message index)
```

下降。

冻结 invariant：

```text
successful Observe archival never removes the current maximum Conversation index
```

这保证后续 Promptpile `-c` allocation 不会因为 archive 而重新使用一个已经归档的旧 index。

### 12.5 Thought immutability under Observe pruning

任何未登记在 `index.json` 的 message index 都不是 Observe retention 的 mutation target。

因此：

```text
Thought artifacts 永远不会被 Observe pruning 移动
```

---

## 13. Pruning algorithm

输入：

```text
N > 0
registered indices
```

计算：

```text
active = registered indices 中 primary body 位于 work root 的 indices
active.sort(ascending)
```

冻结：

```text
newest = active.at(-1)
```

然后：

```text
while active.length > N:
  oldest = active[0]

  assert oldest != newest
  archiveObserveFamily(oldest)
  active.shift()
```

例如：

```text
N = 2
active before = [3,5]
new Observe = 7
active after register = [3,5,7]
newest = 7
archive 3
final active = [5,7]
```

不重新编号文件。Promptpile Conversation index 允许空洞：

```text
[0], [2], [4], [5], [6], [7]
```

---

## 14. Archive operation

`archiveObserveFamily(n)` 冻结要求：

1. `n` 已在 identity ledger。
2. `n` 不是当前 newest Observe。
3. root primary `[n]assistant.md` 存在。
4. archive primary 不存在。
5. 收集 root 中该 index 的允许 artifact family。
6. destination 任一同名文件已存在时 fail，不覆盖。
7. 使用同文件系统 `rename`，不得 copy + delete。
8. non-primary sidecars 先移动。
9. primary `[n]assistant.md` 最后移动。
10. primary rename 成功后，active/archive 状态才对扫描语义发生切换。
11. 任一 rename 失败立即使 Observe phase failure；不得继续 Check。

由于 source/destination 都在同一个 session work tree，正常是同文件系统 rename。

不引入 WAL、跨进程事务或自动恢复协议。

---

## 15. Stable state 与 failed debug state

上述 retention invariants 只保证在：

```text
successful Observe phase commit
```

之后成立。

如果：

```text
index write 成功
archive sidecar rename 成功
primary rename 失败
```

session 会立即 terminal，且可能在 debug-preserve 模式留下诊断性的 partial state。

这类失败状态允许存在：

```text
root/[3]assistant.md
archive/[3]assistant.extra.json
```

但其语义冻结为：

> **debug-preserved failed session is diagnostic-only, not resumable state.**

因此不要求为了失败调试目录实现 rollback 或 transaction log。

成功 session 的 stable state 必须满足 §12 全部 invariants。

---

## 16. Check 保持完全不变

Check 继续只接收：

```text
empty temporary Conversation
+ check.system.md
+ current observe-report.user.md
+ react_check_decision tool
```

工具 schema 继续只有：

```json
{"decision": true}
```

或：

```json
{"decision": false}
```

不新增：

```text
feedback
reason
repair
next_action
```

Check 不读取：

```text
session work
.observe_files/
index.json
Observe history
```

其唯一职责仍是：

```text
current Observe → outer loop continue / stop
```

---

## 17. Final 保持现有状态隔离

Final 继续：

```text
read authoritative Conversation only
+ latestSuccessfulObserve explicit Final handoff
```

Final 不读取：

```text
session work Conversation
.observe_files/
Observe history
```

即使：

```text
observe_carryover = 5
```

Final 仍只使用 latest successful Observe。

原因：

1. Final 不读 work 是现有权威历史隔离 invariant。
2. carryover 只定义 internal work memory。
3. 不改变 Final token/context policy。
4. Runtime 已持有 latestSuccessfulObserve 供现有 Final handoff。

---

## 18. Work Conversation 的语义变化

未启用 carryover：

```text
work root
= Thought history
```

启用后：

```text
work root
= all retained Thought history
+ latest N Observe history
```

例如 `observe_carryover=1`：

```text
work/
├── [0]assistant.md      Thought₀
├── [2]assistant.md      Thought₁
├── [3]assistant.md      Observe₁
├── [4]assistant.md      Thought₂
└── .observe_files/
    ├── index.json       [1,3]
    └── [1]assistant.md  Observe₀
```

下一轮 Thought / Observe 自然看到：

```text
Thought₀
Thought₁
Observe₁
Thought₂
```

看不到 Observe₀。

Runtime 不解释 Observe 内容，也不要求它 cumulative；用户自定义 prompt 决定 Observe 的语义。

---

## 19. Failure semantics

### 19.1 Promptpile Observe invocation failure

```text
Promptpile nonzero/spawn failure
→ no successful Observe commit
→ no Check
```

### 19.2 `-o` missing / empty

```text
phase_output_missing
→ terminal session
→ no Check
```

即使 Promptpile 已持久化 assistant，session work 仍只是失败诊断状态，最终 cleanup 或 debug-preserve 处理；不提供 resume。

### 19.3 Receipt invalid

包括：

```text
missing receipt
invalid JSON
wrong schema/status
wrong invocation id
assistant=null
assistant outside session work
invalid assistant basename
assistant missing
mainOutput=null
mainOutput != exact expected -o path
mainOutput missing
```

全部：

```text
Observe phase failure
→ no register/prune when validation has not reached that stage
→ no Check
```

### 19.4 index write failure

```text
Observe phase failure
→ no Check
```

### 19.5 archive/prune failure

```text
Observe phase failure
→ no Check
```

不修改、不回滚 authoritative Conversation；所有新 mutation 都只在 session work tree。

---

## 20. Suggested module boundaries

### `src/completion-receipt.ts`

只负责通用 Completion Receipt v1 parse / validate。

### `src/final-receipt.ts`

继续作为 Final-specific wrapper。

### `src/observe-files.ts`

只负责 filesystem state：

```text
.observe_files path
index.json parse / validate / atomic append-register
active/archive inspection
artifact-family archive
retention invariant verification
prune to carryover
```

建议朴素接口：

```ts
registerObserveAndPrune({
  session,
  assistantPath,
  carryover
}): void
```

不引入：

```text
ObserveStore
RetentionManager
ObservationChannel
ReactMemoryProvider
ArchiveRepository
```

### `ObserveReactProcess`

负责：

```text
Promptpile invocation
-o output
optional persistence/receipt
receipt-specific validation wrapper
返回 current text + persisted assistant path
```

建议返回：

```ts
interface ObserveReactResult {
  text: string;
  persistedAssistantPath?: string;
}
```

### `PromptpileReactRuntime`

负责 phase ordering：

```text
Observe result
→ register/prune
→ latestSuccessfulObserve
→ phase.completed
→ Check
```

Runtime 不保存 Observe history 数组；filesystem 是 carryover history source of truth。

---

## 21. Expected code changes

### `src/types.ts`

新增：

```ts
ReactCliOverrides.observeCarryover?: number
ResolvedReactConfig.observeCarryover: number
```

### `src/cli.ts`

新增：

```text
--observe-carryover <n>
```

解析为非负整数。

### `src/toml-config-react.ts`

`REACT_ONLY_KEYS` 增加：

```text
observe_carryover
```

`ReactOnlyTomlLayer` 增加：

```ts
observeCarryover?: number
```

### `src/resolve-react-config.ts`

合并：

```text
CLI > TOML > 0
```

### `src/build-phase-argv.ts`

Observe routing：

```text
0:
  保持当前 routing

>0:
  authoritative inputs
  outputDirectory = session work
  continueMode = true
```

### `src/react-processes.ts`

Observe：

```text
继续 -o
N>0 增加 -c / output-dir / invocation-id / receipt
验证 Receipt 双绑定
返回 ObserveReactResult
```

### `src/react-runtime.ts`

在 Observe 与 Check 之间：

```text
registerObserveAndPrune
verify invariants
set latestSuccessfulObserve
```

### `src/observe-files.ts`

新增 file-native retention 实现。

---

## 22. Security / path identity

所有 `.observe_files` mutation 必须限定在当前 session work：

1. archive root 固定为 `session.workDirectoryAbs/.observe_files`。
2. Receipt assistant parent 必须 canonical same-directory 于 session work。
3. Receipt mainOutput 必须 exact match Runtime 本轮创建的 resolved `-o` path。
4. 不接受 symlink/path traversal 后逃逸的 artifact。
5. assistant basename 必须严格解析为标准 `[n]assistant.md`。
6. archive destination 必须 canonical 位于当前 `.observe_files`。
7. destination 已存在时 fail，不覆盖。
8. 不读取或移动 authoritative Conversation 中的同 index 文件。
9. 优先复用 `react-path-identity.ts` helper。

---

## 23. Agent Event Protocol

不新增：

```text
observe.persisted
observe.archived
retention.updated
handoff.created
```

公开事件仍只表达 phase lifecycle / Check decision / Final output。

`phase.completed(observe)` 只有在完整 retention commit 成功后才发出。

---

## 24. Tests: configuration

覆盖：

```text
default = 0
CLI > TOML
0 valid
1 valid
N valid
negative invalid
fraction invalid
non-numeric invalid
unknown TOML key strictness updated
```

---

## 25. Tests: backward compatibility

`carryover=0` 必须断言：

```text
Observe argv 与当前一致
无 --output-dir work
无 -c
无 --receipt
无 Observe invocation-id
无 .observe_files
work 中无 Observe assistant message
Final handoff unchanged
```

最好保留 current argv snapshot/boundary test，使默认路径是真正 byte-level/argument-level 兼容，而不是只做语义近似。

---

## 26. Tests: Observe persistence / receipt binding

fake Promptpile：

```text
work/[1]assistant.md = observe persisted body
-o = observe main output
receipt.assistant = exact work/[1]assistant.md
receipt.mainOutput = exact -o
receipt.invocationId = expected
```

断言：

```text
Observe returns text
index.json == [1]
[1]assistant.md active in root
```

必须增加失败 case：

```text
assistant valid but mainOutput points to another file
mainOutput valid but assistant points to another work file
wrong invocation id
```

全部在 Check 前 fail。

---

## 27. Tests: retention and monotonic index

`carryover=2`：

```text
Thought 0
Observe 1
Thought 2
Observe 3
Thought 4
Observe 5
```

最终：

```text
root Observe = 3,5
archive Observe = 1
index = [1,3,5]
Thought 0,2,4 remain root
```

再执行下一 Thought，必须由 Promptpile 产生：

```text
[6]assistant.md
```

不得因为 `[1]` 被 archive 而复用旧 index。

显式测试 invariant：

```text
newest Observe always remains root
max active Conversation index never decreases after prune
```

---

## 28. Tests: manifest strictness

覆盖：

```text
bad JSON
wrong version
duplicate index
unsorted index
negative index
non-integer
```

同时测试 append-only：

```text
register 1 → [1]
register 3 → [1,3]
archive 1 → still [1,3]
```

---

## 29. Tests: artifact family / archive collision

Observe index 3：

```text
[3]assistant.md
[3]assistant.extra.json
```

淘汰后两者都在 `.observe_files/`。

若 destination 任一 family file 已存在：

```text
archive/[3]assistant.md
```

必须 fail，不覆盖。

测试 primary-last：若 sidecar move 成功、primary move 模拟失败：

```text
session fails
no Check
```

允许 debug-preserve partial state，但不得被视为 stable/resumable。

---

## 30. Tests: FSM

覆盖：

```text
retention success → phase.completed(observe) → Check
retention failure → no phase.completed(observe) success → no Check
Check=false → Final
Check=true + next step → next Thought sees retained Observe through normal root scan
Check=true + max_step → Final
```

特别断言：

```text
current newest Observe remains active before Check
```

---

## 31. Real Promptpile E2E

至少一个真实 Promptpile CLI E2E 验证：

```text
Observe -c + -o + receipt 可同时工作
receipt.assistant points to work/[n]assistant.md
receipt.mainOutput equals requested -o path
同一次 invocation id 绑定二者
移入 .observe_files 后下一次 scan 不再读取 archived Observe
root retained Observe 会进入后续 Thought/Observe context
prune 后下一次 -c index 继续单调递增，不复用 archived index
```

---

## 32. Non-goals

明确不做：

1. 不修改 `react_check_decision` schema。
2. 不把 Check 自然语言输出反馈给 Thought。
3. 不新增 Observe role。
4. 不修改 Promptpile Conversation 文件格式。
5. 不给 `[n]assistant.md` 增加 YAML phase metadata。
6. 不修改 authoritative Conversation。
7. 不让 Final 直接读取 session work。
8. 不定义跨 session Observe archive 恢复协议。
9. 不支持 session resume。
10. 不把 `.observe_files` schema 作为 public API。
11. 不对 Observe 内容做 cumulative/local 语义假设。
12. 不引入 WAL / rollback transaction manager。

---

## 33. 完整示例：`observe_carryover=1`

开始：

```text
work/
└── .promptpile-react-session.json
```

### Iteration 0 / Thought

```text
work/
├── .promptpile-react-session.json
└── [0]assistant.md              Thought₀
```

### Iteration 0 / Observe

Promptpile 同一 invocation：

```text
-o /tmp/observe-0.md
-c --output-dir work
--receipt /tmp/observe-receipt-0.json
```

Receipt 证明：

```text
mainOutput = /tmp/observe-0.md
assistant  = work/[1]assistant.md
```

登记后：

```text
work/
├── [0]assistant.md              Thought₀
├── [1]assistant.md              Observe₀
└── .observe_files/
    └── index.json               [1]
```

Check₀=true。

### Iteration 1 / Thought

Promptpile 正常 scan：

```text
Thought₀
Observe₀
```

写：

```text
[2]assistant.md                  Thought₁
```

### Iteration 1 / Observe

同一 invocation 产生：

```text
[3]assistant.md                  Observe₁
-o Observe₁ text
Receipt binds both
```

append-register：

```json
{"version":1,"indices":[1,3]}
```

active Observe：

```text
[1,3]
```

`N=1`，newest=3，archive oldest=1：

```text
work/
├── [0]assistant.md              Thought₀
├── [2]assistant.md              Thought₁
├── [3]assistant.md              Observe₁
└── .observe_files/
    ├── index.json               [1,3]
    └── [1]assistant.md          Observe₀ archived
```

稳定态：

```text
latest Observe 3 remains active
active Observe count = 1
max root message index = 3
```

Check₁=true 时下一 Thought 由 Promptpile 分配：

```text
[4]assistant.md
```

不会复用 archived index 1。

若 Check₁=false：

```text
Final
= authoritative Conversation
+ latestSuccessfulObserve(Observe₁) existing Final handoff
```

session 成功后整个 work tree 按现有 cleanup policy 删除。

---

## 34. Acceptance criteria

本设计实现完成必须同时满足：

1. `observe_carryover=0` argv / filesystem / event 行为无回归。
2. `N>0` 时 Observe 由 Promptpile 自己持久化为标准 `[n]assistant.md`。
3. React 不自行分配 Conversation index。
4. Observe identity 由 validated Completion Receipt 的 assistant artifact 精确获得。
5. Check 使用的 `-o` 与 persisted Observe assistant 通过同一 Receipt / invocation id 双绑定。
6. `.observe_files/index.json` 是 Observe identity 的唯一 source of truth。
7. identity ledger append-only。
8. root / `.observe_files` 物理位置是 active/archive 的唯一 source of truth。
9. successful stable state 中每个 registered Observe primary 恰好位于一个位置。
10. active Observe 永远不超过 N。
11. newest Observe 永远保持 active。
12. Observe pruning 永远不会降低 active work Conversation 的当前最大 message index。
13. 后续 Promptpile mutation 不复用 archived Observe index。
14. Thought 文件永不因 Observe pruning 被移动。
15. 同 index Observe artifact family 一起归档，primary last。
16. Check 输入与 boolean protocol 完全不变。
17. Final 仍只读 authoritative Conversation + latest Observe handoff。
18. retention/index/archive 任一失败都会在 Check 前终止 session。
19. failed debug-preserve state 明确不可 resume，仅供诊断。
20. Agent Event Protocol 不新增 retention event。
21. session cleanup 与 debug-preserve 语义保持现状。
22. real Promptpile E2E 证明“根目录保留即自然可见、移入子目录即自然不可见、index 持续单调分配”。

最终架构压缩为一句话：

> **`observe_carryover` 不负责把 Observe 注入后续 phase；它只决定哪些由 Promptpile 正常生成的 Observe message 继续留在 active work Conversation。Promptpile 负责消息与 index，Completion Receipt 负责 commit proof，React 只负责 Observe 身份登记和文件 retention。**
