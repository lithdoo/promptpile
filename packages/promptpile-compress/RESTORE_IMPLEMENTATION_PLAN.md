# Restore 命令实现计划

> 基于 `DESIGN.md` 的文件系统模型，以最少代码实现安全、可重试的 `restore`。

---

## 1. 目标

实现：

```text
promptpile-compress restore -d <messages-directory> [--dry-run]
```

核心流程：

```text
restore(directory):
  1. 检查并回滚未提交的 staging
  2. 定位所有 [idx]system.md.archive/
  3. 只读校验每个 compression.json
  4. 全量预检文件冲突和跨归档冲突
  5. 先删除所有对应的 [idx]system.md 总结消息
  6. 按 idx 从新到旧将原始消息文件移回顶层
  7. 删除所有已清空的 archive 目录
```

原则：

- **文件系统即状态**：不增加 restore 状态文件或 `status` 字段。
- **多归档兼容**：一个或多个 archive 都是合法输入，全部按 idx 从新到旧还原。
- **总结先删除**：移动任何原文之前，先删除全部对应总结消息，避免同 idx 总结与原文同时可见。
- **永不覆盖**：目标路径存在时停止，不提供 `--force`。
- **全量预检**：所有归档都验证通过后才开始修改文件。
- **失败即保留**：任一步失败时，不清理尚未完成的 archive。
- **可重试**：中断后再次执行，只处理仍留在 archive 中的文件。
- **真正 dry-run**：包括 staging 回滚在内，全流程不写、不移、不删。

---

## 2. 目录结构

所有 restore 核心代码放在同一个子目录中：

```text
src/
├── index.ts                  # CLI/包入口，不包含 restore 业务逻辑
└── restore/
    ├── index.ts              # recover + restore 主流程，唯一对外出口
    ├── scanner.ts            # archive、staging、消息文件识别
    └── types.ts              # restore 类型
```

约束：

- `src/index.ts` 只解析参数、调用 `./restore`、输出结果并设置退出码。
- `src/restore/index.ts` 编排全部 restore 流程，并读取 `compression.json`。
- `src/restore/scanner.ts` 只负责文件系统扫描和文件名识别。
- 不创建 `manifest.ts`、`atomic-file.ts` 或通用 `src/tools/`。
- restore 不需要 tokenizer、LLM client、消息组装或检索模块。
- 未来 compress 核心代码放入独立的 `src/compress/`。

---

## 3. 类型

### `src/restore/types.ts`

```typescript
export interface CompressionMetadata {
  version: 1;
  archivedTurnIndices: number[];
}

export interface ArchiveDir {
  idx: number;
  name: string;
  path: string;
}

export interface RecoveryAction {
  kind: 'rollback_staging';
  detail: string;
}

export interface RestoreOptions {
  directory: string;
  dryRun?: boolean;
}

export type RestoreResult =
  | {
      restored: true;
      turnsRestored: number;
      archivesRestored: number;
      summaryIndices: number[];
      archivePaths: string[];
      recoveryActions: RecoveryAction[];
    }
  | {
      restored: false;
      skipReason: 'no_archive_found' | 'dry_run' | 'rolled_back_staging';
      turnsRestored?: number;
      archivesRestored?: number;
      recoveryActions: RecoveryAction[];
    };
```

restore 只解析 `compression.json` 中实际需要的字段。其他由 compress 写入的字段可以存在，但 restore 不读取、不修改。

---

## 4. 扫描模块

### `src/restore/scanner.ts`

```typescript
export const findArchiveDirs = (directory: string): Promise<ArchiveDir[]>;
export const findStagingDir = (directory: string): Promise<string | null>;
export const listMessageFiles = (directory: string): Promise<string[]>;
export const isMessageFileName = (name: string): boolean;
```

使用与 promptpile 一致的文件协议：

```typescript
const FILE_PATTERN = /^\[(\d+)\](.+?)\.(md|json)$/i;
const ASSISTANT_CALL_PATTERN = /^\[(\d+)\]assistant\.calls\.jsonl$/i;
const ASSISTANT_RESULT_PATTERN = /^\[(\d+)\]assistant\.result\.jsonl$/i;
const ASSISTANT_EXTRA_PATTERN = /^\[(\d+)\]assistant\.extra\.json$/i;
const ARCHIVE_DIR_PATTERN = /^\[(\d+)\]system\.md\.archive$/i;
const STAGING_DIR = '.promptpile-compress.staging';
```

规则：

- 只扫描指定目录第一层。
- 只返回普通文件，不递归进入子目录。
- `compression.json`、`.summary.md`、`.vector/` 不属于消息文件。
- archive 按 idx 降序返回。

---

## 5. `compression.json` 的职责

`compression.json` 由 compress 创建。restore 对它只有两种操作：

1. 还原前只读解析；
2. 还原成功后随 archive 目录一起删除。

restore 绝不创建、更新或重写 `compression.json`。

读取函数直接放在 `src/restore/index.ts`：

```typescript
const readCompressionMetadata = async (
  archive: ArchiveDir
): Promise<CompressionMetadata>;
```

只做必要校验：

- 文件存在且 JSON 可解析；
- `version === 1`；
- `archivedTurnIndices` 是非空、无重复的非负整数数组；
- archive 目录 idx 等于 `max(archivedTurnIndices)`。

任一归档的 `compression.json` 缺失或损坏时，整体停止，不修改任何文件。

---

## 6. Staging 回滚

restore 启动时先检查 `.promptpile-compress.staging/`。它表示 compress 在 archive 提交前中断。

```typescript
export const recover = async (
  directory: string,
  options?: { dryRun?: boolean }
): Promise<RecoveryAction[]>;
```

流程：

```text
1. 若 staging 不存在，返回空 actions。
2. 若 staging 与 archive 同时存在，状态有歧义，报错且不修改。
3. 列出 staging 第一层中的消息文件。
4. 预检所有顶层目标路径；任一冲突则停止。
5. dry-run：只报告将回滚的文件。
6. 非 dry-run：逐个 rename 回消息目录顶层。
7. 任一 rename 失败立即停止，不删除 staging。
8. 确认 staging 中已无消息文件后，删除 staging 及其元数据。
```

部分回滚后进程中断可以重试：已经移回的文件不再位于 staging，下次只处理剩余文件。

archive 缺少总结消息不属于 restore 的恢复错误。restore 本来就要删除总结，因此不会补写 `[idx]system.md`。

---

## 7. Restore 主流程

### 7.1 目录校验

- 将路径解析为绝对路径。
- 不存在、不是目录或不可读时抛错。

### 7.2 Staging 恢复

```text
recoveryActions = recover(directory, { dryRun })
```

- dry-run 只报告，不修改。
- 非 dry-run 回滚 staging 后重新扫描 archive。
- 若只有 staging 且回滚完成，返回 `rolled_back_staging`。

### 7.3 定位与校验全部 archive

```text
archives.length === 0 → no_archive_found
archives.length >= 1  → 按 idx 从新到旧处理
```

在修改任何文件前：

1. 读取所有 `compression.json`；
2. 校验每个 archive 的目录 idx；
3. 汇总所有 `archivedTurnIndices`；
4. 检查不同 archive 之间没有重复 idx；
5. 列出每个 archive 当前剩余的消息文件；
6. 检查不同 archive 之间没有同名消息文件；
7. 检查所有顶层目标路径不存在。

任一检查失败则零修改退出。

`turnsRestored` 使用所有 metadata 中 `archivedTurnIndices` 的去重总数，不按当前剩余文件重新统计。

### 7.4 Dry-run

返回或输出：

- staging 回滚计划；
- 将删除的全部 `[idx]system.md`；
- 将移动的全部消息文件；
- archive 处理顺序；
- `turnsRestored` 和 archive 数量。

不得执行任何写入、移动或删除。

### 7.5 先删除全部总结消息

全量预检通过后、移动任何原文之前：

```text
for archive of archivesSortedByIdxDesc:
  summaryPath = directory/[archive.idx]system.md
  if summaryPath exists:
    unlink(summaryPath)
```

规则：

- 总结消息不存在时跳过，这是 restore 中断后的合法状态。
- 任一删除失败立即停止。
- 此时尚未移动任何原文，所有 archive 均保持完整。
- 删除完成后，promptpile 不会看到总结消息与对应原文同时存在。

### 7.6 移动原始消息文件

```text
for archive of archivesSortedByIdxDesc:
  for file of archive.messageFiles:
    rename(archive/file, directory/file)
```

规则：

- 使用同一消息目录内的 `rename`，不实现 copy/unlink 回退。
- 任一移动失败立即停止。
- 已移动文件留在顶层，未移动文件仍在 archive。
- 不删除任何 archive，直到所有消息文件移动完成。
- 再次执行 restore 时，只移动 archive 中剩余文件。

移动是单份迁移，不存在 archive “安全副本”。安全性来自移动失败后保留尚未处理的 archive。

### 7.7 删除 archive

只有确认所有 archive 第一层都已无消息文件后：

```text
for archive of archivesSortedByIdxDesc:
  rm archive recursively
```

这会删除其中的 `compression.json`、`.summary.md`、`.vector/` 和未知派生内容。

任一目录删除失败时停止并保留剩余 archive。总结消息已删除、原文已还原；重试只需继续清理现存空 archive。

archive 中没有消息文件不是损坏状态，它可能表示上一次 restore 已完成移动但尚未清理。

---

## 8. CLI

### `src/index.ts`

```typescript
#!/usr/bin/env node
import { Command } from 'commander';
import { restoreArchivedTurns } from './restore';

const program = new Command();

program
  .name('promptpile-compress')
  .version('0.1.0')
  .command('restore')
  .description('将压缩归档还原到消息目录')
  .requiredOption('-d, --directory <path>', '消息目录路径')
  .option('--dry-run', '只报告操作，不修改文件', false)
  .action(async options => {
    try {
      const result = await restoreArchivedTurns({
        directory: options.directory,
        dryRun: options.dryRun,
      });

      if (!result.restored) {
        console.log(`跳过还原: ${result.skipReason}`);
        return;
      }

      console.log(`已还原 ${result.turnsRestored} 个 idx group`);
      console.log(`已清理 ${result.archivesRestored} 个压缩归档`);
    } catch (error) {
      console.error(`promptpile-compress restore: ${String(error)}`);
      process.exitCode = 1;
    }
  });

program.parseAsync();
```

退出码：

- 成功、no-op、dry-run：0；
- 参数、目录、`compression.json`、冲突或文件操作错误：1。

---

## 9. 边界情况

| 场景 | 行为 |
|---|---|
| 目录不存在或不是目录 | 报错，退出码 1 |
| 无 staging、无 archive | `no_archive_found` |
| 只有 staging | 安全回滚；失败时保留 staging |
| staging 与 archive 同时存在 | 状态有歧义，报错且不修改 |
| 一个或多个 archive | 全量预检后按 idx 从新到旧全部还原 |
| compression.json 缺失或损坏 | 报错，零修改 |
| 跨 archive 重复 idx 或文件名 | 报错，零修改 |
| archive 文件与顶层同名 | 报错，零修改 |
| 总结消息已不存在 | 跳过删除，继续还原 |
| 总结消息删除失败 | 停止；任何原文都尚未移动 |
| 原文移动中断 | 重试，只移动 archive 中剩余文件 |
| archive 已无消息文件 | 直接进入 archive 清理阶段 |
| archive 中含派生内容 | 原文全部还原后随 archive 删除 |
| `--dry-run` | 全流程只读，包括 staging recover |

---

## 10. 实现顺序

```text
1. src/restore/types.ts
2. src/restore/scanner.ts + 单元测试
3. src/restore/index.ts：compression.json 只读校验 + staging recover
4. src/restore/index.ts：多 archive 全量预检
5. src/restore/index.ts：总结删除、原文移动、archive 清理
6. src/index.ts：CLI
7. 端到端测试
```

---

## 11. 必要测试

### 正常行为

- [ ] 单 archive 正常还原，目录与压缩前 fixture 一致。
- [ ] 多 archive 按 idx 从新到旧全部还原。
- [ ] 未压缩目录返回 no-op。
- [ ] dry-run 前后目录树和内容完全不变。

### 顺序保证

- [ ] 所有总结消息先于任何原文移动被删除。
- [ ] 总结消息删除失败时，任何原文都尚未移动。
- [ ] 还原期间不存在总结消息与同 idx 原文同时位于顶层的状态。

### 安全性

- [ ] 任一 compression.json 损坏时，预检阶段零修改。
- [ ] 跨 archive 重复 idx 或文件名时零修改。
- [ ] 顶层同名冲突时零修改。
- [ ] staging 回滚失败时 staging 不被删除。
- [ ] 原文移动失败时 archive 不被清理。

### 中断重试

- [ ] staging 部分回滚后可继续。
- [ ] 总结已删除但尚未移动原文时可继续。
- [ ] 部分原文已移到顶层时只移动剩余文件。
- [ ] 全部原文已移出但 archive 未清理时只清理 archive。

### 协议文件

- [ ] 同 idx 的 assistant.md/calls/extra/result 全部恢复。
- [ ] `compression.json`、`.summary.md`、`.vector/` 不移动到顶层。
- [ ] 未知 archive 内容不进入顶层，并随 archive 删除。
