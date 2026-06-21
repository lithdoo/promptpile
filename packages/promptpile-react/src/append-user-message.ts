import path from 'path';

import { appendUserMessage, scanDirectory } from 'promptpile/dist/file-handler';

/**
 * 将终端输入写入 `-d` 目录的下一条 user 消息文件（语义与 `promptpile -i` 相同）。
 *
 * @returns 写入文件的绝对路径或相对路径字符串（由 `appendUserMessage` 返回）
 */
export function appendUserFromTerminal(directory: string, content: string): string {
  const dirAbs = path.resolve(process.cwd(), directory);
  let files = scanDirectory(dirAbs);
  const writtenPath = appendUserMessage(dirAbs, files, content);
  files = scanDirectory(dirAbs);
  if (files.length === 0) {
    throw new Error('No message files after appendUserMessage; directory may be invalid.');
  }
  return writtenPath;
}
