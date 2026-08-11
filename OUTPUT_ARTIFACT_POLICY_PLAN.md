# Promptpile Output Artifact Policy 实施设计计划

> 状态：v1 已实施
> 设计冻结日期：2026-08-10
> 实施闭环日期：2026-08-11
> 核心提案：为一次 completion 的 terminal、output pile、`-o` 主输出、Conversation `--continue`、after-hook 与未来 Completion Receipt 定义唯一的 resolved output topology、阶段顺序、artifact ledger 和失败语义；保持现有 CLI 入口，同时消除路径重算、跨通道碰撞和“某个流结束就等于整个 completion 成功”的歧义

## 0. 结论

Output Artifact Policy v1 不是一个新的业务 run/session 协议，也不是把所有输出合并成一个 JSON stream。

它只回答四个基础问题：

1. **本次 invocation 配置了哪些 output sinks？**
2. **这些 sinks 的路径、优先级、命名空间与 requiredness 是什么？**
3. **模型返回之后，各输出阶段必须按什么顺序执行？**
4. **每个阶段失败时，已经产生的输出保留什么、后续阶段停止什么？**

v1 固定为：

```text
resolved completion config
        ↓
resolve output artifact policy
        ↓
validate static target identities / collisions
        ↓
prepare configured sinks
        ↓
model stream
   ├─ stdout        live / observational
   └─ output pile   live / required if configured
        ↓
finalize output pile
        ↓
commit caller-managed -o artifact group
        ↓
terminal tool-call postlude
        ↓
commit Conversation --continue artifacts
        ↓
after-hook consumes actual artifact ledger
        ↓
future Completion Receipt consumes ledger + hook result
        ↓
final process status
```

核心不变量：

1. **不存在跨通道事务。** 已经成功写入或已经流出的内容不因后续失败而回滚。
2. **“是否权威”与“失败是否影响退出状态”是两个独立维度。** output pile 不是正文权威来源，但显式配置后仍是 required sink；其 I/O 失败是 ordinary operational failure。
3. **`-o` 与 Conversation 都可以是 durable body authority，但属于不同 namespace。** `-o` 是 caller-managed result；Conversation artifacts 是 Conversation Protocol 历史。两者不要求 byte-for-byte 相同。
4. **只有真正成功完成写入的文件才能进入 artifact ledger。** 不能根据 `toolCalls`、`reasoningContent` 或配置路径“推测文件应该存在”。
5. **after-hook 与未来 Receipt 只能消费同一个 ledger。** 禁止各自重新计算 `calls` / `extra` / assistant path。
6. **output pile 的 `assistant_done` 只表示模型 stream 已结束。** 它不表示 `-o`、Conversation commit、after-hook 或 Receipt 已成功。
7. **Conversation OCC conflict 保持 exit code `3`。** Output Policy 不重新实现 OCC，也不把 conflict 改成普通 output error。
8. **ordinary output failure 保持 exit code `1`。** v1 不引入新的 output 专用退出码。
9. **第一个 primary failure 决定本轮失败语义。** cleanup/finalizer 的 secondary failure 不得覆盖一个更早的 primary failure。
10. **`--input` user append 不是 completion output sink。** 它是模型请求前的 Conversation mutation，继续由 Conversation Protocol/OCC 负责；如果后续 completion 失败，已提交 user artifact 不回滚。

职责边界固定为：

```text
Conversation Protocol / OCC
  负责 Conversation mutation、idx、claim、conflict

Output Artifact Policy
  负责 output topology、target resolution、阶段顺序、artifact ledger、output failure ordering

Output Pile
  负责模型实时 transport encoding / writer lifecycle

After-hook Failure Policy
  负责 hook 结果如何影响最终退出状态

Completion Receipt
  负责把最终 invocation outcome 与 artifact refs 编码成稳定机器文档
```

---

## 1. 动机与当前问题

Promptpile 当前已经拥有多条可组合输出路径：

- stdout assistant stream；
- stderr diagnostics；
- `-o/--output` 主输出；
- `<main>.calls.jsonl`；
- `<main>.extra.json`；
- `--continue` assistant.md；
- `--continue` assistant.calls.jsonl；
- `--continue` assistant.extra.json；
- output pile file / inherited fd；
- after-hook environment；
- 未来 Completion Receipt。

单项实现并不复杂，但如果没有统一 policy，会出现几类结构性问题。

### 1.1 路径解释分散

当前：

- `index.ts` 自己 resolve `-o`；
- `output-pile.ts` 自己用 `process.cwd()` resolve pile file；
- `index.ts` 自己推导 main calls / extra path；
- `after-hook.ts` 又自己推导一次 main calls path；
- Conversation path 由另一个 writer 返回；
- Receipt 将来如果直接接入，很容易再复制第三套 path derivation。

长期结果会变成：

```text
configured path
→ writer 认为 A
→ hook env 认为 B
→ receipt 认为 C
```

Output Policy 必须把 path resolution 与 artifact observation 收敛成一个事实来源。

### 1.2 “流结束”与“调用完成”容易混淆

当前 output pile JSON 可以写：

```json
{"type":"assistant_done"}
```

但之后仍可能发生：

- `-o` 写入失败；
- Conversation OCC conflict；
- Conversation artifact I/O 失败；
- claim cleanup failure；
- after-hook failure；
- 未来 receipt write failure。

因此：

```text
assistant_done != completion committed
```

必须成为正式 contract，而不是靠调用方猜。

### 1.3 多文件 durable output 没有统一 partial-failure 语义

例如 `-o` 可能产生：

```text
result.md
result.calls.jsonl
result.extra.json
```

如果 body 成功、calls 失败：

- body 是否保留？
- extra 是否继续？
- Conversation 是否继续 commit？
- after-hook 是否运行？
- Receipt 是否可以引用 body？

必须冻结一个唯一答案。

### 1.4 file sinks 可能互相覆盖

典型错误组合：

```bash
promptpile ... \
  -o ./result.md \
  --output-pile-file ./result.md
```

output pile 会先打开 / truncate / stream，模型结束后 `-o` 又原子替换同一路径。

更隐蔽的情况：

```bash
-o ./result.md
--output-pile-file ./result.calls.jsonl
```

即使本次模型最终没有 tool calls，配置本身仍是 outcome-dependent collision：一旦有 tool calls，main sidecar 会覆盖 pile。

因此潜在 sidecar target 也必须在模型前进入 collision set。

### 1.5 output pile file/fd 的配置是一个逻辑 target，却目前按两个字段独立 merge

当前 config resolution 分别选择：

```text
outputPileFile
outputPileFd
```

writer 再使用：

```text
fd wins over file
```

这会出现跨来源优先级反转：

```text
CLI:  --output-pile-file ./cli.txt
TOML: output_pile_fd = 7
```

如果两个字段分别 merge，最终 fd 仍存在并胜出，等于 TOML target 覆盖了 CLI target。

v1 必须把 output pile destination 当成一个 logical slot 解析。

---

## 2. v1 范围

v1 规范化 root completion 的以下输出面：

1. stdout；
2. stderr；
3. output pile file；
4. output pile inherited fd；
5. `-o/--output` body；
6. `-o` calls sidecar；
7. `-o` extra sidecar；
8. `--continue` assistant body；
9. `--continue` calls sidecar；
10. `--continue` extra sidecar；
11. after-hook 对实际 artifact paths 的消费边界；
12. Completion Receipt 的未来接入边界。

v1 不负责：

- root `--input` user artifact 的 mutation transaction；
- tool execution 后的 `assistant.result.jsonl`；
- `promptpile-mcp exec-calls/check`；
- Compress / Archive 输出；
- React 外层 phase/session 状态；
- 业务 run id；
- 网络对象存储；
- 分布式事务。

---

## 3. 术语

### 3.1 Sink

一次 invocation 中接收模型结果或 completion metadata 的目标。

例如：

```text
stdout
output pile fd
-o file
Conversation output directory
future receipt file
```

### 3.2 Live transport

模型仍在生成时就可能被观察到的通道。

v1：

```text
stdout
output pile
```

live transport 天然可能 partial。

### 3.3 Durable artifact

写入成功返回后，可由文件系统重新读取的结果文件。

v1：

```text
-o body/calls/extra
Conversation assistant/calls/extra
future receipt
```

### 3.4 Body authority

一个 namespace 中正文或 sidecar 的权威持久表示。

不存在一个“Promptpile 全局唯一正文文件”。

如果同时使用 `-o` 与 `--continue`：

```text
-o                    caller-managed result authority
Conversation artifact Conversation history authority
```

调用方必须选择自己消费的 namespace。

### 3.5 Required sink

如果调用方显式配置该 sink，而 sink 本身发生 I/O failure，本轮不能返回 success。

注意：

```text
non-authoritative != optional
```

output pile 就是典型 required-but-non-authoritative sink。

### 3.6 Artifact ledger

本 invocation 内部记录的：

> 哪些 durable files 已经真正完成写入。

ledger 记录事实，不记录“理论上应该存在”的路径。

---

## 4. 通道分类

| 通道 | 类别 | 时机 | body authority | 显式配置后的 I/O failure 是否影响退出 |
| --- | --- | --- | --- | --- |
| stdout | observational live transport | model stream + postlude | 否 | 不作为 v1 durable sink contract |
| stderr | diagnostic | 任意阶段 | 否 | 不适用 |
| output pile file | required live transport | model stream | 否 | 是，ordinary failure |
| output pile fd | required live transport | model stream | 否 | 是，ordinary failure |
| `-o` body | durable caller-managed artifact | post-model | 是，仅在 caller-managed namespace | 是 |
| `-o` calls | durable caller-managed sidecar | post-model | 是，仅在 caller-managed namespace | 是 |
| `-o` extra | durable caller-managed sidecar | post-model | 是，仅在 caller-managed namespace | 是 |
| Conversation assistant | durable protocol artifact | post-main-output | 是，Conversation Protocol | conflict 或 ordinary failure |
| Conversation calls | durable protocol artifact | post-main-output | 是，Conversation Protocol | conflict 或 ordinary failure |
| Conversation extra | durable protocol artifact | post-main-output | 是，Conversation Protocol | conflict 或 ordinary failure |
| after-hook | downstream consumer，不是 artifact | post-artifacts | 否 | 由 After-hook Failure Policy 决定 |
| Completion Receipt | future durable metadata artifact | 最后 | 只对 invocation metadata 权威 | 由 Receipt contract 决定 |

---

## 5. Resolved Output Artifact Policy v1

v1 不新增 public `[promptpile.output_policy]` TOML table。

现有 CLI / TOML 先照常解析，再收敛为一个内部 resolved object：

```ts
interface ResolvedFileTarget {
  absolutePath: string;
  identity: string;
}

type ResolvedOutputPileTarget =
  | {
      kind: 'file';
      file: ResolvedFileTarget;
    }
  | {
      kind: 'fd';
      fd: number;
    };

interface ResolvedOutputArtifactPolicyV1 {
  terminal: {
    quiet: boolean;
  };

  outputPile?: {
    target: ResolvedOutputPileTarget;
    format: 'text' | 'json';
  };

  mainOutput?: {
    body: ResolvedFileTarget;
    calls: ResolvedFileTarget;
    extra: ResolvedFileTarget;
  };

  conversation: {
    continueEnabled: boolean;
    outputDirectory?: string;
    outputDirectoryIndex?: number;
  };
}
```

重要：

```text
mainOutput.calls
mainOutput.extra
```

是 **reserved potential targets**。

它们存在于 policy 中不表示本次一定会写出对应文件；只有 ledger 才表示实际成功写入。

未来 Receipt 加入后，可以增加：

```ts
receipt?: {
  file: ResolvedFileTarget;
}
```

但 Output Policy v1 不提前增加无效 CLI/TOML 配置。

---

## 6. Path resolution 必须只有一处

### 6.1 caller-managed file sinks

以下相对路径统一相对 invocation `cwd`：

```text
-o/--output
--output-pile-file
future --receipt
```

内部 resolver 必须显式接收 `cwd`：

```ts
resolveOutputArtifactPolicy(cwd, config)
```

不得在下游 writer 中再次调用：

```ts
process.cwd()
```

来重新解释同一个配置字符串。

### 6.2 main sidecar path

给定：

```text
/path/result.md
```

统一推导：

```text
/path/result.calls.jsonl
/path/result.extra.json
```

path derivation 必须只存在一个 primitive，例如：

```ts
resolveMainOutputTargets(bodyPath)
```

`index.ts`、after-hook、Receipt 不得各自复制 `path.parse()` 规则。

### 6.3 Conversation paths

Conversation output directory 继续由 Layered Conversation I/O resolution 提供 canonical physical directory。

Output Policy 不自行重新 resolve `--output-dir`。

Conversation artifact filename 由 Conversation writer/OCC 决定；Output Policy 不计算第二套 next idx。

---

## 7. Output pile target precedence

output pile 的 destination 是一个逻辑 slot：

```text
file OR fd
```

不能把 file/fd 当成两个互不相关的配置项分别 merge。

### 7.1 source precedence

固定为：

```text
CLI target group
>
TOML target group
>
disabled
```

如果 CLI 显式提供任何 output pile destination：

```text
--output-pile-file
--output-pile-fd
deprecated --output-pipe alias
```

则 TOML 的 file/fd destination 全部退出竞争。

因此：

```text
CLI file + TOML fd
→ CLI file
```

而不是 TOML fd 因为 `fd wins` 意外反超 CLI。

### 7.2 同一来源同时 file + fd

为保持当前 v1 compatibility：

```text
fd wins
file is shadowed
```

这是已存在行为，不在 Output Policy v1 中突然改成 fatal config error。

但 resolver 应保留一个 internal diagnostic：

```text
shadowed file target
```

供 debug / future `config explain-output` 使用。

未来 major version 可以考虑把同源双 target 改成配置错误。

### 7.3 format precedence

format 继续独立解析：

```text
CLI format > TOML format > text
```

如果没有实际 output pile target，但配置了 format：

- v1 保持兼容；
- 不创建 sink；
- format 不产生副作用。

---

## 8. File target identity 与 collision validation

### 8.1 为什么不能只比较原字符串

以下必须被视为同一 path entry：

```text
./run/result.md
./run/../run/result.md
```

Windows 还必须处理 case-insensitive path identity。

### 8.2 v1 identity

对普通 file target，v1 使用：

```text
normalized absolute path
→ canonical parent directory identity when available
→ exact basename
→ Windows comparison case-insensitive
```

不把 mtime、inode 或 file contents 放入 target identity。

v1 不承诺检测两个不同 path entries 通过 hardlink / final-component symlink 指向同一 inode 的所有别名情况；该问题不应阻塞普通跨平台 target collision contract。

### 8.3 两阶段检查

为了避免在发现明显 collision 前创建目录：

```text
1. normalized absolute lexical collision check
2. prepare required parent directories
3. canonical-parent identity collision check
4. only then open/truncate live file sinks
```

parent directory 创建失败：

```text
→ ordinary failure
→ model not called
```

仅创建了空 parent directory 不算 durable output artifact；发生后续 config failure 时不要求回滚目录。

### 8.4 必须预留 potential main sidecars

如果启用：

```bash
-o /run/result.md
```

collision set 从模型调用前就必须包含：

```text
/run/result.md
/run/result.calls.jsonl
/run/result.extra.json
```

不能等模型返回后发现存在 tool calls 才检查。

### 8.5 静态 file sink collision

至少拒绝：

```text
main body == output pile file
main calls == output pile file
main extra == output pile file
future receipt == any other file sink
```

结果：

```text
config/output-policy error
→ exit 1
→ model not called
→ no output file opened/truncated
```

### 8.6 Promptpile reserved control path

非控制 sink 不得写入已保留的 Promptpile control path，例如 writable Conversation directory 下：

```text
.promptpile.occ.claim
```

否则会制造 deterministic self-conflict / stale coordination state。

### 8.7 Conversation namespace self-collision

如果本 invocation 可能执行 Conversation mutation：

```text
--input
或
--continue
```

则 caller-managed file sink 如果同时满足：

1. 位于 writable output physical directory 的直接子层；
2. basename 被当前 Conversation scanner 识别为 protocol artifact；

必须在模型前拒绝。

原因：

```text
-o /messages/[8]assistant.md
```

不能一边声称是 caller-managed output，一边又在同一次 mutation 流程中偷偷成为 Conversation scanner artifact。

该 recognition 必须复用 scanner 的 filename classifier；禁止 Output Policy 复制第二套 Conversation regex。

如果当前 scanner 还没有可复用 filename classifier，Phase 0 应先把 recognition 从 `scanDirectory()` 抽成共享 primitive，scanner 自己也改用它。

没有 Conversation mutation 的 legacy invocation 不因本计划自动禁止 caller 主动把 `-o` 放入某个 Conversation-like filename；这不是 v1 要扩大处理的兼容面。

### 8.8 after-hook script 不能被本轮 output sink 覆盖

after-hook script 是 read/execute dependency，不是 output sink。

实现应在任何 live file sink 打开前完成一次只读 hook resolution，并检查：

```text
resolved hook script path
!=
any file output target identity
```

例如：

```bash
-o ./after.sh --after-hook-path ./after.sh
```

必须在模型前失败，而不是先把 hook script 替换成模型输出再执行。

hook 的**执行时机**仍在所有 durable output commit 之后；这里只提前做 read-only resolution / collision validation。

---

## 9. Model result projection

Output Policy 不重新定义 Chat Completion 的 response schema。

但不同 durable sinks 是否产生 sidecar，必须共享一套 presence predicates：

```ts
interface CompletionProjectionPresence {
  hasContent: boolean;
  hasToolCalls: boolean;
  hasReasoning: boolean;
}
```

建议固定：

```text
hasContent   = response.length > 0
hasToolCalls = toolCalls.length > 0
hasReasoning = reasoningContent.trim().length > 0
```

### 9.1 `-o` body

只要配置 `-o` 且模型成功：

```text
body file always written
```

即使 response 是空字符串，也会产生零字节 body file。

这是 caller 明确请求 main output file 的语义。

### 9.2 `-o` calls / extra

```text
hasToolCalls → calls sidecar
hasReasoning → extra sidecar
```

### 9.3 Conversation

Conversation 保持既有 protocol：

```text
hasContent   → assistant.md
hasToolCalls → assistant.calls.jsonl
hasReasoning → assistant.extra.json
```

三者都 false：

```text
Conversation commit 成功
但不产生 artifact
不保留/占用 idx
```

### 9.4 不要求两个 namespace byte-identical

main output 与 Conversation artifact 可以使用各自既有 encoding / normalization contract。

Output Policy 只保证：

> 它们从同一次 logical model result 投影产生。

它不要求：

```text
main calls bytes == Conversation calls bytes
main extra bytes == Conversation extra bytes
```

未来若要统一 exact encoding，应修改对应 artifact format contract，而不是偷偷让 Output Policy 变成正文 canonicalizer。

---

## 10. Completion Artifact Ledger

### 10.1 ledger 只记录 durable files

建议内部结构：

```ts
interface PersistedFileArtifact {
  absolutePath: string;
}

interface PersistedConversationArtifact extends PersistedFileArtifact {
  outputDirectory: string;
  directoryIndex: number;
  relativePath: string;
  index: number;
}

interface CompletionArtifactLedger {
  mainOutput: {
    body?: PersistedFileArtifact;
    calls?: PersistedFileArtifact;
    extra?: PersistedFileArtifact;
  };

  conversation: {
    assistant?: PersistedConversationArtifact;
    calls?: PersistedConversationArtifact;
    extra?: PersistedConversationArtifact;
  };
}
```

### 10.2 ledger 不记录 output pile

output pile 是 transport，不是 completed file authority。

即使 pile target 恰好是普通文件，也不进入 durable artifact ledger。

如未来 Receipt 希望记录 transport metadata，应使用独立字段，例如：

```text
transport.outputPile
```

而不是混入 `artifacts`。

### 10.3 record-after-success

每个 file write 必须：

```text
atomic/stream operation returns success
→ record artifact
```

绝不能：

```text
before write
→ 先把预期 path 填入 ledger
```

### 10.4 partial group failure

如果：

```text
main body success
main calls failure
```

ledger 应保留：

```text
mainOutput.body
```

但不存在：

```text
mainOutput.calls
mainOutput.extra
```

即使 command 随后 exit 1。

这使未来 failure receipt / diagnostics 能准确描述事实。

### 10.5 internal absolute path 不等于 future public receipt schema

ledger 可以为了本进程 hook/environment 使用 absolute path。

Completion Receipt 不得简单 JSON.stringify 整个 internal ledger。

Receipt 应把 Conversation artifact 映射成自己冻结的 stable artifact reference；例如复用 Layered Conversation 的 directory identity / relativePath 语义。

---

## 11. 唯一执行阶段顺序

### 11.1 Phase A：pure resolution / preflight

在模型调用前完成：

```text
resolve config
→ OCC early preflight（若配置）
→ resolve hook candidate read-only
→ resolve output policy
→ lexical collision validation
→ other completion validation / tools / sidecars / messages
```

此阶段不应创建 durable output artifact。

### 11.2 Phase B：sink preparation

所有确定性 config validation 完成后、模型调用之前：

```text
prepare main-output parent directory
prepare output-pile parent directory（file target）
canonical-parent collision recheck
open output pile sink / await readiness
```

必须保证：

```text
已知 output-pile file open failure
→ 不启动模型请求
```

不要在 API 已经开始产生费用后才发现 pile file 根本无法打开。

### 11.3 Phase C：model stream

模型 delta 到达时：

```text
if output pile enabled:
    write pile delta

if !quiet:
    write stdout delta
```

output pile 与 stdout 都可能在后续失败前已经被外部观察到。

### 11.4 Phase D：model stream finalization

模型成功：

```text
outputPile.writeDone()
→ outputPile.close()
```

只有 close 成功后才进入 durable artifact stage。

模型失败：

```text
best-effort outputPile.writeError(primaryModelError)
→ close pile
→ stop
```

后续不执行：

```text
-o
--continue
after-hook
success receipt
```

### 11.5 Phase E：main output group

如果配置 `-o`：

```text
1. body
2. calls（若有）
3. extra（若有）
```

每个文件独立原子提交。

### 11.6 Phase F：terminal postlude

保持当前兼容行为：

```text
if !quiet:
    print tool-call JSON lines
```

这是 observational stdout，不影响 artifact ledger。

### 11.7 Phase G：Conversation commit

如果 `--continue`：

```text
OCC enabled → claim + authoritative recheck + commit
legacy path → existing single-writer behavior
```

Conversation path 只能由 Conversation writer 返回并进入 ledger。

### 11.8 Phase H：after-hook

仅在前置 required stages 没有 ordinary failure / OCC conflict 时执行。

hook env 从：

```text
resolved policy
+
artifact ledger
+
model metadata
```

构建。

### 11.9 Phase I：future Receipt finalization

Receipt 永远是最后一个 durable metadata artifact。

成功路径：

```text
model done
→ output pile finalized
→ main artifacts
→ Conversation artifacts
→ hook result known
→ receipt
```

如果未来 Receipt 支持 conflict / failure receipt，则可以在对应失败路径中消费：

```text
partial ledger
primary failure/conflict
hook skipped/result
```

但“哪些失败写 receipt”由 Completion Receipt contract 决定，不由 Output Policy v1 偷偷决定。

---

## 12. Output pile contract

### 12.1 定位

output pile 是：

```text
real-time model output transport
```

不是：

```text
completion transaction log
completion commit marker
Conversation history
```

### 12.2 file target

file target 保持 current behavior：

```text
open for write / truncate
stream deltas
close at end of model phase
```

因此 pile file 允许：

- partial；
- API failure 时只有部分 deltas；
- process crash 时没有 final marker；
- post-model failure 时仍然显示 `assistant_done`。

### 12.3 fd target

fd target 是 invocation 级 inherited transport。

Promptpile writer 在 model stream 阶段结束时 finalize/close 自己的 stream，从而让接收方获得 EOF。

调用方不应假设该 fd 在 Promptpile 返回后仍可被当前 child 重用。

### 12.4 JSON events

v1 保持：

```json
{"type":"assistant_delta","content":"..."}
{"type":"assistant_done"}
{"type":"error","message":"..."}
```

`assistant_done` 的唯一含义：

> model streaming API 已完成，并且 done event 已提交给 pile writer。

它不表示：

```text
main output committed
Conversation committed
hook succeeded
receipt exists
process exit 0
```

### 12.5 不追加 post-model outcome event

v1 不在 pile close 之后重新打开 pile 去追加：

```text
conversation_conflict
hook_failed
receipt_failed
```

如果需要完整 phase event protocol，应单独设计 realtime run event stream；不要污染 model-output pile 的职责。

### 12.6 configured pile failure 是 fatal ordinary failure

只要调用方显式启用了 pile：

```text
open failure
write failure
close failure
```

都属于：

```text
ordinary operational failure
exit 1
```

并停止后续 durable artifact stages。

理由：

> 非权威 transport 仍然是调用方显式请求的 required sink；悄悄丢失它会让 orchestrator 误以为自己的 transport 正常工作。

---

## 13. Main output artifact group

### 13.1 固定 commit 顺序

```text
body
→ calls
→ extra
```

不要根据对象 key enumeration 或异步 Promise 顺序决定。

### 13.2 单文件 atomic，不做组事务

每个文件继续使用同目录 temp + fsync + rename 的 atomic writer。

但：

```text
body + calls + extra
```

不是一个 filesystem transaction。

### 13.3 partial failure

例如 calls write failure：

```text
body 已成功 → 保留
calls 失败
extra 不再尝试
Conversation 不再尝试
after-hook 不运行
future success receipt 不写
exit 1
```

extra failure：

```text
body/calls 已成功 → 保留
Conversation 不再尝试
after-hook 不运行
exit 1
```

### 13.4 existing target replacement

`-o` 继续是 caller-managed replace semantics。

如果 target 已存在且 parent directory 可写，atomic writer 可以替换该 path entry。

Output Policy 不把 `-o` 改成 no-clobber。

---

## 14. Conversation output stage

### 14.1 顺序固定在 main output 之后

这是一个重要兼容 contract：

```text
model
→ pile finalize
→ -o
→ Conversation --continue
```

因此 post-model OCC conflict 时：

```text
-o 可能已存在
```

且不回滚。

### 14.2 OCC 不属于 Output Policy 内部实现

Output Policy 只调用现有 Conversation mutation primitive。

禁止复制：

- fingerprint；
- claim；
- next-index allocator；
- conflict classification。

### 14.3 Conversation partial multi-file failure

assistant body/calls/extra 继续不是跨文件事务。

如果 writer 在 body 成功后 sidecar 失败：

- 已提交 Conversation artifact 保留；
- 后续 hook 不运行；
- exit 1；
- ledger 必须保留能够确定为成功提交的实际 path。

为支持这一点，writer 应允许 artifact recorder 在每个 atomic file success 后更新 ledger，不能只依赖函数最终成功返回一个 all-or-nothing object。

### 14.4 empty assistant projection

如果 content/calls/reasoning 都不存在：

```text
Conversation stage success
no artifact recorded
no idx reservation
```

不要把 allocator 暂时计算出的 idx 当成已提交 artifact identity。

---

## 15. Terminal contract

### 15.1 quiet 只影响 terminal

```text
-q/--quiet
```

只关闭正常 stdout：

- assistant delta；
- tool-call JSON lines；
-其它 normal terminal chatter。

它不关闭：

```text
-o
output pile
--continue
after-hook
future receipt
```

### 15.2 stderr 不被 quiet 吞掉

warning/error/conflict diagnostics 继续写 stderr。

### 15.3 stdout 不是机器完成协议

即使 quiet=false，调用方也不能通过“stdout 最后一行”判断 completion commit。

机器 orchestration 应使用：

```text
exit code
+
Receipt（未来）
+
Conversation/Fingerprint 等明确协议
```

---

## 16. After-hook integration

### 16.1 hook 不是 output artifact

after-hook 是 downstream consumer。

Output Policy 只定义它什么时候可以看到哪些 artifact facts。

### 16.2 hook env 必须从 ledger 构造

未来重构目标：

```ts
buildPromptpileHookEnv({
  policy,
  ledger,
  modelMetadata,
  ...
})
```

不得再做：

```text
if toolCalls exist
→ 自己猜 <main>.calls.jsonl 一定存在
```

### 16.3 exact artifact env

至少以下 env 必须来自 actual ledger：

```text
PROMPTPILE_OUTPUT_FILE
PROMPTPILE_CALLS_FILE
PROMPTPILE_ASSISTANT_MD_FILE
PROMPTPILE_ASSISTANT_CALL_FILE
PROMPTPILE_ASSISTANT_EXTRA_FILE
```

配置了 target 但实际没有成功写出文件：

```text
不能把 target path 当成 persisted artifact 暴露
```

### 16.4 hook failure policy 独立

当前兼容行为仍由 After-hook Failure Policy 演进：

```text
warn
error
```

Output Policy 只冻结：

- hook 在 durable output stages 后执行；
- hook failure 不回滚 artifacts；
- hook 的结构化结果必须在 Receipt 之前确定。

---

## 17. Completion Receipt integration seam

Receipt 尚未实施，因此 v1 不提前修改 public CLI。

但未来 Receipt 必须遵循以下边界。

### 17.1 receipt consumes facts, not inference

输入：

```text
artifact ledger
model metadata
Conversation outcome/conflict
hook result
final status candidate
```

禁止 Receipt 重新 scan “最新文件”或根据 tool calls 推导 path。

### 17.2 receipt last

成功路径 receipt 可见时，它引用的所有成功 artifacts 必须已经完成写入。

### 17.3 receipt 不复制正文

Receipt 只引用 artifacts / status，不复制：

- assistant body；
- reasoning body；
- tool arguments；
- API key；
-完整 prompt。

### 17.4 receipt failure 不回滚

如果未来 receipt atomic write 失败：

```text
main artifacts 保留
Conversation artifacts 保留
hook 已执行则不撤回
exit 1
```

---

## 18. First-primary-failure rule

### 18.1 为什么必须冻结

多阶段流程会出现：

```text
primary model error
+
output pile writeError failure
+
output pile close failure
```

或者：

```text
Conversation mutation error
+
claim cleanup failure
```

如果 finally 中的新 error 随意覆盖前一个 error，调用方得到的失败分类会随机依赖 cleanup 情况。

### 18.2 v1 规则

```text
第一个导致正常阶段无法继续的错误 = primary failure
```

随后 cleanup/finalizer failure：

```text
secondary diagnostic
```

不得覆盖 primary failure 的：

- exit class；
- conflict kind；
- error message 主体。

### 18.3 没有已有 primary 时

如果 model 成功，但：

```text
output pile close failure
```

则 close failure 本身成为 primary ordinary failure。

如果 Conversation artifacts 已 commit，但 claim cleanup 失败且此前无 error：

```text
cleanup failure becomes primary ordinary failure
```

artifact 仍保留。

### 18.4 implementation pattern

建议内部使用：

```ts
interface CompletionFailureState {
  primary?: unknown;
  secondary: unknown[];
}
```

或等价 helper：

```text
recordPrimaryOnce(error)
recordSecondary(error)
```

不要靠嵌套 `try/finally` 的默认 throw precedence 决定公开语义。

---

## 19. Failure matrix

| Failure point | 已经可能存在 | 后续 main output | 后续 Conversation | after-hook | exit |
| --- | --- | --- | --- | --- | --- |
| output policy config/collision | parent dirs 最多可能被准备 | 不写 | 不写 | 不运行 | 1 |
| output pile open/readiness | 无 durable output | 不写 | 不写 | 不运行 | 1 |
| model/API failure | partial stdout / pile | 不写 | 不写 | 不运行 | 1 |
| output pile write failure | partial stdout / pile | 不写 | 不写 | 不运行 | 1 |
| output pile close failure after model | stdout / pile 可能含 done | 不写 | 不写 | 不运行 | 1 |
| main body failure | pile/stdout | 停止 | 不写 | 不运行 | 1 |
| main calls failure | main body | extra 不写 | 不写 | 不运行 | 1 |
| main extra failure | main body/calls | 已停止 | 不写 | 不运行 | 1 |
| Conversation OCC conflict | stdout/pile/main output；可能 pre-input user | 已存在的不回滚 | 本轮 assistant 不写 | 不运行 | 3 |
| Conversation ordinary write failure | stdout/pile/main；可能 partial Conversation | 不回滚 | 停止 | 不运行 | 1 |
| Conversation claim cleanup failure after commit | main + committed Conversation | 不回滚 | 已提交不回滚 | 不运行 | 1 |
| after-hook warning failure | 全部 artifacts | 不回滚 | 不回滚 | 已尝试 | 按 hook policy |
| future receipt failure | 全部 artifacts + hook effect | 不回滚 | 不回滚 | 不重跑 | 1 |

---

## 20. Post-model OCC conflict

OCC v1 已冻结：模型期间 Conversation 允许变化，commit-time recheck 才是权威判断。

Output Policy 进一步冻结通道结果：

```text
model succeeded
output pile finalized
-o succeeded
Conversation changed
→ OCC conflict
```

此时：

### 保留

- 已输出 stdout；
- output pile 内容，包括可能存在的 `assistant_done`；
- `-o` body；
- `-o` calls；
- `-o` extra；
- `--input --continue` 中模型前已提交的 user artifact；
- competing writer 的 artifact。

### 不产生

- 本轮新的 Conversation assistant.md；
- 本轮新的 Conversation calls/extra；
- after-hook side effect。

### 状态

```text
exit 3
```

future Receipt 是否记录 conflict，由 Receipt plan 决定。

---

## 21. Layered Conversation I/O 边界

Output Policy 必须继续遵守 Layered 已冻结语义。

### 21.1 `--output-dir`

只控制 Conversation mutation target：

```text
--continue
--input（不属于 completion output ledger）
```

它不改变：

```text
-o relative path base
output pile relative path base
future receipt relative path base
```

这些 caller-managed paths 仍相对 cwd。

### 21.2 ledger Conversation refs

Conversation ledger entry 至少保留：

```text
outputDirectory
output directoryIndex
relativePath
index
absolutePath (internal)
```

这样 after-hook 可以使用 absolute path，而 future Receipt 可以映射成稳定 layered artifact reference。

### 21.3 不把 read-only layers 当 output sinks

Output Policy 不为 base/shared input layer创建 writable policy entry。

---

## 22. Atomicity 与 durability

### 22.1 stdout / stderr

不承诺 durability。

### 22.2 output pile

stream transport：

- 非原子；
- 可 partial；
- file mode 通常 truncate；
- fd mode 由 inherited stream 生命周期决定。

### 22.3 main output

每个文件：

```text
atomic temp + fsync + rename
```

组：

```text
not transactional
```

### 22.4 Conversation artifacts

继续继承 Conversation Protocol：

```text
single-file atomic
multi-file not transactional
```

### 22.5 Receipt

未来：

```text
single-file atomic
last visible metadata marker
```

但不是跨 artifact transaction commit record。

---

## 23. Security / privacy

Output Policy / ledger 不得记录或输出：

- API key；
-完整 environment dump；
-完整 prompt；
- tool arguments；
- assistant body 副本；
- reasoning body 副本。

collision diagnostics 可以包含：

- sink name；
- target path；
- conflicting sink name。

不要为了诊断打印 artifact contents。

hook env 继续只传必要 metadata / paths。

---

## 24. 模块边界

建议实现结构：

```text
resolve-config.ts
  ↓ raw resolved completion config

output-artifact-policy.ts
  ↓ resolved sink topology / paths / identities / collision checks

output-pile.ts
  ↓ transport writer only

main-output.ts
  ↓ body/calls/extra durable writer

conversation OCC + file-handler
  ↓ Conversation durable writer

completion-artifact-ledger.ts
  ↓ actual persisted file facts

after-hook.ts
  ↓ consumes policy + ledger

completion-receipt.ts (future)
  ↓ consumes ledger + outcome
```

### 24.1 `output-pile.ts` 不再 resolve cwd

它接收已经 resolved 的：

```text
absolute file path
或
fd
```

### 24.2 `index.ts` 不再推导 sidecar path

顶层只负责阶段 orchestration。

以下逻辑应离开 `index.ts`：

- `callsPathForMainOutput()`；
- `extraPathForMainOutput()`；
- main group per-file bookkeeping；
- sink collision logic。

### 24.3 after-hook 不再推导 main calls path

删除重复的 `callsPathForMainOutput()`。

path 来自 ledger。

### 24.4 不建立大型 OutputManager God Object

v1 不需要一个同时拥有：

- API call；
- Conversation scanner；
- hook spawn；
- receipt JSON；
- terminal rendering；
- config parsing

的单体 class。

Policy 是 immutable resolved topology；ledger 是事实记录；各 writer 保持窄职责。

---

## 25. 实施阶段

### Phase 0：冻结 contract / inventory

1. 更新 CLI Contract 的 output channel classification。
2. 冻结本计划阶段顺序与 failure matrix。
3. 把 output pile destination 定义为 logical target slot，冻结 CLI-over-TOML group precedence。
4. 冻结 same-source `fd wins` compatibility。
5. 如 Conversation filename recognition 尚不可复用，先抽出 scanner filename classifier。

验收：

- 不写业务实现前，协议已能回答所有合法组合和 failure point。

### Phase 1：Resolved policy

新增：

```text
output-artifact-policy.ts
```

实现：

- cwd-relative path resolution；
- main potential sidecar targets；
- output pile target group precedence；
- lexical/canonical-parent target identity；
- static collision validation；
- reserved control collision；
- writable Conversation namespace self-collision；
- resolved hook dependency collision。

### Phase 2：Artifact ledger + main writer

新增/抽取：

```text
completion-artifact-ledger.ts
main-output.ts
```

main writer：

```text
body → calls → extra
```

每个 success 后 record。

### Phase 3：Output pile lifecycle hardening

让 `output-pile.ts`：

- 接收 resolved target；
- 提供 readiness barrier；
- 明确 required sink failure；
- preserve-first-error；
- cleanup secondary diagnostics；
- 保持 text/json wire format。

### Phase 4：Conversation stage integration

- 不改 OCC 算法；
- `--continue` 成功 path 进入 ledger；
- partial Conversation write 需要能够逐文件 record；
- OCC conflict 保持 exit 3；
- claim cleanup failure 后 hook 不运行。

### Phase 5：after-hook ledger integration

`buildPromptpileHookEnv()` 改为消费：

```text
policy + actual ledger
```

移除重复 path derivation。

### Phase 6：组合与 fault-injection tests

完成第 26 节测试矩阵。

### Phase 7：contracts / docs / CI freeze

- CLI Contract；
- package README；
- tracking；
- dedicated Windows/Linux output-policy workflow 或纳入等价 cross-platform matrix。

完成后把状态改为：

```text
v1 已实施
```

### Closure audit：2026-08-11

- `prepareOutputArtifactPolicy()` 已位于 OCC、messages、tools、tool choice 与 insert/append sidecar validation 之后；
- terminal、Conversation output topology 与 hook execution 统一从 resolved policy 消费；
- ledger 对 `(namespace, kind)` 实施唯一键约束，重复 record 是内部错误；
- fault injection 覆盖 model failure + pile close failure，以及 main body/calls/extra 三个 failure point；
- dedicated Windows/Linux workflow 包含 logical-slot CLI-over-TOML precedence 测试。

---

## 26. Test Plan

### 26.1 policy resolution

覆盖：

- no output sink；
- `-q` only；
- main output only；
- pile file only；
- pile fd only；
- main + pile；
- main + continue；
- pile + continue；
- main + pile + continue；
- layered output directory。

### 26.2 output pile precedence

至少：

```text
CLI file + TOML fd → CLI file
CLI fd + TOML file → CLI fd
TOML file only → TOML file
TOML fd only → TOML fd
same-source file + fd → fd wins
```

并证明 shadowed file 不被 mkdir/open/truncate。

### 26.3 cwd resolution

从不同 cwd 调用同一 config fixture，验证：

```text
-o relative
pile file relative
```

只由 resolved policy 决定，不受 writer 内部 `process.cwd()` 再解释影响。

### 26.4 target collision

必须覆盖：

```text
main body == pile
main calls == pile
main extra == pile
```

即使最终模型 fixture 没有 calls/extra，也必须在模型前 reject potential collision。

断言：

```text
API request count == 0
pile target 未 truncate
main target 未创建
```

Windows 增加 case-insensitive alias fixture。

### 26.5 output directory namespace collision

当 root 有 `--input` / `--continue`：

```text
-o <outputDir>/[N]assistant.md
pile <outputDir>/[N]user.md
```

应在模型前失败。

scanner recognition 必须复用 shared classifier。

### 26.6 OCC control collision

```text
pile/main target = <outputDir>/.promptpile.occ.claim
```

必须 pre-model failure，不能制造 stale claim。

### 26.7 hook script collision

```text
-o hook.sh
--after-hook-path hook.sh
```

API request count `0`，hook 文件 byte-for-byte unchanged。

### 26.8 output pile success

text：

```text
deltas concatenate exactly
```

json：

```text
assistant_delta...
assistant_done
```

fd：

- 内容正确；
- finalize 后 reader 得到 EOF。

### 26.9 API failure

fake API：

```text
some delta
→ error
```

验证：

- stdout/pile 允许 partial；
- JSON pile best-effort error event；
- no main output；
- no Conversation assistant；
- no hook；
- exit 1。

### 26.10 output pile failure

fault injection：

- open failure；
- writeDelta failure；
- writeDone failure；
- close failure。

验证：

```text
no downstream main/Conversation/hook
exit 1
```

primary model error + pile cleanup error 时，model error 必须保持 primary。

### 26.11 main output group

四种结果：

1. body only；
2. body + calls；
3. body + extra；
4. body + calls + extra。

再注入：

- body failure；
- calls failure；
- extra failure。

验证 partial ledger 与 downstream stop 顺序。

### 26.12 empty model content

配置 `-o`，模型：

```text
content = ''
no calls
no reasoning
```

验收：

- main body 存在且 zero-byte；
- Conversation `--continue` 不产生 assistant artifact；
- ledger 只含 main body。

### 26.13 post-model OCC conflict

保留现有真实测试并接入 ledger assertions：

- pile done 保留；
- `-o` 保留；
- Conversation assistant 不写；
- hook 不执行；
- exit 3。

### 26.14 Conversation partial failure

通过 deterministic writer seam：

```text
assistant.md success
calls write fails
```

验证：

- md 保留；
- md 进入 ledger；
- calls 不进入 ledger；
- extra 不尝试；
- hook 不运行；
- exit 1。

### 26.15 claim cleanup failure after committed Conversation

验证：

- committed Conversation paths 进入 ledger；
- claim cleanup error exit 1；
- hook 不运行；
- committed files 不回滚。

### 26.16 quiet matrix

至少：

```text
quiet + main
quiet + pile
quiet + continue
quiet + main + pile + continue
```

验证 quiet 只影响 stdout，不影响 file/fd outputs。

### 26.17 hook env from ledger

模型有 calls/reasoning 时验证 exact paths；

模型没有 calls/reasoning 时：

```text
CALLS/EXTRA artifact path 不得凭空出现
```

测试不允许 hook env builder 自己调用 main path derivation helper。

### 26.18 first-primary-failure

覆盖：

```text
model failure + pile close failure
mutation failure + claim cleanup failure
```

最终公开 error classification 必须保留第一个 primary；secondary failure 仅诊断。

---

## 27. CI

Output Policy 触及：

- Windows path case behavior；
- file/fd stream lifecycle；
- atomic file replacement；
- Conversation output；
- hook scripts。

因此实施完成必须至少在：

```text
Node 18 / Ubuntu
Node 22 / Ubuntu
Node 18 / Windows
Node 22 / Windows
```

执行核心 output-policy integration tests。

不要只在 Unix 验证 target identity / hook collision。

---

## 28. 验收标准

实现完成必须同时满足：

- [x] Output Policy 是内部唯一 resolved sink topology；
- [x] downstream writer 不重新 resolve cwd-relative output paths；
- [x] main body/calls/extra target derivation 只有一个 primitive；
- [x] output pile destination 按 logical slot 做 CLI-over-TOML precedence；
- [x] same-source file+fd 保持 v1 `fd wins` compatibility；
- [x] potential main calls/extra target 在模型前参与 collision validation；
- [x] static sink collision 在 API 调用前失败且不 truncate sink；
- [x] Conversation mutation invocation 拒绝 caller sink 写入 writable output directory 的 recognized protocol filename；
- [x] non-control sink 不得占用 `.promptpile.occ.claim`；
- [x] resolved after-hook script 不得与 output file sink 冲突；
- [x] output pile `assistant_done` 明确只表示 model stream done；
- [x] configured output pile I/O failure 是 ordinary failure；
- [x] output pile failure 后不写 main/Conversation artifact、不运行 hook；
- [x] `-o` group 固定 body → calls → extra；
- [x] main output 每文件 atomic、组内不承诺 transaction；
- [x] main partial failure 保留已写文件并停止 downstream stages；
- [x] Conversation commit 固定发生在 main output 之后；
- [x] post-model OCC conflict 保留 pile/main，跳过本轮 assistant/hook，exit 3；
- [x] Conversation partial multi-file failure 不回滚已提交文件；
- [x] artifact ledger 只记录实际成功写入的 durable files；
- [x] output pile 不进入 artifact ledger；
- [x] after-hook exact file env 全部来自 ledger；
- [x] Receipt 未来只消费 ledger，不重新扫描/推导 artifact path；
- [x] quiet 只影响 terminal，不关闭其它 sinks；
- [x] first-primary-failure rule 有 fault-injection tests；
- [x] valid existing CLI combinations保持行为兼容；
- [x] Windows/Linux output policy matrix 已纳入 dedicated CI；
- [x] 文档明确不存在跨 output channels transaction / rollback。

---

## 29. 非目标

v1 明确不做：

- 不公开新的 `[promptpile.output_policy]` TOML schema；
- 不增加 `config explain-output` public command；
- 不把 stdout 变成 JSON RPC；
- 不把 output pile 扩展成完整 invocation event log；
- 不为 pile 加 Conversation commit event；
- 不让 Receipt 保存第二份正文；
- 不把 after-hook stdout 解释成 artifact；
- 不在 output policy 中实现 OCC；
- 不给 main output 增加 exactly-once / no-clobber；
- 不把 main + Conversation + Receipt 变成跨文件事务；
- 不自动 retry file I/O；
- 不自动 rollback 已写 artifact；
- 不检测所有 hardlink / inode alias；
- 不定义业务 session/run lifecycle。

---

## 30. Future Work

Output Artifact Policy v1 稳定后，再推进：

### 30.1 After-hook Failure Policy

让 hook 返回结构化结果：

```text
success
spawn_failed
nonzero_exit
signal
...
```

并在 `warn/error` policy 下决定最终 exit。

### 30.2 Completion Receipt

Receipt 直接消费：

```text
immutable output policy
artifact ledger
hook result
completion outcome
```

不再解决 path discovery 问题。

### 30.3 config explain-output

如果真实用户需要诊断 resolved sink topology，再增加：

```bash
promptpile config explain-output --format json
```

其输出必须来自同一个 resolver，而不是重新解释 config。

### 30.4 更严格的 same-source pile target validation

未来 major version 可以把：

```text
file + fd
```

从 `fd wins` compatibility 改成显式配置错误。

### 30.5 External artifact stores

未来如果支持 object storage / URLs，应增加新的 sink kind，不要把 URL 假装成本地 path。

---

## 31. 冻结决策汇总

Output Artifact Policy v1 在实现前冻结以下决定：

1. **Policy 是内部 resolved topology，不新增 public output-policy config object。**
2. **stdout/stderr、output pile、main output、Conversation、hook、Receipt 是不同职责面，不合并成单一 stream。**
3. **output pile 非权威但显式配置后是 required sink。**
4. **pile I/O failure exit 1，并阻止后续 durable artifact commit。**
5. **pile `assistant_done` 只表示模型 stream done。**
6. **pile destination 是 logical slot；CLI target group 整体优先于 TOML target group。**
7. **同来源 file+fd 保持 v1 `fd wins`。**
8. **caller-managed relative output paths统一相对 cwd，并只 resolve 一次。**
9. **main body/calls/extra potential targets 在模型前全部进入 collision set。**
10. **known sink path collision 必须 pre-model fail。**
11. **Conversation mutation invocation 不允许 caller sink 在 writable output dir 内伪装成 recognized Conversation artifact。**
12. **`.promptpile.occ.claim` 是 reserved control path。**
13. **output sink 不得覆盖本轮 resolved after-hook script。**
14. **main output commit 顺序是 body → calls → extra。**
15. **main output 每文件 atomic，group 不 transactional。**
16. **Conversation commit 在 main output 之后。**
17. **OCC conflict 保留已经完成的 live/main outputs，不写本轮 assistant，不运行 hook，exit 3。**
18. **Artifact ledger 只记录真实成功的 durable file writes。**
19. **Output pile 不属于 artifact ledger。**
20. **after-hook 和未来 Receipt 共享同一 ledger，不重新推导 path。**
21. **Receipt 在 hook result 之后，是未来最后 durable metadata stage。**
22. **任何后续失败都不回滚已完成 artifact。**
23. **first primary failure 不得被 cleanup/finalizer error 覆盖。**
24. **quiet 只影响 terminal。**
25. **`--input` user mutation 不纳入 completion output ledger。**

当以上规则全部进入实现、contract、fault-injection tests 与 Windows/Linux CI 后，Output Artifact Policy v1 才算真正闭环。
