# Promptpile Conversation Fork v1 实施闭环设计

> 状态：v1 实现完成，等待 dedicated cross-platform matrix 后 Freeze
> 初始设计日期：2026-08-07  
> 闭环设计更新：2026-08-12  
> 核心提案：`promptpile-fork` 提供一个不调用模型、只读源 Conversation、按显式 index cutoff 创建 byte-exact 独立物理快照的 domain operation；最终 target 只通过一次 terminal directory publication 对外可见。

---

## 0. 最终架构结论

Conversation Fork v1 不是通用目录复制，不是 Conversation merge，也不是 layered materializer。

v1 的唯一语义是：

```text
single physical source Conversation
        │
        │ direct regular Conversation Protocol artifacts
        │ whose numeric idx <= throughIndex
        ▼
stable selected-prefix observation
        │
        │ byte-exact copy
        ▼
private same-parent staging directory
        │
        │ staging verification
        ▼
selected-prefix re-observation
        │
        │ same selected prefix still holds
        ▼
terminal directory rename
        │
        ▼
complete target Conversation
```

核心 correctness theorem：

```text
promptpile-fork success
⇒ target 由一次完整 publication 产生
⇒ target 只包含 source 中 idx <= throughIndex 的 direct regular protocol artifacts
⇒ 每个目标 artifact 的 basename 与 source 完全相同
⇒ 每个目标 artifact 的 bytes 与 source baseline 完全相同
⇒ target selected-prefix fingerprint == source selected-prefix fingerprint
⇒ Fork 没有修改 source
⇒ publication 后没有任何仍可把 domain success 翻转为 failure 的必需阶段
```

失败不变量：

```text
failure before terminal publication
⇒ source untouched
⇒ final target absent
```

并发增长不变量：

```text
source 仅新增 / 修改 idx > throughIndex
≠ selected-prefix conflict
≠ Fork failure
```

这三个不变量共同定义 Fork v1 的闭环边界。

---

## 1. 动机

用户可能需要：

- 从历史 index 创建实验分支；
- 冻结测试 fixture；
- 为独立压缩、迁移或调试创建物理副本；
- 在不改变原 Conversation 的情况下保留一个稳定 prefix。

手工复制容易：

- 漏掉同 idx 的 assistant sidecars；
- 把 lock、临时文件、Receipt、debug dump 一起复制；
- 在复制过程中读到混合版本；
- 暴露半完成 target；
- 错误地把 source 后续正常 append 当成 conflict。

Layered Conversation I/O 已经能够表达“只读 base + 新 output”的轻量逻辑分支；Fork 只服务于**需要独立物理 Conversation 副本**的场景。

---

## 2. Domain ownership

Fork v1 的 owner 是独立 package：

```text
packages/promptpile-fork
```

它不得被重新塞回 `packages/promptpile` core runtime。

推荐 dependency direction：

```text
promptpile-protocol
        ▲
        │ public pure protocol primitives
        │
promptpile-fork
        │
        ├─ filesystem observation
        ├─ target validation
        ├─ claim
        ├─ staging
        ├─ verification
        └─ publication
```

Fork 不得 import：

```text
promptpile/src/*
promptpile/dist/*
promptpile-compress/src/*
任何 sibling package 私有实现路径
```

Fork 可以依赖已发布 / workspace-resolved 的 `promptpile-protocol` public exports。

---

## 3. v1 scope

v1 只实现：

```text
single physical Conversation directory
+ explicit throughIndex
+ direct regular protocol artifact selection
+ byte-exact copy
+ stable selected-prefix verification
+ private staging
+ one terminal target publication
+ dry-run plan/report
```

v1 必须具备独立 CLI binary：

```text
promptpile-fork
```

v1 不依赖模型、API key、MCP、compression provider 或 Promptpile root CLI。

---

## 4. Explicit non-goals

v1 明确不做：

- merge 两个 Conversation；
- rewrite / compact / renumber idx；
- layered Conversation flatten/materialize；
- Archive Protocol 历史复制；
- compression / restore；
- tool execution；
- Completion；
- semantic repair；
- 自动补全 missing result；
- 自动修复 malformed JSON / JSONL；
- hardlink / reflink / copy-on-write；
- `--force` / overwrite / merge-existing-target；
- stale claim 自动回收；
- crash residual 自动恢复；
- filesystem metadata clone；
- portable archive/export format。

这些能力若未来真实需要，必须作为独立 operation / protocol evolution 设计，不能通过给 Fork v1 增加隐式分支语义解决。

---

## 5. Protocol dependency boundary

Fork 对 Conversation artifact lexical semantics 必须使用：

```text
promptpile-protocol/conversation
```

至少包括：

- `parseConversationIndexV1`；
- `classifyConversationArtifactNameV1`；
- `compareConversationArtifactsV1`。

Fork 不得复制 Conversation filename regex 或排序逻辑。

### 5.1 Fingerprint prerequisite

Fork 是 Conversation Fingerprint canonical semantics 的第二个真实 consumer，因此允许触发 Fingerprint protocol primitive 的准入。

应将现有 Fingerprint 中**纯 canonical 部分**抽到：

```text
promptpile-protocol/fingerprint
```

建议 public surface：

```ts
export interface FingerprintArtifactObservationV1 {
  relativePath: string;
  kind: ConversationArtifactFileKindV1;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  byteLength: bigint;
  contentSha256: Uint8Array;
}

export function encodeConversationFingerprintV1(
  records: readonly FingerprintArtifactObservationV1[]
): Uint8Array;

export function digestConversationFingerprintV1(
  records: readonly FingerprintArtifactObservationV1[]
): Uint8Array;

export function buildConversationFingerprintTokenV1(
  digest: Uint8Array
): string;

export function parseConversationFingerprintTokenV1(
  value: string
): string;
```

不得迁入 protocol package：

- filesystem scan；
- read stream；
- two-pass observation；
- retry；
- source stability policy；
- Fork-specific cutoff selection。

这些继续由各 runtime owner 实现。

若 Fingerprint pure primitive 尚未发布，Fork runtime implementation Phase 1 不得通过 private import `promptpile` 来绕过该 prerequisite。

---

## 6. Source Conversation model

Fork v1 只接受一个**单物理目录** source。

source 必须：

- 存在；
- 是 directory；
- 可读取 direct entries；
- 可读取所有被选择的 protocol artifacts。

v1 不接受 layered source list。

source scanner 只考虑 source 根目录中的：

```text
direct
regular file
Conversation Protocol recognized basename
```

明确忽略：

- nested directory；
- nested file；
- symlink；
- socket / fifo / device；
- 非协议 regular file；
- lock；
- temp；
- Receipt；
- debug dump；
- archive directory / manifest；
- Fork 自己的 claim/staging metadata。

Fork 不递归。

---

## 7. Selection semantics

用户必须显式提供：

```text
--through-index <n>
```

其中 `n` 必须是：

```text
0 <= n <= Number.MAX_SAFE_INTEGER
```

并遵守 Conversation Protocol v1 index lexical/numeric semantics。

被选择 artifact 集合定义为：

```text
SelectedPrefix(source, n)
=
source direct regular protocol artifacts
whose parsed numeric idx <= n
```

`throughIndex` 是**inclusive cutoff**。

例如：

```text
[12]assistant.md
[12]assistant.calls.jsonl
[12]assistant.extra.json
[12]assistant.result.jsonl
```

只要这些文件存在且被 protocol scanner 识别，在：

```text
--through-index 12
```

下必须全部属于 selection。

Fork 不允许基于 artifact kind 再拆同一 idx。

---

## 8. Leading zero / casing semantics

Fork 依据 numeric idx 做 cutoff，但复制时 basename 必须原样保留。

例如：

```text
[01]User.md
```

其 numeric idx 为 `1`，所以 `--through-index 1` 会选中它；target 中仍必须叫：

```text
[01]User.md
```

而不是 canonicalize 成：

```text
[1]User.md
```

同样：

- role casing 原样保留；
- extension casing 只按 protocol classifier 是否认可决定；
- Fork 不做 rename normalization。

---

## 9. Byte-preserving contract

Fork 是 lexical / byte-preserving operation，不是 semantic validator。

对每个 selected artifact，只承诺：

```text
source basename == target basename
source raw bytes == target raw bytes
```

Fork 不解析或修复：

- Markdown body；
- YAML front matter；
- calls JSON/JSONL；
- result JSONL；
- assistant.extra JSON；
- tool-call/result completeness。

因此：

```text
malformed but protocol-recognized artifact
→ 仍可被 byte-exact fork
```

Fork 成功不等于 Conversation semantic completeness；它只证明所选 lexical artifact snapshot 被一致复制。

---

## 10. Filesystem metadata non-contract

Fork v1 不保证复制：

- mtime；
- ctime；
- atime；
- inode；
- uid/gid；
- ACL；
- xattr；
- filesystem compression flags；
- hardlink identity；
- sparse-file layout。

Fork v1 的 durable domain artifact 是**basename + bytes**，不是 filesystem clone。

因此 v1 不暴露 `--copy-mode`。

---

## 11. Stable selected-prefix observation

Fork 不 fingerprint 整个不断增长的 source Conversation。

它只观察：

```text
SelectedPrefix(source, throughIndex)
```

每条 baseline record 至少包含：

```ts
interface ForkSourceArtifactObservationV1 {
  relativePath: string;
  idx: number;
  fileKind: ConversationArtifactFileKindV1;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  byteLength: bigint;
  contentSha256: Uint8Array;
}
```

records 必须使用 protocol comparator 排序。

Fork runtime 自己负责 filesystem observation；Fingerprint protocol primitive 只负责 canonical encoding / digest。

---

## 12. Source stability semantics

Fork 的 source consistency 保护范围是 selected prefix，不是整个 source directory。

执行必须形成：

```text
A. baseline selected-prefix observation
        ↓
B. copy baseline artifacts to staging
        ↓
C. verify staging against baseline
        ↓
D. selected-prefix re-observation
        ↓
E. require D == A
```

只有 A/D 完全一致，才允许 publication。

### 12.1 必须判为 conflict

在 observation window 中，下列变化发生在 `idx <= throughIndex` 时必须失败：

- selected artifact 新增；
- selected artifact 删除；
- selected artifact rename；
- selected artifact bytes 变化；
- selected artifact lexical metadata 变化。

统一错误语义：

```text
source_unstable
```

### 12.2 不应判为 conflict

只发生在：

```text
idx > throughIndex
```

的新增、修改或删除不属于当前 Fork snapshot contract。

最重要 regression invariant：

```text
append above cutoff
→ Fork may still succeed
```

Fork 不应错误地成为整个 Conversation 的 OCC writer/read barrier。

---

## 13. Selected-prefix fingerprint

Fork report 中的 fingerprint 表示 selected prefix，而不是整个 source。

字段名固定为：

```text
sourcePrefixFingerprint
```

禁止使用容易误解的：

```text
sourceFingerprint
```

若使用 Conversation Fingerprint v1 canonical encoder，则：

```text
sourcePrefixFingerprint
=
fingerprint(canonical ordered selected-prefix observations)
```

成功时必须满足：

```text
baseline sourcePrefixFingerprint
== staging fingerprint
== target fingerprint immediately after publication
```

Fingerprint token 使用被冻结的 Conversation Fingerprint token form；不得另造 Fork-specific hash string grammar。

---

## 14. Source / target canonical identity

source 与 target 的 physical ownership 必须在写入前解析。

### 14.1 source identity

source 已存在，因此使用 canonical realpath identity。

### 14.2 target identity

target 必须不存在，因此 target identity 由：

```text
canonical realpath(target parent)
+
target basename
```

构造。

### 14.3 必须拒绝

Fork 在任何 write side effect 前必须拒绝：

```text
source == target

target is inside source

source is inside target
```

Windows canonical identity comparison 按 case-insensitive 规则处理。

不允许用纯字符串 path comparison 代替 canonical identity。

---

## 15. Target non-existence invariant

Fork v1 最终 target：

```text
MUST NOT EXIST
```

不接受“已存在但为空目录”。

如果 target 已存在，无论是：

- file；
- directory；
- symlink；
- 其他 filesystem entry；

都必须在 copy/staging 前失败：

```text
target_exists
```

v1 没有：

```text
--force
--overwrite
--merge
```

这样 target publication 保持单一 ownership。

---

## 16. Target parent contract

target parent 必须：

- 已存在；
- 是 directory；
- source/target identity 校验通过；
- staging 与 target 最终处于同一 parent directory。

v1 不自动递归创建 target parent。

这样 staging → target publication 可以保持同-parent rename topology。

---

## 17. Target claim

Fork 对同一 canonical target 必须有 cooperating-writer claim。

claim 必须在 target parent 中，以 exclusive create 获得。

推荐 logical naming：

```text
.promptpile-fork.claim.<sha256(canonical-target-identity)>
```

具体 filename encoding 可以作为 internal implementation detail，但必须满足：

```text
same canonical target
→ same claim identity

different canonical target
→ independent claim identity
```

claim metadata 可以包含诊断信息，例如：

```json
{
  "schemaVersion": 1,
  "pid": 1234,
  "target": "..."
}
```

metadata 不是公共协议。

### 17.1 v1 stale policy

v1 不自动回收 stale claim。

```text
claim exists
→ target_claimed
→ fail closed
```

不要在 v1 引入 hostname/PID/age stale recovery state machine。

### 17.2 claim cleanup

publication 前 failure：

```text
best-effort release claim
```

publication 成功后：

```text
best-effort release claim
```

**publication 成功后的 claim cleanup failure 不得把 Fork domain success 翻转为 failure。**

可以输出 warning / diagnostic，但 final target 已经是成功 durable outcome。

---

## 18. Private staging

Fork 不允许逐文件直接写入 final target。

必须在 target parent 中创建唯一 private staging directory，例如：

```text
.promptpile-fork.staging.<random>
```

staging 必须：

- 与 target 同 parent；
- 创建时 target 仍不存在；
- 不使用 protocol-looking target name；
- 不进入 source Conversation；
- 普通失败时 best-effort cleanup。

staging 是 implementation artifact，不是公共协议。

---

## 19. Copy algorithm

对 baseline 中每个 selected artifact：

1. 从 baseline-recorded source path 读取 bytes；
2. 写到 staging 中同 basename 文件；
3. 不重写内容；
4. 不修改 basename；
5. 同时计算 staged byteLength / SHA-256；
6. staged artifact 必须与 baseline record 一致。

copy order 使用 protocol comparator，便于 deterministic diagnostics/tests；correctness 不依赖 filesystem enumeration order。

Fork 不需要为 staging 中每个单文件再实现公开 atomic rename，因为 staging 本身尚未对外发布；真正 public commit point 是整个 staging directory 的 final rename。

实现仍应避免留下打开的 file handle，并在进入 verification 前关闭所有 staged files。

---

## 20. Staging verification

copy 完成后，必须重新 scan staging，并构造 staging observation。

要求：

```text
staging artifact set == baseline artifact set
```

且每条：

```text
relativePath identical
idx identical
fileKind identical
role identical
extension identical
byteLength identical
contentSha256 identical
```

然后：

```text
staging fingerprint == baseline sourcePrefixFingerprint
```

不允许只相信 write loop 成功返回。

verification mismatch：

```text
staging_verify_failed
```

不得 publication。

---

## 21. Source re-observation

staging 验证成功后、publication 前，必须重新观察：

```text
SelectedPrefix(source, throughIndex)
```

require：

```text
final source selected-prefix observation
== baseline selected-prefix observation
```

如果不一致：

```text
source_unstable
```

final target 保持不存在。

---

## 22. Terminal publication commit point

Fork v1 只有一个 public commit point：

```text
rename(stagingDirectory, targetDirectory)
```

rename 必须发生在同 parent directory 下。

状态机：

```text
resolve arguments
  ↓
validate source/target identities
  ↓
acquire target claim
  ↓
build stable selected-prefix baseline
  ↓
create private staging
  ↓
copy selected artifacts
  ↓
verify staging
  ↓
re-observe selected source prefix
  ↓
verify source still equals baseline
  ↓
FINAL DIRECTORY RENAME
  ↓
domain success
  ↓
best-effort cleanup / diagnostics only
```

关键 invariant：

```text
before final rename
→ final target absent

after final rename
→ final target complete
```

publication 成功后不得再执行任何可能被定义为 required/fatal domain stage 的工作。

---

## 23. Atomic visibility / durability boundary

v1 的目标是：

```text
same-parent directory rename
→ single namespace publication boundary
```

这提供目标 filesystem 上的 atomic visibility expectation，但文档不得过度承诺：

- 不保证所有 filesystem / network filesystem 都具有相同 rename 语义；
- 不宣称 universal power-loss durability；
- parent directory fsync 若实现，只能按平台能力 best-effort；
- Windows/POSIX 的目录 fsync 能力不同。

Fork v1 的冻结保证是**不主动将 partial final target 作为正常执行状态暴露**，而不是宣称对任意 crash/filesystem 都有事务数据库级 durability。

---

## 24. Failure model

v1 所有普通 domain / validation failure 使用 process exit code：

```text
1
```

成功：

```text
0
```

v1 不新增 OCC-style 特殊 conflict exit code。

建议稳定 error codes：

```text
invalid_arguments
invalid_source
invalid_through_index
invalid_target_parent
path_overlap
target_exists
target_claimed
artifact_unreadable
source_unstable
staging_create_failed
staging_write_failed
staging_verify_failed
publication_failed
```

错误 message 可以演进，但 machine-facing JSON `code` 一旦发布后需要按兼容性规则维护。

---

## 25. Failure matrix

| Failure point | Source | Final target | Staging | Exit |
|---|---|---|---|---|
| invalid CLI | untouched | absent | none | 1 |
| invalid source | untouched | absent | none | 1 |
| invalid cutoff | untouched | absent | none | 1 |
| target parent invalid | untouched | absent | none | 1 |
| path overlap | untouched | absent | none | 1 |
| target already exists | untouched | preserved | none | 1 |
| target claim busy | untouched | absent | none | 1 |
| selected source unreadable | untouched | absent | cleanup | 1 |
| selected prefix changes | untouched | absent | cleanup | 1 |
| append only above cutoff | untouched | completed | consumed by rename | 0 |
| staging create/write failure | untouched | absent | cleanup | 1 |
| staging verification mismatch | untouched | absent | cleanup | 1 |
| final rename failure | untouched | absent | cleanup | 1 |
| crash before final rename | untouched | absent | may remain | abnormal |
| crash immediately after final rename | untouched | complete | published as target | abnormal process, valid target state |
| post-publication claim cleanup failure | untouched | complete | published as target | 0 + warning |

普通 failure 的 cleanup 是 best-effort；cleanup failure 不得覆盖 primary error。

---

## 26. Crash model

Fork v1 区分：

### 26.1 Recoverable / caught failure

尽量：

```text
remove staging
release claim
return primary error
```

### 26.2 Process crash / SIGKILL / power loss

允许留下：

```text
.promptpile-fork.staging.*
.promptpile-fork.claim.*
```

但正常设计保证 final target 不承载逐步复制过程。

v1 不实现自动 stale recovery。

未来若残留成为实际运营问题，可单独设计：

```text
promptpile-fork cleanup
```

不得为了提前处理未知需求而扩展 Fork v1 state machine。

---

## 27. CLI contract

v1 binary：

```bash
promptpile-fork \
  --source ./messages \
  --target ./branches/experiment-a \
  --through-index 12
```

唯一核心 flags：

```text
--source <dir>        required
--target <dir>        required
--through-index <n>   required
--dry-run             optional
--format text|json    optional, default text
```

明确不提供：

```text
-d
--to
--all
--force
--overwrite
--copy-mode
--hardlink
--archive
--layers
--materialize
```

v1 使用显式长 flag，减少与 `promptpile` root CLI 私有 shorthand 的耦合。

---

## 28. Dry-run semantics

`--dry-run` 必须执行足够多的 read-only validation，以产生真实 plan：

- parse CLI；
- validate source；
- resolve canonical source/target identity；
- validate target absent；
- validate target parent；
- observe stable selected prefix；
- 计算 artifactCount / totalBytes / sourcePrefixFingerprint；
- 输出计划报告。

`--dry-run` 不得：

- 创建 target；
- 创建 staging；
- 创建 claim；
- 写 source；
- 修改任何 filesystem entry。

Dry-run 不是 reservation；它不保证真正 execution 时 source、target 或权限仍保持不变。

---

## 29. Success JSON report v1

`--format json` 成功输出固定结构：

```json
{
  "schemaVersion": 1,
  "operation": "conversation_fork",
  "status": "completed",
  "source": "/canonical/source/path",
  "target": "/canonical/target/path",
  "throughIndex": 12,
  "artifactCount": 27,
  "totalBytes": 123456,
  "sourcePrefixFingerprint": "promptpile-conversation-v1:sha256:..."
}
```

约束：

- `schemaVersion` const `1`；
- `operation` const `conversation_fork`；
- `status` const `completed`；
- `throughIndex` 为请求 cutoff；
- `artifactCount` 是 selected artifact 数；
- `totalBytes` 是 selected raw byte 总数；
- `sourcePrefixFingerprint` 是 selected prefix fingerprint。

JSON success report 是操作结果，不进入 target Conversation。

### 29.1 Dry-run JSON report

Dry-run 使用：

```json
{
  "schemaVersion": 1,
  "operation": "conversation_fork",
  "status": "planned",
  "source": "/canonical/source/path",
  "target": "/canonical/target/path",
  "throughIndex": 12,
  "artifactCount": 27,
  "totalBytes": 123456,
  "sourcePrefixFingerprint": "promptpile-conversation-v1:sha256:..."
}
```

`planned` 不表示 target reservation 或 future success guarantee。

---

## 30. Error JSON contract

当 `--format json` 且 operation 失败时，stdout 应输出一个 machine-readable error document；human diagnostic 可以写 stderr，但不得污染 stdout JSON。

建议：

```json
{
  "schemaVersion": 1,
  "operation": "conversation_fork",
  "status": "failed",
  "code": "source_unstable",
  "message": "selected Conversation prefix changed during fork"
}
```

不得把 stack trace 放入 stdout JSON contract。

内部 cause 可以在 debug diagnostics 中保留，但公共 message 不应泄露无关 source content。

---

## 31. Text output contract

text success 应保持简单、可读，不作为 machine protocol。

至少包含：

```text
target
through index
artifact count
selected prefix fingerprint
```

Machine consumer 必须使用 `--format json`。

---

## 32. Archive boundary

Fork v1 明确：

```text
DO NOT COPY Archive Protocol artifacts/history
```

如果 source 当前处于 compression 后 live view，Fork 只复制当前 source 根目录中被 Conversation Protocol scanner 识别的 live artifacts。

Fork 不复制：

- archive directory；
- archive manifest；
- archived old turns；
- restore capability/history。

未来“可逆历史 clone”属于独立 Archive clone operation，不属于 Fork flag。

---

## 33. Layered Conversation boundary

Fork v1 只接受 single physical source directory。

不支持：

```text
--source layerA --source layerB
--materialize
idx rewrite
collision resolution
provenance manifest
```

Layered materialization 会引入不同的 domain invariants：

- numeric idx collision；
- exact basename collision；
- provenance；
- rewrite policy；
- output-layer ownership。

因此它必须作为未来独立设计，而不能隐藏进 Fork v1。

---

## 34. Tool / malformed sidecar boundary

Fork 对 calls/result/extra 不做 semantic validation。

因此：

```text
calls without result
→ copied unchanged

malformed calls JSONL
→ copied unchanged

malformed result JSONL
→ copied unchanged
```

Fork report 不负责提示 tool completeness。

需要 semantic diagnostics 的 caller 应在 Fork 前后调用 Inspect / MCP 专属 read model。

这样 Fork 保持单一职责：stable byte snapshot。

---

## 35. Security / symlink policy

v1 scanner 只接受 direct regular files。

必须避免：

- follow source symlink；
- copy symlink target；
- recurse nested directory；
- 通过 crafted basename 写出 staging root；
- path traversal。

由于 protocol artifact basename 来自 direct directory entry，并由 protocol classifier 认可，target path 必须始终使用：

```text
join(stagingRoot, exactBasename)
```

实现必须验证最终 candidate path 仍属于 staging root。

Fork 不接受用户直接指定任意 artifact relative path list。

---

## 36. Empty selection semantics

如果 source 是合法 directory，但：

```text
SelectedPrefix(source, throughIndex)
```

为空，v1 允许成功创建**空 target directory**。

理由：

- empty Conversation directory 已经是合法 filesystem state；
- cutoff 可能早于 source 的第一个 numeric idx；
- Fork 不应偷偷把“没有 selected artifact”当 validation error。

此时：

```text
artifactCount = 0
totalBytes = 0
sourcePrefixFingerprint = canonical empty-record fingerprint
```

该语义必须有 fixture/test。

---

## 37. Observability / diagnostics

Fork v1 不需要 telemetry subsystem。

错误至少应携带稳定 machine `code`；human message 要包含足够路径/阶段上下文，但避免打印 Conversation 内容。

第一 primary failure 规则：

```text
first primary domain failure wins
```

后续 staging / claim cleanup failure 只能附加 warning，不得替换 primary failure。

---

## 38. Implementation phases

### Phase 0 — Fingerprint prerequisite

目标：

- 将 pure Conversation Fingerprint canonical primitives 提升到 `promptpile-protocol/fingerprint`；
- 保持 filesystem observer 在 `promptpile`；
- `promptpile` 切到 public primitive；
- protocol dedicated tests / package surface / tarball smoke 全绿；
- 发布或 workspace 固定 exact protocol version。

Exit criteria：Fork 不需要 private-import `promptpile` 即可计算 canonical selected-prefix fingerprint。

### Phase 1 — Fork package runtime scaffold

新增：

- TypeScript build；
- `promptpile-fork` binary；
- exact dependency on `promptpile-protocol`；
- CLI parsing；
- source/target validation；
- protocol-based direct-file scanner；
- error types/codes。

不写 target。

### Phase 2 — Observation + planning + dry-run

实现：

- selected-prefix observation；
- byte length + SHA-256；
- canonical fingerprint；
- dry-run；
- text/json reports。

Exit criteria：全功能仍为 read-only。

### Phase 3 — Staging + copy + verification

实现：

- private same-parent staging；
- byte-exact copy；
- staging rescan；
- staged hash/fingerprint verification；
- ordinary failure cleanup。

仍不发布 final target。

### Phase 4 — Claim + terminal publication

实现：

- canonical-target claim；
- selected-prefix re-observation；
- source stability decision；
- same-parent final directory rename；
- post-publication best-effort cleanup。

Exit criteria：只有一个 commit point。

### Phase 5 — Failure / race / crash evidence

增加：

- source mutation injection；
- append-above-cutoff race；
- target contention；
- staging write failure；
- publication failure；
- crash injection around commit point；
- cleanup failure injection。

### Phase 6 — Package / CI / Freeze

完成：

- `npm pack`；
- packed tarball install smoke；
- Node 18/22 × Ubuntu/Windows dedicated matrix；
- normal root quality workflows；
- README/public CLI docs；
- plan acceptance checklist；
- 状态升级为 `v1 已实施 / Freeze 完成`。

---

## 39. Unit test matrix

至少覆盖：

### Protocol selection

- ordinary message；
- assistant body；
- calls；
- extra；
- result；
- same-idx sidecars；
- leading-zero basename；
- role casing；
- max safe integer；
- index above safe integer ignored/rejected according to protocol classifier；
- non-protocol basename；
- nested file；
- symlink。

### Observation

- deterministic ordering；
- byte length；
- SHA-256；
- empty selection fingerprint；
- selected-prefix fingerprint stable across enumeration order。

### Path identity

- source == target；
- target nested in source；
- source nested in target；
- Windows case-fold identity；
- target parent missing；
- target exists as file/dir/symlink。

### Report

- success JSON；
- planned JSON；
- failed JSON；
- stdout JSON purity；
- text output。

---

## 40. Root E2E matrix

必须至少有以下 E2E：

1. 正常 prefix Fork 成功；
2. cutoff 精确包含同 idx 全部 sidecars；
3. idx > cutoff artifacts 全部排除；
4. leading-zero basename 原样保留；
5. role casing 原样保留；
6. malformed calls/result 仍 byte-exact copy；
7. 非协议 regular files 不复制；
8. nested files 不复制；
9. symlink 不复制；
10. empty selected prefix 成功发布空 target；
11. target exists 在任何 staging/write 前失败；
12. source/target identity collision pre-side-effect fail；
13. target parent invalid pre-side-effect fail；
14. selected source artifact unreadable；
15. `idx <= cutoff` 内容变化 → `source_unstable`；
16. `idx <= cutoff` artifact add/remove → `source_unstable`；
17. **只 append `idx > cutoff` → Fork 仍成功**；
18. staging write failure → target absent；
19. staging verification mismatch → target absent；
20. final directory rename failure → target absent；
21. dry-run zero mutation；
22. two Fork processes same target → exactly one winner；
23. crash before publication → target absent；
24. injected failure immediately after publication → target complete，domain publication 不回滚；
25. post-publication claim cleanup failure → exit0 + warning；
26. source bytes 在整个成功/失败路径均未被 Fork 修改；
27. published target fingerprint == reported `sourcePrefixFingerprint`；
28. published target 可被普通 Promptpile Conversation scanner/read model 直接消费。

其中第 17 条是 v1 的关键 concurrency regression，不可省略。

---

## 41. Crash injection points

为了验证 commit boundary，测试至少提供内部 injection hooks：

```text
after_baseline
before_staging_create
after_staging_create
after_each_copy
after_staging_verify
after_source_reobserve
before_publish
after_publish
before_claim_cleanup
```

这些 hooks 仅用于 test dependency injection，不进入 public package API。

最关键证明：

```text
all injected failures before_publish
→ final target absent

after_publish failure
→ final target complete
```

---

## 42. Cross-platform CI

Dedicated workflow：

```text
Conversation Fork v1
```

矩阵：

```text
Node 18 / ubuntu-latest
Node 22 / ubuntu-latest
Node 18 / windows-latest
Node 22 / windows-latest
```

每组至少：

```text
npm ci --ignore-scripts
build protocol prerequisite
npm test -w promptpile-protocol
npm test -w promptpile-fork
relevant promptpile compatibility tests
npm pack fork
packed install smoke
```

不得依赖 dirty workspace 或 pre-existing sibling `dist`。

---

## 43. Package surface

`promptpile-fork` v1 package 应至少具有：

```json
{
  "name": "promptpile-fork",
  "type": "commonjs",
  "bin": {
    "promptpile-fork": "dist/index.js"
  }
}
```

依赖建议：

```json
{
  "dependencies": {
    "promptpile-protocol": "<exact released beta/stable version>"
  }
}
```

CLI parser dependency是否引入 commander属于 implementation choice，但不得因此依赖 `promptpile` package。

`prepack` 应显式 build；workspace install 不应通过 `prepare` 偷跑 consumer build。

packed tarball smoke 必须在临时独立项目中安装 tarball 并运行：

```text
promptpile-fork --help
promptpile-fork dry-run fixture
promptpile-fork real fork fixture
```

---

## 44. Public API policy

v1 的主要 public contract 是 CLI + JSON report/error contract。

不要求第一版暴露 programmatic library API。

如果内部为了测试拆出：

```text
observeForkPrefix
planFork
executeFork
```

可以保持 package-private，避免在 v1 Freeze 时过早承诺 JavaScript library API。

只有出现真实独立 programmatic consumer 后，再设计 public JS API。

---

## 45. Source of truth

Conversation lexical facts：

```text
Conversation Protocol docs
        ↓
promptpile-protocol/conversation
        ↓
promptpile-fork scanner
```

Fingerprint canonical facts：

```text
Conversation Fingerprint v1 normative contract
        ↓
promptpile-protocol/fingerprint
        ↓
promptpile + promptpile-fork
```

Fork-specific lifecycle semantics：

```text
CONVERSATION_FORK_PLAN.md
        ↓
promptpile-fork implementation/tests
```

不得让 Fork 重新定义 Conversation filename grammar 或 Fingerprint encoding。

---

## 46. Documentation boundary

实现完成后 README 至少说明：

- Fork 是 physical prefix snapshot；
- source read-only；
- cutoff inclusive；
- target must not exist；
- non-protocol files ignored；
- Archive history not copied；
- malformed recognized artifacts copied byte-exact；
- append above cutoff does not conflict；
- crash residual staging/claim 可能存在；
- JSON report 的 `sourcePrefixFingerprint` 含义。

Conversation Protocol 文档只需要增加 domain-operation pointer，不把 Fork lifecycle state machine复制进去。

---

## 47. v1 acceptance checklist

### Ownership

- [ ] 独立 `promptpile-fork` binary/package；
- [ ] 不向 `promptpile` core 增加 Fork runtime ownership；
- [ ] 不 private-import sibling `src/*` / `dist/*`。

### Protocol

- [ ] Conversation lexical semantics 来自 `promptpile-protocol/conversation`；
- [ ] Fingerprint pure canonical semantics 来自 `promptpile-protocol/fingerprint`；
- [ ] 没有重复 filename regex / ordering / hash encoding。

### Selection

- [ ] 只扫描 direct regular protocol artifacts；
- [ ] `idx <= throughIndex` inclusive；
- [ ] 同 idx sidecars 不被拆散；
- [ ] basename/bytes 原样复制；
- [ ] empty selected prefix 语义明确并测试。

### Concurrency

- [ ] 只保护 selected prefix；
- [ ] cutoff 内变化失败；
- [ ] cutoff 外 append 不导致 conflict；
- [ ] same target cooperating writers 只有一个 winner。

### Publication

- [ ] target 必须不存在；
- [ ] staging 与 target 同 parent；
- [ ] final target 不承载 progressive copy；
- [ ] staging verified；
- [ ] source re-observed；
- [ ] 只有 final directory rename 一个 commit point；
- [ ] publication 后无 fatal required stage。

### Failure

- [ ] ordinary failure source untouched；
- [ ] publication 前 failure final target absent；
- [ ] primary failure 不被 cleanup failure 覆盖；
- [ ] crash residual 语义有测试；
- [ ] post-publication cleanup failure 不翻转 success。

### Boundaries

- [ ] 不复制 Archive history；
- [ ] 不支持 layered materialization；
- [ ] 不执行/修复 Tool artifacts；
- [ ] 不复制 filesystem metadata 作为 contract；
- [ ] 不支持 hardlink/force/overwrite。

### CLI / Report

- [ ] 五个 v1 flags 固定；
- [ ] JSON success schema 固定；
- [ ] JSON planned schema 固定；
- [ ] JSON failure code contract 固定；
- [ ] stdout JSON 不被 human logs 污染；
- [ ] exit0/exit1 contract 固定。

### Evidence

- [ ] root E2E matrix 完整；
- [ ] Node 18/22 × Ubuntu/Windows 全绿；
- [ ] npm pack + independent install smoke 全绿；
- [ ] Promptpile compatibility consumer 验证通过；
- [ ] 文档与实现一致。

---

## 48. Freeze criteria

只有以下全部成立，才能将文档状态改为：

```text
v1 已实施 / Freeze 完成
```

Freeze 必须同时证明：

```text
语义闭环
+
状态机闭环
+
publication 闭环
+
failure 闭环
+
package 边界闭环
+
cross-platform evidence 闭环
```

具体要求：

1. acceptance checklist 全部勾选；
2. dedicated Fork matrix Node 18/22 × Ubuntu/Windows 全绿；
3. 同一实现通过 packed-tarball independent install smoke；
4. `promptpile` 能直接消费 Fork 产生的 target；
5. cutoff 内 source race 被拒绝；
6. cutoff 外 append race 被允许；
7. publication 前不存在 partial final target；
8. publication 后无 required fatal stage；
9. source 在所有执行路径保持只读；
10. Fork 不拥有 Archive/Layered/Tool/Completion runtime semantics。

---

## 49. ADR / anti-scope-creep rule

建议在实现时增加一条 Fork ownership ADR：

> Conversation Fork v1 是一个 single-source, prefix-selected, byte-preserving physical snapshot operation。任何需要 merge、idx rewrite、layer flattening、archive history、semantic repair、tool execution 或 overwrite-existing-target 的需求，都不是 Fork v1 的自然扩展，必须重新经过独立 protocol/domain design。

这条规则用于防止 `promptpile-fork` 演化成通用 Conversation filesystem utility。

---

## 50. 实施者不得重新决定的事项

本冻结稿之后，v1 实施阶段不得再临场改变：

```text
owner package
single physical source
explicit throughIndex
inclusive cutoff
direct regular file rule
byte-preserving semantics
target must not exist
private same-parent staging
single terminal directory publication
selected-prefix consistency scope
append-above-cutoff semantics
no Archive copy
no layered materialize
no hardlink
no force/overwrite
no semantic repair
exit0/exit1
JSON operation/status field grammar
post-publication cleanup non-fatal
```

如果实现过程中发现这些约束无法成立，应先修改本设计并重新审查，而不是在代码里静默引入另一套语义。

---

## 51. 最终闭环判定

Conversation Fork v1 的最终目标不是“复制测试通过”，而是让以下状态在设计层成立：

```text
success
⇒ complete independently readable target

failure before commit
⇒ no final target

source changes inside selected prefix
⇒ no success witness

source changes outside selected prefix
⇒ does not invalidate this fork
```

达到这四条，并有跨平台/打包证据后，Fork v1 才可以正式 Freeze。
