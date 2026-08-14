#!/usr/bin/env node
import { Command } from 'commander';
import {
  compressDirectory,
  createTiktokenTokenizer,
  heuristicTokenizer,
} from './compress';
import { restoreArchivedTurns } from './restore';

export const CLI_DESCRIPTION = '独立的会话目录压缩、归档与恢复工具';

const isCommanderHelpExit = (error: unknown): boolean => {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  const code = (error as { code?: string }).code;
  return code === 'commander.helpDisplayed' || code === 'commander.help';
};

export const parseCli = async (argv = process.argv): Promise<number> => {
  let exitCode = 0;
  const program = new Command()
    .name('promptpile-compress')
    .description(CLI_DESCRIPTION)
    .version('0.1.0-beta.1')
    .helpOption('-h, --help', '显示帮助')
    .exitOverride();

  program
    .command('compress')
    .description('压缩消息目录中的历史轮次，减少上下文 token 消耗')
    .requiredOption('-d, --directory <path>', '消息目录路径')
    .option('--threshold <number>', '兼容模式 token 阈值（不能与 budget 参数组合）')
    .option('--model-context <number>', '模型上下文容量', '128000')
    .option('--reserved-output <number>', 'completion 输出预留', '8000')
    .option('--system-tool-overhead <number>', 'system/tool 固定开销', '2000')
    .option('--target-live-history <number>', '目标 live history', '32000')
    .option('--summary-output <number>', 'summary 输出上限', '2048')
    .option('--safety-margin <number>', '安全余量', '4000')
    .option('--tokenizer <name>', 'tokenizer: heuristic 或 tiktoken', 'heuristic')
    .option('--tokenizer-model <name>', 'tiktoken 模型标识', 'gpt-4o-mini')
    .option('--keep-recent <number>', '保留最近轮次数', '4')
    .option('--strategy <name>', '压缩策略', 'sliding-window')
    .option('--dry-run', '只报告操作，不修改文件', false)
    .action(
      async (options: {
        directory: string;
        threshold?: string;
        modelContext: string;
        reservedOutput: string;
        systemToolOverhead: string;
        targetLiveHistory: string;
        summaryOutput: string;
        safetyMargin: string;
        tokenizer: string;
        tokenizerModel: string;
        keepRecent: string;
        strategy: string;
        dryRun?: boolean;
      }, command: Command) => {
        try {
          const threshold =
            options.threshold === undefined
              ? undefined
              : Number.parseInt(options.threshold, 10);
          const keepRecent = Number.parseInt(options.keepRecent, 10);
          if (threshold !== undefined && !Number.isInteger(threshold)) {
            throw new Error(`threshold 必须是整数: ${options.threshold}`);
          }
          if (!Number.isInteger(keepRecent)) {
            throw new Error(`keep-recent 必须是整数: ${options.keepRecent}`);
          }
          if (options.strategy !== 'sliding-window') {
            throw new Error(`不支持的压缩策略: ${options.strategy}`);
          }
          const budgetOptionNames = [
            'modelContext',
            'reservedOutput',
            'systemToolOverhead',
            'targetLiveHistory',
            'summaryOutput',
            'safetyMargin',
          ];
          if (
            threshold !== undefined &&
            budgetOptionNames.some(
              (name) => command.getOptionValueSource(name) === 'cli'
            )
          ) {
            throw new Error('threshold 不能与 budget 参数组合');
          }
          if (!['heuristic', 'tiktoken'].includes(options.tokenizer)) {
            throw new Error(`不支持的 tokenizer: ${options.tokenizer}`);
          }

          const parseBudgetInteger = (name: string, value: string): number => {
            const parsed = Number.parseInt(value, 10);
            if (!Number.isInteger(parsed)) {
              throw new Error(`${name} 必须是整数: ${value}`);
            }
            return parsed;
          };
          const tokenizer =
            options.tokenizer === 'tiktoken'
              ? await createTiktokenTokenizer(options.tokenizerModel)
              : heuristicTokenizer;

          let result;
          try {
            result = await compressDirectory({
              directory: options.directory,
              ...(threshold !== undefined
                ? { threshold }
                : {
                    budget: {
                      modelContextTokens: parseBudgetInteger(
                        'model-context',
                        options.modelContext
                      ),
                      reservedOutputTokens: parseBudgetInteger(
                        'reserved-output',
                        options.reservedOutput
                      ),
                      systemToolOverheadTokens: parseBudgetInteger(
                        'system-tool-overhead',
                        options.systemToolOverhead
                      ),
                      targetLiveHistoryTokens: parseBudgetInteger(
                        'target-live-history',
                        options.targetLiveHistory
                      ),
                      summaryOutputTokens: parseBudgetInteger(
                        'summary-output',
                        options.summaryOutput
                      ),
                      safetyMarginTokens: parseBudgetInteger(
                        'safety-margin',
                        options.safetyMargin
                      ),
                    },
                  }),
              tokenizer,
              keepRecent,
              strategy: options.strategy,
              dryRun: options.dryRun === true,
            });
          } finally {
            tokenizer.dispose?.();
          }

          console.log(
            `预算: mode=${result.budget.mode}, tokenizer=${result.budget.tokenizer.id}/${result.budget.tokenizer.model}, before=${result.budget.tokensBefore}, kept=${result.budget.keptHistoryTokens}, summary=${result.budget.summaryTokens}(${result.budget.summaryTokenBasis}), fixed=${result.budget.systemToolOverheadTokens}, reserved=${result.budget.reservedOutputTokens}, safety=${result.budget.safetyMarginTokens}, total=${result.budget.totalPlannedTokens}`
          );

          if (!result.compressed) {
            console.log(`跳过压缩: ${result.skipReason}`);
            if (result.dryRunPlan) {
              console.log(`dry-run 预计结果: ${result.dryRunPlan.outcome}`);
              console.log(
                `dry-run 将恢复 ${result.dryRunPlan.archivesToRestore} 个归档`
              );
              for (const action of result.dryRunPlan.recoveryActions) {
                console.log(`dry-run recovery: ${action}`);
              }
            }
            if (result.tokensBefore !== undefined) {
              console.log(`压缩前 token 估算: ${result.tokensBefore}`);
            }
            if (result.compressibleTokens !== undefined) {
              console.log(`可压缩 token 估算: ${result.compressibleTokens}`);
            }
            if (result.summaryIdx !== undefined) {
              console.log(`将生成 summary idx: ${result.summaryIdx}`);
            }
            return;
          }

          console.log(`已归档 ${result.turnsArchived} 个 idx group`);
          console.log(`保留 ${result.turnsKept} 个 idx group`);
          console.log(`压缩前 token 估算: ${result.tokensBefore}`);
          console.log(`压缩后 token 估算: ${result.tokensAfter}`);
          console.log(`summary idx: ${result.summaryIdx}`);
          console.log(`archive: ${result.archivePath}`);
        } catch (error) {
          console.error(
            `promptpile-compress compress: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          exitCode = 1;
        }
      }
    );

  program
    .command('restore')
    .description('将压缩归档还原到消息目录')
    .requiredOption('-d, --directory <path>', '消息目录路径')
    .option('--dry-run', '只报告操作，不修改文件', false)
    .action(async (options: { directory: string; dryRun?: boolean }) => {
      try {
        const result = await restoreArchivedTurns({
          directory: options.directory,
          dryRun: options.dryRun === true,
        });
        if (!result.restored) {
          console.log(`跳过还原: ${result.skipReason}`);
          for (const action of result.recoveryActions) {
            console.log(`recovery: ${action.detail}`);
          }
          if (result.turnsRestored !== undefined) {
            console.log(`将还原 ${result.turnsRestored} 个 idx group`);
          }
          if (result.archivesRestored !== undefined) {
            console.log(`将清理 ${result.archivesRestored} 个压缩归档`);
          }
          return;
        }
        console.log(`已还原 ${result.turnsRestored} 个 idx group`);
        console.log(`已清理 ${result.archivesRestored} 个压缩归档`);
      } catch (error) {
        console.error(
          `promptpile-compress restore: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        exitCode = 1;
      }
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    if (isCommanderHelpExit(error)) {
      return 0;
    }
    return 1;
  }
  return exitCode;
};

if (require.main === module) {
  void parseCli().then((code) => {
    process.exitCode = code;
  });
}

export { recover, restoreArchivedTurns } from './restore';
export type { RecoveryOptions, RestoreOptions, RestoreResult } from './restore';
export { compressDirectory, runCompressionBeforeCompletion } from './compress';
export { createTiktokenTokenizer, heuristicTokenizer } from './compress';
export type {
  CompressDryRunPlan,
  CompressOptions,
  CompressResult,
  CompressSkipReason,
  CompressionLifecycleOptions,
  CompressionLifecycleResult,
  CompressionCommitReport,
  CompressionDecisionReport,
  CompressionOperationReport,
  ContextBudgetOptions,
  ContextBudgetReport,
  LifecycleErrorCode,
  OperationPhaseReport,
  SemanticSummaryArtifact,
  SemanticSummaryDocument,
  SemanticSummaryItem,
  SemanticSummaryProvider,
  SemanticSummaryRequest,
  SemanticSummaryTurn,
  SummaryKind,
  SummaryOptions,
  TokenizerAdapter,
} from './compress';
export * from './lifecycle/mutation';
