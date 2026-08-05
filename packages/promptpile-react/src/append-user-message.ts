import {
  invokePromptpileAsync,
  type PromptpileSpawnConfig
} from './promptpile-invoker';

/**
 * 通过公开 CLI 将终端输入写入 `-d` 目录的下一条 user 消息文件。
 */
export async function appendUserFromTerminal(
  spawnConfig: PromptpileSpawnConfig,
  directory: string,
  content: string,
  cwd: string
): Promise<void> {
  const result = await invokePromptpileAsync(
    spawnConfig,
    ['conversation', 'append-user', '-d', directory, '--quiet'],
    { cwd, quiet: true, stdin: content }
  );

  if (result.error) {
    throw new Error(
      `Unable to run promptpile conversation append-user: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    const tail = result.stderr.trim().slice(-500);
    const detail = tail === '' ? '' : `: ${tail}`;
    throw new Error(
      `promptpile conversation append-user exited with code ${result.status ?? 'null'}${detail}`
    );
  }
}
