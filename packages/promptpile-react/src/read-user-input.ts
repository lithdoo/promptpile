import readline from 'readline';

/**
 * 与 `packages/promptpile/src/index.ts` 中 `readUserInputFromTerminal` 一致：
 * 多行输入以 Ctrl+Z+Enter（Windows）或 Ctrl+D（Unix）结束。
 */
export async function readUserInputFromTerminal(): Promise<string> {
  console.log(
    'Enter user message. Finish with Ctrl+Z then Enter (Windows), or Ctrl+D (macOS/Linux).'
  );
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const lines: string[] = [];
  for await (const line of rl) {
    lines.push(line);
  }

  rl.close();
  return lines.join('\n').trim();
}
