# Promptpile Conversation Optimistic Concurrency 实施设计计划

> 状态：实施前冻结稿  
> 日期：2026-08-10  
> 核心提案：为 Conversation mutations 提供可选 expected precondition，并用 output-directory-scoped 的短临界区 exclusive claim 完成 commit-time compare-and-commit，避免 TOCTOU，同时不引入长期锁服务

## 0. 结论

Conversation Optimistic Concurrency（OCC）v1 只回答一个问题：

> 当调用方准备修改一个 physical Conversation Directory 时，能否证明当前状态仍满足调用方声明的 expected condition，并保证多个遵守 OCC 协议的 writer 不会同时把同一个旧状态都提交成功？

v1 固定为：

```text
caller expected condition
        ↓
optional early preflight
        ↓
expensive work / model request
        ↓
acquire short exclusive mutation claim
        ↓
commit-time authoritative recheck
        ↓
condition matches ?
   yes            no
    ↓              ↓
 mutation       conflict
    ↓
release claim
```

核心不变量：

1. **Fingerprint / next-index 检查本身不是 CAS。** 只做 `check -> write` 仍然存在 TOCTOU。
2. **真正的 cooperative writer 串行点是短临界区 exclusive claim。** claim 只覆盖最终校验与 Conversation mutation，不覆盖模型请求。
3. **commit-time recheck 才是权威判断。** preflight 只用于尽早失败、减少无意义模型调用。
4. **Fingerprint 直接复用 Conversation Fingerprint v1。** OCC 不复制 scanner、hash、canonicalization 或 token 算法。
5. **Layered 模式只保护 writable output physical directory。** 只读 base/shared layer 不自动变成 OCC mutation target。
6. **assistant.md / calls / extra 仍不是跨文件事务。** OCC 解决“哪个 writer 可以进入 commit”，不把多 sidecar 写入升级成 filesystem transaction。
7. **没有 expected condition 时保持现有兼容路径。** v1 不把所有历史 mutation 强制切换成 OCC。

职责边界固定为：

```text
inspect       磁盘上有哪些 recognized artifacts
fingerprint   recognized artifact 的精确字节状态
OCC           当前 writable Conversation 是否仍满足 expected state，以及谁可以进入 mutation critical section
receipt       一次 completion 最终产生了什么；后续独立能力
```

---

## 1. 动机与当前问题

Conversation Protocol 已保证单个最终文件使用临时文件 + rename 做原子发布，但当前 next-index mutation 仍然是典型的 check-then-act：

```text
scan files
→ compute next idx
→ existsSync(target)
→ atomicWriteFileSync(target)
```

两个进程可以同时：

```text
writer A sees next idx = 9
writer B sees next idx = 9
```

然后分别进入最终写入。

`atomicWriteFileSync()` 当前保证的是：

> 每个 writer 的单文件发布不会留下半个临时文件。

它不保证：

> 目标文件在 rename 时仍不存在。

普通 rename 不是 compare-and-swap；目标在检查之后被另一个 writer 创建时仍存在覆盖 / 串写风险。

Conversation Fingerprint v1 已经提供强 state identity，但：

```text
fingerprint == expected
→ write
```

仍不是原子操作。两个 writer 可以同时得到同一个 fingerprint，再同时写入。

因此 OCC v1 必须同时具备：

```text
expected precondition
+
short exclusive mutation claim
+
commit-time recheck
```

少任何一项都不能兑现“两个 cooperative writers 最多一个从同一个旧状态成功 commit”的承诺。

---

## 2. v1 范围

v1 保护 Promptpile 自己的 Conversation mutations：

1. `promptpile conversation append-user`
2. root completion 的 `--input` user append
3. root completion 的 `--continue` assistant artifacts

v1 不把以下操作自动纳入同一个 transaction：

- `-o/--output` 普通主输出；
- output pile；
- stdout / stderr；
- after-hook；
- promptpile-mcp result 写入；
- compress / restore；
- archive retrieval；
- fork；
- 外部脚本直接写 Conversation 文件。

后续这些 mutation consumer 可以选择复用同一个 claim protocol，但不应阻塞 OCC v1。

### 2.1 cooperative writer

本计划中的 **cooperative writer** 指：

> 在修改同一个 physical Conversation Directory 前，遵守本 OCC v1 exclusive claim + commit-time recheck 协议的 writer。

v1 保证 cooperative writers 之间不会同时成功从同一个 expected state commit。

它不能阻止：

- 老版本 Promptpile；
- 用户手工编辑；
- 不遵守 claim 的第三方程序；
- 直接调用底层文件函数绕过 mutation guard 的代码。

这些属于 non-cooperative writer。

---

## 3. 实施前置条件

### 3.1 Conversation Fingerprint v1 已完成

OCC 的 strong precondition 必须直接调用现有：

```text
fingerprintConversationDirectory(directory)
```

不得：

- 自己重新扫描并 hash；
- hash Inspect JSON；
- 复制 canonical encoder；
- 重新实现 fingerprint token regex 后产生第二套 token 语义。

Fingerprint 模块应补一个共享 token parser / validator，例如：

```ts
parseConversationFingerprintTokenV1(value: string): ConversationFingerprintTokenV1
```

CLI config 和 OCC 内部都使用它。

### 3.2 idx 数值域必须先冻结

Conversation Protocol 当前把 `idx` 定义为十进制非负整数，但实现使用 JavaScript `number`。

在 OCC 实现前必须把 v1 合法范围冻结为：

```text
0 <= idx <= Number.MAX_SAFE_INTEGER
         = 9007199254740991
```

原因：

- `parseInt()` 超过 safe integer 后不能保持精确整数 identity；
- next-index / ordering / maxIndex / expected-next-index 都依赖精确整数；
- Fingerprint 与未来跨语言实现需要一致排序。

必须明确超范围 filename 的 scanner 行为，并在 Conversation Protocol 中先冻结。

当当前最大合法 idx 已经是 `Number.MAX_SAFE_INTEGER` 时：

```text
next mutation
→ index_exhausted
→ ordinary operational failure
```

不得 wrap、round 或产生 unsafe integer filename。

---

## 4. CLI contract

### 4.1 conversation append-user

```bash
promptpile conversation append-user \
  -d ./messages \
  --expect-fingerprint promptpile-conversation-v1:sha256:<64-hex>
```

弱条件：

```bash
promptpile conversation append-user \
  -d ./messages \
  --expected-next-index 9
```

两个条件可同时给出：

```bash
promptpile conversation append-user \
  -d ./messages \
  --expect-fingerprint promptpile-conversation-v1:sha256:<64-hex> \
  --expected-next-index 9
```

同时提供时必须 **全部满足**。

### 4.2 root completion

Layered completion 必须明确 condition 只针对 writable output directory，因此 root 参数使用 output 前缀：

```bash
promptpile \
  -d ./base \
  --output-dir ./session \
  -c \
  --expect-output-fingerprint promptpile-conversation-v1:sha256:<64-hex>
```

弱条件：

```bash
--expected-output-next-index 9
```

两个条件也可以同时提供。

### 4.3 参数适用性

root OCC options 只有在本次 invocation 可能执行 Conversation mutation 时才合法：

```text
--input
或
--continue
```

例如：

```bash
promptpile -d ./messages --expect-output-fingerprint ...
```

但既没有 `--input` 也没有 `--continue`：

```text
→ config error
→ 不调用模型
```

### 4.4 expected fingerprint 格式

v1 只接受 Fingerprint v1 的 canonical token：

```text
promptpile-conversation-v1:sha256:<64-lowercase-hex>
```

非法 prefix、错误长度、uppercase hex 或未来未知 version：

```text
→ config error
→ exit 1
```

不得把 malformed token 当成普通 mismatch。

### 4.5 expected next index 格式

必须是十进制 safe integer：

```text
0 .. 9007199254740991
```

负数、小数、指数格式、NaN、Infinity、unsafe integer：

```text
→ config error
→ exit 1
```

---

## 5. Preconditions

### 5.1 Strong condition：expected fingerprint

```text
expectedFingerprint
```

表示：

> commit 时 output physical directory 的 Conversation Fingerprint v1 必须等于调用方给出的 token。

它能检测：

- recognized artifact 增删；
- exact path 变化；
- 旧 artifact 原地任意 byte 修改；
- sidecar 内容变化。

它不检测：

- ignored file 变化；
- nested ignored file 变化；
- mtime/permission 等 metadata；
- active claim 本身。

这完全继承 Fingerprint v1 语义。

### 5.2 Weak condition：expected next index

`expected-next-index` / `expected-output-next-index` 表示：

> 本 invocation **下一次实际 Conversation mutation** 按当前 mutation allocator 应使用的 index 必须等于该值。

它不是抽象全局 counter。

具体：

- `conversation append-user`：下一次 user append 的 allocator index；
- root `--input`：下一次 user append 的 allocator index；
- root 只有 `--continue`：下一次 assistant turn 的 allocator index；
- root `--input --continue`：调用方提供的值先约束 user append；user append 成功后，为 assistant commit 派生新的内部 next-index baseline。

next-index 是低成本条件，可以检测“另一个 writer 已追加新 turn”，但不能检测旧 artifact 原地修改。

### 5.3 两个条件同时存在

```text
fingerprint matches
AND
next index matches
```

才允许 mutation。

任意一个不匹配：

```text
→ conflict
```

### 5.4 allocator 必须是唯一 primitive

当前 user append 与 assistant append 分别拥有自己的 next-index 逻辑。

OCC 实现时必须把“实际 mutation 将使用哪个 index”的逻辑提取为共享、可测试 primitive，mutation guard 与最终 writer 必须调用同一 allocator，不允许：

```text
OCC 计算 next index = A
writer 自己再算一次 = B
```

需要保留现有 filesystem target collision 行为，尤其是 Windows case-insensitive path alias 场景。

---

## 6. 为什么必须有 atomic claim

以下实现是错误的：

```text
A: fingerprint == F
B: fingerprint == F
A: write index 9
B: write index 9
```

即使 A/B 都在写入前重新 fingerprint，也可以同时通过。

因此 v1 引入一个 **directory-scoped short mutation claim**。

它不是长期 lease，也不会覆盖模型调用时间；它只覆盖：

```text
acquire
→ authoritative state check
→ Conversation mutation
→ optional derived baseline capture
→ release
```

这就是 OCC 的 compare-and-commit 临界区。

---

## 7. Exclusive mutation claim v1

### 7.1 claim scope

claim 绑定一个 physical writable Conversation Directory。

Layered mode：

```text
base/shared layer    不 claim
output directory     claim
```

单目录兼容 mutation：

```text
该 physical directory = claim scope
```

### 7.2 reserved claim path

建议 v1 冻结一个不会被 Conversation scanner 识别的 control filename：

```text
.promptpile.occ.claim
```

它：

- 不是 Conversation artifact；
- 不参与 scanner；
- 不参与 Fingerprint；
- 不进入模型 messages；
- 不属于 assistant/user idx namespace；
- 只用于 mutation coordination。

如果最终选择其它名字，必须在实现前写入 Conversation Protocol / CLI Contract 并保持所有 cooperative implementations 一致。

### 7.3 atomic acquisition

Node v1 使用 filesystem exclusive-create primitive：

```ts
fs.openSync(claimPath, 'wx', 0o600)
```

语义：

- claim 不存在：恰好一个 writer 原子创建成功；
- claim 已存在：其他 writer 收到 `EEXIST`；
- 不允许 `existsSync(claim) -> create(claim)`，因为那本身又是 TOCTOU。

claim 的协调事实只依赖：

```text
claim path 是否成功 exclusive-create
```

不依赖 claim JSON metadata 的时间戳判断。

### 7.4 metadata

claim 文件可以写入最小诊断 metadata：

```json
{
  "schemaVersion": 1,
  "token": "random-owner-token",
  "pid": 12345,
  "host": "machine-name",
  "createdAt": "2026-08-10T09:00:00.000Z",
  "operation": "continue"
}
```

metadata 只用于诊断和安全 release，不参与 Conversation identity。

不得包含：

- API key；
- prompt；
- assistant 正文；
- tool arguments；
- environment dump。

### 7.5 claim 不等待

v1 不内建 wait/backoff：

```text
claim exists
→ conflict: claim_busy
→ exit 3
```

上层若希望 retry，可以自己决定 cadence。

Promptpile 不应在内部 sleep 后静默重试，因为 completion 可能涉及模型成本和业务时序。

### 7.6 claim release

成功或普通 conflict 后，在 `finally` 中释放自己持有的 claim。

release 前应验证 claim owner token 仍等于本 writer token；如果不一致：

```text
不得删除未知 owner 的 claim
```

claim 必须在 Conversation mutation 完成后、after-hook 之前释放。

理由：after-hook 不是 Conversation commit critical section，而且未来 hook / MCP 可能拥有自己的 mutation coordination。

### 7.7 crash / stale claim

进程 crash、kill -9、断电可能留下 claim。

v1 选择 **安全优先**：

```text
不根据 createdAt 自动偷 claim
不使用 TTL 自动删除
不根据“看起来够旧”推断 owner 已死亡
```

因为：

- shared filesystem 可能来自另一台 host；
- PID 只在本机命名空间有意义；
- paused process / debugger / VM suspend 可能超过任意 TTL；
- 自动 stale stealing 会重新引入双 writer 风险。

因此残留 claim 与活跃 claim 都统一表现为：

```text
claim_busy
```

诊断应打印 claim path 和安全 metadata，运维人员只有在确认没有 live writer 后才能显式删除残留 claim。

未来若有真实需求，可单独设计 `conversation claim inspect/clear`；不阻塞 v1。

### 7.8 claim cleanup failure

如果 Conversation artifacts 已成功提交，但释放 claim 失败：

- 已提交 artifacts 不回滚；
- 命令返回 ordinary operational failure（exit 1）；
- stderr 明确提示 mutation 已提交但 claim cleanup 失败；
- 不把它伪装成 OCC conflict；
- 不运行 after-hook，避免上层误判完整 success path。

该场景必须有 fault-injection test。

---

## 8. Authoritative commit protocol

所有 OCC-enabled mutation 的权威流程：

```text
1. acquire exclusive claim
2. fresh read of current mutation state
3. validate every supplied precondition
4. if mismatch:
     release claim
     return conflict
5. perform Conversation mutation
6. if same invocation still needs a later Conversation mutation:
     derive new internal baseline while claim is held
7. release claim
8. continue non-Conversation work
```

第 2 步必须发生在 claim **之后**。

以下是错误实现：

```text
check fingerprint
→ acquire claim
→ write
```

因为 condition 可能在 check 与 claim acquisition 之间已经变化。

claim acquisition 后必须重新检查。

---

## 9. Early preflight

为了避免已经明显冲突时仍调用模型，可以在 expensive work 前进行一次 early preflight：

```text
fresh expected check
```

但 preflight：

- 不替代 commit-time claim；
- 不产生 ownership；
- 不承诺 linearizable model-input snapshot；
- 只用于 fail fast。

如果 preflight mismatch：

```text
→ conflict
→ 不调用模型
```

如果 preflight match：

```text
仍必须在真正写 Conversation 前 acquire claim + recheck
```

---

## 10. `conversation append-user` 流程

stdin 可能等待用户输入，因此绝不能在读取 stdin 前长期持有 claim。

流程：

```text
1. parse / validate OCC options
2. optional early preflight
3. read stdin completely
4. reject empty input
5. acquire directory claim
6. authoritative fingerprint / next-index recheck
7. append user artifact
8. release claim
9. success stdout 保持 append-user 既有 contract
```

如果第 6 步 conflict：

- 不写 user artifact；
- stdout 为空；
- stderr 写简短 conflict diagnostic；
- exit 3。

---

## 11. Root `--input` 流程

root `--input` 是 **模型请求之前的 Conversation mutation**。

如果 OCC option 存在：

```text
1. optional early preflight
2. read user input
3. acquire output-directory claim
4. authoritative expected check
5. append user artifact
6. 若同一 invocation 还有 --continue：派生新的内部 baseline
7. release claim
8. rescan / build messages
9. call model
```

如果 user append commit 后模型随后失败：

```text
user artifact 保留
```

这保持当前行为；OCC 不模拟 rollback transaction。

---

## 12. Root `--continue` 流程

### 12.1 没有 `--input`

```text
1. validate config
2. early preflight expected condition
3. assemble messages / load tools / sidecars
4. call model
5. finish stdout / output pile model stream
6. write independent -o main output（若配置）
7. acquire output-directory claim
8. commit-time authoritative expected check
9. append assistant.md / calls / extra
10. release claim
11. run after-hook
```

只有第 8 步通过才能执行第 9 步。

### 12.2 为什么模型请求期间不持 claim

模型调用可能持续秒到分钟。

如果从 preflight 一直持有 claim 到模型返回：

- 实际上变成长时间 pessimistic lock；
- crash / 网络 stall 会阻塞所有 cooperative mutations；
- Layered/session orchestration 会被不必要串行化。

因此：

```text
model request outside claim
commit-time recheck catches intervening changes
```

这是 optimistic concurrency 的核心。

---

## 13. Root `--input --continue`：派生 baseline

这是最容易实现错误的组合。

假设调用方提供：

```text
expected fingerprint = F0
```

user append 成功后 Conversation 已经合法变成：

```text
F1
```

assistant commit 绝不能继续拿 `F0` 比较，否则必然 conflict。

正确流程：

```text
caller expected state F0
        ↓
claim
        ↓
verify F0
        ↓
append user
        ↓
derive post-input baseline F1
        ↓
release claim
        ↓
call model
        ↓
claim
        ↓
verify current == F1
        ↓
append assistant
```

如果调用方只提供 `expected-output-next-index`，则同样：

```text
expected next index N
→ user append at N
→ derive post-input assistant next-index baseline
→ model
→ commit-time verify derived baseline
```

如果两个条件都提供，则派生后的两个内部条件都必须用于 assistant commit。

### 13.1 derived baseline 不是新的 public argument

它是同一次 invocation 内部生成的 guard state，不输出到普通 stdout，也不要求用户手工计算。

未来 Completion Receipt 可以记录它，但 OCC v1 不依赖 Receipt。

---

## 14. Fingerprint stable-observation failure 在 OCC 中的分类

commit-time expected fingerprint 检查可能遇到：

```text
unstable_observation
```

这通常表示目录正在变化，无法建立 stable state。

OCC 映射为 retryable conflict：

```text
state_unstable
→ exit 3
```

而以下 Fingerprint failure 仍是普通 operational error：

```text
artifact_unreadable
internal_encoding_error
invalid_directory
```

它们：

```text
→ exit 1
```

不要把权限错误伪装成并发冲突。

---

## 15. Conflict contract

### 15.1 稳定退出码

v1 冻结：

```text
0 = success
1 = ordinary/config/runtime failure
3 = Conversation OCC conflict
```

`3` 专指：

> 命令本身可运行，但当前 Conversation state / claim 不允许按照调用方声明的 optimistic condition commit。

### 15.2 conflict kinds

内部结构化错误至少区分：

```ts
type ConversationConflictKind =
  | 'claim_busy'
  | 'fingerprint_mismatch'
  | 'next_index_mismatch'
  | 'state_unstable'
  | 'target_collision';
```

建议：

```ts
class ConversationConflictError extends Error {
  code: 'conversation_conflict';
  kind: ConversationConflictKind;
  expectedFingerprint?: string;
  actualFingerprint?: string;
  expectedNextIndex?: number;
  actualNextIndex?: number;
  claimPath?: string;
}
```

### 15.3 stderr / stdout

conflict diagnostic 写 stderr，可以包含：

- conflict kind；
- output directory / artifact path；
- expected / actual fingerprint token；
- expected / actual next index；
- claim diagnostic metadata。

不得包含正文或 tool arguments。

CLI machine consumer 只依赖 exit code，不解析自然语言 stderr。

### 15.4 暂不要求 JSON conflict stdout

root completion 可能已经流式写过 stdout，因此 v1 不声称 conflict 时 root stdout 必为空。

`conversation append-user` 在 conflict 时 stdout 必须为空。

未来 Completion Receipt 可提供结构化 conflict document；OCC v1 不把 Receipt 变成前置依赖。

---

## 16. 模型已经返回后的 conflict 语义

post-model conflict 是正常、必须明确的 OCC 状态：

```text
model request succeeded
but
Conversation commit precondition no longer holds
```

v1 保持输出通道与 Conversation commit 解耦。

### 16.1 post-model conflict 时可能已经存在

按照当前 completion 写入顺序：

- stdout assistant stream 可能已经输出；
- output pile 可能已经写完 model stream / done；
- `-o` 主输出可能已经原子写入；
- `-o` 的 calls / extra sidecar 可能已经写入；
- tool-call terminal lines 可能已经输出；
- 如果同 invocation 先用了 `--input`，user artifact 已经提交。

这些都不是 `--continue` assistant Conversation commit 的 rollback target。

### 16.2 post-model conflict 时必须不存在

- 本轮新的 `--continue` assistant.md；
- 本轮新的 Conversation calls/extra sidecar；
- after-hook execution。

流程必须在 conflict 后停止，不运行 after-hook。

### 16.3 output pile `done` 的含义

如果 output pile 在模型流结束时已经发出 `done`，它只能表示：

> 模型输出流完成。

它不表示：

> 整个 Promptpile invocation，包括 Conversation OCC commit，最终成功。

后续 Output Artifact Policy 应继续保持这个边界。

---

## 17. Assistant multi-file commit 边界

一个 assistant turn 可能写：

```text
[N]assistant.md
[N]assistant.calls.jsonl
[N]assistant.extra.json
```

OCC claim 可以保证：

> 同一 physical output directory 中，遵守 OCC 的其它 writer 不会同时进入自己的 Conversation mutation critical section。

但 claim 不把三个文件变成一个 atomic filesystem transaction。

因此 crash 仍可能留下 partial assistant turn。

v1 明确：

- 不回滚已经成功原子发布的 sidecar；
- 不宣称 all-or-nothing assistant bundle；
- partial turn 继续由 Conversation scanner / diagnostics / future validate 观察；
- Completion Receipt 若以后实现，可以表达“没有完整 completion receipt”。

OCC 解决 writer ownership，不解决多文件 transaction。

---

## 18. Layered Conversation I/O

Layered root completion：

```text
inputDirectories = [base, shared, output]
```

OCC 只针对：

```text
output physical directory
```

因此：

```text
--expect-output-fingerprint
--expected-output-next-index
claim path
```

全部绑定 output directory。

只读层：

- 不创建 claim；
- 不进入 next-index calculation；
- 不被 output fingerprint condition 覆盖。

### 18.1 不做 composed-input OCC

v1 不提供：

```text
--expect-layered-fingerprint
--expect-base-fingerprint
--expect-all-inputs
```

如果未来需要保证模型请求的全部 base/shared inputs 都未变化，应基于未来 Layered Composite Fingerprint 单独设计 request precondition。

这与 output mutation OCC 分离。

---

## 19. Target collision 与 non-cooperative writer

claim 只能协调 cooperative writers。

在 critical section 中，最终 writer 仍应在发布前检查将写入的 exact target paths，并把意外存在映射为：

```text
target_collision
→ conflict
```

这可以降低与 legacy / external writer 的覆盖概率。

但 v1 不承诺消除所有 non-cooperative writer race，因为：

```text
check target absent
→ external writer creates target
→ current ordinary rename
```

仍可能发生。

如果未来需要对 non-cooperative filesystem writer 提供更强 no-replace 保证，应单独设计跨 Windows/Linux 的 atomic create-if-absent publication primitive；不要在 OCC 文档中假装普通 rename 已经具备该语义。

---

## 20. 内部模型建议

新增建议模块：

```text
packages/promptpile/src/conversation-mutation-guard.ts
```

建议类型：

```ts
interface ConversationMutationPrecondition {
  expectedFingerprint?: string;
  expectedNextIndex?: number;
}

interface ConversationMutationBaseline {
  fingerprint?: string;
  nextIndex?: number;
}

interface ConversationMutationClaim {
  path: string;
  ownerToken: string;
}

type ConversationMutationKind =
  | 'append_user'
  | 'continue_assistant';
```

核心 primitive：

```ts
acquireConversationMutationClaim(directory, operation)
releaseConversationMutationClaim(claim)
checkConversationMutationPrecondition(directory, mutationKind, precondition)
deriveConversationMutationBaseline(directory, mutationKind, requestedKinds)
```

以及高层 helper：

```ts
withConversationMutationClaim(directory, operation, async claim => {
  await check...
  mutate...
})
```

### 20.1 不暴露公共 library API

v1 是 Promptpile CLI / internal runtime contract。

除非后续 Protocol Package 明确抽取，否则不要承诺这些 TypeScript symbols 为 semver-stable public API。

---

## 21. Claim 与 Fingerprint 的关系

`.promptpile.occ.claim` 不参与 Fingerprint。

因此：

```text
fingerprint(directory with no claim)
==
fingerprint(directory while claim held)
```

只要 Conversation artifacts 本身相同。

这很重要：

- Fingerprint 描述 Conversation content state；
- claim 描述短期 mutation ownership；
- 两者不能互相污染。

调用方也不能因为 fingerprint 相同就推断“当前没有 writer”；是否可进入 commit 只能由 claim acquisition 决定。

---

## 22. Security / privacy

OCC 默认输出和 claim metadata 不得泄露：

- API key；
- LLM prompt；
- user / assistant 正文；
- reasoning；
- tool arguments；
-完整 environment。

Fingerprint token可以用于 conflict diagnostic，但它不是 secret-safe access token。

claim file mode建议：

```text
0600
```

受平台 ACL / umask 能力限制时保持 best effort。

---

## 23. 非目标

OCC v1 明确不做：

- 长期 pessimistic lock；
- 分布式 lease service；
- Redis / database coordinator；
- 在模型请求期间持有 filesystem claim；
- 自动 retry 模型调用；
- 自动 stale-claim TTL stealing；
- cross-directory transaction；
- assistant sidecar all-or-nothing transaction；
- rollback 已经提交的 `--input` user artifact；
- rollback `-o` / output pile / stdout；
- layered composed input fingerprint；
- 自动协调 non-cooperative external writers；
- 把 claim 写进 Conversation Fingerprint；
- 依赖 Completion Receipt 才能工作；
- 对 expected fingerprint 做弱 hash / mtime shortcut。

---

## 24. 实施阶段

### Phase 0：protocol prerequisites

先处理协议底座：

- 冻结合法 idx 为 JS safe integer；
- 定义 index exhausted；
- 将 actual mutation allocator 提取为唯一 primitive；
- Fingerprint 模块增加 canonical token parser / validator；
- 在 Conversation Protocol / CLI Contract 预留 OCC claim control filename；
- 明确 conflict exit code `3`。

验收：OCC 实现不再需要自行解释 idx、fingerprint token 或 next-index。

### Phase 1：exclusive claim primitive

实现：

```text
exclusive create
owner token metadata
safe release
claim_busy
cleanup failure
```

增加 deterministic dependency injection seam，不靠 sleep 测竞争。

验收：两个进程/两个 injected contenders 对同一目录同时 acquire，恰好一个成功。

### Phase 2：append-user OCC

为：

```text
conversation append-user
```

接入：

```text
expected fingerprint
expected next index
claim
commit-time recheck
exit 3
```

这是最小完整 mutation path，先证明 OCC primitive 正确。

### Phase 3：root `--input`

把 root user append 接入相同 mutation guard，不实现第二套 claim/precondition 逻辑。

覆盖 single-directory 与 layered output directory。

### Phase 4：root `--continue`

增加：

```text
early preflight
model request outside claim
post-model claim + recheck
assistant commit
no hook on conflict
```

冻结 `-o` / output pile / stdout 在 post-model conflict 下的既有独立语义。

### Phase 5：combined `--input --continue`

实现 derived baseline：

```text
caller expected
→ commit user
→ derive post-input baseline
→ model
→ verify derived baseline
→ commit assistant
```

单独做 integration tests，不能假定 Phase 3 + Phase 4 拼起来自然正确。

### Phase 6：cross-platform concurrency CI

建议新增专用 workflow：

```text
Node 18 / Ubuntu
Node 22 / Ubuntu
Node 18 / Windows
Node 22 / Windows
```

运行真实 child-process contention tests。

### Phase 7：docs / ecosystem boundary

更新：

- Conversation Protocol v1 concurrency section；
- CLI Contract v1；
- package README；
- Fingerprint plan 最后一项：OCC 直接消费 fingerprint primitive；
- Output Artifact Policy 中 post-model conflict 通道语义。

Receipt integration 继续留到 Receipt 自己的计划中。

---

## 25. 测试矩阵

### 25.1 Option validation

覆盖：

- malformed fingerprint token；
- uppercase fingerprint hex；
- unsupported fingerprint version；
- negative next index；
- fractional next index；
- unsafe integer；
- OCC root option 但没有 mutation；
- Layered mutation 缺少 output directory 继续沿用既有 config error。

### 25.2 append-user

覆盖：

- fingerprint match → success；
- fingerprint mismatch → exit 3 / no write；
- next-index match → success；
- next-index mismatch → exit 3 / no write；
- 两者同时 match → success；
- 任一个 mismatch → conflict；
- conflict stdout empty；
- claim cleanup 后 control file 不存在。

### 25.3 real contention

使用真实 child processes + barrier，不用随机 sleep：

```text
两个 writer
同 expected fingerprint
同 expected next index
同时尝试 commit
```

验收：

```text
success count == 1
conflict count == 1
新增 user artifact count == 1
```

在 Windows/Linux 都跑。

### 25.4 claim

覆盖：

- exclusive acquire；
- claim already exists → exit 3；
- claim metadata 不影响 fingerprint；
- wrong owner token 不允许 release；
- normal conflict 会 release own claim；
- mutation throw 会进入 finally cleanup；
- release failure 返回 exit 1；
- stale claim 不自动 TTL steal。

### 25.5 preflight

fake API server 记录请求数：

```text
preflight mismatch
→ API request count == 0
```

### 25.6 mutation during model

使用 fake delayed API：

```text
preflight passes
→ model request starts
→ another cooperative writer commits
→ model returns
→ commit-time recheck conflicts
```

验收：

- root exit 3；
- 本轮没有 assistant Conversation artifacts；
- after-hook 没有执行；
- competing writer artifact 保留；
- `-o` / output pile 行为符合第 16 节。

### 25.7 `--input --continue`

覆盖：

- F0 match；
- user append succeeds；
- derived F1 / next-index baseline 正确；
- 无外部 mutation → assistant commit success；
- 模型期间 mutation → assistant conflict；
- 已提交 user artifact 不回滚；
- 本轮 assistant artifact 不写；
- after-hook 不运行。

### 25.8 Layered output

```text
base read-only
shared read-only
session output
```

验收：

- claim 只出现在 session；
- fingerprint condition 只计算 session；
- base/shared byte-for-byte unchanged；
- base/shared mutation 不由 v1 output OCC 自动判断；
- session mutation conflict 正确。

### 25.9 idx boundary

覆盖：

```text
Number.MAX_SAFE_INTEGER - 1
Number.MAX_SAFE_INTEGER
Number.MAX_SAFE_INTEGER + 1 filename
```

验收合法范围、scanner behavior、expected-next-index parser 和 `index_exhausted` 一致。

### 25.10 crash semantics

故障注入：

```text
process acquires claim
→ exits abruptly before cleanup
```

下一次 OCC mutation：

```text
→ claim_busy
→ 不自动偷 claim
→ 不写 artifact
```

测试不自动删除残留 claim 来伪造安全恢复；test teardown 可以显式清理 fixture。

---

## 26. 验收标准

实现完成必须同时满足：

- [ ] Fingerprint precondition 直接复用 Conversation Fingerprint v1 primitive；
- [ ] OCC 不复制 scanner / hash / canonicalization；
- [ ] Fingerprint token 有唯一 parser / validator；
- [ ] idx safe-integer 数值域已在 Conversation Protocol 冻结；
- [ ] next-index allocator 是 guard 与 writer 共用的唯一 primitive；
- [ ] OCC-enabled mutation 在 authoritative check 前先 acquire exclusive claim；
- [ ] claim acquisition 使用 atomic exclusive create，不使用 `existsSync -> create`；
- [ ] claim 不覆盖模型请求时间；
- [ ] claim 不参与 Conversation Fingerprint；
- [ ] claim 不做 TTL auto-steal；
- [ ] append-user mismatch 不写 artifact；
- [ ] root preflight mismatch 不调用模型；
- [ ] post-model mismatch 不写本轮 assistant Conversation artifacts；
- [ ] post-model mismatch 不执行 after-hook；
- [ ] `--input --continue` 使用 post-input derived baseline；
- [ ] Layered OCC 只绑定 writable output directory；
- [ ] 两个 cooperative writers 从相同 expected state 竞争时最多一个 commit 成功；
- [ ] conflict 使用稳定 exit code 3；
- [ ] ordinary error 继续使用非 conflict exit semantics；
- [ ] assistant multi-file write 仍明确不承诺 transaction；
- [ ] 无 expected condition 时既有正常单 writer CLI 行为保持兼容；
- [ ] Windows / Linux real child-process contention tests 通过；
- [ ] crash/stale claim 行为有确定性测试；
- [ ] 文档明确 non-cooperative writer 不在强保证范围内。

---

## 27. Future Work

### 27.1 Structured conflict receipt

Completion Receipt 稳定后可以记录：

```json
{
  "status": "conflict",
  "conflict": {
    "kind": "fingerprint_mismatch",
    "expectedFingerprint": "...",
    "actualFingerprint": "..."
  }
}
```

但 Receipt 是观察/结果协议，不参与 claim 正确性。

### 27.2 Expected condition from file / fd

如果上层确实不希望 fingerprint 出现在 argv，可以增加：

```text
--expect-output-fingerprint-file
```

当前 token 本身不含正文且长度很短，不需要为 v1 增加复杂入口。

### 27.3 Claim inspect / clear

如果 stale claim 成为真实运维痛点，再设计显式：

```text
conversation claim inspect
conversation claim clear
```

clear 必须要求显式 operator intent，不能退化成 TTL 自动偷锁。

### 27.4 Portable atomic no-replace publication

如果需要把保护范围从 cooperative Promptpile writers 扩大到更多 non-cooperative filesystem races，可以单独研究：

- native rename-no-replace；
- same-directory hard-link publication；
- platform-specific primitives。

必须通过 Windows/Linux filesystem matrix 后才能升级 contract。

### 27.5 Layered request preconditions

未来 Layered Composite Fingerprint 若稳定，可以新增“模型请求输入视图未变化”的 request precondition。

它与 output-directory mutation OCC 是不同能力，不能混在一个 fingerprint token 中。

---

## 28. 最终实施顺序

```text
Conversation Protocol idx hardening
        ↓
Fingerprint token parser
        ↓
exclusive claim primitive
        ↓
append-user OCC
        ↓
root --input OCC
        ↓
root --continue preflight + commit-time recheck
        ↓
--input --continue derived baseline
        ↓
Windows/Linux contention CI
        ↓
CLI / Conversation contracts freeze
```

这条路线完成后，Promptpile 的 Conversation mutation 基础层形成：

```text
Inspect
  = What artifacts exist?

Fingerprint
  = What exact artifact state is this?

OCC
  = Is this still the state I expect, and can I exclusively enter the mutation commit section?
```

Fork、Completion Receipt、compression planning 等上层能力随后只消费这些 primitive，不再各自重新定义 Conversation state 与并发语义。
