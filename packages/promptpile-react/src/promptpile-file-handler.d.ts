declare module 'promptpile/dist/file-handler' {
  /** Scanned message file row（与 `promptpile` 内部一致；此处仅声明调用所需字段）。 */
  export interface FileInfo {
    idx: number;
    path: string;
    role: string;
    extension: string;
    fileKind: string;
  }

  export function scanDirectory(directory: string): FileInfo[];

  export function appendUserMessage(
    directory: string,
    files: FileInfo[],
    content: string
  ): string;
}
