# promptpile-compress 优化计划

> 状态：Complete
>
> 适用范围：`packages/promptpile-compress` 当前实现
>
> 基线版本：`0.1.0` / private / experimental；当前发布版本为 `0.1.0-beta.1`
>
> 当前阶段：P0-P4 已完成
>
> 最近复核：2026-08-06

## 1. 目标

把当前“可逆归档与恢复基础设施”提升为边界准确、故障可验证、能够保留关键语义的 conversation lifecycle mutation implementation。

优化完成后应满足：

- producer 与 restore 遵守 Archive Protocol v1，并由共享 fixtures 验证；
- compress/restore 在崩溃、重试和受控并发下不会静默丢失或覆盖 conversation artifacts；
- summary 保留继续推理所需的目标、事实、约束、决策、关键工具发现和未完成工作；
- context budget 的输入、保留量和估算误差可解释；
- CLI、结果对象和 metadata 不宣称不存在的能力，指标语义明确。

## 2. 当前基线

已具备：

- 按 idx 聚合 turn，并整体处理 assistant message/calls/result/extra；
- system turn 保留、threshold、keepRecent 与 dry-run；
- staging → archive commit、`compression.json`、restore、recovery 与 recompress；
- restore destructive preflight、部分恢复重试与冲突检测；
- 协议中性的 archive summary 与准确的 CLI capability 描述；
- 含 8 类状态的 Archive Protocol v1 共享 conformance corpus；
- 明确区分 live-before、summary 与 live-after 的 producer token metadata；
- cooperating-writer directory lock、same-host stale-lock recovery 与 conversation generation precondition；
- 可注入 mutation boundary、atomic temp cleanup 与 retry regression tests；
- staging/archive-aware dry-run simulation 与可信统计；
- 89 个 producer/lifecycle tests 与 4 个独立 consumer tests，覆盖 filesystem、protocol、CLI、semantic summary、budget/tokenizer、orchestrator 和跨包行为。

本轮计划缺口已关闭；真实上层应用接线、grep query surface 和长期版本迁移演练作为后续独立工作推进。

## 3. 约束与非目标

- Archive Protocol 与 Conversation Protocol 是上层契约，本 package 不私自扩展 consumer 必须理解的格式。
- summary 生成失败、为空、超出预算或目录已变化时，不能提交 archive。
- grep、`lookup_archive`、`read_archived_turn`、embedding、vector index、ranking 和 retrieval MCP server 不属于本 package。
- 不在普通 Promptpile completion 中隐式触发有副作用的 lifecycle mutation；自动化由 orchestrator 显式安排 exclusive phase。
- 优先完善单 archive 模型；没有明确收益和迁移方案前，不增加分层 archive。

## 4. 实施阶段

阶段必须按顺序推进；每个阶段满足验收标准后再开始下一阶段。

### P0 · 契约与对外语义收敛（已完成：2026-08-06）

完成结果：

- summary 与 CLI 已改为协议中性描述，不再承诺 `lookup_archive` 等具体工具；
- `fixtures/archive-protocol-v1/` 覆盖合法最小 manifest、未知字段、错误 version、重复/负数 idx、目录 idx 不匹配、summary 缺失与 staging 忽略；
- producer、restore preflight 与不 import compress 私有 parser 的只读验证器共用 corpus；
- token metadata 使用 `liveTokenCountBefore`、`summaryTokenCount`、`liveTokenCountAfter`；历史字段继续按未知 producer metadata 兼容；
- compress 中不可达的 `rolled_back_staging` skip reason 已移除；
- conformance paths 均验证 fixture 在执行前后 byte-for-byte 不变。

### P1 · Mutation safety 与可恢复性（已完成：2026-08-06）

完成结果：

- `.promptpile-compress.lock.<host>.<pid>.<owner>` 唯一锁集合通过原子发布、同机死进程精确路径清理与清理后重扫保证同一目录只有一个 cooperating lifecycle writer；metadata 记录 owner、PID、host、operation 与创建时间，旧固定锁 fail closed；
- 同主机 dead PID lock 自动恢复，跨主机、live PID 与损坏 metadata fail closed；
- scan 前后、summary 后及 staging 创建前校验 SHA-256 generation，检测到 conversation/archive/staging 变化即拒绝提交；
- mutation hook 覆盖 staging、manifest、summary、archive commit、restore 与 cleanup，故障测试验证重试或 fail-closed 行为；
- atomic write 失败会清理临时文件；POSIX sync file 与 parent directory，Windows 保留 file sync + same-directory rename 保证；
- staging/archive dry-run 在隔离临时副本执行 lifecycle 规划模拟，目标目录不变，selection、turn 统计与压缩前 token 统计和随后真实执行一致；summary 使用 provider-free 保守上限；
- 设计明确保留 orchestrator exclusive-phase 前提，不把 package lock 描述为跨系统事务。

### P2 · Semantic summary（已完成：2026-08-06）

完成结果：

- turn selector 与 summary generator 已拆分，`sliding-window` 不再绑定 provider；
- 默认 `archive-pointer` 不读取 API key、不联网，程序化 API 可显式注入 semantic provider；
- v1 schema 覆盖 goal、stable facts、constraints、decisions、important tool findings、completed/unresolved work、failed approaches 与 next actions；
- 规范化输入保留 role、idx、message/calls/result/extra 原文及输入/输出预算；
- 完整结构、非空来源、archived idx、provider timeout/error 与输出预算均在 staging 前校验；
- dry-run 与 orchestrator estimate plan 不调用 provider，实际 compress phase 每次只生成一次 semantic summary；
- `fixtures/semantic-summary-v1/` 提供 deterministic provider output 与人工可复核质量样本；
- regression 覆盖成功 compact context、异常/超时/无效/超预算零 mutation，以及 semantic compress → restore byte-for-byte 精确还原。

### P3 · Context budget 与性能（已完成：2026-08-06）

完成结果：

- 引入 `TokenizerAdapter`，默认明确使用 `promptpile-unicode-heuristic-v1` fallback，并提供按 model 创建和释放的 `tiktoken@1.0.22` exact adapter；
- `fixtures/tokenizer-benchmark-v1/` 固定中英文 Markdown、JSON/JSONL 与 tool-heavy reference counts，并校验 exact 稳定性和 heuristic 误差边界；
- context budget 统一 model context、reserved output、system/tool overhead、target live history、summary limit 与 safety margin；旧 `threshold` 保留为互斥兼容模式；
- trigger、连续 recent suffix selection、summary output validation、dry-run 与 `ContextBudgetReport` 使用同一 resolved budget；预算报告用 `upper-bound` / `actual` 区分规划上限和真实 summary token；
- scanner 并行读取并缓存 live artifacts，tokenizer 与 semantic provider 不再重复读取；generation precondition 继续独立复核；
- `npm run benchmark -w promptpile-compress` 提供可调规模的 current/legacy two-pass 对比；1,000 turns / 3,000 artifacts Windows 样本为 244.17 ms 对 967.53 ms（3.96×）。

### P4 · 集成与成熟度（已完成：2026-08-06）

完成结果：

- `runCompressionBeforeCompletion` 按 resolved directory 串行 plan → acquire → compress → release → completion；测试验证下一次 lifecycle phase 不与 active completion 重叠；
- `CompressionOperationReport` 覆盖 phase、recovery actions、selection、budget、commit state 与稳定 error code，并验证不泄露 conversation/provider 原始内容；
- `promptpile-compress-grep-search` 成为 active workspace，production reader 仅依据公开协议实现 discovery/read-turn，architecture guard 禁止 implementation dependency；
- producer 公共 API → 独立 consumer 的 integration test 验证 message/calls/result mapping 以及读取前后 byte-for-byte 不变；
- 新增 Node 18/22 × Ubuntu/Windows filesystem matrix，Pages/root gates 同步包含 consumer；发布质量门记录命令、平台和兼容策略；
- 完成成熟度评估：producer 与独立 retrieval consumer 均以 `0.1.0-beta.1` 公开预发布；继续通过真实上层接线与版本迁移演练验证兼容性。

## 5. 优先级与依赖

```text
P0 契约准确性（已完成）
    ↓
P1 mutation safety（已完成）
    ↓
P2 semantic summary（已完成）
    ↓
P3 context budget / performance（已完成）
    ↓
P4 orchestrator integration / maturity（已完成）
```

P0 是低成本正确性修复；P1 先保护 authoritative conversation state；P2 提供压缩的核心语义价值；P3 在 summary 输入输出模型稳定后统一预算；P4 最后扩大自动化和发布面。

## 6. 每阶段通用完成定义

- 实现、类型、CLI help、package 文档和上层 contract 文档一致；
- 新行为有成功、失败、dry-run 与恢复路径测试；
- `npm test -w promptpile-compress` 通过；
- 涉及 Archive Protocol 时，producer/restore/consumer conformance tests 通过；
- 没有把独立 retrieval consumer 的职责重新引入本 package；
- 已完成工作从本计划移除或压缩为简短基线，不保留新的历史计划副本。

## 7. 文档治理

本 package 只维护两份主动文档：

- `DESIGN.md`：描述当前职责、边界和已经存在的行为；
- `OPTIMIZATION_PLAN.md`：描述尚未完成、可验收的优化工作。

协议语义以 `../../doc/15-contracts/` 为准。完成的 implementation plan、阶段性 status snapshot 和被取代的设计不在 package 内归档，追溯使用 Git 历史。
