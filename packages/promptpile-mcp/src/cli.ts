import path from 'path';
import { Command } from 'commander';
import { assertHttpUrl, parsePortArg } from './cli-shared';
import { runCheck } from './commands/check';
import { runExecCalls } from './commands/exec-calls';
import { runExportTools } from './commands/export-tools';
import { runLaunch } from './commands/launch';

function isCommanderHelpExit(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return false;
  }
  const code = (err as { code?: string }).code;
  return code === 'commander.helpDisplayed' || code === 'commander.help';
}

export async function parseCli(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0) {
    console.error(
      'promptpile-mcp: 请指定子命令：launch | export-tools | exec-calls | check'
    );
    console.error('运行 promptpile-mcp --help 查看帮助。');
    return 1;
  }

  let exitCode = 0;
  const program = new Command()
    .name('promptpile-mcp')
    .description(
      'promptpile 的 MCP 适配：launch 在本机启动 HTTP 网关（可选 stdio MCP）；export-tools 拉取工具为 .tools.toml；exec-calls 执行 *.calls.jsonl；check 检查 calls/result 状态。'
    )
    .version('0.1.0')
    .helpOption('-h, --help', '显示帮助');

  program.exitOverride();

  program
    .command('launch')
    .description('加载 mcp.toml 并启动本机 HTTP 网关')
    .option('--config <path>', 'mcp.toml 或 .mcp.json 路径')
    .option(
      '--port <n>',
      '监听端口（整数 1–65535）；可与配置文件 [gateway].port 合并（CLI 优先）'
    )
    .option('--token <secret>', '可选；启用 Bearer 鉴权（CLI 覆盖配置文件）')
    .action(async (opts: { config?: string; port?: string; token?: string }) => {
      const configPath =
        (opts.config && opts.config.trim()) ||
        (process.env.MCP_CONFIG && process.env.MCP_CONFIG.trim()) ||
        '';
      if (!configPath) {
        console.error(
          'promptpile-mcp: 须通过 --config 或环境变量 MCP_CONFIG 指定配置文件。'
        );
        exitCode = 1;
        return;
      }
      if (opts.port !== undefined) {
        try {
          parsePortArg(opts.port);
        } catch (e) {
          console.error(e instanceof Error ? e.message : String(e));
          exitCode = 1;
          return;
        }
      }
      exitCode = await runLaunch({
        configPath,
        port: opts.port,
        token: opts.token,
      });
    });

  program
    .command('export-tools')
    .description('连接 launch 网关并生成 .tools.toml')
    .requiredOption(
      '--base-url <url>',
      'launch 网关根地址，例如 http://127.0.0.1:8765'
    )
    .option(
      '-o, --output <path>',
      '输出 .tools.toml 路径',
      path.join(process.cwd(), '.tools.toml')
    )
    .option(
      '--token <secret>',
      '可选；网关 Bearer 鉴权（GET /v1/tools/export 等请求携带 Authorization）'
    )
    .action(async (opts: { baseUrl: string; output: string; token?: string }) => {
      try {
        assertHttpUrl(opts.baseUrl);
      } catch (e) {
        console.error(e instanceof Error ? e.message : String(e));
        exitCode = 1;
        return;
      }
      exitCode = await runExportTools({
        baseUrl: opts.baseUrl.trim(),
        output: opts.output,
        token: opts.token,
      });
    });

  program
    .command('check')
    .description('检查一个 calls 文件及其配对 result 的执行状态')
    .requiredOption('--input <path>', '要检查的 .calls.jsonl 文件')
    .action(async (opts: { input: string }) => {
      exitCode = await runCheck({ input: opts.input });
    });

  program
    .command('exec-calls')
    .description(
      '经网关执行 tool calls：目录模式扫描 --dir 下 *.calls.jsonl，或单文件模式 --input'
    )
    .requiredOption(
      '--base-url <url>',
      'launch 网关根地址，例如 http://127.0.0.1:8765'
    )
    .option(
      '--dir <path>',
      '目录模式：仅扫描当前目录第一层的 *.calls.jsonl（与 --input 互斥；未指定时默认当前工作目录）'
    )
    .option(
      '--input <path>',
      '单文件模式：一个 .calls.jsonl（与 --dir 互斥；默认同目录 stem.result.jsonl，可用 --output 覆盖）'
    )
    .option(
      '--output <path>',
      '单文件模式：result 输出路径（仅与 --input 一起使用）'
    )
    .option(
      '--token <secret>',
      '可选；网关 Bearer 鉴权（POST /v1/calls/exec 等请求携带 Authorization）'
    )
    .option(
      '--overwrite-results',
      '覆盖已存在的 stem.result.jsonl（默认仅处理尚无配对 result 的 *.calls.jsonl）'
    )
    .option('--timeout-ms <ms>', '每个 calls 文件请求网关的整体超时（默认 120000）', '120000')
    .action(
      async (opts: {
        baseUrl: string;
        dir?: string;
        input?: string;
        output?: string;
        token?: string;
        overwriteResults?: boolean;
        timeoutMs: string;
      }) => {
        try {
          assertHttpUrl(opts.baseUrl);
        } catch (e) {
          console.error(e instanceof Error ? e.message : String(e));
          exitCode = 1;
          return;
        }
        const timeoutMs = Number(opts.timeoutMs);
        if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
          console.error('promptpile-mcp: --timeout-ms 须为正整数');
          exitCode = 1;
          return;
        }
        exitCode = await runExecCalls({
          baseUrl: opts.baseUrl.trim(),
          dir: opts.dir,
          input: opts.input,
          output: opts.output,
          token: opts.token,
          overwriteResults: opts.overwriteResults === true,
          requestTimeoutMs: timeoutMs,
        });
      }
    );

  try {
    await program.parseAsync(process.argv);
  } catch (err: unknown) {
    if (isCommanderHelpExit(err)) {
      return 0;
    }
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code?.startsWith('commander.')) {
      return 1;
    }
    if (
      typeof err === 'object' &&
      err !== null &&
      'message' in err &&
      typeof (err as { message: unknown }).message === 'string'
    ) {
      console.error((err as { message: string }).message);
    }
    return 1;
  }

  return exitCode;
}
