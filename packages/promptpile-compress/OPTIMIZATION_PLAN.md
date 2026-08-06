# promptpile-compress 优化计划

> 状态：Active  
> 适用范围：`packages/promptpile-compress` 当前实现  
> 基线版本：`0.1.0` / private / experimental  
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
- 22 个 filesystem behavior tests，当前全部通过。

主要缺口：

- `sliding-window` 只生成 archive pointer，不做 semantic distillation；
- summary 和 CLI 仍暗示 package 具备 retrieval 能力，实际不存在；
- Archive Protocol 尚无 producer/restore/consumer 共用的 conformance corpus；
- 字符估算仅适合作为粗略 trigger，`tiktoken` optional dependency 尚未使用；
- mutation 依赖 exclusive-writer 前提，但代码未锁定、未检测长耗时步骤期间的目录变化；
- fault-injection 覆盖不足，atomic write 临时文件和各 commit 边界的恢复语义尚未系统验证；
- 已有 archive 或 staging 时，dry-run 返回的信息不足以描述实际后续动作；
- `compressedTokenCount` 当前只记录 summary 估算值，名称容易被理解为压缩后的 live 总量。

## 3. 约束与非目标

- Archive Protocol 与 Conversation Protocol 是上层契约，本 package 不私自扩展 consumer 必须理解的格式。
- summary 生成失败、为空、超出预算或目录已变化时，不能提交 archive。
- grep、`lookup_archive`、`read_archived_turn`、embedding、vector index、ranking 和 retrieval MCP server 不属于本 package。
- 不在普通 Promptpile completion 中隐式触发有副作用的 lifecycle mutation；自动化由 orchestrator 显式安排 exclusive phase。
- 优先完善单 archive 模型；没有明确收益和迁移方案前，不增加分层 archive。

## 4. 实施阶段

阶段必须按顺序推进；每个阶段满足验收标准后再开始下一阶段。

### P0 · 契约与对外语义收敛

工作项：

1. 将 summary 改为协议中性的 archive 提示，不引用某个必然存在的 retrieval tool。
2. 修正 CLI/package 文案中的“检索”描述，明确本包只负责 compress/archive/restore/recovery。
3. 建立 Archive Protocol v1 conformance corpus，由 producer、restore 和独立 consumer 共用；至少覆盖合法最小 manifest、未知字段、错误 version、重复/负数 idx、目录 idx 不匹配、summary 缺失和 staging 忽略。
4. 明确 invalid/incomplete archive 的行为矩阵：producer/restore fail closed，read-only consumer 报错但不修复。
5. 定义 producer token metadata 的准确含义。优先增加语义清楚的字段（例如 summary 与 live-after 分开），避免继续扩大 `compressedTokenCount` 的歧义。
6. 清理未使用或不可达的公开类型状态，例如当前不会由 compress 返回的 `rolled_back_staging` skip reason。

验收标准：

- 仓库搜索不到 compress 对 `lookup_archive` 可用性的硬编码承诺；
- producer 生成物通过 conformance corpus，restore 接受未知 metadata 字段；
- 所有无效 fixture 在文件变更前失败，consumer fixture 测试保持只读；
- CLI help、TypeScript result 和 manifest 指标可由文档逐项解释。

### P1 · Mutation safety 与可恢复性

工作项：

1. 为 cooperating lifecycle writers 增加 directory-level lock；记录 owner、创建时间与恢复策略，使用原子创建避免双写者同时获得锁。
2. 在 scan/summary 与 commit 之间校验 conversation generation 或内容指纹；检测到 non-cooperating writer 的变化时放弃提交并保留原文件。
3. 明确锁只协调遵守协议的 writer；orchestrator 仍必须保证 active completion 与 lifecycle mutation 不并行。
4. 抽出可注入的 filesystem mutation boundary，增加 fault-injection tests：移动到 staging、写 manifest、写临时 summary、rename archive、写 live summary、restore summary 删除、逐文件恢复、archive cleanup。
5. 为 atomic write 增加失败后的临时文件清理与重试测试；评估需要的 file/directory sync 边界并记录跨平台保证。
6. 改善 staging/archive 状态报告，使 dry-run 能展示 recovery、restore、recompress 的计划动作和可信 token/turn 统计，而不是返回全零占位。

验收标准：

- 两个 cooperating writers 不能同时 mutation 同一目录；
- scan 后发生外部写入时 compress 在移动任何文件前退出；
- 每个注入故障点均有“可自动重试”或“明确 fail closed”的测试结论；
- 任意失败路径都不覆盖同名 conversation artifact，不把不完整 turn 当作成功提交；
- dry-run 前后目录 byte-for-byte 不变，报告与随后真实执行的计划一致。

### P2 · Semantic summary

工作项：

1. 把“选择哪些 turns”与“如何生成 summary”拆成独立接口，避免 selection strategy 绑定具体 LLM/provider。
2. 定义稳定的 summary schema，至少包含：goal、stable facts、constraints、decisions、important tool findings、completed work、unresolved work、failed approaches、next actions 和可追溯 idx。
3. 通过依赖注入接入 summary provider；默认不隐式读取 API key 或访问外部服务。
4. 在调用 provider 前构建规范化输入，保留 role、idx 与 tool artifact 关系，并设定输入/输出预算。
5. 校验空输出、结构缺失、超预算、provider timeout/error；任何失败均发生在 filesystem mutation 之前。
6. 使用 deterministic fake provider 和固定 conversation fixtures 做 regression；另设人工质量样本评估关键信息保留率，而不是只比较文本快照。

验收标准：

- 固定 fixtures 中列出的目标、约束、决策、关键发现和未完成工作均能在 compact context 中定位；
- summary 的每项历史陈述可追溯到 archived idx，且不伪造 retrieval capability；
- provider 失败、无效输出和超预算时目录完全不变；
- compress → restore 后原始 message artifacts 内容与文件名完全一致。

### P3 · Context budget 与性能

工作项：

1. 引入 tokenizer adapter，保留显式标记的 heuristic fallback；先用中英文 Markdown、JSON/JSONL 和 tool-heavy fixtures 测量误差，再决定保留或移除未使用的 `tiktoken` dependency。
2. 将单一 threshold 拆成可解释预算：model context、reserved output、system/tool fixed overhead、目标 live history 与 safety margin。
3. 让 trigger、selection、summary output limit 和结果报告使用同一 budget model，避免各自重复估算。
4. 对大目录减少重复读文件和串行 I/O；用基准确认优化收益，不以牺牲一致性校验为代价。

验收标准：

- 每种 tokenizer adapter 都有版本/模型标识、误差基准和 fallback 行为；
- 给定同一目录与 budget 配置，dry-run 和真实执行得到相同 selection；
- 结果报告能解释 `tokensBefore`、固定预留、summary、kept history 与 safety margin；
- 性能改动附带可复现基准，且协议/恢复测试无回归。

### P4 · 集成与成熟度

工作项：

1. 为 orchestrator 定义显式 lifecycle API：estimate/plan → acquire exclusive phase → compress → release → completion。
2. 增加结构化 operation report，包含 recovery actions、selection、预算、commit 状态和可操作错误码；日志不得包含完整敏感 conversation 内容。
3. 建立跨 package integration tests，验证 producer archive 可由独立 consumer 读取，consumer 不依赖本包私有源码或 `dist`。
4. 补齐 Node 支持矩阵与 Windows/POSIX filesystem CI；检查 lock、rename、fsync 和中断恢复差异。
5. 仅在协议 fixtures、semantic quality gate、并发模型和 integration tests 稳定后评估取消 `private` / `experimental`。

验收标准：

- orchestrator 集成不存在 active completion 与 compress/restore 的未协调并发；
- operation report 足以诊断一次失败而无需解析自由文本日志；
- producer/consumer cross-package tests 在 CI 中运行；
- 发布前质量门槛有明确测试命令、支持平台和兼容策略。

## 5. 优先级与依赖

```text
P0 契约准确性
    ↓
P1 mutation safety
    ↓
P2 semantic summary
    ↓
P3 context budget / performance
    ↓
P4 orchestrator integration / maturity
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
