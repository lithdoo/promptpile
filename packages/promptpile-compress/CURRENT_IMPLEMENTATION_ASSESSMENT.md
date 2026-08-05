# promptpile-compress 当前实现评估

> 类型：Current implementation assessment  
> 状态：Implemented assessment  
> 稳定程度：Experimental  
> 适用代码：`main` 分支当前实现  
> 最近复核：2026-08-05

## 1. 结论

当前 `promptpile-compress` 已经形成一个较可靠的、可逆的 **conversation compaction / lifecycle foundation**，但还没有完成真正意义上的长期上下文语义压缩系统。

更精确地说：

- **文件生命周期层**：基本完成。能够扫描 Promptpile conversation directory、按 idx group 归档旧轮次、生成占位 summary、恢复原始文件、处理 staging 残留，并支持 dry-run 与重新压缩。
- **语义压缩层**：尚未完成。当前 summary 不保留真实 conversation 语义，只描述归档范围和估算 token 数。
- **检索与长期记忆层**：尚未完成。当前代码没有实现 summary 中提到的 `lookup_archive`，也没有 `read_archived_turn`、MCP server、索引或向量检索。
- **自动生命周期集成**：尚未完成。`promptpile` 与 `promptpile-react` 不会隐式触发压缩；目前必须由外部调用者显式执行。

当前最合理的阶段定义是：

```text
Phase 1: reversible conversation compaction engine   基本完成
Phase 2: semantic summary and archive retrieval       尚未完成
Phase 3: orchestrator lifecycle integration           尚未完成
```

## 2. 当前能力矩阵

| 维度 | 当前状态 | 评价 |
|---|---|---:|
| Conversation 文件协议兼容 | 已实现 | 8.5/10 |
| idx group / tool artifact 整体归档 | 已实现 | 9/10 |
| archive / restore 可逆性 | 已实现 | 9/10 |
| staging recovery / retry | 已实现 | 8.5/10 |
| dry-run / recompress | 已实现 | 8/10 |
| token threshold 判断 | 粗略实现 | 5/10 |
| 语义摘要 | 基本未实现 | 2/10 |
| archive selective retrieval | 未实现 | 1/10 |
| MCP memory tools | 未实现 | 0/10 |
| 自动 lifecycle integration | 未实现 | 2/10 |
| 并发安全 | 未解决 | 4/10 |

总体判断：

```text
文件生命周期实现：7.5–8/10
语义压缩与记忆实现：2–3/10
```

## 3. 当前实现结构

```text
packages/promptpile-compress/
├── src/
│   ├── index.ts
│   ├── compress/
│   │   ├── index.ts
│   │   ├── scanner.ts
│   │   ├── strategy.ts
│   │   ├── tokenizer.ts
│   │   └── types.ts
│   └── restore/
│       ├── index.ts
│       ├── scanner.ts
│       └── types.ts
├── DESIGN.md
├── COMPRESS_IMPLEMENTATION_PLAN.md
├── RESTORE_IMPLEMENTATION_PLAN.md
└── CURRENT_IMPLEMENTATION_ASSESSMENT.md
```

CLI 当前暴露：

```bash
promptpile-compress compress -d <directory>
promptpile-compress restore -d <directory>
```

`compress` 支持：

```text
--threshold
--keep-recent
--strategy sliding-window
--dry-run
```

`restore` 支持：

```text
--dry-run
```

## 4. 已实现的压缩流程

当前 `compressDirectory()` 的主流程是：

```text
assert directory
    ↓
recover leftover staging
    ↓
existing archive?
    ├─ yes → restore full history
    └─ no
    ↓
scan top-level conversation files
    ↓
group files by idx
    ↓
estimate token count
    ↓
below threshold? → no-op
    ↓
keep system turns
keep recent N non-system idx groups
archive older non-system idx groups
    ↓
generate summary text
    ↓
move archived files into staging
write compression.json
write .summary.md
    ↓
rename staging → [N]system.md.archive
    ↓
write [N]system.md
```

当前实现具备以下正确性特征：

1. **按 idx group 归档**

   同一 idx 下的普通 message、`assistant.calls.jsonl`、`assistant.result.jsonl` 和 `assistant.extra.json` 被作为一个整体处理，不拆散 tool call/result 关系。

2. **system turn 不压缩**

   只要某个 idx group 包含 `system.md`，该 group 就保留在顶层。

3. **不重新编号**

   被保留的消息继续使用原 idx；conversation 中存在 idx gap 不影响 Promptpile 按 idx 排序。

4. **利用顶层扫描协议实现零侵入**

   Promptpile conversation scanner 不递归进入子目录，因此移动到 `[N]system.md.archive/` 的历史消息会自然从 live context 中消失。

5. **重新压缩前恢复完整历史**

   如果已经存在 archive，当前实现先 restore，再基于完整历史重新计算一次压缩结果，避免无限叠加多个 summary。

## 5. 已实现的 archive 格式

压缩后的目录形态如下：

```text
messages/
├── [0]system.md
├── [N]system.md
├── [N]system.md.archive/
│   ├── [1]user.md
│   ├── [2]assistant.md
│   ├── [2]assistant.calls.jsonl
│   ├── [2]assistant.result.jsonl
│   ├── compression.json
│   └── .summary.md
├── [N+1]user.md
└── [N+2]assistant.md
```

`compression.json` 当前写入：

```json
{
  "version": 1,
  "compressedAt": "ISO-8601 timestamp",
  "strategy": "sliding-window",
  "originalTokenCount": 12345,
  "compressedTokenCount": 42,
  "archivedTurnIndices": [1, 2, 3]
}
```

当前格式是 package-private / experimental 状态，还没有被提升为 Promptpile ecosystem 的 versioned public contract。

## 6. Restore 与崩溃恢复评价

Restore 是当前实现中最成熟的部分。

还原前会先完成全量预检：

- archive 目录名和 `archivedTurnIndices` 最大 idx 一致；
- `compression.json.version === 1`；
- archived indices 为非负整数、非空、无重复；
- 多个 archive 之间不存在重复 idx；
- 多个 archive 之间不存在重复消息文件；
- 顶层不存在将被恢复文件的目标冲突；
- staging 与 archive 同时存在时拒绝自动判断。

正式 restore 时：

```text
delete all corresponding summaries
    ↓
move archived message files back to top level
    ↓
verify archives contain no message files
    ↓
remove archive directories
```

当前恢复逻辑还支持：

- partial restore 后再次执行；
- summary 已经丢失但 archive 仍存在；
- archive 消息已经移动完、只剩 metadata；
- staging rollback；
- read-only dry-run。

这部分测试覆盖不仅包含 happy path，也覆盖 damaged metadata、target conflict、duplicate idx、ambiguous state 和中断重试。

## 7. 当前不是真正的语义压缩

当前唯一策略是 `sliding-window`。

它的 `generateSummary()` 不读取并概括历史 conversation 的真实内容，而只生成类似：

```text
对话第 1-20 轮已被归档，可通过 lookup_archive 工具检索原文。
归档范围共 20 轮，原始 token 数约 12345。
```

因此当前行为实际是：

```text
old context
    ↓
move outside live context
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
constraints
decisions
completed work
unresolved work
important tool results
```

这意味着历史中的用户约束、关键决策、工具输出和未完成事项都不会自动进入 compact live context。

所以从信息论意义上看，当前实现主要是 **history eviction / archival compaction**，而不是完整的 semantic compression。

## 8. Summary 与 retrieval 当前不闭环

当前 summary 会告诉模型可以通过 `lookup_archive` 查询原文，但当前 `src/` 中没有实现：

```text
lookup_archive
read_archived_turn
archive index
MCP server
file grep backend
vector backend
```

当前真实链路是：

```text
conversation
    ↓
archive
    ↓
pointer summary
    ↓
no implemented retrieval path
```

完整目标应该是：

```text
conversation
    ↓
semantic summary
    ↓
compact live context
    │
    ├─ continue reasoning
    │
    └─ retrieve archived source when needed
             ↓
        original turns
```

因此在 retrieval 实现之前，summary 中直接宣称存在 `lookup_archive` 会形成不真实的 capability promise。后续应选择以下一种方式：

1. 先实现确定性的 archive lookup，再保留当前 summary wording；或
2. 在 lookup 尚未实现时，修改 summary，不向模型声明不存在的工具。

推荐方案是第一种。

## 9. Token 估算限制

当前 token 计算采用字符 heuristic：

```text
tokens ≈ character count / 3.5
       + 30 × file count
```

Markdown 会先剥离 YAML front matter。

该估算足以承担粗粒度 threshold trigger，例如判断 conversation 是否大致超过 32k，但不适合承担精确的 context budget 管理。

已知偏差来源包括：

- 中文和英文字符/token 比率不同；
- JSONL tool results 的 token 密度不同；
- tool schema、insert sidecar、append sidecar 不在当前 conversation directory 估算中；
- model-specific tokenizer 不同；
- output token reserve 没有计入；
- promptpile 真实组装时的 message/tool wrapper 与当前固定 30 token heuristic 不完全一致。

`package.json` 声明了 optional `tiktoken`，但当前代码没有使用它。

## 10. Crash safety 与 concurrency safety 的边界

当前实现对进程崩溃和中断恢复考虑较好，但这不等于具备并发安全。

Compress 准备阶段会逐个执行：

```text
rename message file → staging
```

在所有文件移动完成以前，另一个同时读取 conversation directory 的 Promptpile 进程可能观察到不完整 idx group。

Restore 也会逐个把文件移动回顶层。过程中另一个 reader 可能看到部分历史已经恢复、部分仍在 archive。

因此当前正确使用前提应明确为：

```text
compress / restore 对 conversation directory 执行 exclusive lifecycle mutation
```

也就是说，在 compress 或 restore 运行期间，不应有：

- Promptpile completion；
- React phase invocation；
- append-user；
- MCP result writer；
- 其他 compressor/restorer；
- 任何修改同一 conversation directory 的写入者。

未来接入自动 lifecycle 前，需要增加正式 coordination 机制，例如：

- directory lock file + exclusive create；
- orchestrator-level mutex；
- generation/version precondition；
- snapshot directory + atomic directory switch。

第一阶段推荐先使用 orchestrator-level exclusive lock，不需要立即设计复杂 MVCC。

## 11. 当前测试评价

现有测试覆盖：

### Compress

- 正常 sliding-window 压缩；
- tool artifacts 作为 idx group 一起归档；
- dry-run 不修改文件；
- system turns 保留；
- 没有可压缩 turn 时 no-op；
- 已存在 archive 时先 restore 再 recompress；
- staging leftovers rollback；
- archive 已提交但 summary 丢失时恢复并重压缩。

### Restore

- 无 archive 时 no-op；
- 多 archive 还原；
- 在移动原始消息前删除所有 summary；
- dry-run；
- target conflict 全量预检；
- duplicate indices；
- damaged compression metadata；
- partial restore continuation；
- empty archive cleanup；
- staging recovery；
- staging + archive ambiguous state rejection。

当前缺少的高价值测试包括：

- compress 准备阶段每一个 rename 位置的 fault injection；
- commitStaging 在 archive rename 后、summary 写入前失败；
- restore 每个 file move 位置的 fault injection；
- 非 UTF-8、不可读文件和 permission failure；
- 非常大的 JSONL tool results；
- symlink / special file 行为；
- 多进程竞争的明确 rejection 或 lock behavior；
- Promptpile 真实扫描压缩后目录的 integration test；
- summary/retrieval 完整闭环测试。

## 12. 与 Promptpile Protocol 的关系

当前 scanner 自己维护了一套文件名 regex，用于识别：

```text
[idx]role.md
[idx]role.json
[idx]assistant.calls.jsonl
[idx]assistant.result.jsonl
[idx]assistant.extra.json
```

它与 `Conversation Protocol v1` 当前基本一致，但仍存在隐式协议复制风险。

因为 `promptpile-compress` 不应重新依赖 `promptpile/dist/*` 私有实现，所以不建议通过导入 Promptpile 内部 scanner 解决。

推荐路径是：

1. 继续把 `Conversation Protocol v1` 作为 normative source；
2. 给 Compress 添加 protocol conformance fixtures；
3. 使用同一批 fixture 同时验证 Promptpile scanner 与 Compress scanner；
4. 只有出现多个真实 TypeScript consumer 需要共享 parser 时，再考虑独立 protocol package；
5. 不为单纯复用 regex 提前创建 `promptpile-core`。

## 13. 下一阶段建议

### P0：让 summary 与 retrieval 闭环

先实现最小确定性检索，不需要第一版就引入 vector database。

建议增加：

```text
promptpile-compress lookup
promptpile-compress read-turn
```

或等价 MCP tools：

```text
lookup_archive(query, limit?)
read_archived_turn(idx)
```

最小 backend 可以是：

```text
scan archive files
    ↓
plain text / regex / keyword match
    ↓
return matching idx and excerpts
```

完成后 summary 中的 archive pointer 才成为真实 capability。

### P1：实现 structured semantic summary

不要只生成自由文本摘要。建议先定义内部结构：

```json
{
  "goal": "...",
  "decisions": ["..."],
  "facts": ["..."],
  "constraints": ["..."],
  "completedWork": ["..."],
  "unresolvedWork": ["..."],
  "importantToolResults": ["..."],
  "archiveRange": { "from": 1, "to": 20 }
}
```

然后由该结构渲染 `[N]system.md`。

这能比直接要求模型写一段摘要更容易测试、合并和重压缩。

### P2：定义真实 context budget

从单一 `threshold` 升级为：

```text
model context limit
- system / tool schema estimate
- recent conversation estimate
- output reserve
- safety margin
= archive budget
```

tokenizer 应允许：

```text
model-specific tokenizer
    ↓ fallback
character heuristic
```

### P3：接入 orchestrator lifecycle

推荐由 React 或未来通用 orchestrator 显式控制：

```text
before phase invocation
    ↓
estimate context
    ↓
over budget?
    ├─ no → run phase
    └─ yes
        ↓
      acquire conversation lock
        ↓
      compress
        ↓
      release lock
        ↓
      run phase
```

不建议让普通 `promptpile` completion 在内部静默压缩 conversation；这会破坏 completion command 的透明性。

### P4：并发协调与协议版本化

当 Compress 开始被 React/MCP 等外部组件自动调用时，应补：

- directory-level lock contract；
- compression manifest version contract；
- summary representation version；
- retrieval tool contract；
- compatibility tests；
- migration policy。

## 14. 暂不建议做的事

当前不建议：

1. 把 compress/restore 逻辑并入 `promptpile` core；
2. 为共享 scanner 创建庞大的 `promptpile-core`；
3. 在没有 deterministic retrieval 前直接上向量数据库；
4. 在没有 structured summary contract 前实现 hierarchical compression；
5. 让 Promptpile completion 隐式修改 conversation history；
6. 把当前 archive 格式过早宣布为稳定 public protocol。

## 15. 验收标准

### Phase 1：当前 compaction foundation

- [x] 按 idx group 扫描 conversation；
- [x] system turn 保留；
- [x] tool call/result 不拆散；
- [x] threshold no-op；
- [x] dry-run；
- [x] staging + archive 两阶段状态；
- [x] restore；
- [x] recompress；
- [x] crash leftovers recovery；
- [x] conflict preflight；
- [x] 关键文件生命周期测试。

### Phase 2：语义压缩与记忆

- [ ] 真实 semantic summary；
- [ ] structured summary representation；
- [ ] `lookup_archive`；
- [ ] `read_archived_turn`；
- [ ] summary 中只声明真实存在的 retrieval capability；
- [ ] summary/retrieval integration tests。

### Phase 3：自动生命周期管理

- [ ] model-aware context budget；
- [ ] exact/fallback tokenizer strategy；
- [ ] conversation exclusive lock；
- [ ] React/orchestrator integration；
- [ ] archive/retrieval versioned contract；
- [ ] production migration and compatibility policy。

## 16. 最终判断

当前 `promptpile-compress` 已经解决了最容易造成数据损坏的部分：

```text
如何安全地把一组 conversation artifacts 移出 live context，
并且在失败、中断和重新压缩后仍能恢复原始数据。
```

它尚未解决最影响 Agent 推理质量的部分：

```text
被移出 live context 的信息如何被语义保留，
以及 Agent 如何按需、确定性地重新获得原始信息。
```

因此当前 package 应继续保持：

```text
private / experimental
```

下一阶段的主要投入应从文件系统事务转向：

```text
semantic summary
retrieval
context budgeting
orchestrator coordination
```

而不是继续扩展 archive 文件布局本身。
