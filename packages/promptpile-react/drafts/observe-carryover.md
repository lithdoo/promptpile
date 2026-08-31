# ReAct Observe Carryover：文件原生闭环改造方案

> 状态：**Draft**（2026-08-31）  
> 范围：仅 `packages/promptpile-react`  
> 目标：在不改变 Promptpile 文件优先设计、不扩大 Check 职责、不引入新的业务协议的前提下，让 Observe 可以成为后续 ReAct iteration 的显式上下文，并通过纯文件位置实现滑动窗口。  
> 默认：`observe_carryover = 0`，严格保持当前行为。  
> 核心原则：**身份由 index 记录，可见性由文件位置决定。**

---

## 1. 结论先行

现有 ReAct FSM 保持不变：

```text
Thoughtₙ
  ↓
Observeₙ
  ↓
Checkₙ
  ├─ false → Final
  └─ true  → Thoughtₙ₊₁
```

本改造不把 Check 改成 feedback producer。四个 phase 的职责继续是：

```text
Thought  = 执行 / 推进工作
Observe  = 对当前累计工作形成评价
Check    = current Observe → continue / stop
Final    = 对外形成最终回复
```

唯一新增能力是：当调用方显式配置 `observe_carryover > 0` 时，Observe 不再只是临时 `-o` 文本，而是同时作为标准 Promptpile assistant message 持久化进本 React session 的 work Conversation。

最近 N 个 Observe message 保留在 work 根目录，因此自然参与后续读取 work Conversation 的 phase；更旧的 Observe message 被移动到：

```text
<session.workDirectoryAbs>/.observe_files/
```

Promptpile 只扫描 Conversation directory 根层，不递归扫描子目录，因此：

```text
work 根目录                  = active React Conversation
work/.observe_files/         = 已退出 active context 的 Observe archive
work/.observe_files/index.json
                             = 哪些 message index 属于 Observe
```

不生成额外 Thought handoff，不拼接 Observe 文本，不维护第二套内存 Observe history，不要求用户的 Observe prompt 是 cumulative summary。

---

## 2. 为什么从 sidecar handoff 改为文件原生 retention

早期方案考虑过：

```text
Observe text
→ Runtime 保存 successfulObserves[]
→ 动态生成 thought-observations.user.md
→ --append-files
→ next Thought
```

该方案功能正确，但与 Promptpile 的核心设计语言不够一致：

1. 同一条 Observe 同时存在为 Runtime 内存状态和 handoff 文本，形成第二套状态表示。
2. Runtime 需要主动组装上下文，而不是让 Conversation directory 自然决定上下文。
3. `observe_carryover=N` 会变成“特殊注入 N 条 Observe”，而不是普通 Conversation retention。
4. 需要额外定义 handoff 格式、顺序、覆盖与生命周期。

新的 file-native 方案改为：

```text
Observe completion
→ Promptpile 正常写 [n]assistant.md
→ React 记录 n 是 Observe
→ 最近 N 个 Observe 留在 work 根目录
→ 旧 Observe move 到 .observe_files/
```

于是 carryover 不再是“注入”，而是：

> **决定最近多少个 Observe message 仍属于 active React work Conversation。**

这与 Promptpile “文件即消息、目录即 Conversation、目录位置决定是否参与扫描”的模型一致。

---

## 3. 配置语义

新增 React-only 非负整数：

| 表面 | 键 | 默认 | 含义 |
| --- | --- | ---: | --- |
| CLI | `--observe-carryover <n>` | `0` | active work Conversation 中最多保留的最近 Observe message 数量 |
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

需要保留 session 内全部 Observe 时，直接令：

```text
observe_carryover >= max_step
```

配置优先级：

```text
CLI --observe-carryover
> [promptpile-react].observe_carryover
> 0
```

`observe_carryover` 只属于 `[promptpile-react]`，不得加入 `[promptpile]` shared keys。

### 3.1 `observe_carryover = 0`

必须是严格 backward-compatible 模式：

```text
Observe
→ 继续使用临时 -o
→ 不传 -c
→ 不写 session work Conversation
→ 不创建 .observe_files/
→ 不创建 index.json
```

现有 Thought / Observe / Check / Final argv contract、Conversation routing、Agent Event Protocol 和 cleanup 行为保持不变。

### 3.2 `observe_carryover = N > 0`

Observe 同时完成两件事：

```text
-o <temporary-output>
    → Runtime 取得 current Observe text，供 Check 与 latest Final handoff 使用

-c --output-dir <session-work>
    → Promptpile 把同一 completion 作为标准 [n]assistant.md 持久化
```

每次成功 Observe 后，active work 根目录中最多保留最近 N 个 Observe turn。

注意：这意味着最近 N 个 Observe 会被所有读取 work Conversation 的 phase 自然看到，当前包括：

```text
Thought
Observe
```

而不是只对 Thought 可见。

这是刻意的语义：`observe_carryover` 定义 work Conversation retention，而不是 Thought-only injection。

---

## 4. 文件系统状态模型

假设：

```toml
[promptpile-react]
max_step = 4
observe_carryover = 2
```

运行若干 iteration 后，session work 可能是：

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

语义：

```text
indices
= 本 session 中所有由 Observe phase 产生的 Conversation message index
```

它不记录 active / archived：

```text
index 中 + work 根目录存在 [n]assistant.md
→ active Observe

index 中 + .observe_files/ 存在 [n]assistant.md
→ archived Observe
```

因此：

> **manifest 只记录身份，物理位置记录状态。**

不得再在 index 中维护：

```json
{
  "active": [...],
  "archived": [...]
}
```

否则移动文件时会产生重复事实来源。

---

## 5. Observe index manifest

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
2. `indices` 只能包含非负整数。
3. 严格升序。
4. 不允许重复。
5. 不记录 session id；父目录已有 `.promptpile-react-session.json`。
6. 不记录文件路径；路径由 index + 固定 Conversation artifact 命名规则决定。
7. 不记录 iteration；当前 message index 已足以标识持久化 Observe turn。
8. 不作为 public protocol；仅属于 session-owned internal state。

写入必须使用：

```text
write temp in same directory
→ fsync/close（若现有 atomic helper 已覆盖则复用）
→ rename to index.json
```

至少保证不会对下一阶段暴露半写 JSON。

`.observe_files/` 在 `observe_carryover=0` 时不得创建；在 `N>0` 时可以 lazy 创建于第一个成功持久化 Observe 的登记阶段。

---

## 6. 一个 Observe turn 的 artifact family

Observe 身份以 message index 为单位，而不是只以 `[n]assistant.md` 单文件为单位。

同 index 的标准 Promptpile assistant artifact family 包括存在的：

```text
[n]assistant.md
[n]assistant.calls.jsonl
[n]assistant.extra.json
[n]assistant.result.jsonl
```

当前 Observe phase 使用 `--disable-tool`，正常情况下不会产生 calls/result，但 retention/archive 逻辑仍应按同 index family 处理，避免未来 phase capability 变化后遗留半个 turn。

归档时：

```text
work/[n]assistant.*
→ work/.observe_files/[n]assistant.*
```

只允许移动明确属于该 Observe index 的标准 artifact family；不得使用模糊前缀删除其它文件。

---

## 7. 如何可靠识别本轮 Observe 的 index

不要通过：

```text
Observe 前 readdir
Observe 后 readdir
→ diff 猜新增文件
```

也不要由 `promptpile-react` 自己计算 next index。

Promptpile 已有 Completion Receipt v1，并在所有 receipt 引用 artifact 已存在后才原子发布。启用 carryover 时，Observe invocation 应增加：

```text
--invocation-id <session-specific-observe-id>
--receipt <temporary-receipt-path>
```

成功后验证 Receipt：

```text
schemaVersion == 1
status == completed
invocationId == 本轮 expected id
artifacts.assistant != null
assistant path exists
assistant parent == session.workDirectoryAbs
assistant basename == [n]assistant.md
```

然后从 receipt 的 `artifacts.assistant` basename 严格解析 `n`。

这样 index 的来源是：

```text
Promptpile commit proof
→ exact persisted assistant artifact
→ exact Conversation index
```

而不是 Runtime 对 Promptpile allocation 规则的猜测。

### 7.1 Receipt 生命周期

Observe Receipt 只是 phase commit proof，不需要长期保留。

建议使用 session-owned 或系统临时路径：

```text
/tmp/promptpile-react-observe-receipt-<id>.json
```

读取验证后删除。

不要把每轮 Receipt 永久放入 `.observe_files/`；`.observe_files/` 保持只承载：

```text
index.json
archived Observe artifact family
```

---

## 8. Observe phase routing

当前 Observe：

```text
read:
  authoritativeReadLayers
  session work

write:
  temporary -o only

continueMode:
  false
```

`observe_carryover = 0` 时完全保持。

`observe_carryover > 0` 时建议切换为与 Thought 类似的 writable routing：

```text
input directories:
  authoritativeReadLayers

output directory:
  session.workDirectoryAbs

continueMode:
  true
```

Promptpile 会把 output directory 作为最后 Conversation layer，因此逻辑读取仍然是：

```text
authoritative Conversation
→ existing session work Conversation
```

同时 `-c` 把本轮 Observe completion 写回同一个 session work。

Observe prompt 仍通过现有 `--append-files <observe.system.md>` 注入；该 prompt sidecar 本身不进入 Conversation。

完整概念 argv：

```text
promptpile
  -d <authoritative layer> ...
  --output-dir <session-work>
  -c
  --disable-tool
  --append-files <observe-prompt.system.md>
  -o <observe-output.md>
  --invocation-id <...>
  --receipt <observe-receipt.json>
```

---

## 9. Runtime 闭环顺序

`observe_carryover > 0` 时，一轮 successful iteration 的冻结顺序为：

```text
1. Thought
   ↓
2. Observe Promptpile invocation
   - 生成临时 -o text
   - 持久化 [n]assistant.md 到 work
   - 原子发布 Completion Receipt
   ↓
3. Validate Observe Receipt
   ↓
4. 从 receipt.artifacts.assistant 得到 Observe index n
   ↓
5. register n 到 .observe_files/index.json
   ↓
6. prune active Observe 到 observe_carryover 上限
   ↓
7. Observe phaseCompleted
   ↓
8. Check(current Observe text)
   ↓
9. continue / stop
```

必须在 `phaseCompleted(observe)` 之前完成登记与 pruning。

因此“Observe phase 成功”的含义变成：

```text
model completion succeeded
AND temporary Observe output valid
AND persisted work artifact receipt valid
AND Observe identity registered
AND active Observe retention invariant satisfied
```

其中任一步失败：

```text
session stopReason = error
Check 不执行
Final 不执行
```

这保证后续 phase 永远不会在半完成 retention 状态上继续运行。

---

## 10. Retention / pruning 算法

输入：

```text
carryover = N > 0
index.indices = 所有 Observe indices
```

定义 active Observe：

```text
index n 属于 active
iff work 根目录存在 [n]assistant.md
```

定义 archived Observe：

```text
index n 属于 archived
iff .observe_files/ 存在 [n]assistant.md
```

正常稳定态要求对每一个 registered Observe index：

```text
exactly one of:
  active primary body exists
  archived primary body exists
```

每次新 Observe 注册后：

```text
active = registered indices 中 primary body 位于 work 根目录者
active.sort(ascending)

while active.length > N:
  oldest = active.shift()
  archiveObserveFamily(oldest)
```

例如 `N=2`：

```text
注册前 active = [3,5]
新 Observe index = 7
注册后 active = [3,5,7]
→ archive 3
最终 active = [5,7]
```

不重新编号文件；Promptpile Conversation index 允许存在空洞：

```text
[0], [2], [4], [5], [6], [7]
```

仍按现存 index 升序扫描。

---

## 11. Archive 操作

`archiveObserveFamily(n)` 必须：

1. 确认 `n` 已在 `index.json`。
2. 确认 root primary `[n]assistant.md` 存在。
3. 确认 archive primary 不存在，防止覆盖。
4. 收集 root 中该 index 的允许 artifact family。
5. 对每个目标执行同文件系统 `rename`，不得 copy + delete。
6. sidecar 可先移动，primary body 最后移动；primary body 的位置作为 active/archived 判定锚点。
7. 任一 rename 失败立即使 Observe phase 失败，不继续 Check。

由于 source 与 destination 都位于同一个 session work tree，正常情况下 `rename` 是同文件系统移动。

不要求实现复杂的跨进程事务或恢复日志：session work 本身是单 session 独占、失败即终止、无跨 session resume 保证的内部状态。

但必须 fail-closed：发生 archive/index mutation failure 后不得继续 ReAct。

---

## 12. Check 明确保持不变

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

Check 的唯一职责仍然是：

```text
current Observe
→ outer ReAct loop 是否继续
```

Observe carryover 不改变 Check 的输入可见性：Check 不读取 work Conversation，也不读取 `.observe_files/`。

---

## 13. Final 明确保持现状

本改造只解决 iteration-to-iteration Observe retention，不改变 Final 当前状态隔离。

Final 继续：

```text
read authoritative Conversation only
+ latest successful Observe explicit Final handoff
```

Final 不读取：

```text
session work Conversation
.observe_files/
Observe history
```

即使：

```toml
observe_carryover = 5
```

Final 仍只使用 latest successful Observe handoff。

原因：

1. Final 不读 work 是已有权威历史隔离设计的重要 invariant。
2. `observe_carryover` 定义 active ReAct work memory，不定义 Final history policy。
3. 避免无关改变 Final token/context 行为。
4. latest Observe text 已在 Runtime 中用于当前 Final handoff，不需要从 archive 重读。

如果未来要让 Final 读取多轮 Observe，应作为独立设计讨论。

---

## 14. Work Conversation 的真实语义变化

启用 carryover 前，work 根目录主要是：

```text
Thought₀
Thought₁
Thought₂
...
```

启用后，work 根目录会形成：

```text
Thought₀
Observe₀
Thought₁
Observe₁
Thought₂
Observe₂
...
```

经过 retention 后，旧 Observe 被移走，因此更准确地说：

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

下一轮 Thought 与 Observe 自然看到：

```text
Thought₀
Thought₁
Observe₁
Thought₂
```

而看不到 Observe₀。

Runtime 不对 Observe 内容做任何解释，也不要求模型知道某 assistant message 是 Observe；调用方若需要显式 phase label，应由自己的 Observe prompt 让输出自描述。

---

## 15. Failure semantics

### 15.1 Promptpile Observe completion 失败

```text
无 valid receipt
→ Observe phase error
→ 不登记 index
→ 不 Check
```

Promptpile 是否已经留下部分 artifact 由其自身 Completion Receipt/commit contract 管理；React 不通过目录 diff 猜测成功状态。

### 15.2 临时 `-o` 缺失或为空

保持当前：

```text
phase_output_missing
→ Observe phase error
```

若 carryover mode 中 Promptpile 已成功持久化 assistant 但 Runtime 随后发现 main output 无效，则 session 仍 terminal。session work 为内部临时状态，正常 cleanup 会整体删除；debug-preserve 模式可保留供诊断，不提供 resume guarantee。

### 15.3 Receipt 无效

包括：

```text
missing
invalid JSON
wrong schema/status
wrong invocation id
assistant=null
assistant outside session work
invalid assistant basename
artifact missing
```

全部作为 Observe phase invocation/commit failure；不运行 Check。

### 15.4 index 写失败

Observe phase error；不运行 Check。

### 15.5 archive/prune 失败

Observe phase error；不运行 Check。

不需要尝试恢复用户权威 Conversation，因为所有 mutation 都只发生在 session-owned work tree。

---

## 16. Completion Receipt validator 建议

当前 `final-receipt.ts` 已经实现 Completion Receipt v1 的大量通用校验，但接口是 Final-specific 且不返回 parsed artifact。

为了避免 Observe 再复制一套 receipt parser，建议抽一个很小的通用层，例如：

```text
src/completion-receipt.ts
```

职责：

```ts
validateCompletionReceiptV1({
  receiptPath,
  expectedInvocationId,
  expectedAssistantParentAbs
}): ValidatedCompletionReceiptV1
```

返回至少：

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

然后：

```text
final-receipt.ts
→ Final-specific wrapper

observe persistence
→ Work-specific wrapper，要求 assistant 必须非 null 且 parent == session work
```

不要把 receipt validation、Observe index、archive policy 混成一个大 manager。

---

## 17. 建议新增的文件模块

建议新增一个小而纯的 filesystem module：

```text
src/observe-files.ts
```

只负责：

```text
.observe_files path
index.json parse / validate / atomic write
register Observe index
active/archive invariant inspection
archive Observe artifact family
prune to carryover
```

建议接口可以保持朴素：

```ts
registerObserveAndPrune({
  session,
  assistantPath,
  carryover
}): void
```

内部流程：

```text
assistantPath
→ validate direct child of work
→ parse message index
→ append index atomically
→ prune active Observe
```

不引入：

```text
ObserveStore class
RetentionManager
ObservationChannel
ReactMemoryProvider
ArchiveRepository
```

除非后续确实出现多实现需求。

---

## 18. Runtime / Process 分层

建议保持：

```text
ObserveReactProcess
= 执行 Promptpile completion
= 返回 current Observe text + persisted assistant path（carryover mode）

PromptpileReactRuntime
= 定义 phase 顺序
= 在 Check 前要求 Observe retention commit 成功

observe-files.ts
= 文件状态 mutation
```

Observe process 返回值可从：

```ts
Promise<string>
```

扩展为：

```ts
interface ObserveReactResult {
  text: string;
  persistedAssistantPath?: string;
}
```

Runtime：

```ts
const observation = await this.reactObserveProcess();

this.latestSuccessfulObserve = {
  stepIndex: this.currentStep,
  text: observation.text
};

if (observation.persistedAssistantPath !== undefined) {
  registerObserveAndPrune({
    session: this.session,
    assistantPath: observation.persistedAssistantPath,
    carryover: this.config.observeCarryover
  });
}

// 只有到这里 Observe phase 才 completed
const continueOuter = await this.reactCheckProcess(observation.text);
```

不要让 Runtime 保存：

```ts
successfulObserves: Observe[]
```

carryover history 的 source of truth 应是 filesystem。

Runtime 只继续保留现有：

```ts
latestSuccessfulObserve
```

因为它属于 Final handoff 的既有需求，而不是 carryover history。

---

## 19. 预计代码改造面

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

解析为非负整数；与 `maxStep` 的“正整数”解析不要混淆。

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
CLI
> TOML
> 0
```

校验 `>=0`，写入 resolved config。

### `src/build-phase-argv.ts`

Observe routing 按 `observeCarryover` 分支：

```text
0:
  保持当前 read authoritative + work / no output / no -c

>0:
  authoritative inputs
  outputDirectory = session work
  continueMode = true
```

### `src/react-processes.ts`

Observe：

```text
继续 -o
carryover>0 时增加 receipt + -c persistence
验证 receipt
返回 text + persisted assistant path
```

### `src/react-runtime.ts`

在 Observe completion 与 Check 之间执行：

```text
registerObserveAndPrune
```

并把 retention failure 归入 Observe phase failure。

### `src/observe-files.ts`

新增 file-native retention 实现。

### Receipt validation

建议把 `final-receipt.ts` 中通用部分抽出，Final 行为保持兼容。

---

## 20. Agent Event Protocol 保持不变

不新增：

```text
observe.persisted
observe.archived
observe.delta
handoff.created
retention.updated
```

公开事件仍然只表达 phase lifecycle 与 Final output。

Observe retention 是内部 session filesystem implementation detail。

`phase.completed(observe)` 只有在 retention commit 成功后才发出，因此外部无需知道内部步骤。

---

## 21. Security / path identity

所有 `.observe_files` mutation 必须限制在当前 session work：

1. archive root 固定为 `session.workDirectoryAbs/.observe_files`。
2. Receipt assistant parent 必须 canonical same-directory 于 `session.workDirectoryAbs`。
3. 不接受 symlink/path traversal 逃逸后的 assistant artifact。
4. index 只能解析标准非负 integer message index。
5. archive destination 必须 canonical 位于当前 `.observe_files`。
6. destination 已存在时 fail，不覆盖。
7. 不读取或移动 authoritative Conversation 中的同 index 文件。

现有 `react-path-identity.ts` 的 canonical/sameDirectory helper 应优先复用。

---

## 22. 测试计划

### 22.1 Config

覆盖：

```text
默认 = 0
CLI > TOML
0 合法
1 合法
N 合法
负数非法
小数非法
字符串非法
unknown TOML key contract 更新
```

### 22.2 Backward compatibility (`carryover=0`)

必须断言：

```text
Observe argv 与当前一致
无 --output-dir work
无 -c
无 Observe receipt
无 .observe_files
work 中无 Observe assistant message
Final handoff 行为不变
```

### 22.3 Observe persistence (`carryover>0`)

fake Promptpile 产生：

```text
work/[1]assistant.md
receipt.artifacts.assistant = exact path
-o = observe text
```

断言：

```text
Observe 返回 text
index.json = [1]
[1]assistant.md 留在 root
```

### 22.4 Multiple iterations

`carryover=2`，模拟：

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
Thought 0,2,4 全部仍在 root
```

### 22.5 不误归档 Thought

给 work 根目录混合：

```text
[0]assistant.md Thought
[1]assistant.md Observe
[2]assistant.md Thought
[3]assistant.md Observe
```

prune 只能根据 manifest archive `1/3`，绝不能按“最旧 assistant 文件”移动 Thought。

### 22.6 Artifact family

Observe index 3 包含：

```text
[3]assistant.md
[3]assistant.extra.json
```

淘汰后两者必须都位于 `.observe_files/`。

### 22.7 Receipt validation

覆盖：

```text
missing receipt
wrong invocation id
assistant null
assistant outside work
assistant basename invalid
assistant file missing
```

全部在 Check 前失败。

### 22.8 Manifest strictness

覆盖：

```text
bad JSON
wrong version
duplicate index
unsorted index
negative index
non-integer
```

### 22.9 Archive collision

如果：

```text
root/[3]assistant.md
archive/[3]assistant.md
```

必须 fail，不覆盖。

### 22.10 FSM

覆盖：

```text
retention success → Check
retention failure → no Check
Check=false → Final
Check=true + next step → next Thought sees active Observe via normal work scan
Check=true + max_step → Final
```

### 22.11 Real Promptpile boundary

至少一个真实 Promptpile CLI E2E，验证：

```text
Observe -c + -o + receipt 可同时工作
receipt assistant path 指向 work/[n]assistant.md
移入 .observe_files 后下一次 Promptpile scan 不再读取它
root 中保留的 latest Observe 会正常进入后续 Thought/Observe messages
```

---

## 23. 非目标

本改造明确不做：

1. 不修改 `react_check_decision` schema。
2. 不把 Check 自然语言输出反馈给 Thought。
3. 不新增 Observe 专用 role。
4. 不修改 Promptpile 普通 Conversation 文件格式。
5. 不给 `[n]assistant.md` 加 YAML phase metadata。
6. 不修改 authoritative Conversation。
7. 不让 Final 直接读取 session work。
8. 不定义跨 session Observe archive 恢复协议。
9. 不提供 session resume。
10. 不让外部 package 依赖 `.observe_files` schema 作为公共 API。
11. 不对 Observe 内容做 cumulative/local 语义假设。

---

## 24. 完整示例：`observe_carryover=1`

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

```text
work/
├── [0]assistant.md              Thought₀
├── [1]assistant.md              Observe₀
└── .observe_files/
    └── index.json               [1]
```

Check₀=true。

### Iteration 1 / Thought

Promptpile 正常扫描 root，因此自然看到：

```text
Thought₀
Observe₀
```

写出：

```text
[2]assistant.md                  Thought₁
```

### Iteration 1 / Observe

写出：

```text
[3]assistant.md                  Observe₁
```

登记：

```json
{"version":1,"indices":[1,3]}
```

active Observe 数量 2 > carryover 1，因此 move Observe₀：

```text
work/
├── [0]assistant.md              Thought₀
├── [2]assistant.md              Thought₁
├── [3]assistant.md              Observe₁
└── .observe_files/
    ├── index.json               [1,3]
    └── [1]assistant.md          Observe₀ archived
```

下一轮 active work Conversation 自动成为：

```text
Thought₀
Thought₁
Observe₁
```

无需任何特殊 handoff 注入。

如果 Check₁=false：

```text
Final
= authoritative Conversation
+ latestSuccessfulObserve(Observe₁) 的现有 Final handoff
```

session 成功结束后，整个 work tree 按现有 cleanup policy 删除。

---

## 25. 验收标准

本设计可以认为落地完成，当以下条件全部成立：

1. `observe_carryover=0` 的现有行为与 argv contract 无回归。
2. `N>0` 时 Observe 由 Promptpile 自己持久化为标准 `[n]assistant.md`。
3. React 不自行分配 Conversation index。
4. Observe index 由 validated Completion Receipt 精确获得。
5. `.observe_files/index.json` 是 Observe 身份唯一 source of truth。
6. work root / `.observe_files` 的物理位置是 active/archive 状态唯一 source of truth。
7. active Observe 永远不超过 N。
8. Thought 文件永不因 Observe pruning 被移动。
9. 同 index Observe artifact family 一起归档。
10. Check 输入与 boolean protocol 完全不变。
11. Final 仍只读 authoritative Conversation + latest Observe handoff。
12. retention/index/archive 任一失败都会在 Check 前终止 session。
13. Agent Event Protocol 不新增内部 retention 事件。
14. session cleanup 与 debug-preserve 语义保持现状。
15. real Promptpile E2E 证明“根目录保留即自然可见、移入子目录即自然不可见”。

最终架构可以压缩为一句话：

> **`observe_carryover` 不负责把 Observe 注入后续 phase；它只决定哪些 Observe message 继续留在 active work Conversation。Promptpile 负责消息文件，React 只负责给 Observe 标身份并移动文件。**
