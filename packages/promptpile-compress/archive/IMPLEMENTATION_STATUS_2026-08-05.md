# promptpile-compress 当前实现评估

> 类型：Implementation Status  
> 状态：Experimental / Active  
> 适用分支：`main`  
> 最近复核：2026-08-05  
> 主要用途：记录当前实现已经完成的能力、尚未闭环的能力，以及下一阶段优先级；不替代 `DESIGN.md` 或历史 implementation plan。

## 1. 结论

当前 `promptpile-compress` 已经具备一套较完整的、可逆的 conversation 文件生命周期压缩基础设施，但还没有形成完整的语义上下文压缩与长期记忆检索系统。

更准确地说：

- **文件生命周期压缩 / archive / restore 基础层：约 7.5–8/10**
- **语义压缩 / memory retrieval 层：约 2–3/10**

当前 package 更接近：

> **可逆 conversation compaction engine + context lifecycle foundation**

而不是：

> **完整的 production long-context memory system**

建议继续保持 `private: true` / `experimental` 定位，直到语义摘要、archive retrieval、orchestrator integration 和并发模型完成闭环。

---

## 2. 当前能力矩阵

| 维度 | 当前状态 | 评价 |
|---|---|---:|
| Conversation 文件协议兼容 | 已实现 | 8.5/10 |
| 按 idx 聚合 turn | 已实现 | 9/10 |
| tool call/result/extra 整体归档 | 已实现 | 9/10 |
| archive / restore 可逆性 | 已实现 | 9/10 |
| crash recovery / retry | 已实现 | 8.5/10 |
| dry-run | 已实现 | 8/10 |
| recompress | 已实现 | 8/10 |
| compression manifest | 已实现 | 8/10 |
| token budget 判断 | heuristic 实现 | 5/10 |
| 语义 summary | 未真正实现 | 2/10 |
| archive selective retrieval | 未实现 | 1/10 |
| `lookup_archive` / `read_archived_turn` | 未实现 | 0/10 |
| MCP memory tools | 未实现 | 0/10 |
| 自动 lifecycle integration | 未实现 | 2/10 |
| 并发安全 | 尚未解决 | 4/10 |

---

## 3. 已经完成并且设计合理的部分

### 3.1 Turn 级别归档

压缩不是按单文件处理，而是先按照相同 `idx` 聚合为 turn。

一个 assistant turn 可以包含：

```text
[idx]assistant.md
[idx]assistant.calls.jsonl
[idx]assistant.result.jsonl
[idx]assistant.extra.json
```

这些文件作为同一个 turn 一起参与 keep/archive 决策，因此不会把 tool call 和 tool result 拆散。

这与 Promptpile Conversation Protocol 的文件模型一致，是当前实现最重要的正确性基础之一。

### 3.2 System turn 永不压缩

当前 sliding-window strategy 将所有 system turn 保留在 live conversation 中，只对非-system turn 做历史窗口压缩。

这样可以保证：

- 初始 system prompt 不被重写；
- 已生成的 summary system message 不会在普通候选选择中被继续当作普通历史 turn；
- 对话行为约束与上下文摘要不会因为普通 sliding window 而意外丢失。

### 3.3 Archive 利用顶层扫描协议实现零侵入

Promptpile Conversation Protocol 只扫描 conversation directory 顶层文件，不递归读取子目录。

`promptpile-compress` 将被压缩的原始文件移动到：

```text
[idx]system.md.archive/
```

因此不需要 Promptpile core 理解 archive 语义。

压缩前：

```text
[0]system.md
[1]user.md
[2]assistant.md
[2]assistant.calls.jsonl
[2]assistant.result.jsonl
[3]user.md
[4]assistant.md
```

压缩后：

```text
[0]system.md
[2]system.md
[2]system.md.archive/
  [1]user.md
  [2]assistant.md
  [2]assistant.calls.jsonl
  [2]assistant.result.jsonl
  compression.json
  .summary.md
[3]user.md
[4]assistant.md
```

这是当前 package 与 Promptpile CLI/file-first 架构比较一致的地方。

---

## 4. Compress 生命周期实现

当前 `compressDirectory()` 的主流程已经基本完整：

```text
assert directory
    ↓
recover leftover staging
    ↓
existing archive?
    ├─ yes → restore full history
    └─ no
    ↓
scan turns
    ↓
estimate tokens
    ↓
threshold check
    ↓
strategy.selectTurns()
    ↓
strategy.generateSummary()
    ↓
prepare staging
    ↓
rename staging → archive
    ↓
write [summaryIdx]system.md
```

默认参数：

```text
threshold   = 32000
keepRecent  = 4
strategy    = sliding-window
```

现阶段支持：

```text
promptpile-compress compress -d <directory>
promptpile-compress compress -d <directory> --threshold <n>
promptpile-compress compress -d <directory> --keep-recent <n>
promptpile-compress compress -d <directory> --dry-run
```

### 4.1 Recompress

当前实现检测到已有 archive 后，会先 restore 完整历史，再从完整 conversation 重新执行 compression。

这避免长期运行后出现：

```text
archive 1
archive 2
archive 3
...
```

不断叠加的复杂历史结构。

现有设计的期望状态是：正常完成后，一个 conversation 目录保持一个主要 summary/archive 对。

### 4.2 Dry-run

`compress --dry-run` 和 `restore --dry-run` 都尽量保持完全只读。

它们用于：

- 评估是否会触发压缩；
- 查看预计 archive 数量；
- 查看 token 估算；
- 验证 restore/recovery 操作，而不修改目录。

---

## 5. Restore / Recovery 是当前最成熟的模块

当前 restore 实现已经包含比较完整的 destructive-operation preflight。

在移动任何 archive 文件之前，会验证：

- `compression.json` 可解析；
- `version === 1`；
- `archivedTurnIndices` 是非空非负整数数组；
- archive directory idx 与 manifest 最大 idx 一致；
- 不同 archive 之间没有重复 idx；
- 不同 archive 之间没有重复 message filename；
- conversation 顶层不存在将被覆盖的目标文件。

Restore 执行时还采用：

```text
先删除全部 summary
    ↓
再移动 archive message files
    ↓
确认 archive 中没有剩余 message files
    ↓
删除 archive directory
```

这样可以避免 summary 与 restored original turn 长时间同时作为 live conversation 内容存在。

### 5.1 Partial restore 可重试

如果 restore 执行到一半崩溃，例如：

```text
[1]user.md 已恢复到顶层
[2]assistant.md 仍在 archive
summary 已删除
```

下一次 restore 可以继续处理 archive 中仍然存在的文件，而不要求重建 summary。

### 5.2 Staging recovery

未提交 compression 使用：

```text
.promptpile-compress.staging/
```

作为准备区。

再次执行 compress/restore 时可以检测残留 staging，并将其中 message files rollback 到 conversation 顶层。

如果 staging 与 archive 同时存在，当前实现认为状态存在歧义并拒绝自动恢复，而不是猜测用户意图。

这是合理的 fail-closed 行为。

---

## 6. 当前最大的功能缺口：还没有真正的语义压缩

当前唯一实现的 strategy 是：

```text
sliding-window
```

它在 `generateSummary()` 中并没有读取归档 turn 的语义并生成真正摘要。

当前生成的内容本质上类似：

```text
对话第 X-Y 轮已被归档，可通过 lookup_archive 工具检索原文。
归档范围共 N 轮，原始 token 数约 T。
```

因此当前压缩流程实际完成的是：

```text
old context
    ↓
move outside live conversation
    ↓
insert archive pointer
```

而不是：

```text
old context
    ↓
semantic distillation
    ↓
goals
facts
decisions
constraints
completed work
unresolved work
important tool results
    ↓
compact live context
```

这意味着旧 conversation 中的重要语义目前不会自动保留在 live context 中。

例如以下内容：

- 用户长期目标；
- 已确定的 architecture decision；
- API compatibility requirement；
- 工具执行后得到的重要事实；
- 已完成工作；
- 未完成工作；
- 关键失败原因；
- 后续行动约束；

在当前 sliding-window 实现中都只存在于 archive 原文，而不会进入 summary。

因此目前更准确的术语是：

> **history compaction / archival**

而不是完整：

> **semantic context compression**

---

## 7. Summary 与 Retrieval 目前没有闭环

当前 summary 明确提示：

```text
可通过 lookup_archive 工具检索原文
```

但是当前 `src/` 实际只包含：

```text
src/
├── index.ts
├── compress/
└── restore/
```

设计文档中曾规划的以下模块尚未实现：

```text
lookup_archive
read_archived_turn
LLM summary client
prompt builder
retrieval backend
MCP server
vector search
```

所以当前真实链路是：

```text
conversation
    ↓
archive old turns
    ↓
pointer summary
    ↓
没有实现对应 retrieval tool
```

完整目标应该是：

```text
conversation
    ↓
semantic summary
    ↓
compact live context
    │
    ├─→ continue reasoning
    │
    └─→ lookup archived source
             ↓
         original turns
```

在 retrieval tool 实现之前，不应该把现有 summary 中“可通过 lookup_archive 检索”理解为已经可用的 runtime capability。

---

## 8. Token budget 当前只是 heuristic

当前 token estimator 采用字符估算：

```text
tokens ≈ characters / 3.5
       + 30 × fileCount
```

Markdown 会先尝试剥离 YAML front matter。

这一实现适合：

```text
“conversation 是否已经大到值得 compact？”
```

这种 coarse trigger。

但它不适合精确做：

```text
model context = 128k
reserved output = 16k
tool definitions = 12k
system sidecars = 8k
target live history = 80k
```

这种 context budget planning。

`package.json` 当前已经声明 optional `tiktoken`，但实现中还没有真正使用模型 tokenizer。

下一阶段如果开始自动接入 orchestrator，token budget 精度需要提升。

---

## 9. Crash-safe 与 concurrency-safe 必须区分

当前实现对进程崩溃后的恢复已经考虑较多，但还没有解决 concurrent reader/writer 问题。

例如 compress preparation 过程中会逐文件执行：

```text
rename file 1 → staging
rename file 2 → staging
rename file 3 → staging
...
```

此时如果另一个 Promptpile invocation 同时扫描 conversation directory，它可能看到一个瞬时的不完整 turn：

```text
[2]assistant.md            已移动
[2]assistant.calls.jsonl   仍存在
[2]assistant.result.jsonl  仍存在
```

同理 restore 也不是一个跨整个 conversation directory 的原子事务。

Conversation Protocol v1 本身也明确不提供跨文件事务和多写入者协调。

因此当前 compress/restore 的正确运行前提应明确理解为：

> **对目标 conversation directory 进行 exclusive lifecycle mutation。**

在将 compression 自动集成进 React 或其他 orchestrator 之前，需要至少明确一种并发协调策略，例如：

- directory lock；
- orchestrator-owned exclusive phase；
- lock file + stale lock recovery；
- generation/version precondition。

现阶段不建议在 Promptpile core 中隐式自动触发 compress。

---

## 10. 当前测试质量

现有 tests 已覆盖的关键路径包括：

### Compress

- 普通 sliding-window compression；
- tool call/result 同 turn archive；
- system turn preservation；
- dry-run 不修改目录；
- below/no-compressible path；
- existing archive → restore → recompress；
- leftover staging rollback；
- archive 已存在但 summary 丢失后的 recompress recovery。

### Restore

- uncompressed directory no-op；
- multi-archive restore；
- summary-before-original ordering；
- dry-run；
- target conflict；
- duplicate archived indices；
- damaged `compression.json`；
- partial restore retry；
- empty archive cleanup；
- staging rollback；
- ambiguous staging + archive rejection。

因此目前 storage lifecycle 的测试覆盖明显强于 semantic layer。

---

## 11. 当前架构评价

### 做得好的地方

1. **没有侵入 Promptpile core。**
2. **以 conversation files 作为唯一共享状态。**
3. **turn 是最小 mutation unit，而不是单文件。**
4. **archive 是可审计、可恢复的真实文件，而不是 opaque DB state。**
5. **restore 在 destructive mutation 前做完整 preflight。**
6. **recompress 通过 restore full history 简化长期状态。**
7. **staging/recovery 设计已经可以承受多数 crash 场景。**

### 当前主要技术债

1. `generateSummary()` 仍是 placeholder archive pointer；
2. retrieval tool 未实现；
3. summary 宣称的 `lookup_archive` capability 与 runtime 不一致；
4. token estimator 精度较低；
5. compression metadata 尚未成为 ecosystem versioned contract；
6. compress/restore 没有 directory-level concurrency coordination；
7. 尚未与 React/Plan 形成正式 lifecycle integration。

---

## 12. 下一阶段建议

当前不建议继续扩展 archive/storage 机制。现有文件生命周期基础已经足够支撑下一阶段。

### Priority 1：实现真正的 semantic summary strategy

建议新增独立 strategy，例如：

```text
summarize
```

摘要目标不要定义成泛化的“总结聊天内容”，而应明确保留长期 agent reasoning 所需的信息类别：

```text
goal
user intent
stable facts
constraints
architecture decisions
important tool observations
completed work
unresolved work
failed approaches
next actions
references worth retrieving
```

理想情况下 summary 应采用稳定结构，而不是自由文本段落。

### Priority 2：实现最小 archive retrieval

第一版不需要 vector database。

优先实现 deterministic file-based tools：

```text
lookup_archive(query)
read_archived_turn(idx)
```

至少让 summary 中的“可以检索 archive”成为真实能力。

### Priority 3：把 summary + retrieval 设计成完整 memory loop

目标：

```text
old turns
   ↓
summary
   ↓
agent continues
   ↓
missing detail?
   ↓
lookup archive
   ↓
original evidence
```

而不是只做 history truncation。

### Priority 4：再接入 orchestrator lifecycle

推荐由 orchestration layer 显式控制：

```text
estimate context
    ↓
over budget?
    ↓ yes
compress
    ↓
run Thought / completion
```

不要让普通 `promptpile` completion 隐式修改 conversation lifecycle。

### Priority 5：精确 token budget 与 concurrency model

在自动 integration 前补：

- model-aware tokenizer；
- output/tool/system reserve budget；
- directory-level lifecycle lock 或等价协调模型；
- concurrency / interruption integration tests。

---

## 13. 建议的阶段定义

当前状态可以正式定义为：

### Phase 1 — Reversible Conversation Compaction

**状态：基本完成**

包括：

```text
scan
turn grouping
token heuristic
sliding-window selection
staging
archive
manifest
restore
recover
recompress
dry-run
```

### Phase 2 — Semantic Context Compression

**状态：未完成**

包括：

```text
semantic summarization
structured retained context
summary quality tests
model/config integration
```

### Phase 3 — Archive Retrieval / Memory

**状态：未完成**

包括：

```text
lookup_archive
read_archived_turn
retrieval contract
MCP/tool exposure
optional semantic search
```

### Phase 4 — Orchestrator Lifecycle Integration

**状态：未完成**

包括：

```text
context budget trigger
exclusive compression phase
React integration
recovery integration
observability
```

---

## 14. Acceptance Criteria for the Next Maturity Level

只有以下条件满足后，才建议把 `promptpile-compress` 从“experimental compaction engine”提升为真正的 conversation memory subsystem：

- [ ] summary 包含真实历史语义，而不是 archive pointer；
- [ ] summary schema / prompt 有稳定测试；
- [ ] `lookup_archive` 或等价 retrieval 能力真实存在；
- [ ] agent 可以从 compact context 重新定位原始证据；
- [ ] token budget 能对应具体 model/context limit；
- [ ] compression 与 active completion 不会并发修改同一目录；
- [ ] interruption / crash / retry integration tests 完整；
- [ ] React 或其他 orchestrator 有显式 lifecycle integration；
- [ ] compression archive format 如需跨实现消费，提升为 versioned contract；
- [ ] package 文档不再把未实现的 MCP/retrieval 能力描述为当前能力。

---

## 15. 当前推荐定位

截至本次复核，推荐对外和仓库内部统一使用以下定位：

> `promptpile-compress` 当前是一套 experimental、可逆、file-native 的 conversation compaction / restore 基础设施。它已经较可靠地解决“如何把旧 turn 安全移出 live conversation 并在需要时完整恢复”的问题，但尚未解决“如何以更少 token 保留历史语义，以及 agent 如何按需重新取回被压缩知识”的完整 memory 问题。

因此下一阶段工程重点应从：

```text
archive mechanics
```

转向：

```text
semantic summary
+
retrieval
+
orchestrator lifecycle integration
```
