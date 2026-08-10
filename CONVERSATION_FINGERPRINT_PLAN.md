# Promptpile Conversation Fingerprint 实施设计计划

> 状态：实施前冻结稿  
> 日期：2026-08-10  
> 核心提案：为一个 physical Conversation Directory 定义跨平台、确定性的强 fingerprint，作为内容身份与 optimistic concurrency 的共享只读 primitive

## 0. 结论

Conversation Fingerprint v1 只回答一个问题：

> 当前这个 physical Conversation Directory 的 Conversation Protocol 可见 artifact 状态，是否与另一个已知状态完全一致？

v1 固定为一个**只读、单物理目录、强内容 fingerprint** 能力：

```text
physical Conversation Directory
        ↓
Conversation scanner
        ↓
canonical artifact order
        ↓
raw-byte content hashes
        ↓
stable observation
        ↓
canonical binary encoding
        ↓
SHA-256 fingerprint
```

职责边界固定为：

```text
inspect       磁盘上有哪些被 scanner 识别的 artifacts；不读正文
fingerprint   这些 artifacts 的精确字节状态是什么；读取正文但不解释内容
validate      artifacts 的内容是否合法；未来独立能力
OCC           当前状态是否仍等于调用方预期；消费 fingerprint，但 fingerprint 本身不是锁
```

v1 不实现 layered composite fingerprint，不把 fingerprint 塞进 `conversation inspect`，也不把 hash 结果解释成 Conversation 的语义有效性。

---

## 1. 动机

completion、compression、fork、tool orchestration 和上层恢复流程都需要回答 Conversation 是否发生变化。

以下方式不够稳定：

- 目录 mtime；
- 单文件 mtime / ctime / inode；
- `readdir` 原始枚举顺序；
- 绝对路径；
- 调用方各自读取正文并自行 hash；
- 只比较 next idx；
- 只比较文件名和文件大小。

Promptpile 应提供一套唯一、确定性的 Conversation artifact content identity，使后续 Optimistic Concurrency、Fork、cache key 和 fixture 验证复用同一算法，而不是重复定义“Conversation 是否相同”。

---

## 2. v1 范围与基本定义

### 2.1 Physical Conversation Directory

v1 每次只检查一个已存在的 physical Conversation Directory。

它不解析 root completion 的 layered input 配置，也不接受：

```text
重复 -d
--output-dir
--insert-files
--append-files
```

这与 Conversation Protocol 的下游单目录边界保持一致。

### 2.2 Fingerprint 表示什么

Fingerprint 表示：

> Conversation scanner 识别到的全部直接子 artifact 的**精确协议路径、scanner 解释和原始文件字节状态**。

它是 artifact-state fingerprint，不是 LLM semantic prompt fingerprint。

例如：

```markdown
---
foo: bar
---
hello
```

改成：

```markdown
---
foo: baz
---
hello
```

即使 Promptpile 去掉 front matter 后交给模型的正文仍然是 `hello`，fingerprint 也必须改变，因为 artifact 原始 bytes 已变化。

### 2.3 与 Conversation Protocol 版本绑定

Fingerprint v1 绑定 Conversation Protocol v1 的：

- artifact discovery；
- artifact kind / role / extension 解释；
- canonical ordering。

如果未来 Conversation Protocol 对上述身份语义做不兼容修改，必须评审是否升级 fingerprint version；不能在保持 v1 token 的情况下静默改变 canonical identity。

---

## 3. CLI Contract v1

独立命令：

```bash
promptpile conversation fingerprint \
  -d ./messages
```

参数：

```text
-d, --directory <path>   必填；只接受一次；必须是已存在目录
--format text|json       默认 text
```

明确不采用：

```bash
promptpile conversation inspect -d ./messages --fingerprint
```

原因是 `inspect` 的稳定职责是不读取 artifact 内容，而 fingerprint 必须读取所有被识别 artifact 的原始 bytes。两者只共享 scanner / artifact protocol primitive，不共享运行成本或职责。

### 3.1 text 输出

成功时 stdout 只输出一个 fingerprint token 和换行：

```text
promptpile-conversation-v1:sha256:<64-lowercase-hex>
```

例如：

```text
promptpile-conversation-v1:sha256:0123456789abcdef...
```

不得混入普通日志、目录路径或解释性文字。

### 3.2 JSON 输出

```json
{
  "schemaVersion": 1,
  "fingerprintVersion": 1,
  "algorithm": "sha256",
  "artifactCount": 17,
  "maxIndex": 8,
  "fingerprint": "promptpile-conversation-v1:sha256:..."
}
```

字段语义：

```ts
interface ConversationFingerprintResult {
  schemaVersion: 1;
  fingerprintVersion: 1;
  algorithm: 'sha256';
  artifactCount: number;
  maxIndex: number | null;
  fingerprint: string;
}
```

JSON 不包含调用者提供的 `directory`，也不包含 canonical absolute path。这样同一 physical directory 通过：

```text
messages
./messages
绝对路径
目录 symlink / junction alias
```

访问时，只要最终被 scanner 观察到的协议 artifact 状态相同，fingerprint 结果不因 display path 改变。

JSON formatter 固定使用：

```ts
JSON.stringify(result, null, 2) + '\n'
```

### 3.3 failure

失败时：

- 非零退出；
- stdout 必须为空；
- stderr 输出简短诊断；
- 不输出部分 fingerprint；
- 不要求 API key；
- 不加载 completion config、LLM、tools 或 after-hook。

v1 不要求为不同 fingerprint failure 分配稳定专用 exit code。后续 OCC 应直接复用内部 fingerprint primitive，而不是解析 fingerprint CLI 的 stderr 文本。

---

## 4. Artifact inclusion

Fingerprint 只覆盖当前 Conversation scanner 识别到的直接子文件。

包括：

```text
[idx]{role}.md
[idx]{role}.json
[idx]assistant.calls.jsonl
[idx]assistant.extra.json
[idx]assistant.result.jsonl
```

是否参与 fingerprint 只由 scanner discovery 决定。

### 4.1 malformed 内容仍参与

只要 scanner 识别文件名，artifact 就参与 fingerprint，即使：

- `.json` 内容不是合法 JSON；
- calls/result 不是合法 JSONL；
- assistant sidecar 缺少对应 assistant.md；
- calls 缺少 result；
- 内容会在未来 validate 中产生 diagnostic。

Fingerprint 不解析这些内容，也不判断 valid / pending / partial / complete。

### 4.2 不参与

以下内容不参与 v1 fingerprint：

- scanner 未识别的文件；
- nested directory 中的协议文件；
- lock 文件；
- 临时文件；
- receipt；
- archive metadata；
- mtime / ctime；
- inode / file id；
- permission bits；
- absolute directory path；
- Conversation 目录自身 metadata；
- `--insert-files` / `--append-files`。

文件级 symlink 是否被扫描继续完全服从现有 `scanDirectory()` 的 `Dirent` 行为；Fingerprint 不增加第二套 symlink discovery 规则。

---

## 5. Canonical ordering：实现前置条件

Fingerprint 不得复制一套 filename parser 或 comparator。

在实现 Fingerprint 前，Conversation Protocol 必须拥有唯一的 deterministic scanner comparator，并由 `scanDirectory()` 与 Fingerprint 共用。

### 5.1 排序主键

排序语义保持 Conversation Protocol v1：

```text
1. idx ascending
2. artifact tier ascending
3. role canonical byte order
4. relativePath canonical byte order
```

artifact tier 必须直接复用 scanner 的正式协议定义，不在 Fingerprint 内重新推导。

### 5.2 字符串 comparator

现有 `localeCompare()` 不作为 fingerprint canonical identity 的规范基础。

v1 冻结字符串比较为：

> UTF-8 编码后的 unsigned bytes，按 lexicographic ascending 比较。

Node 实现等价于：

```ts
Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
```

不得依赖：

- OS locale；
- Node / ICU locale 默认值；
- case folding；
- Unicode normalization；
- 平台文件系统的大小写规则。

例如 role / filename 的 Unicode normalization form 不同，即使视觉上相同，也按不同 byte sequence 处理。

### 5.3 relativePath

Fingerprint 使用 scanner 提供的精确 `relativePath`，协议表示统一使用 `/` 作为 separator。

当前 scanner 只扫描 direct child，因此正常 artifact path 不含目录 separator；仍然明确 `/` 协议形式，以避免未来实现把平台 `\\` 写入 canonical bytes。

`[1]user.md` 与 `[01]user.md` 必须保持两个独立 artifact；二者可以拥有相同 parsed index，但 exact path 不同，因此最终 fingerprint 会区分。

### 5.4 Phase 0 protocol hardening

如果在冻结 comparator 时发现 Conversation Protocol 文档与当前 scanner 在边界排序或 artifact tier 上存在差异，必须先在 Conversation Protocol 中解决，再生成 Fingerprint golden fixtures。

Fingerprint 不承担“顺便修正 scanner”的职责。

---

## 6. Artifact Observation Record

每个被识别 artifact 先映射成内部 observation record：

```ts
interface FingerprintArtifactObservation {
  relativePath: string;
  kind:
    | 'message'
    | 'assistant_call'
    | 'assistant_extra'
    | 'assistant_result';
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  byteLength: bigint;
  contentSha256: Uint8Array; // exactly 32 bytes
}
```

`idx` 不重复编码进最终 canonical record：

- exact `relativePath` 已保留原始 `[1]` / `[01]` 差异；
- scanner 的 parsed idx 只负责 canonical ordering 与 `maxIndex` summary；
- 避免为既有 JS numeric idx 再引入新的整数序列化兼容面。

`kind`、`role`、`extension` 虽然可从文件名推导，仍进入 canonical record，用于绑定 scanner 对 artifact 的协议解释。

---

## 7. 原始文件内容 hashing

每个 artifact 的：

```text
contentSha256 = SHA-256(raw file bytes)
```

必须对原始 bytes 做 streaming hash。

不得：

- 以 UTF-8 string 重新编码后 hash；
- strip BOM；
- strip YAML front matter；
- parse / stringify JSON；
- normalize line endings；
- trim whitespace；
- 解析 calls / result 后重新编码。

`byteLength` 是实际读取到并参与该次 content hash 的 raw byte 数量。

实现目标：

```text
时间复杂度：O(total recognized artifact bytes)
额外内存：O(artifact count)，不随所有正文总大小线性增长
```

---

## 8. Canonical binary encoding v1

Fingerprint v1 不依赖普通 JSON serialization 作为 hash 输入。

所有整数使用 unsigned big-endian。

所有字符串使用 UTF-8 原始 bytes，不做 Unicode normalization。

### 8.1 domain header

canonical byte stream 以固定 ASCII domain separator 开始：

```text
promptpile-conversation-fingerprint-v1\0
```

即该 ASCII 字符串后跟一个 `0x00` byte。

### 8.2 artifact count

随后写入：

```text
artifactCount: u64 big-endian
```

### 8.3 artifact record

每个 artifact 按 canonical order 写入：

```text
recordMarker:       u8 = 0x01
relativePathLength: u32 big-endian
relativePath:       UTF-8 bytes
kind:               u8
roleLength:         u32 big-endian
role:               UTF-8 bytes
extension:          u8
byteLength:         u64 big-endian
contentSha256:      32 raw bytes
```

### 8.4 enum codes

`kind`：

```text
0x00 message
0x01 assistant_call
0x02 assistant_extra
0x03 assistant_result
```

`extension`：

```text
0x00 md
0x01 json
0x02 jsonl
```

未知 enum 值不是 v1 canonical encoding 的合法输入。

### 8.5 final digest

最终：

```text
conversationDigest = SHA-256(canonicalByteStream)
```

对外 token：

```text
promptpile-conversation-v1:sha256:<lowercase-hex-digest>
```

canonical byte stream 不包含：

- absolute path；
- display directory；
- canonical realpath；
- mtime / ctime；
- inode；
- layer index；
- OS / runtime version。

---

## 9. Stable Observation

### 9.1 不承诺 filesystem transaction

Fingerprint 是 stable observation，不是：

- 文件系统锁；
- 多文件事务；
- 线性化 snapshot；
- CAS；
- writer lease。

在没有合作锁的普通文件系统上，命令无法证明“返回 fingerprint 的那个瞬间目录一定没有变化”。因此 v1 不使用“读取期间任何 mutation 都必然被检测”这种无法完全兑现的承诺。

它提供的可实现保证是：

> 只有连续两次完整的强 observation 得到完全相同的协议 artifact state 时，才返回 fingerprint。

### 9.2 单次 observation

一次 `collectObservation(directory)`：

1. 调用 `scanDirectory()` 得到 `scanStart`；
2. 使用 canonical scanner order；
3. 对 `scanStart` 中每个 artifact 打开并 streaming 读取原始 bytes，计算 `byteLength + SHA-256`；
4. 任一文件在读取时不存在或不可读，observation 失败；
5. 完成后再次 `scanDirectory()` 得到 `scanEnd`；
6. 比较 `scanStart` 与 `scanEnd` 的 artifact refs / scanner interpretation；
7. 如果 artifact 集合或顺序发生变化，返回 `unstable`；
8. 否则返回完整 observation records。

这里不依赖 mtime/ctime 证明内容稳定。

### 9.3 双 observation

完整 fingerprint 计算：

```text
A = collectObservation(directory)
B = collectObservation(directory)
```

只有当 A 与 B 的 canonical observation records 完全一致，包括：

```text
relativePath
kind
role
extension
byteLength
contentSha256
```

才认为 observation stable，并根据该 record set 生成 fingerprint。

任何差异：

```text
→ unstable
→ nonzero exit
→ stdout empty
→ 不返回 fingerprint
```

v1 不自动 retry。需要重试的上层可以显式重新调用。

### 9.4 保证边界

如果 writer 在两个 observation 完成之后再次修改目录，旧 fingerprint 自然立即变成旧版本；这不是算法错误。

如果目录经过中间 mutation 后恢复为完全相同的协议 artifact bytes，最终 fingerprint 相同也是正确语义：Fingerprint 描述状态，不描述历史事件。

---

## 10. Empty Conversation

空目录是合法 Conversation state：

```json
{
  "schemaVersion": 1,
  "fingerprintVersion": 1,
  "algorithm": "sha256",
  "artifactCount": 0,
  "maxIndex": null,
  "fingerprint": "promptpile-conversation-v1:sha256:<golden>"
}
```

空目录 fingerprint 必须作为 v1 golden fixture 固定下来。

以后任何实现语言都必须得到相同 token。

---

## 11. Failure semantics

至少覆盖以下失败类别：

```text
invalid_directory
artifact_unreadable
unstable_observation
internal_encoding_error
```

这些类别第一版可以只作为内部结构化 error type；CLI 对外保持：

```text
success → exit 0
failure → nonzero
```

错误 diagnostic：

- 写 stderr；
- 可以包含 artifact relative path / canonical filesystem path 以定位问题；
- 不输出 artifact 正文；
- 不输出 API key、tool arguments 或其它 secret；
- stdout 在 failure 时必须保持为空。

不允许“跳过不可读 artifact 后继续算 hash”，因为那会让同一个 protocol state 在不同权限上下文得到错误的成功 fingerprint。

---

## 12. Security / privacy

Fingerprint 读取完整 artifact bytes，但正常输出只包含：

- count；
- max index；
- hash token。

默认不得输出：

- assistant / user 正文；
- reasoning；
- tool arguments；
- result 内容；
- 每文件 content hash 列表。

SHA-256 fingerprint 不是访问控制机制，也不等同于 secret-safe opaque identifier。调用方不应把它当作敏感正文的加密保护。

---

## 13. 与现有能力的边界

### 13.1 Conversation Inspect

Inspect：

```text
scanDirectory
→ artifact inventory
→ 不读取 artifact 内容
```

Fingerprint：

```text
scanDirectory
→ raw-byte hashing
→ stable observation
→ canonical fingerprint
```

两者共享 scanner / protocol comparator，但 Fingerprint 不建立在 Inspect JSON serialization 上，也不把 Inspect 的 `directory` display string 放入 hash。

### 13.2 Layered Conversation I/O

v1 不提供：

```text
layer fingerprints array
composed fingerprint
layer label
output-layer-aware combined token
```

调用方现在可以分别对：

```text
base
shared
session
```

各自执行 single-directory fingerprint，并保留有序 token list。

未来若确实需要 composed fingerprint，应单独冻结 domain-separated ordered-layer encoding，且不能包含机器相关绝对路径。

### 13.3 Optimistic Concurrency

OCC 可以消费：

```bash
--expect-fingerprint promptpile-conversation-v1:sha256:...
```

但 Fingerprint 只提供 expected state identity。

它**不单独保证**：

> 两个竞争 writer 检查到相同 fingerprint 后最多一个 commit 成功。

真正的并发提交仍需要 OCC 设计中的原子 claim / no-replace / CAS 等写入机制解决 TOCTOU。

### 13.4 Fork / cache / recovery

Fingerprint 可以作为：

- fork source precondition；
- immutable fixture identity；
- cache key 的一部分；
- restore 后状态检查；
- compression planning precondition。

但它不取代 archive manifest、receipt 或 provenance metadata。

---

## 14. 非目标

v1 明确不做：

- validate；
- tool completeness check；
- weak filename/size-only fingerprint；
- incremental hash cache；
- filesystem watcher；
- write lock；
- multi-file transaction；
- layered composite fingerprint；
- hash ignored files；
- semantic prompt fingerprint；
- hash API config、model、tools、insert/append files；
- 把 fingerprint artifact 写回 Conversation Directory；
- 公共稳定 TypeScript library API。

---

## 15. 实施阶段

### Phase 0：冻结 deterministic Conversation comparator

先完成协议基础，不开始 hashing：

- 把 scanner comparator 提取为唯一可复用 primitive；
- 用 UTF-8 byte lexicographic order 替代 `localeCompare()`；
- 更新 Conversation Protocol v1；
- 明确现有 scanner 与 contract 的 artifact tier / assistant edge cases；
- 增加 ASCII、Unicode、大小写、`[1]` / `[01]`、calls/extra/result 排序 golden tests；
- 确认 Windows / Linux 得到完全一致顺序。

验收：Fingerprint 后续不需要自己排序或解析 filename。

### Phase 1：pure canonical core

新增建议模块：

```text
packages/promptpile/src/conversation-fingerprint.ts
```

负责：

- observation types；
- raw-byte streaming SHA-256；
- canonical binary encoder；
- final fingerprint token builder；
- pure JSON/text formatter。

canonical encoder 应能直接接受 synthetic observation fixture，不依赖文件系统，以便做 byte-level golden test。

### Phase 2：stable observation collector

实现：

```text
scan → hash → rescan
× 2 observations
→ compare
```

增加 deterministic mutation injection seam，测试不能依赖 timing race / sleep。

### Phase 3：CLI wiring

增加：

```bash
promptpile conversation fingerprint -d <directory> [--format text|json]
```

要求：

- 独立 conversation domain handler；
- 不调用 `resolveConfig()`；
- 不读取 API key；
- 不加载 tools；
- 不调用模型或 after-hook；
- failure stdout 为空。

### Phase 4：跨平台 golden CI

在 Windows / Linux 至少固定：

- canonical order fixture；
- canonical encoded bytes fixture；
- empty directory fingerprint；
- populated directory fingerprint；
- Unicode role / filename fixture。

同一个 fixture 的 token 必须逐字符相同。

### Phase 5：消费者接入

Fingerprint v1 本身稳定后，再推进：

- `CONVERSATION_OPTIMISTIC_CONCURRENCY_PLAN.md`；
- Fork precondition；
- compression planning guard；
- 可选 layered composite design。

消费者不得复制 fingerprint 算法。

---

## 16. 测试矩阵

至少覆盖：

### Discovery / identity

- 空目录；
- system/user/assistant/custom role；
- assistant calls/extra/result；
- malformed JSON / JSONL 仍成功；
- sidecar 没有 assistant.md 仍参与；
- nested protocol file 被忽略；
- unknown file 被忽略；
- 大写扩展名按 scanner 当前规则忽略；
- `[1]user.md` 与 `[01]user.md` 同时存在并产生稳定、不同于删除任一文件后的 fingerprint。

### Determinism

- 相同 artifact bytes 在 Windows / Linux token 相同；
- readdir 原始枚举顺序不影响结果；
- cwd 不同不影响结果；
- display path 写法不同不影响结果；
- mtime / ctime 变化不影响结果；
- ignored file 增删改不影响结果；
- recognized artifact 任意一 byte 改变会改变 fingerprint；
- recognized artifact rename 会改变 fingerprint；
- artifact kind / extension 变化会改变 fingerprint；
- line ending 变化会改变 fingerprint；
- BOM 变化会改变 fingerprint；
- front matter-only 变化会改变 fingerprint。

### Stable observation

- A/B 相同返回 fingerprint；
- 两次 observation 间新增 recognized artifact → unstable；
- 删除 artifact → unstable；
- rename artifact → unstable；
- 同 size 原地内容变化 → unstable；
- artifact 读取失败 → failure，不跳过；
- mutation 后恢复到相同最终 bytes，可以返回相同状态 fingerprint；
- mutation injection 使用确定性 test seam，不依赖随机 race。

### Encoding

- canonical encoder byte-for-byte golden fixture；
- enum code 固定；
- u32/u64 big-endian fixture；
- UTF-8 Unicode role fixture；
- empty artifact set golden digest；
- token 固定为 lowercase hex；
- JSON 可以直接 `JSON.parse()` 且只有一个 document。

### Runtime boundary

- 无 API key 成功；
- cwd 中存在非法 completion TOML 仍成功；
- 不加载 tools；
- 不调用 LLM；
- 不执行 hook；
- 命令前后目录文件集合与内容 byte-for-byte 不变。

---

## 17. 验收标准

实现完成必须同时满足：

- [ ] v1 一次只 fingerprint 一个 physical Conversation Directory；
- [ ] Fingerprint 是独立 command，不破坏 Inspect 的 no-content-read contract；
- [ ] artifact discovery 100% 复用 Conversation scanner；
- [ ] scanner 使用 locale-independent deterministic comparator；
- [ ] Fingerprint 不实现第二套 filename parser / comparator；
- [ ] 所有 scanner-recognized artifacts 都参与，无论内容是否合法；
- [ ] ignored / nested / non-protocol 文件不参与；
- [ ] artifact 内容按 raw bytes streaming SHA-256；
- [ ] canonical binary encoding 有 byte-level golden fixture；
- [ ] empty directory fingerprint 被固定为 golden；
- [ ] Windows / Linux 对相同 fixture 产生相同 token；
- [ ] absolute path、cwd、mtime、枚举顺序不影响 fingerprint；
- [ ] recognized artifact 任意 byte 或 exact path 变化会改变 fingerprint；
- [ ] 只有两个连续强 observation 完全一致时才返回结果；
- [ ] unstable / unreadable 时不返回部分 fingerprint；
- [ ] failure stdout 为空；
- [ ] 命令不要求 completion config、API key、tools、LLM 或 hook；
- [ ] 算法内存使用不随全部正文总大小线性增长；
- [ ] Fingerprint 文档明确声明其不是锁、CAS、事务或线性化 snapshot；
- [ ] OCC 只消费该 fingerprint primitive，不复制算法。

---

## 18. Future Work

以下能力明确推迟，不阻塞 v1：

### 18.1 Layered composite fingerprint

未来可定义：

```text
ordered per-layer fingerprint tokens
→ domain-separated composite encoding
→ composite fingerprint
```

要求 layer 顺序参与 identity，但 canonical absolute path 不参与。

### 18.2 Incremental cache

大型 archive / Conversation 若 hashing 成本成为真实瓶颈，再评估：

- trusted manifest cache；
- content-addressed artifact cache；
- incremental verification。

不得用 mtime/size-only cache 静默降低 strong fingerprint 语义。

### 18.3 Weak fingerprint

只有出现明确性能需求时再设计 weak identity，并必须使用不同 algorithm/version token，不能与 strong v1 混淆。

### 18.4 Public protocol package

如果多个 package 或外部实现需要独立计算 fingerprint，再把：

- comparator；
- observation record schema；
- canonical encoder；
- token parser；

迁移到后续 Protocol Package。v1 不因未来复用而提前扩张公共 API。

---

## 19. 最终架构位置

完成后，Conversation read / identity / validation / mutation 的层次应保持：

```text
Conversation Protocol scanner
        ↓
Inspect
What artifacts exist?
        ↓
Fingerprint
What exact artifact state is this?
        ↓
Validate
Are those artifacts semantically valid?
        ↓
Optimistic Concurrency
Is the current state still the state I expected before mutation?
```

Fingerprint 的设计目标不是做最多事情，而是成为一个足够小、足够强、跨平台确定、后续能力可以长期复用的 Conversation content identity primitive。
