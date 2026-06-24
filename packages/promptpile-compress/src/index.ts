#!/usr/bin/env node
import { Command } from 'commander';
import { compressDirectory } from './compress';
import { restoreArchivedTurns } from './restore';

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
    .description('独立的会话目录压缩与检索工具')
    .version('0.1.0')
    .helpOption('-h, --help', '显示帮助')
    .exitOverride();

  program
    .command('compress')
    .description('压缩消息目录中的历史轮次，减少上下文 token 消耗')
    .requiredOption('-d, --directory <path>', '消息目录路径')
    .option('--threshold <number>', 'token 阈值，超过时执行压缩', '32000')
    .option('--keep-recent <number>', '保留最近轮次数', '4')
    .option('--strategy <name>', '压缩策略', 'sliding-window')
    .option('--dry-run', '只报告操作，不修改文件', false)
    .action(
      async (options: {
        directory: string;
        threshold: string;
        keepRecent: string;
        strategy: string;
        dryRun?: boolean;
      }) => {
        try {
          const threshold = Number.parseInt(options.threshold, 10);
          const keepRecent = Number.parseInt(options.keepRecent, 10);
          if (!Number.isInteger(threshold)) {
            throw new Error(`threshold 必须是整数: ${options.threshold}`);
          }
          if (!Number.isInteger(keepRecent)) {
            throw new Error(`keep-recent 必须是整数: ${options.keepRecent}`);
          }
          if (options.strategy !== 'sliding-window') {
            throw new Error(`不支持的压缩策略: ${options.strategy}`);
          }

          const result = await compressDirectory({
            directory: options.directory,
            threshold,
            keepRecent,
            strategy: options.strategy,
            dryRun: options.dryRun === true,
          });

          if (!result.compressed) {
            console.log(`跳过压缩: ${result.skipReason}`);
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

export * from './restore';
export * from './compress';
