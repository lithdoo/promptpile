# promptpile-compress 设计文档

## 概述

`promptpile-compress` 是一个**独立的会话目录压缩与检索工具**。它直接操作 promptpile 消息目录，提供两个核心命令：

1. **`compress`** — 将历史轮次归档并生成摘要，减少上下文 token 消耗
2. **`restore`** — 将归档的轮次还原到消息目录

此外还提供检索能力（`lookup_archive` / `read_archived_turn` 工具及 MCP 服务），让 LLM 按需查询被归档的原文。

它**不调用 promptpile**，也**不依赖 promptpile 运行**。它和 promptpile 之间唯一的交集是文件命名约定（`[idx]role.ext`）——promptpile 写目录，它操作目录，promptpile 再读目录。两者通过文件系统协作，而非进程调用。

### 设计目标

- **不调用 promptpile** — 本工具是独立的目录操作器，不是 promptpile 的消费者。摘要生成直接调用 LLM API
- **零侵入** — 不修改 promptpile 核心。promptpile 的 `scanDirectory` 只扫描目录顶层文件，归档到子目录即可让旧轮次对 promptpile "不可见"
- **文件即状态** — 压缩结果物化为文件系统变更（归档 + 摘要），可审计、可 `git diff`、可版本控制
- **独立 CLI + 可嵌入** — 可手动调用、可放入脚本、可被上层工具作为子进程集成、可作为 MCP server 运行
- **可逆** — 原始文件移动到 `[idx]system.md.archive/` 子目录而非删除，删除该目录即可恢复
- **轮次感知** — 以 turn（相同 `[idx]` 的所有文件）为最小压缩单元，不拆散 tool_call/result 配对

---

## 问题分析

promptpile 的核心理念是**文件驱动对话**：每一轮对话（用户消息、助手回复、工具调用、工具结果）都物化为 `[idx]role.ext` 格式的文件。这个机制天然适合多轮交互，但也导致消息目录随时间线性膨胀：

```
messages/
  [0]system.md                     ← idx 0: system prompt
  [1]user.md                       ← idx 1: 第一条用户消息
  [2]assistant.md                  ← idx 2: 助手回复 + 工具调用/结果
  [2]assistant.calls.jsonl
  [2]assistant.result.jsonl
  [3]user.md                       ← idx 3: 第二条用户消息
  [4]assistant.md
  [4]assistant.calls.jsonl
  [4]assistant.result.jsonl
  ...
  [47]assistant.md                 ← 不断增长，超出上下文窗口
  [47]assistant.calls.jsonl
  [47]assistant.result.jsonl
```

无论是哪种使用模式，只要轮次足够多，最终都会遇到上下文窗口限制：

| 使用场景 | 膨胀来源 |
|---|---|
| `promptpile` 手动多轮 | 每次 `-c` 追加 assistant + calls + results |
| 任意编排循环 | 循环中持续追加 user + assistant + tool 消息 |
| `promptpile-mcp` | exec-calls 产生大量 tool result 文件 |

### 压缩要解决的核心矛盾

- 后续轮次的推理依赖历史上下文（之前的决策、工具结果、用户意图）
- 但历史上下文不能无限增长，必须控制在模型的 token 预算之内
- **压缩 = 用更少的 token 保留等价的上下文信息**

---

## 架构设计

### 在生态中的位置

```
                        文件系统（消息目录）
                    ┌──────────────────────┐
   promptpile ──写──→  [0]system.md        ←──读── promptpile
                      [1]user.md
                      [2]assistant.md      ←──读── MCP 客户端
                      [2]assistant.calls.jsonl
                      ...
                    ──────────────────────────
                    ↑ 操作        ↑ 读取
                    │             │
              promptpile-compress │
              ├─ 扫描目录          │
              ├─ 调用 LLM API 生成摘要
              ├─ 归档旧轮次到 .archive/
              ├─ 写入 [N]system.md
              └─ 暴露 MCP server（检索工具）
```

`promptpile-compress` 与 `promptpile` 之间**没有进程调用关系**。两者通过共享的消息目录协作：

- promptpile 负责：组装文件 → 调用 LLM API → 流式输出 → 写回新轮次
- promptpile-compress 负责：扫描目录 → 估算 token → 调用 LLM API 生成摘要 → 归档 + 写入摘要文件 → 暴露检索服务

LLM API 调用是各自独立的：promptpile 调用 API 做对话推理，promptpile-compress 调用 API 做上下文摘要。两者可以使用完全不同的模型和 API endpoint。

### 包目录结构

```
packages/promptpile-compress/
├── package.json
├── tsconfig.json
├── DESIGN.md                    ← 本文件
├── src/
│   ├── index.ts                 # CLI 入口 (#!/usr/bin/env node)
│   ├── compress.ts              # 核心压缩编排
│   ├── scanner.ts               # 扫描消息目录，按 [idx]role.ext 命名约定解析
│   ├── tokenizer.ts             # Token 估算
│   ├── llm-client.ts            # 轻量 LLM API 调用（不依赖 promptpile）
│   ├── atomic-file.ts           # 原子文件写入
│   ├── strategies/
│   │   ├── summarize.ts         # 策略A：LLM 摘要
│   │   ├── sliding-window.ts    # 策略B：滑动窗口
│   │   └── hierarchical.ts      # 策略C：分层压缩
│   ├── archiver.ts              # 文件归档/恢复
│   ├── manifest.ts              # compression.json 读写
│   ├── prompt-builder.ts        # 构建摘要 prompt
│   ├── mcp/                     # MCP 服务
│   │   ├── server.ts            # MCP stdio server（serve 子命令）
│   │   └── types.ts             # MCP 协议类型
│   ├── tools/                   # 原文检索工具
│   │   ├── types.ts             # LookupBackend 抽象接口
│   │   ├── registry.ts          # 后端注册与选择
│   │   ├── generate-tools-toml.ts  # 自动生成 compressed-tools.toml
│   │   ├── tool-executor.ts     # 工具调用分发（CLI lookup 子命令）
│   │   └── backends/
│   │       ├── file-grep.ts     # 后端A：文件系统 grep
│   │       ├── mcp.ts           # 后端B：MCP 网关代理
│   │       └── vector.ts        # 后端C：向量语义搜索
│   └── types.ts                 # 公共类型定义
```

---

## 文件布局设计

### 压缩前

```
messages/
  [0]system.md
  [1]user.md
  [2]assistant.md
  [2]assistant.calls.jsonl
  [2]assistant.result.jsonl
  [3]user.md
  [4]assistant.md
  [4]assistant.calls.jsonl
  [4]assistant.result.jsonl
  [5]user.md
  [6]assistant.md
  [6]assistant.calls.jsonl
  [6]assistant.result.jsonl
  [7]user.md
  [8]assistant.md
```

### 压缩后（保留最近4轮，压缩 idx 1-5）

```
messages/
  [0]system.md                   ← system 消息，永不压缩
  [5]system.md                   ← 压缩摘要，覆盖 idx 1-5，system 消息
  [5]system.md.archive/          ← idx 1-5 原文
    [1]user.md
    [2]assistant.md
    [2]assistant.calls.jsonl
    [2]assistant.result.jsonl
    [3]user.md
    [4]assistant.md
    [4]assistant.calls.jsonl
    [4]assistant.result.jsonl
    [5]user.md
    compression.json
  [6]assistant.md                ← 保留（最近轮次，idx 不变）
  [6]assistant.calls.jsonl
  [6]assistant.result.jsonl
  [7]user.md
  [8]assistant.md
```

Note: `[0]system.md` 和 `[5]system.md` 都是 `*.system.md`，永不参与压缩。只有非 system 轮次的 user/assistant/tool 文件被归档。

### 重压缩

当对一个已有压缩归档的目录再次执行 `compress` 时，不产生多个 `.archive/` 目录，而是**先还原全部历史，再重新压缩为一个摘要**：

```
compress() 启动:

  1. 检测是否存在 [*]system.md.archive/
     若无 → 首次压缩，走正常流程

  2. 若有 → 重压缩流程：
     a. 按 idx 从新到旧排列所有 .archive/ 目录
     b. 对每个 .archive/：
        - 将其中的文件移回消息目录顶层
        - 删除对应的 [idx]system.md
        - 删除 [idx]system.md.archive/
     c. 现在消息目录包含完整对话历史（无任何压缩痕迹）
     d. 对完整历史执行正常 compress() 流程
```

这样保证任意时刻一个消息目录最多只有一个 `[idx]system.md.archive/` 和一个 `[idx]system.md`，目录结构始终简洁。

### 关键设计点

1. **不重新编号**：保留的轮次保持原有 idx，避免破坏引用关系。`scanDirectory` 按 idx 排序，gap 不影响消息组装。

2. **归档到 `.archive` 子目录**：利用 promptpile 的 `scanDirectory` 只扫描目录顶层文件的特性实现零侵入。归档目录命名为 `[idx]system.md.archive`，与摘要文件 `[idx]system.md` 一一对应。再次压缩时先还原上一次归档再重新压缩，保证一个消息目录中永远只有一对摘要 + 归档。

3. **摘要生成为新文件**：不对 `[0]system.md` 做任何修改。摘要生成一条新的 `[idx]system.md` 消息，`idx` 取被压缩轮次的最大序号，使摘要在消息序列中恰好填充被归档轮次的原位置。LLM 看到的是：system prompt → 摘要 → 最近轮次，而非 system prompt 内容被篡改。

4. **压缩策略：system 不动，其余平等对待**：
   - **所有 `*.system.md` 永不压缩**。不论 `[0]system.md`（用户编写的 system prompt）还是之前压缩产生的 `[3]system.md`，只要文件名匹配 `*.system.md`，该 turn 就从候选压缩集合中排除。System 消息定义行为约束、输出格式、安全边界，或承载历次压缩的上下文摘要——任何改写都可能引入偏差或丢失上下文。Claude Code 与 OpenCode 的做法一致：所有 system 消息被视为 immutable，不属于对话历史管理范畴。
   - **初始用户消息无特殊保护**。第一条 user.md（通常是 `[1]user.md`）与其他旧轮次一起参与压缩。摘要本身自然包含任务语义，不需要原文锚定。
   - **压缩扫描时跳过 system turn**：`selectTurns()` 在分组时检查每个 turn 是否包含 `*.system.md` 文件——若包含则自动归类到 `keep[]`。

5. **元数据内聚**：`compression.json` 存放在对应的 `[idx]system.md.archive/` 目录内，而非散落在消息目录顶层。删除一个 `.archive` 目录即可彻底清理一次压缩的所有痕迹。

---

## 事务与断点恢复

单文件原子写（`write-temp + rename`）保证每个文件自身不会被写坏，但压缩操作涉及多个文件的状态迁移，需要在整体上保证一致性。

### 不一致状态分析

如果按"先写摘要，再逐个移动文件"的顺序，崩溃可能产生三种脏状态：

| 崩溃时机 | 状态 | 后果 |
|---|---|---|
| 摘要已写，文件未移 | 摘要 + 原文同时可见 | promptpile 扫描到双份信息，压缩白做 |
| 摘要已写，部分文件已移 | 同上，且部分 turn 被拆散 | call/result 配对断裂 |
| 文件已移，摘要未写 | 原文消失，摘要不存在 | 上下文出现空洞 |

### 两阶段提交

核心思想：**归档目录的原子 rename 作为提交点**。提交前一切可回滚，提交后保证完成。

```
Phase 1 — 准备（可回滚）

  1. scanner.scanTurns(directory) → turns
  2. tokenizer.estimateTotal(turns)
     若 < threshold → 跳过，返回 { compressed: false }
  3. strategy.selectTurns(turns) → { keep, archive }

  4. llm.callChatCompletions(buildSummaryPrompt(archive)) → summary

  5. 创建暂存目录
     mkdir .promptpile-compress.staging/
     // 在消息目录内，但子目录不会被 promptpile 扫描

  6. 移动待归档文件到暂存目录
     for each turn in archive:
       for each file in turn.files:
         fs.rename(file, .staging/file)
     // 逐文件移动。若中途崩溃 → 进入恢复流程

  7. 写入暂存目录内的元数据
     write .staging/compression.json  { status: "preparing", ... }
     write .staging/.summary.md        (摘要正文，固定名称，便于识别)

     // .staging/ 此时的内容：
     //   [1]user.md                  ← 原始消息文件（匹配 [idx]role.ext）
     //   [2]assistant.md             ← 同上
     //   [2]assistant.calls.jsonl    ← 同上
     //   compression.json            ← 元数据（恢复时排除）
     //   .summary.md                 ← 摘要临时文件（恢复时排除）

Phase 2 — 提交（不可回滚）

  8. fs.rename(.staging, [summaryIdx]system.md.archive/)
     // 同文件系统的 rename 是原子的。成功 → 提交完成

  9. atomicWrite([summaryIdx]system.md, summary)
     // 将摘要以最终命名写入消息目录顶层
     // 注：.summary.md 已随 staging 进入 .archive/，此处写入顶层文件

 10. 更新 compression.json
     write .archive/compression.json { status: "complete", ... }
```

### 恢复流程

每次 `compress` 或 `restore` 启动时，先执行恢复检查：

```
recover(directory):

  1. 检测 .promptpile-compress.staging/
     若存在：
       // 上一次 compress 在 Phase 1 中崩溃
       for each file in .staging/:
         if file matches [idx]role.ext 模式:     // ← 只移回原始消息文件
           fs.rename(file, directory/)
         else:
           skip  // 跳过 compression.json、.summary.md 等元数据
       fs.rmdir(.staging/, { recursive: true })  // 删除暂存目录及残留元数据
       // 回滚完成，消息目录恢复压缩前状态

  2. 检测 [*]system.md.archive/ 但缺少对应的 [*]system.md
     若存在：
       // 上一次 compress 在步骤 8 之后、步骤 9 之前崩溃
       // .archive/ 内已含 compression.json 和 .summary.md
       summary = read .archive/compression.json → summary
       atomicWrite([idx]system.md, summary)    // 完成收尾
       update .archive/compression.json status = "complete"
```

### 状态机

```
                   ┌─────────┐
                   │  idle   │
                   └────┬────┘
                        │ compress() 调用
                   ┌────▼────┐
                   │ preparing│  .staging/ 存在
                   └────┬────┘
                        │
              ┌─────────┼─────────┐
              │ 崩溃     │ 成功     │
         ┌────▼────┐ ┌──▼──────────▼──┐
         │ recovery│ │   committed    │
         │ 回滚    │ │ .archive/ 存在  │
         └────┬────┘ │ [idx]system.md │
              │      │ 存在            │
              │      └────────────────┘
              │
         ┌────▼────┐
         │  idle   │  (可重新 compress)
         └─────────┘
```

### 关键保证

- **摘要与原文不会同时可见**。提交点（`rename .staging → .archive`）在所有文件移动完成之后，摘要写入之前。提交前原文已从顶层消失但摘要在 `.staging` 内不可见；提交后原文在 `.archive` 内不可见而摘要可见。
- **部分移动可回滚**。只要 `.staging` 存在，恢复流程就把它里面的文件全量移回顶层。
- **提交后必然完成**。如果 `.archive` 存在但摘要缺失，恢复流程从 `compression.json` 中取出摘要文本补写 `[idx]system.md`。
- **不依赖外部锁**。两个 promptpile-compress 进程同时操作同一目录可能导致竞态，但这是调用者的责任（类似两个 `git add` 同时跑）。

---

## 压缩策略

### 策略 A：摘要合并（summarize）

**适用场景**：需要保留历史推理过程的关键信息（复杂多步任务、调试场景）。

**算法**：
1. 将待压缩轮次的文件按顺序拼接为文本
2. 构建摘要 prompt（可自定义模板）
3. 调用 LLM 生成结构化摘要
4. 摘要写入新的 `[summaryIdx]system.md`

**默认摘要 prompt 模板**：

```
你是一个上下文压缩器。请将以下对话轮次压缩为结构化摘要。

要求：
- 保留所有关键决策及其理由
- 保留用户明确表达的偏好和约束
- 保留未解决的问题和待办事项
- 保留工具调用中的重要发现
- 丢弃冗余的工具输出细节
- 丢弃已完全解决的子任务

输出格式：
## 关键决策
- ...

## 用户偏好与约束
- ...

## 重要发现
- ...

## 未解决问题
- ...
```

**优点**：信息密度最高，保留语义。
**缺点**：需要额外 LLM 调用，有成本和延迟。

### 策略 B：滑动窗口（sliding-window）

**适用场景**：对话逻辑线性，早期轮次参考价值低（如简单的 Q&A 链）。

**算法**：
1. 保留最近 N 轮（`keepRecent` 参数）
2. 其余轮次直接归档
3. 生成一条简短摘要："第1-X轮已被归档，可通过 lookup_archive 检索"
4. 写入 `[summaryIdx]system.md`

**优点**：零额外 LLM 成本，最快。
**缺点**：彻底丢失历史信息，可能遗漏早期关键决策。

### 策略 C：分层压缩（hierarchical）

**适用场景**：轮次非常多（50+），信息价值随距离递减。

**算法**：
1. 将轮次分为三层：
   - **热层**（最近 N 轮）：完整保留
   - **温层**（中间 M 轮）：保留关键决策和事实（轻量摘要）
   - **冷层**（最远 K 轮）：合并为一句摘要
2. 温层和冷层分别生成摘要，合并后写入 `[summaryIdx]system.md`

**优点**：在信息保留和 token 消耗之间取得平衡。
**缺点**：需两次 LLM 调用（温层 + 冷层），配置参数多。

---

## 原文检索：两层记忆模型

### 设计动机

压缩引入了一个新问题：摘要会丢失细节。后续轮次中 LLM 可能需要确认"第3轮那个报错具体是什么？"——摘要未必保留了这些微观信息。

解决方式是 **两层记忆**：工作记忆（摘要 + 最近轮次，LLM 直接可见）+ 归档记忆（原文在 `.archive/` 中，通过工具按需检索）。核心原则：**不让 LLM 记住一切，让它知道可以去哪里找**。

### 统一工具接口

无论底层用什么检索技术，LLM 看到的工具签名是相同的：

```toml
# 由 promptpile-compress 压缩后自动生成：compressed-tools.toml

[[tools]]
name = "lookup_archive"
description = "在已归档的历史对话中搜索。当摘要信息不足以回答问题或需要确认某个具体细节时使用。当前归档范围：第1-5轮，共 34,200 tokens 原文。"
parameters = { type = "object", properties = {
  query = { type = "string", description = "搜索关键词、短语或自然语言描述" },
  max_results = { type = "integer", description = "最大返回条数", default = 5 }
}, required = ["query"] }

[[tools]]
name = "read_archived_turn"
description = "读取指定轮次的完整原始内容。"
parameters = { type = "object", properties = {
  idx = { type = "integer", description = "要读取的轮次编号（归档范围：1-5）" },
  include_tool_results = { type = "boolean", description = "是否包含工具调用结果", default = true }
}, required = ["idx"] }
```

两个工具的语义分工：
- `lookup_archive` — **发现**："我不知道要找哪一轮，帮我搜"
- `read_archived_turn` — **精读**："我知道是第2轮，把原文给我"

### 后端抽象

三种检索方式共享同一个 `LookupBackend` 接口，通过配置切换：

```typescript
// tools/types.ts

/** 统一检索结果 */
export interface LookupResult {
  /** 匹配的轮次索引 */
  turnIdx: number;
  /** 相关性分数（0-1），grep 后端为字符串匹配率，vector 后端为余弦相似度 */
  score: number;
  /** 匹配片段（前后各 200 字符的上下文） */
  snippet: string;
  /** 匹配所在的文件角色 */
  role: string;
}

export interface ReadTurnResult {
  turnIdx: number;
  messages: Array<{
    role: string;
    content: string;
    toolCalls?: Array<{ name: string; arguments: string }>;
    toolResult?: string;
  }>;
}

/** 所有检索后端实现此接口 */
export interface LookupBackend {
  readonly name: 'file-grep' | 'mcp' | 'vector';
  readonly description: string;

  /** 搜索归档轮次，返回匹配片段 */
  lookup(query: string, maxResults: number): Promise<LookupResult[]>;

  /** 读取指定轮次的完整内容 */
  readTurn(idx: number, includeToolResults: boolean): Promise<ReadTurnResult | null>;

  /** 后端初始化（如建立向量索引、连接 MCP 网关等） */
  initialize?(options: BackendInitOptions): Promise<void>;

  /** 后端清理 */
  dispose?(): Promise<void>;
}
```

---

### 三种检索后端

| | file-grep | mcp | vector |
|---|---|---|---|
| **原理** | 对 `.archive/` 目录 grep | 委托 MCP filesystem server | embedding + 向量索引 |
| **查询能力** | 关键词匹配 | 依赖 MCP server 能力 | 语义匹配 |
| **外部依赖** | 无 | promptpile-mcp 网关 | embedding 模型 + 向量存储 |
| **适合规模** | < 20 轮 | 任意 | > 50 轮 |
| **启动成本** | 零 | 需启动网关 | 需构建索引 |

支持组合降级：`backend = ["vector", "file-grep"]`，vector 失败时自动回退到 grep。

索引文件（仅 vector 后端）存放在 `[idx]system.md.archive/.vector/` 目录下。

### 工具生成流程

压缩完成后，自动生成 `compressed-tools.toml`：

```
compress() 完成后:

  1. 读取 compression.json → 获取归档范围、轮次总数

  2. 根据配置的后端，生成对应的工具描述：
     - file-grep: 在 description 中注明 "在 [3]system.md.archive/ 目录中搜索"
     - mcp: 在 description 中注明 "通过 MCP 网关搜索"
     - vector: 在 description 中注明 "语义搜索已归档的对话"

  3. 工具参数中注入归档元数据：
     - idx 的有效范围
     - 归档原文总 token 数（让 LLM 知道"档案库"的大小）

  4. 写入 compressed-tools.toml 到消息目录

  5. 如果后端是 vector，额外触发索引构建
```

### 工具执行路径

检索工具以三种方式暴露：

1. **MCP server**（推荐）— `promptpile-compress serve` 启动 stdio MCP server，任何 MCP 客户端可以直接调用 `lookup_archive` / `read_archived_turn`
2. **独立 CLI** — `promptpile-compress lookup --calls-file [N]assistant.calls.jsonl` 直接处理单个 calls 文件并写回 result
3. **库模式** — `import { executeLookupTool } from 'promptpile-compress'` 程序化调用

---

## Token 估算

### 问题：直接拼文件不等于 API payload

简单地把文件内容拼接起来估算 token 是不准确的，因为 promptpile 在组装 API 请求时做了以下变换：

| 文件 | 存储格式 | API 中的格式 |
|---|---|---|
| `[idx]role.md` | YAML front matter + 正文 | 剥离 front matter → `{role, content}` |
| `[idx]assistant.calls.jsonl` | 每行一个 `{id, type, function: {name, arguments}}` | 嵌入 assistant 消息的 `tool_calls: [...]` 数组 |
| `[idx]assistant.result.jsonl` | 每行 `{tool_call_id, content, name?}` | 独立 `{role: "tool", tool_call_id, content}` 消息 |
| `[idx]assistant.extra.json` | `{reasoning_content}` | 嵌入 assistant 消息的 `reasoning_content` 字段 |
| 以上所有 | 无 | 每个消息有 JSON 结构固定开销（`role` 字段等） |

### 方案：自建消息组装

`promptpile-compress` 不依赖 promptpile 代码，但需要遵循 promptpile 的消息组装协议。在 `scanner.ts` 中实现一个轻量的 `assembleMessages(files)`：

```
assembleMessages(files):
  // 与 promptpile 的 buildMessagesWithDiagnostics 逻辑等价

  1. 按 idx 分组
  2. 对每组：
     a. 读取 .md 文件 → 剥离 YAML front matter → {role, content}
     b. 读取 .calls.jsonl → 解析 tool_calls[] → 合并到 assistant 消息
     c. 读取 .result.jsonl → 生成 tool 消息（每条一个）
     d. 读取 .extra.json → 提取 reasoning_content → 合并到 assistant 消息
  3. 返回 ChatMessage[]
```

然后对 `JSON.stringify(messages)` 的结果做 token 计数：

1. **优先使用 tiktoken**（optionalDependency）：`tiktoken.encode(json).length`
2. **回退到字符估算**：`JSON.length / 3.5`
3. **缓存结果**：在 `compression.json` 中记录原始 token 数，避免重复扫描

这样估算的就是 promptpile 实际会发给 API 的内容，不会因为文件编码格式差异而偏差。

---

## 使用场景

`promptpile-compress` 以三种形态被使用：

1. **CLI** — `promptpile-compress -d ./messages --threshold 32000`，手动或在脚本/after-hook 中调用。阈值驱动使其可作为 no-op 安全地挂在每次 promptpile 调用前后
2. **MCP server** — `promptpile-compress serve`，将检索工具暴露给 MCP 生态
3. **库** — `import { compress, restore, executeLookupTool } from 'promptpile-compress'`，被其他 Node.js 工具嵌入

---

## 命令设计

### compress — 压缩指定目录

**职责**：扫描消息目录 → 估算 token → 按策略选择待压缩轮次 → 生成摘要 → 归档原文 → 写入摘要文件。

**设计思路**：

1. **参数最小化**。目录路径是唯一的必选参数。策略、阈值、保留轮次数等都有默认值，无需显式指定即可运行。
2. **阈值驱动**。提供 `--threshold` 参数，只有目录总 token 超过阈值时才执行压缩。这使 compress 可以安全地作为"每次调用前跑一下"的钩子——不超阈值时是零成本的 no-op。
3. **策略即参数**。`--strategy summarize|sliding-window|hierarchical` 切换压缩策略。不同策略有不同的额外参数（summarize 需要 model/api-key，sliding-window 不需要），但共享同一套执行流程。
4. **幂等**。多次 compress 不会重复压缩已归档的轮次，通过已有的 `*.archive/` 目录自动判断。
5. **dry-run 先行**。`--dry-run` 仅分析并报告哪些轮次会被压缩、预计节省多少 token，不实际执行。

### restore — 还原指定目录

**职责**：将 `[idx]system.md.archive/` 中的文件移回消息目录顶层 → 删除对应的 `[idx]system.md` 摘要文件 → 删除 `.archive/` 目录。

**设计思路**：

1. **自动定位**。`restore` 扫描目录中唯一的 `[idx]system.md.archive/`，无需用户指定 idx。
2. **安全**。还原前检查目标位置是否已有同名文件，避免覆盖当前工作中的轮次。
3. **完整清理**。一次还原操作删除三个东西：摘要文件、归档目录、compression.json。不残留任何压缩痕迹。

---

## 类型定义

```typescript
// types.ts

// 本包不依赖 promptpile，自建协议类型。

/** promptpile 消息目录中的文件命名约定 */
export type FileKind = 'message' | 'assistant_call' | 'assistant_result' | 'assistant_extra';

export interface ScannedFile {
  path: string;
  idx: number;
  role: string;
  extension: 'md' | 'json' | 'jsonl';
  fileKind: FileKind;
}

/** 一个对话轮次（同一 idx 的所有文件聚合） */
export interface Turn {
  idx: number;
  files: ScannedFile[];
  estimatedTokens: number;
  roles: Set<string>;
  hasToolCalls: boolean;
  snippet?: string;
}

export type CompressStrategy = 'summarize' | 'sliding-window' | 'hierarchical';

export interface CompressOptions {
  directory: string;
  threshold: number;
  keepRecent: number;
  strategy: CompressStrategy;
  model: string;
  apiKey: string;
  apiBaseUrl: string;
  temperature?: number;
  summarySystemPrompt?: string;
  summaryUserPrompt?: string;
  dryRun?: boolean;
  retrieval?: {
    backend: string | string[];
    fallbackOnError?: boolean;
  };
}

export interface CompressResult {
  compressed: boolean;
  turnsArchived: number;
  tokensBefore: number;
  tokensAfter: number;
  summary?: string;
  summaryIdx?: number;
  archivePath?: string;
  skipReason?: 'below_threshold' | 'no_turns_to_compress' | 'dry_run';
}

export interface CompressionManifest {
  version: 1;
  compressedAt: string;
  strategy: CompressStrategy;
  model: string;
  originalTokenCount: number;
  compressedTokenCount: number;
  archivedTurnIndices: number[];
  summary: string;
}

/** getStatus() 的返回值 */
export interface CompressStatus {
  totalTokens: number;
  totalTurns: number;
  isCompressed: boolean;
  compression?: CompressionManifest;
  summaryIdx?: number;
  turnTokens: Array<{ idx: number; tokens: number }>;
}
```

---

## 边界情况处理

### 压缩相关

| 情况 | 处理方式 |
|---|---|
| 消息目录为空 | 跳过，返回 `{ compressed: false }` |
| token 数未达阈值 | 跳过，返回 `{ compressed: false, skipReason: 'below_threshold' }` |
| 可压缩的轮次少于 2 轮 | 跳过，至少保留最近轮次 |
| `[idx]system.md.archive/` 已存在 | 追加归档（不覆盖已有文件） |
| `[0]system.md` 不存在 | 正常处理——压缩不依赖 system 文件存在，只归档非 system turn |
| 某 turn 包含 `*.system.md` | 该 turn 直接跳过，归入 keep[]，不参与压缩 |
| 压缩过程中断 | `[idx]system.md.archive/` 和 `compression.json` 可检测半完成状态，下次调用时修复 |
| 工具调用无配对结果 | 该轮次整体归档，不会拆散 call/result 配对 |
| 目录中已有压缩归档 | 触发重压缩：先 restore 全部历史，再对完整历史重新压缩 |
| 被压缩的目录正在被 promptpile 读取 | 由调用者保证时序；本工具不锁文件 |

### 检索相关

| 情况 | 处理方式 |
|---|---|
| 还未执行过压缩（无 `.archive/` 目录） | `lookup` 返回空结果，提示先执行压缩 |
| 查询无匹配 | 返回空数组 `[]`，LLM 据此判断"档案中无相关信息" |
| vector 后端索引损坏 | 自动降级到 file-grep（如果配置了 fallback） |
| 请求的 idx 不在归档范围 | 返回 `null`，附带提示"该轮次未被归档" |
| MCP 网关不可达 | `lookup` 报错并建议检查网关状态；如有 fallback 则降级 |
| embedding API 限流 | 返回友好错误，建议稍后重试或切换后端 |
| 归档轮次中部分文件缺失 | 返回已有文件，缺失文件在结果中标注 |

---

## 依赖关系

```
promptpile-compress
  ├── node-fetch (或 built-in fetch) — LLM API 调用（摘要生成 + embedding）
  ├── @iarna/toml — 解析 TOML 配置
  ├── tiktoken (optional) — 精确 token 计数
  ├── promptpile-mcp (optional — 仅 mcp 后端需要)
  │     └── MCP 网关通信
  ├── better-sqlite3 或 lance (optional — 仅 vector 后端需要)
  │     └── 向量索引存储
  └── commander
        └── CLI 参数解析
```

**不依赖 promptpile。** 文件扫描、消息解析、原子写入等逻辑在本包内自实现（复用 promptpile 的命名约定而非代码）。与 promptpile 的唯一耦合是文件命名格式 `[idx]role.ext`。

按后端按需安装：
- 只用 `file-grep` → 仅需 `commander` + `node-fetch`
- 用 `vector` → 额外需要 embedding API 客户端 + 向量存储
- 用 `mcp` → 额外需要 `promptpile-mcp` peer

---

## 后续扩展

- **自动策略选择**：根据轮次数和 token 分布自动选择最优压缩策略
- **模型感知压缩**：根据目标模型的上下文窗口大小自动设置阈值
- **选择性保留**：标记某些轮次为"不可压缩"（如在文件名中添加 `.keep` 后缀）
- **多级摘要**：支持摘要的摘要，应对数百轮的超长对话
- **混合检索**：向量语义匹配 + BM25 关键词匹配融合排序
- **检索结果摘要**：对 `lookup_archive` 返回的多个片段进行二次摘要，减少注入 LLM 的 token
