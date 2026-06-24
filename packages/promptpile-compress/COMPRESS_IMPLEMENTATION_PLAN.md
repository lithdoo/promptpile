# Compress 命令实现计划

> 基于 `DESIGN.md` 的文件系统模型与 `RESTORE_IMPLEMENTATION_PLAN.md` 的既有实现，以最少代码实现安全、可重试的 `compress`。

---

## 1. 目标

实现：

```text
promptpile-compress compress -d <messages-directory> [options]
```

核心流程：

```text
compress(directory, options):
  1. 检查并回滚未提交的 staging（复用 ../restore 的 recover）
  2. 检测已存在的 archive → 触发重压缩：先 restore 全部历史
  3. 扫描消息目录，按 idx 聚合为 turn 列表
  4. 排除所有包含 *.system.md 的 turn（永不压缩）
  5. 估算 token 总量，低于阈值则跳过
  6. 按策略选择 keep[] 与 archive[] turn
  7. 生成摘要文本（策略决定是否需要 LLM）
  8. 两阶段提交：准备 staging → 原子提交为 archive
  9. 返回压缩结果（检索工具描述后续实现）
```

原则：

- **文件系统即状态**：压缩结果物化为 staging → archive rename + summary 文件写入，不使用外部状态文件。
- **正常完成后摘要与原文不可同时可见**：先移动原文到 staging，再 rename staging 为 archive，最后写 summary。正常完成后，promptpile 扫描顶层时只会看到 summary + 最近轮次，不会同时看到被归档原文和 summary。若提交阶段在 archive rename 后、summary 写入前中断，会短暂出现“原文已归档但 summary 缺失”的不完整状态；下次 `compress` 通过重压缩流程还原并重试。
- **永不修改 system prompt**：`[0]system.md` 及压缩产生的 `[N]system.md` 均不参与压缩。
- **阈值驱动**：低于阈值时为零成本 no-op，可安全挂在每次 promptpile 调用前后。
- **失败即保留**：任一步失败时 staging 或 archive 保持完整，restore 可恢复。
- **真正 dry-run**：全流程不写、不移、不删。
- **可重试**：中断后再次执行 compress，staging 残留由 `recover` 回滚；archive 已存在时先还原完整历史，再重新压缩。

---

## 2. 目录结构

Compress 核心代码放在独立子目录中。与 restore 的关系：

```text
src/
├── index.ts                   # CLI/包入口，注册 compress + restore 子命令
├── restore/                   # 已有：restore 命令（recover + restore）
│   ├── index.ts
│   ├── scanner.ts
│   └── types.ts
└── compress/                  # 新增：compress 命令
    ├── index.ts               # compress 主流程 + 两阶段提交，唯一对外出口
    ├── scanner.ts             # turn 扫描与聚合
    ├── tokenizer.ts           # token 估算
    ├── strategy.ts            # 策略接口 + sliding-window 实现
    └── types.ts               # compress 类型
```

约束：

- `src/index.ts` 新增 `compress` 子命令，只解析参数、调用 `./compress`、输出结果。
- `src/compress/index.ts` 编排全部 compress 流程，包括两阶段提交和 `compression.json` 写入。
- `src/compress/scanner.ts` 负责 turn 级别的文件聚合和 system turn 过滤。
- `src/compress/tokenizer.ts` 负责 token 估算，字符回退方案优先。
- `src/compress/strategy.ts` 定义策略接口，首期仅实现 `sliding-window`。
- 与 restore 共享的内容通过 `import '../restore/...'` 引用：
  - `STAGING_DIR` 常量 ← `../restore/scanner`
  - `isMessageFileName` ← `../restore/scanner`
  - `findArchiveDirs`、`findStagingDir`、`listMessageFiles` ← `../restore/scanner`
  - `recover` ← `../restore/index`（compress 启动时调用）
  - `restoreArchivedTurns` ← `../restore/index`（重压缩时调用）
- 不创建 `src/tools/`。
- compress 需要解析 `idx`、`role`、`extension`、`fileKind`，这些字段目前不是 restore 的公开类型；因此在 `src/compress/scanner.ts` 内定义自己的解析正则和 `ScannedFile` 结构，只把 restore 的 `isMessageFileName` 当作文件名过滤器复用。
- LLM client、prompt builder、检索模块留待后续扩展。
- 未来的 `summarize` 和 `hierarchical` 策略放入 `src/compress/strategies/`。

---

## 3. 类型

### `src/compress/types.ts`

```typescript
export type MessageRole = 'system' | 'user' | 'assistant';
export type MessageExtension = 'md' | 'json' | 'jsonl';
export type MessageFileKind = 'message' | 'calls' | 'result' | 'extra';

/** compress 自己的扫描结果；不依赖 restore 内部类型 */
export interface ScannedFile {
  name: string;                 // 文件名，如 [2]assistant.calls.jsonl
  path: string;                 // 绝对路径
  idx: number;
  role: MessageRole;
  extension: MessageExtension;
  fileKind: MessageFileKind;
}

/** 一个对话轮次（同一 idx 的所有文件聚合） */
export interface Turn {
  idx: number;
  files: ScannedFile[];
  estimatedTokens: number;
  isSystemTurn: boolean;       // 包含 *.system.md → 永不压缩
  hasToolCalls: boolean;
}

export type CompressStrategyKind = 'sliding-window';  // 首期；后续扩展 'summarize' | 'hierarchical'

export interface CompressOptions {
  directory: string;
  threshold?: number;           // token 阈值，默认 32000
  keepRecent?: number;          // 保留最近 N 轮，默认 4
  strategy?: CompressStrategyKind;
  dryRun?: boolean;
  // 以下为后续 LLM 策略预留：
  // model?: string;
  // apiKey?: string;
  // apiBaseUrl?: string;
}

export interface CompressResult {
  compressed: boolean;
  turnsArchived: number;
  turnsKept: number;
  tokensBefore: number;
  tokensAfter: number;
  compressibleTokens?: number;
  summaryIdx?: number;
  archivePath?: string;
  // summary 文本不返回给 CLI（太长），写入文件
  skipReason?: 'below_threshold' | 'no_turns_to_compress' | 'dry_run' | 'rolled_back_staging';
}

/** compression.json 的完整结构（由 compress 写入，由 restore 读取） */
export interface CompressionManifest {
  version: 1;
  compressedAt: string;          // ISO 8601
  strategy: CompressStrategyKind;
  originalTokenCount: number;
  compressedTokenCount: number;
  archivedTurnIndices: number[];
}

/** 策略接口 */
export interface CompressStrategy {
  readonly kind: CompressStrategyKind;

  /** 从 turns 中选择 keep 和 archive */
  selectTurns(
    turns: Turn[],
    options: { keepRecent: number }
  ): { keep: Turn[]; archive: Turn[] };

  /** 生成摘要文本。sliding-window 不需要 LLM，其余策略需要 */
  generateSummary(archive: Turn[]): Promise<string>;
}
```

说明：

- `CompressionManifest` 是 compress 写入、restore 读取的共享结构。restore 只解析 `version` 和 `archivedTurnIndices`，忽略其余字段。
- `compression.json` 不保存 `summary` 全文，避免与顶层 `[N]system.md` 形成双写状态。summary 的权威副本只有顶层 `[N]system.md`；staging 阶段的 `.summary.md` 只是提交前的临时文件。
- `CompressStrategy` 是策略接口。`sliding-window` 的 `generateSummary` 为同步生成（不需要 LLM 调用），但接口返回 `Promise<string>` 以兼容未来的异步策略。
- `ScannedFile` 是 compress 包内类型。restore 当前只公开 archive/recovery 相关类型，不公开消息文件解析结果；compress 不应依赖 restore 的未导出实现细节。

---

## 4. Turn 扫描模块

### `src/compress/scanner.ts`

```typescript
import type { ScannedFile } from './types';

/** 扫描消息目录顶层，按 idx 聚合为 turn 列表。idx 升序排列。 */
export const scanTurns = async (directory: string): Promise<Turn[]>;

/** 估算单个 turn 的 token 数（调用 tokenizer 模块） */
export const estimateTurnTokens = (turn: Turn): Promise<number>;
```

规则：

- 复用 `../restore/scanner` 的 `isMessageFileName` 过滤顶层文件；随后在 compress/scanner 内用本地正则解析 `idx`、`role`、`extension`、`fileKind`。
- 按 idx 分组。同 idx 的文件属于同一 turn。
- 判断 `isSystemTurn`：若该 turn 任一文件的 role 为 `system` 且扩展名为 `md`，则为 system turn。
- `hasToolCalls`：若该 turn 包含 `*.calls.jsonl` 文件则为 true。
- 扫描完成后按 idx 升序返回。
- 不扫描子目录（与 promptpile 的 `scanDirectory` 行为一致），因此 archive 目录中的文件不被视为顶层消息。

---

## 5. Token 估算模块

### `src/compress/tokenizer.ts`

```typescript
/** 估算一个 turn 的 token 数 */
export const estimateTurnTokens = async (
  directory: string,
  turnIdx: number,
  fileNames: string[]
): Promise<number>;

/** 估算所有 turn 的总 token 数 */
export const estimateTotalTokens = (turns: Turn[]): number;
```

首期实现：**字符估算回退**。不依赖 tiktoken。

算法：

```text
estimateTurnTokens(directory, idx, fileNames):
  1. 读取该 turn 的所有文件内容
  2. 对 .md 文件：剥离 YAML front matter（复用 restore 已有的逻辑或内联实现）
  3. 对 .calls.jsonl：直接计算文本长度
  4. 对 .result.jsonl：直接计算文本长度
  5. 对 .extra.json：直接计算文本长度
  6. 总字符数 / 3.5 → 估算 token 数
  7. 加上 JSON 结构开销（每个消息约 30 token 的 role/content 包装）
```

规则：

- 字符估算在 20% 误差范围内可接受。压缩决策对阈值不敏感（差几百 token 不影响是否压缩）。
- 后续可选：检测 `tiktoken` 是否已安装，安装则优先使用精确计数。
- Token 计数结果缓存于 Turn 对象中，避免重复计算。

---

## 6. 压缩策略

### `src/compress/strategy.ts`

首期仅实现 `sliding-window`。策略接口为后续 LLM 策略预留扩展点。

```typescript
import type { CompressStrategy, CompressStrategyKind, Turn } from './types';

/** 工厂函数：根据策略类型创建策略实例 */
export const createStrategy = (kind: CompressStrategyKind): CompressStrategy;
```

#### 策略：sliding-window（首期实现）

```
selectTurns(turns, { keepRecent }):
  1. 过滤：移除所有 isSystemTurn === true 的 turn → 归入 keep
  2. 从非 system turn 中：
     - 最后 keepRecent 个 turn → keep
     - 其余更早的 turn → archive
  3. 若 archive 为空 → 返回空集（无轮次可压缩）

generateSummary(archive):
  1. 返回固定文本：
     "对话第 {minIdx}-{maxIdx} 轮已被归档，可通过 lookup_archive 工具检索原文。
      归档范围共 {turnCount} 轮，原始 token 数约 {estimatedTokens}。"
  2. 不调用 LLM
```

注意：

- `sliding-window` 首期用于验证压缩管线，不生成语义摘要，只生成“历史已归档”的占位 summary。
- 在 `lookup` / MCP 检索能力尚未实现前，被归档历史对模型不可直接读取，因此该策略会牺牲历史可见性。
- 若调用方需要尽量保留历史语义，应等待后续 `summarize` 策略，或把 `keepRecent` 设置得更大。

#### 策略接口扩展点（后续实现）

```
summarize:
  selectTurns: 同 sliding-window
  generateSummary:
    1. 拼接 archive turns 的完整文本
    2. 调用 LLM API 生成结构化摘要
    3. 返回 LLM 生成的摘要文本

hierarchical:
  selectTurns: 三层划分（热层 keep / 温层轻量摘要 / 冷层合并摘要）
  generateSummary:
    1. 温层调用 LLM 生成中层摘要
    2. 冷层调用 LLM 生成高层摘要
    3. 合并返回
```

---

## 7. 两阶段提交

直接在 `src/compress/index.ts` 中实现，不拆分为独立模块。

### 7.1 准备阶段

```text
prepareStaging(directory, archiveTurns, summary, summaryIdx):

  1. 检查 .promptpile-compress.staging/ 不存在（由 recover 保证）
     若存在 → 抛出错误

  2. 创建暂存目录
     mkdir <directory>/.promptpile-compress.staging/

  3. 移动待归档文件到暂存目录
     for each turn in archiveTurns (按 idx 升序):
       for each file in turn.files:
         fs.rename(<directory>/<file>, <staging>/<file>)
     // 逐文件移动。若中途崩溃 → staging 残留 → 下次执行时 recover 回滚

  4. 写入暂存目录元数据
     write <staging>/compression.json:
       {
         version: 1,
         compressedAt: "<ISO 8601>",
         strategy: "<kind>",
         originalTokenCount: <number>,
         compressedTokenCount: <estimate of summary tokens>,
         archivedTurnIndices: [<sorted idx list>]
       }

  5. 写入摘要临时文件
     write <staging>/.summary.md  = summary text
     // .summary.md 是固定名称，仅供 commitStaging 写入顶层 summary 使用；
     // recover/listMessageFiles 不把它视为消息文件，staging 回滚时会随 staging 被删除
```

### 7.2 提交阶段

```text
commitStaging(directory, summaryIdx):

  1. 原子 rename
     fs.rename(<staging>, <directory>/[summaryIdx]system.md.archive/)
     // 同文件系统的 rename 是原子的
     // 成功 → 提交完成，原文对 promptpile 不可见

  2. 写入摘要文件到消息目录顶层
     atomicWrite(<directory>/[summaryIdx]system.md, read <archive>/.summary.md)
     // 使用 write-temp + fsync + rename 保证原子性
     // 若步骤 1 成功但步骤 2 前崩溃 → archive 已存在但 summary 缺失；
     // 下次 compress 走重压缩流程：restoreArchivedTurns 还原原文，删除不完整 archive，再重新压缩

  3. compress 不更新 compression.json status 字段
     // compression.json 的内容在 staging 中已完整写入
     // 与 restore 计划一致：restore 不依赖 status 字段做决策
```

### 7.3 崩溃恢复

compress 启动时调用 `restore` 模块的 `recover()`：

```text
compress(directory, options):
  recoverActions = recover(directory, { dryRun: options.dryRun })

  // recover 只处理 staging 残留：
  // ① staging 存在且没有 archive → 回滚 staging 中的消息文件
  // ② staging 与 archive 同时存在 → 状态有歧义，拒绝自动恢复

  // archive 是否缺少 summary 不由 recover 修复。
  // compress 后续通过“已有 archive → restoreArchivedTurns → 重新 compress”的重压缩流程处理。
```

说明：

- `recover()` 的职责只是不丢文件地回滚未提交 staging，不补写 summary。
- archive 已存在但顶层 `[idx]system.md` 缺失时，`restoreArchivedTurns()` 仍可根据 archive 内的消息文件和 `compression.json.archivedTurnIndices` 还原原文；随后 compress 重新生成新的 summary。
- 这样避免在 `compression.json` 中保存 summary 副本，也避免“补写出来的 summary”和真实顶层 summary 产生分歧。

---

## 8. Compress 主流程

### `src/compress/index.ts`

```typescript
export const compressDirectory = async (
  options: CompressOptions
): Promise<CompressResult>;
```

完整流程：

```text
compressDirectory({ directory, threshold=32000, keepRecent=4, strategy='sliding-window', dryRun }):

  ── Step 0: 目录校验 ──
    resolved = 绝对路径
    若不存在/不是目录/不可读写 → 抛出错误

  ── Step 1: 恢复检查 ──
    recoveryActions = recover(resolved, { dryRun })
    // 回滚未提交的 staging（如有）

    若 dryRun 且 recoveryActions 非空:
      → 返回 { compressed: false, skipReason: 'dry_run' }

  ── Step 2: 重压缩检测 ──
    archives = findArchiveDirs(resolved)
    若 archives.length > 0:
      → 重压缩流程：
        a. 若 dryRun:
             → 返回 { compressed: false, skipReason: 'dry_run' }
             // 重压缩的 dryRun 仅报告，不实际执行 restore+compress
        b. restoreArchivedTurns({ directory: resolved })
           // 完整还原所有历史
        c. 现在目录回到压缩前状态，继续正常压缩流程
        d. 注：restore 内部已包含冲突检测和全量预检

  ── Step 3: 扫描 turns ──
    turns = scanTurns(resolved)

    若 turns 为空:
      → 返回 { compressed: false, skipReason: 'no_turns_to_compress' }

  ── Step 4: Token 估算 ──
    estimateTurnTokens 对每个 turn 计算
    totalTokens = sum(turn.estimatedTokens)
    compressibleTokens = sum(non-system turn.estimatedTokens)

  ── Step 5: 阈值检查 ──
    若 totalTokens < threshold:
      → 返回 { compressed: false, skipReason: 'below_threshold', tokensBefore: totalTokens }

    若 compressibleTokens <= 0:
      → 返回 { compressed: false, skipReason: 'no_turns_to_compress', tokensBefore: totalTokens, compressibleTokens }

    // threshold 仍以 totalTokens 作为触发条件，因为目标是控制 promptpile 可见上下文总量。
    // 但 system turn 永不压缩，所以 compressibleTokens 用于判断是否真的存在可压缩空间。

  ── Step 6: 轮次选择 ──
    strategyInstance = createStrategy(strategy)
    { keep, archive } = strategyInstance.selectTurns(turns, { keepRecent })

    若 archive 为空:
      → 返回 { compressed: false, skipReason: 'no_turns_to_compress' }

  ── Step 7: 生成摘要 ──
    summary = strategyInstance.generateSummary(archive)
    summaryIdx = Math.max(...archive.map(t => t.idx))

  ── Step 8: dry-run 检查 ──
    若 dryRun:
      → 返回 {
          compressed: false,
          skipReason: 'dry_run',
          turnsArchived: archive.length,
          turnsKept: keep.length,
          tokensBefore: totalTokens,
          compressibleTokens,
          tokensAfter: estimateTokens(keep) + estimateTokens(summary),
          summaryIdx,
        }

  ── Step 9: 两阶段提交 ──
    // Phase 1: 准备
    prepareStaging(resolved, archive, summary, summaryIdx)

    // Phase 2: 提交
    commitStaging(resolved, summaryIdx)

  ── Step 10: 生成检索工具描述 ──
    // 首期跳过，后续实现
    // generateToolsToml(resolved, archive, summaryIdx)

  ── Step 11: 返回结果 ──
    return {
      compressed: true,
      turnsArchived: archive.length,
      turnsKept: keep.length,
      tokensBefore: totalTokens,
      compressibleTokens,
      tokensAfter: sum(keep tokens) + summary tokens estimate,
      summaryIdx,
      archivePath: `${resolved}/[${summaryIdx}]system.md.archive`,
    }
```

---

## 9. CLI

### `src/index.ts`（追加 compress 子命令）

```typescript
program
  .command('compress')
  .description('压缩消息目录中的历史轮次，减少上下文 token 消耗')
  .requiredOption('-d, --directory <path>', '消息目录路径')
  .option('--threshold <number>', 'token 阈值，超过时执行压缩', '32000')
  .option('--keep-recent <number>', '保留最近轮次数', '4')
  .option('--strategy <name>', '压缩策略', 'sliding-window')
  .option('--dry-run', '只报告操作，不修改文件', false)
  .action(async (options) => {
    // 解析阈值和保留数为整数
    // 调用 compressDirectory(options)
    // 输出结果或错误
    // 退出码 0/1
  });
```

参数：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `-d, --directory` | 必选 | 消息目录路径 |
| `--threshold` | `32000` | token 阈值，低于此值跳过压缩 |
| `--keep-recent` | `4` | 保留的最近轮次数 |
| `--strategy` | `sliding-window` | 压缩策略（首期仅此一个） |
| `--dry-run` | `false` | 仅分析不修改 |

---

## 10. 与 restore 的重用关系

| 导入源 | 导入内容 | Compress 使用场景 |
|---|---|---|
| `../restore/scanner` | `STAGING_DIR` | 创建暂存目录时使用相同名称 |
| `../restore/scanner` | `isMessageFileName` | 扫描消息目录时过滤文件 |
| `../restore/scanner` | `findArchiveDirs` | 检测已有 archive（重压缩判断） |
| `../restore/scanner` | `findStagingDir` | 检查 staging 是否存在 |
| `../restore/scanner` | `listMessageFiles` | 列出待移动的消息文件 |
| `../restore/index` | `recover` | compress 启动时恢复未完成操作 |
| `../restore/index` | `restoreArchivedTurns` | 重压缩时先还原全部历史 |

不重用的部分（compress 独立实现）：

| 模块 | 原因 |
|---|---|
| Turn 扫描聚合 | compress 需要按 turn 分组、标记 system turn、关联 token 数 |
| 消息文件解析类型 | restore 不公开 `ScannedFile`；compress 自己定义 `ScannedFile` 与解析正则 |
| Token 估算 | compress 专属，restore 不需要 |
| 两阶段提交 | compress 专属的 staging → archive 提交流程 |
| 策略选择 | compress 专属的 keep/archive 决策逻辑 |

---

## 11. 实现顺序（依赖拓扑排序）

```
Phase 1 — 类型定义
  └── src/compress/types.ts                     # 所有 compress 模块依赖

Phase 2 — 工具模块（并行）
  ├── src/compress/tokenizer.ts                 # token 估算（依赖 types，需读文件）
  └── src/compress/scanner.ts                  # turn 扫描（依赖 restore/scanner, types）

Phase 3 — 策略
  └── src/compress/strategy.ts                  # 策略接口 + sliding-window（依赖 types）

Phase 4 — 核心逻辑
  └── src/compress/index.ts                     # 主流程 + 两阶段提交（依赖以上所有 + restore）

Phase 5 — CLI
  └── src/index.ts 追加 compress 子命令         # 依赖 compress/index
```

---

## 12. 边界情况

### 正常运行边界

| 场景 | 处理 |
|---|---|
| 消息目录为空 | skipReason: `no_turns_to_compress` |
| token 总数未达阈值 | skipReason: `below_threshold` |
| token 总数达到阈值但可压缩 token 为 0 | skipReason: `no_turns_to_compress` |
| 所有 turn 都是 system turn | archive 为空，skipReason: `no_turns_to_compress` |
| 可压缩轮次不足 2 轮 | 至少保留 `keepRecent` 轮，archive 可能为空 |
| `[0]system.md` 不存在 | 正常处理——压缩不依赖 system 文件存在 |
| 已有 archive 目录（重压缩） | 先调用 restoreArchivedTurns 完整还原，再压缩 |
| 多个 archive 目录 | restore 模块处理（按 idx 从新到旧全部还原） |
| dry-run + staging 残留 | 报告 staging 回滚计划，不执行 |

### 中断恢复边界

| 场景 | 恢复方式 |
|---|---|
| staging 残留（Phase 1 崩溃） | recover → 回滚 staging，返回 `rolled_back_staging` |
| archive 存在但 summary 缺失 | 重压缩流程 → restoreArchivedTurns 还原原文 → 重新 compress |
| staging + archive 同时存在 | recover 报错：状态有歧义 |
| 重压缩中 restore 崩溃 | restore 本身可重试，重新执行 compress 即可 |

### 两阶段提交边界

| 场景 | 处理 |
|---|---|
| 创建 staging 失败（权限） | 抛出错误，不修改任何文件 |
| 部分文件移入 staging 后崩溃 | staging 残留，recover 回滚 |
| staging → archive rename 失败 | staging 完整保留，可重试 |
| summary 写入失败 | archive 已存在但无 summary → 下次 compress 先 restore 再重新压缩 |

---

## 13. 不在此次实现范围的功能

以下功能在 DESIGN.md 中有描述，但首期不实现：

| 功能 | 推迟原因 |
|---|---|
| `summarize` 策略（LLM 摘要） | 需 LLM client、prompt builder；sliding-window 可先验证整个压缩管线 |
| `hierarchical` 策略（分层压缩） | 依赖 summarize，推迟到 LLM client 实现后 |
| `compressed-tools.toml` 自动生成 | 需检索工具描述模板；压缩管线可先跑通 |
| MCP serve 子命令 | 需 MCP 协议实现 + 检索后端 |
| `lookup` 子命令 | 需检索后端实现 |
| `serve` 子命令 | 需完整的检索后端 + MCP server |
| vector 检索后端 | 需 embedding API + 向量存储 |
| 自定义 summary prompt 模板 | 需 LLM 策略先落地 |
| 自动策略选择 | 需所有策略实现后才有选择空间 |

---

## 14. 测试要点（后续实现）

- [ ] 正常压缩：保留最近 N 轮，归档其余
- [ ] 阈值 no-op：低于阈值时跳过
- [ ] system 很大但没有可压缩 turn：返回 `no_turns_to_compress`
- [ ] system turn 永不压缩：包含 `*.system.md` 的 turn 归入 keep
- [ ] 空目录跳过
- [ ] dry-run 不修改文件
- [ ] 重压缩：已有 archive 时先 restore 再 compress
- [ ] 两阶段提交：staging 创建 → rename → summary 写入
- [ ] staging 残留回滚（依赖 restore 的 recover）
- [ ] 部分文件移入 staging 后重试
- [ ] archive 已存在但 summary 缺失：下一次 compress 先 restore 再重新压缩
- [ ] 压缩后目录结构符合 DESIGN.md 规格
- [ ] 压缩后 promptpile 可正常扫描（summary + 最近轮次）
- [ ] 压缩后再 restore 回到原始状态（与 restore 测试互补）
