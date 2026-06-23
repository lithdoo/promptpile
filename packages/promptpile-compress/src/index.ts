#!/usr/bin/env node
import { Command } from 'commander';
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
